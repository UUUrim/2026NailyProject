"""
Naily 서비스 - ComfyUI 워크플로우를 diffusers + transformers 코드로 재현한 파이프라인 모음.

기능 4종:
1. txt2img_generate   : 프롬프트 기반 이미지 생성 (GPU 필요, 무거움) -> main_gen.py
2. inpaint_generate    : 텍스트 프롬프트 기반 자동 마스크 인페인팅 (GPU 필요, 무거움) -> main_gen.py
3. separate_parts      : 파츠 검출 + 인스턴스 분리 (상대적으로 가벼움) -> main_detect.py
4. extract_colors_per_nail : 손톱별 컬러 추출, 그라데이션/프렌치 대응 (상대적으로 가벼움) -> main_detect.py

1,2번은 GPU(diffusion 모델)가 필요해서 무거운 서버에서,
3,4번은 GroundingDINO+SAM만 쓰고 diffusion 모델은 필요 없어서
상대적으로 가벼운 별도 서버에서 돌릴 수 있도록 main_gen.py / main_detect.py로 분리했습니다.
"""

import io
import base64
import time
import pathlib
from functools import lru_cache

import torch
import numpy as np
import cv2
from PIL import Image, ImageFilter, ImageDraw

from app.config import (
    BASE_MODEL_ID,
    LORA_PATH,
    LORA_STRENGTH,
    GROUNDING_DINO_ID,
    SAM_ID,
    DEVICE,
    DTYPE,
    USE_CPU_OFFLOAD,
    DEBUG_SEGMENT_LOG,
    DEBUG_SEGMENT_IMAGES,
)

DEBUG_OUTPUT_DIR = pathlib.Path("debug_output")


def _place_pipe(pipe):
    if USE_CPU_OFFLOAD:
        pipe.enable_model_cpu_offload()
    else:
        pipe.to(DEVICE)
    return pipe


# ---------------------------------------------------------------------------
# 1. txt2img_generate (main_gen.py 전용)
# ---------------------------------------------------------------------------
@lru_cache(maxsize=1)
def get_txt2img_pipe():
    from diffusers import ZImagePipeline

    pipe = ZImagePipeline.from_pretrained(BASE_MODEL_ID, torch_dtype=DTYPE)
    _place_pipe(pipe)

    if "naily" not in pipe.get_list_adapters().get("transformer", []):
        pipe.load_lora_weights(LORA_PATH, adapter_name="naily")
    pipe.set_adapters(["naily"], adapter_weights=[LORA_STRENGTH])
    return pipe


def txt2img_generate(
    prompt: str,
    negative_prompt: str = "",
    seed: int | None = 647744376769594,
    steps: int = 30,
    guidance_scale: float = 3,
    width: int = 768,
    height: int = 512,
) -> Image.Image:
    pipe = get_txt2img_pipe()
    generator = torch.Generator(DEVICE).manual_seed(seed) if seed is not None else None
    image = pipe(
        prompt=prompt,
        negative_prompt=negative_prompt or None,
        num_inference_steps=steps,
        guidance_scale=guidance_scale,
        width=width,
        height=height,
        generator=generator,
    ).images[0]
    return image


# ---------------------------------------------------------------------------
# 2. inpaint_generate (main_gen.py 전용)
# ---------------------------------------------------------------------------
@lru_cache(maxsize=1)
def get_inpaint_pipe():
    from diffusers import ZImageInpaintPipeline

    # txt2img 파이프라인과 동일한 가중치를 재사용해서 VRAM에 모델을 두 벌 올리지 않도록 함
    base = get_txt2img_pipe()
    pipe = ZImageInpaintPipeline(**base.components)
    return pipe


def inpaint_generate(
    image: Image.Image,
    prompt: str,
    mask_prompt: str = "nail tip with small silver metallic stud",
    mask_image: Image.Image | None = None,
    seed: int | None = 692153262017725,
    steps: int = 30,
    strength: float = 0.8,
    guidance_scale: float = 3,
    threshold: float = 0.35,
    mask_offset: int = 8,
    grow_mask_by: int = 20,
) -> Image.Image:
    """
    mask_image를 직접 주지 않으면 mask_prompt로 GroundingDINO+SAM 자동 탐지.
    마스크는 2단계로 확장됨: mask_offset(SegmentV2 자체) -> grow_mask_by(추가 확장).

    prompt에는 마스크 안쪽에 유지하고 싶은 요소(베이스 컬러 등)를 다시 명시해야 함 -
    마스크가 넓게 잡히면 prompt에 없는 요소는 임의로 재생성됨.
    """
    pipe = get_inpaint_pipe()
    generator = torch.Generator(DEVICE).manual_seed(seed) if seed is not None else None

    if mask_image is None:
        _, mask_image = segment_v2(
            image, mask_prompt, threshold=threshold, mask_offset=mask_offset,
            background="alpha", debug_tag="inpaint",
        )

    if grow_mask_by > 0:
        mask_image = _grow_mask(mask_image, grow_mask_by)

    if image.size != mask_image.size:
        mask_image = mask_image.resize(image.size)

    result = pipe(
        prompt,
        image=image.convert("RGB"),
        mask_image=mask_image,
        strength=strength,
        num_inference_steps=steps,
        guidance_scale=guidance_scale,
        generator=generator,
    ).images[0]
    return result


# ---------------------------------------------------------------------------
# 공통: SegmentV2 (RMBG) 재현 = GroundingDINO 텍스트 탐지 + SAM 정밀 마스크
# main_gen.py(inpaint용), main_detect.py(parts/colors용) 둘 다에서 사용
# ---------------------------------------------------------------------------
@lru_cache(maxsize=1)
def get_grounding_dino():
    from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection

    processor = AutoProcessor.from_pretrained(GROUNDING_DINO_ID)
    # CPU에 로드해두고, 실제 추론 직전에만 GPU로 올림 (ComfyUI 스마트 메모리 관리 방식)
    model = AutoModelForZeroShotObjectDetection.from_pretrained(GROUNDING_DINO_ID).eval()
    return processor, model


@lru_cache(maxsize=1)
def get_sam():
    from transformers import SamModel, SamProcessor

    processor = SamProcessor.from_pretrained(SAM_ID)
    model = SamModel.from_pretrained(SAM_ID).eval()
    return processor, model


def _grow_mask(mask: Image.Image, pixels: int) -> Image.Image:
    """마스크를 pixels 만큼 팽창(양수) 또는 침식(음수)."""
    arr = np.array(mask)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (abs(pixels) * 2 + 1,) * 2)
    if pixels >= 0:
        arr = cv2.dilate(arr, kernel)
    else:
        arr = cv2.erode(arr, kernel)
    return Image.fromarray(arr)


def segment_v2(
    image: Image.Image,
    prompt: str,
    threshold: float = 0.4,
    mask_blur: int = 0,
    mask_offset: int = 0,
    invert_output: bool = False,
    background: str = "alpha",
    background_color: str = "#222222",
    debug_tag: str = "segment",
) -> tuple[Image.Image, Image.Image]:
    """
    ComfyUI 'Segmentation V2 (RMBG)' 노드 재현.
    반환: (배경 처리된 이미지, 마스크(L 모드, 흰색=탐지 영역))
    여러 인스턴스가 탐지되면 하나의 마스크로 합쳐짐 - 개별 분리는 separate_parts() 참고.
    """
    image = image.convert("RGB")

    norm_prompt = prompt.strip()
    if not norm_prompt.endswith("."):
        norm_prompt += "."

    dino_processor, dino_model = get_grounding_dino()
    dino_model.to(DEVICE)

    inputs = dino_processor(images=image, text=norm_prompt, return_tensors="pt").to(DEVICE)
    with torch.no_grad():
        outputs = dino_model(**inputs)
    results = dino_processor.post_process_grounded_object_detection(
        outputs,
        input_ids=inputs.input_ids,
        threshold=threshold,
        target_sizes=[image.size[::-1]],
    )[0]
    boxes = results["boxes"]
    scores_list = results.get("scores", [])

    dino_model.to("cpu")
    torch.cuda.empty_cache()

    if DEBUG_SEGMENT_LOG:
        print(f"  [segment_v2:{debug_tag}] prompt='{norm_prompt}' threshold={threshold}")
        print(f"  [segment_v2:{debug_tag}] GroundingDINO 탐지 개수: {len(boxes)}")
        for i, box in enumerate(boxes):
            score = scores_list[i].item() if len(scores_list) > i else None
            print(f"    - box {i}: {box.tolist()} score={score}")
        if len(boxes) == 0:
            print(f"  [segment_v2:{debug_tag}] ⚠ 탐지된 게 없습니다. "
                  f"threshold를 낮추거나(예: 0.2~0.3) 프롬프트를 더 단순하게 바꿔보세요.")

    h, w = image.size[1], image.size[0]
    if len(boxes) == 0:
        combined_mask = np.zeros((h, w), dtype=bool)
        sam_ran = False
    else:
        sam_processor, sam_model = get_sam()
        sam_model.to(DEVICE)

        input_boxes = [[box.tolist() for box in boxes]]
        sam_inputs = sam_processor(image, input_boxes=input_boxes, return_tensors="pt").to(DEVICE)
        with torch.no_grad():
            sam_outputs = sam_model(**sam_inputs)
        masks = sam_processor.image_processor.post_process_masks(
            sam_outputs.pred_masks.cpu(),
            sam_inputs["original_sizes"].cpu(),
            sam_inputs["reshaped_input_sizes"].cpu(),
        )[0]
        scores = sam_outputs.iou_scores.cpu()[0]

        combined_mask = np.zeros((h, w), dtype=bool)
        sam_scores_log = []
        for i in range(masks.shape[0]):
            best = scores[i].argmax().item()
            sam_scores_log.append(round(scores[i, best].item(), 4))
            combined_mask |= masks[i, best].numpy().astype(bool)
        sam_ran = True

        sam_model.to("cpu")
        torch.cuda.empty_cache()

        if DEBUG_SEGMENT_LOG:
            print(f"  [segment_v2:{debug_tag}] SAM 실행 완료, box별 최고 IoU score: {sam_scores_log}")

    mask_img = Image.fromarray((combined_mask * 255).astype(np.uint8))

    if mask_offset != 0:
        mask_img = _grow_mask(mask_img, mask_offset)
    if mask_blur > 0:
        mask_img = mask_img.filter(ImageFilter.GaussianBlur(mask_blur))
    if invert_output:
        mask_img = Image.eval(mask_img, lambda x: 255 - x)

    if background == "alpha":
        out_img = image.convert("RGBA")
        out_img.putalpha(mask_img)
    else:
        bg_rgb = tuple(int(background_color.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
        bg = Image.new("RGB", image.size, bg_rgb)
        out_img = Image.composite(image, bg, mask_img)

    if DEBUG_SEGMENT_IMAGES:
        _save_segment_debug(image, boxes, mask_img, debug_tag, sam_ran)

    return out_img, mask_img


def _save_segment_debug(image, boxes, mask_img, debug_tag, sam_ran) -> None:
    """GroundingDINO 박스 + SAM 마스크를 눈으로 확인할 수 있게 debug_output/ 에 저장."""
    DEBUG_OUTPUT_DIR.mkdir(exist_ok=True)
    ts = time.strftime("%H%M%S")

    box_vis = image.convert("RGB").copy()
    draw = ImageDraw.Draw(box_vis)
    for box in boxes:
        x1, y1, x2, y2 = [float(v) for v in box.tolist()]
        draw.rectangle([x1, y1, x2, y2], outline=(255, 0, 0), width=3)
    box_path = DEBUG_OUTPUT_DIR / f"{debug_tag}_{ts}_1_boxes.png"
    box_vis.save(box_path)

    mask_path = DEBUG_OUTPUT_DIR / f"{debug_tag}_{ts}_2_mask.png"
    mask_img.save(mask_path)

    overlay = image.convert("RGBA").copy()
    red_layer = Image.new("RGBA", image.size, (255, 0, 0, 0))
    mask_rgba = Image.new("RGBA", image.size, (255, 0, 0, 120))
    red_layer.paste(mask_rgba, mask=mask_img)
    overlay = Image.alpha_composite(overlay, red_layer)
    overlay_path = DEBUG_OUTPUT_DIR / f"{debug_tag}_{ts}_3_overlay.png"
    overlay.convert("RGB").save(overlay_path)

    print(f"  [segment_v2:{debug_tag}] 디버그 이미지 저장 (SAM 실행됨={sam_ran}):")
    print(f"    - 박스: {box_path}")
    print(f"    - 마스크: {mask_path}")
    print(f"    - 오버레이: {overlay_path}")


# ---------------------------------------------------------------------------
# 3. separate_parts (main_detect.py 전용)
# ---------------------------------------------------------------------------
def separate_parts(
    image: Image.Image,
    part_prompts: list[str],
    threshold: float = 0.4,
    min_area: int = 30,
) -> dict[str, list[Image.Image]]:
    """
    각 phrase에 대해 segment_v2()로 통합 마스크를 얻은 뒤,
    cv2.connectedComponents로 인스턴스별로 쪼개서 개별 배경제거 PNG 리스트로 반환.

    part_prompts 예: ["bow on nail tip", "star on nail tip", "white pearl on nail tip"]
    """
    results: dict[str, list[Image.Image]] = {}
    rgb_image = image.convert("RGB")

    for phrase in part_prompts:
        safe_tag = f"parts_{phrase.replace(' ', '_')}"
        _, union_mask = segment_v2(
            rgb_image, phrase, threshold=threshold, background="alpha", debug_tag=safe_tag
        )
        mask_arr = (np.array(union_mask) > 127).astype(np.uint8)
        num_labels, labels = cv2.connectedComponents(mask_arr)

        crops: list[Image.Image] = []
        for label_id in range(1, num_labels):
            instance_mask = (labels == label_id).astype(np.uint8)
            if instance_mask.sum() < min_area:
                continue

            ys, xs = np.where(instance_mask > 0)
            x1, x2 = xs.min(), xs.max() + 1
            y1, y2 = ys.min(), ys.max() + 1

            crop = rgb_image.crop((x1, y1, x2, y2)).convert("RGBA")
            crop_mask = Image.fromarray((instance_mask[y1:y2, x1:x2] * 255).astype(np.uint8))
            crop.putalpha(crop_mask)
            crops.append(crop)

        results[phrase] = crops

    return results


# ---------------------------------------------------------------------------
# 4. extract_colors_per_nail (main_detect.py 전용)
# ---------------------------------------------------------------------------
def extract_colors_per_nail(
    image: Image.Image,
    segment_prompt: str = "nail tip",
    threshold: float = 0.35,
    mask_shrink: int = 6,
    min_area: int = 200,
    color_diff_threshold: float = 40.0,
) -> list[dict]:
    """
    손톱을 개별 인스턴스로 분리한 뒤, 손톱마다 1~2개의 대표색을 추출.
    - 단색 손톱: 1개 색
    - 그라데이션/프렌치처럼 색이 뚜렷이 두 영역으로 나뉘는 손톱: 2개 색 (면적 큰 순)
    - RGB 거리뿐 아니라 Hue(색조) 거리도 확인해서, 파츠 그림자(밝기만 다름)를
      진짜 색 차이와 구분함

    반환 예시:
        [
          {"nail_index": 0, "colors": ["#f3c2c2"]},
          {"nail_index": 1, "colors": ["#ffffff", "#e8a0b0"]},
          ...
        ]
    """
    from sklearn.cluster import KMeans

    rgb_image = image.convert("RGB")
    _, union_mask = segment_v2(
        rgb_image, segment_prompt, threshold=threshold, mask_offset=-mask_shrink,
        background="alpha", debug_tag="colors_per_nail",
    )
    mask_arr = (np.array(union_mask) > 127).astype(np.uint8)
    num_labels, labels = cv2.connectedComponents(mask_arr)

    img_arr = np.array(rgb_image)
    results = []

    component_ids = [i for i in range(1, num_labels) if (labels == i).sum() >= min_area]
    component_ids.sort(key=lambda i: np.where(labels == i)[1].min())

    for nail_index, label_id in enumerate(component_ids):
        ys, xs = np.where(labels == label_id)
        pixels = img_arr[ys, xs]
        if len(pixels) < 2:
            continue

        kmeans = KMeans(n_clusters=2, n_init=4, random_state=42)
        km_labels = kmeans.fit_predict(pixels)
        centers = kmeans.cluster_centers_
        counts = np.bincount(km_labels)
        color_dist = np.linalg.norm(centers[0] - centers[1])

        # Hue(색조)가 비슷하면 밝기 차이(그림자)일 뿐 실제 디자인 색은 같다고 판단
        hsv0 = cv2.cvtColor(np.uint8([[centers[0]]]), cv2.COLOR_RGB2HSV)[0][0]
        hsv1 = cv2.cvtColor(np.uint8([[centers[1]]]), cv2.COLOR_RGB2HSV)[0][0]
        hue_dist = min(abs(int(hsv0[0]) - int(hsv1[0])), 180 - abs(int(hsv0[0]) - int(hsv1[0])))
        is_same_hue_family = hue_dist < 15

        if color_dist < color_diff_threshold or is_same_hue_family:
            avg = pixels.mean(axis=0).astype(int)
            colors = ["#{:02x}{:02x}{:02x}".format(*avg)]
        else:
            order = np.argsort(-counts)
            colors = ["#{:02x}{:02x}{:02x}".format(*centers[i].astype(int)) for i in order]

        results.append({"nail_index": nail_index, "colors": colors})

    return results


# ---------------------------------------------------------------------------
# 유틸: base64 <-> PIL
# ---------------------------------------------------------------------------
def image_to_b64(image: Image.Image, fmt: str = "PNG") -> str:
    buf = io.BytesIO()
    image.save(buf, format=fmt)
    return base64.b64encode(buf.getvalue()).decode()


def b64_to_image(b64_str: str) -> Image.Image:
    data = base64.b64decode(b64_str)
    return Image.open(io.BytesIO(data)).convert("RGBA")
