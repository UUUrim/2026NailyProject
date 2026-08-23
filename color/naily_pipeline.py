"""
naily_pipeline.py
=================
원본 손가락 사진 → SAM+GroundingDINO 손가락 마스크 → 위치 기반 손톱 제거 → 피부톤 분석

설치:
    pip install torch torchvision segment-anything opencv-python pillow numpy
    pip install --no-build-isolation git+https://github.com/IDEA-Research/GroundingDINO.git
    pip install transformers==4.48.0

모델 다운로드:
    curl -L https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth -o sam_vit_h_4b8939.pth
    curl -L https://github.com/IDEA-Research/GroundingDINO/releases/download/v0.1.0-alpha/groundingdino_swint_ogc.pth -o groundingdino_swint_ogc.pth
    curl -L https://raw.githubusercontent.com/IDEA-Research/GroundingDINO/main/groundingdino/config/GroundingDINO_SwinT_OGC.py -o GroundingDINO_SwinT_OGC.py

사용법:
    python naily_pipeline.py --mode calibrate 박스사진.jpg
    python naily_pipeline.py --mode single 손가락.jpg
    python naily_pipeline.py --mode multi w.jpg d.jpg --names 원지 도경
    python naily_pipeline.py --mode 10fingers finger\\d --person 도경
"""

from __future__ import annotations
import argparse
import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np
import requests as _requests
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from naily_color import (
    SkinToneAnalyzer, lab_to_rgb_hex,
    relative_classify, aggregate_fingers, FINGER_NAMES,
)

# ── 설정 ──────────────────────────────────────────────────────────────────────
BOX_CALIB_JSON   = "box_calib.json"
BOX_GAIN_MAP_NPY = "box_gain_map.npy"

NAIL_TOP_RATIO = 0.20
BOTTOM_RATIO   = 0.05

# 검출 서버 URL (ngrok 또는 로컬)
DETECT_URL = os.environ.get("NAILY_DETECT_URL", "http://localhost:8001")


# =============================================================================
# 1. 원격 검출 서버 호출
# =============================================================================

def segment_skin_remote(image_rgb: np.ndarray, detect_url: str = None) -> np.ndarray:
    """
    검출 서버(/segment_skin)를 호출해서 피부 마스크 RGBA 이미지를 받아온다.
    로컬에 SAM/GroundingDINO 없이 동작.

    Returns:
        PIL RGBA Image
    """
    import base64, io
    url = detect_url or DETECT_URL

    # numpy → base64
    pil = Image.fromarray(image_rgb)
    buf = io.BytesIO()
    pil.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()

    resp = _requests.post(
        f"{url}/segment_skin",
        json={
            "image_base64":  b64,
            "finger_prompt": "finger",
            "threshold":     0.35,
            "nail_top_ratio": NAIL_TOP_RATIO,
            "bottom_ratio":  BOTTOM_RATIO,
        },
        timeout=120,
    )
    if not resp.ok:
        raise RuntimeError(f"검출 서버 오류 {resp.status_code}: {resp.text}")

    data     = resp.json()
    rgba_b64 = data["rgba_image_base64"]
    px_count = data.get("pixel_count", 0)
    print(f"[seg] 원격 seg 완료  피부픽셀={px_count}")

    rgba_bytes = base64.b64decode(rgba_b64)
    return Image.open(io.BytesIO(rgba_bytes)).convert("RGBA")


# =============================================================================
# 3. QR 보정
# =============================================================================

class BoxCorrector:
    def __init__(self, calib_json=BOX_CALIB_JSON):
        self.qr_ref = None
        if os.path.exists(calib_json):
            with open(calib_json) as f:
                c = json.load(f)
            self.qr_ref = np.array(c["qr_ref_rgb"], dtype=np.float32)
            print(f"[box] 캘리브레이션 로드 (QR기준: {self.qr_ref.round(3)})")
        else:
            print("[box] 캘리브레이션 없음")

    def apply(self, rgb: np.ndarray, qr_sample=None) -> np.ndarray:
        result = rgb.copy()
        if qr_sample is not None and self.qr_ref is not None:
            factor = np.clip(self.qr_ref / np.clip(qr_sample, 1e-3, None), 0.7, 1.5)
            result = result * factor[None, None, :]
        return np.clip(result, 0.0, 1.0)

    @property
    def is_active(self):
        return self.qr_ref is not None


def sample_qr_white(image_rgb: np.ndarray):
    H, W = image_rgb.shape[:2]
    region = image_rgb[H//3:2*H//3, W//8:W//3].astype(np.float32) / 255.0
    bright = region.mean(axis=2) > 0.7
    if bright.sum() < 50:
        return None
    return region[bright].mean(axis=0)


# =============================================================================
# 4. 공통 전처리
# =============================================================================

def preprocess(image_path: str, corrector: BoxCorrector,
               save_seg=False, prefix="", detect_url=None) -> Image.Image:
    try:
        image_bgr = cv2.imdecode(np.fromfile(image_path, dtype=np.uint8), cv2.IMREAD_COLOR)
    except Exception:
        image_bgr = None
    if image_bgr is None:
        raise FileNotFoundError(f"이미지를 열 수 없음: {image_path}")

    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)

    # QR 보정
    if corrector.is_active:
        qr_sample = sample_qr_white(image_rgb)
        corrected = corrector.apply(image_rgb.astype(np.float32) / 255.0, qr_sample)
        image_rgb = (corrected * 255).astype(np.uint8)

    # 원격 seg
    pil_rgba = segment_skin_remote(image_rgb, detect_url=detect_url)

    if save_seg:
        seg_path = f"{prefix}{Path(image_path).stem}_seg.png"
        pil_rgba.save(seg_path)
        print(f"[seg] 저장: {seg_path}")

    return pil_rgba


def preprocess_bytes(image_bytes: bytes, corrector: BoxCorrector,
                      detect_url=None) -> Image.Image:
    """
    실시간 업로드용: 파일 경로 대신 원본 바이트를 바로 받아서
    QR보정 → 원격 seg 까지 처리. (임시파일 안 씀)
    """
    image_bgr = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image_bgr is None:
        raise ValueError("이미지 디코딩 실패 (잘못된 이미지 데이터)")

    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)

    if corrector.is_active:
        qr_sample = sample_qr_white(image_rgb)
        corrected = corrector.apply(image_rgb.astype(np.float32) / 255.0, qr_sample)
        image_rgb = (corrected * 255).astype(np.uint8)

    return segment_skin_remote(image_rgb, detect_url=detect_url)


# =============================================================================
# 5. 단일 파이프라인
# =============================================================================

def run_pipeline(image_path: str, save_seg=True) -> dict:
    print(f"\n{'='*50}")
    print(f"[pipeline] 시작: {image_path}")
    print(f"{'='*50}")

    corrector = BoxCorrector()
    pil_img   = preprocess(image_path, corrector, save_seg=save_seg)

    analyzer = SkinToneAnalyzer()
    metrics  = analyzer.analyze(pil_img)
    hex_val  = lab_to_rgb_hex(metrics.L, metrics.a, metrics.b)

    print(f"\n[결과] L={metrics.L}  a={metrics.a}  b={metrics.b}")
    print(f"[결과] warmness={metrics.warmness}  brightness={metrics.brightness:.3f}")
    print(f"[결과] saturation={metrics.saturation:.3f}  contrast={metrics.contrast:.3f}")
    print(f"[결과] undertone={metrics.undertone}  skinHex={hex_val}")
    print(f"[결과] 유효픽셀={metrics.pixel_count}  기울기={metrics.gradient_removed:.3f}")

    return {"image_path": image_path, "metrics": metrics.to_dict(), "skin_hex": hex_val}


# =============================================================================
# 6. 다중 파이프라인
# =============================================================================

def run_pipeline_multi(image_paths: list, names: list) -> list:
    print(f"\n{'='*50}")
    print(f"[pipeline] 다중 분석: {len(image_paths)}명")
    print(f"{'='*50}")

    corrector    = BoxCorrector()
    analyzer     = SkinToneAnalyzer()
    metrics_list = []
    valid_names  = []

    for name, path in zip(names, image_paths):
        print(f"\n--- {name} ---")
        try:
            pil_img = preprocess(path, corrector)
            m = analyzer.analyze(pil_img)
            metrics_list.append(m)
            valid_names.append(name)
            print(f"  L={m.L}  warm={m.warmness}  hex={lab_to_rgb_hex(m.L, m.a, m.b)}")
        except Exception as e:
            print(f"  [skip] {e}")

    results = relative_classify(metrics_list, valid_names)
    print(f"\n{'='*50}")
    output = []
    for r in results:
        print(f"[{r.name}] {r.season_ko} ({r.season_code})  "
              f"warmness_z={r.warmness_z:+.2f}  {r.skin_hex}")
        output.append({
            "name": r.name, "season_code": r.season_code,
            "season_ko": r.season_ko, "skin_hex": r.skin_hex,
            "warmness_z": r.warmness_z, "metrics": r.metrics,
        })
    return output


# =============================================================================
# 7. 10장 파이프라인
# =============================================================================

def run_pipeline_10fingers(
    image_paths:  list,
    person_name:  str  = "user",
    save_seg:     bool = True,
    finger_names: list = None,
) -> dict:
    print(f"\n{'='*50}")
    print(f"[10fingers] {person_name} 분석 시작 ({len(image_paths)}장)")
    print(f"{'='*50}")

    if finger_names is None:
        finger_names = FINGER_NAMES[:len(image_paths)]

    corrector = BoxCorrector()
    seg_paths = []
    tmp_paths        = []
    tmp_names        = []

    for fname, path in zip(finger_names, image_paths):
        print(f"\n--- {fname} ({Path(path).name}) ---")
        try:
            pil_img = preprocess(path, corrector,
                                  save_seg=save_seg, prefix=f"{person_name}_")
            if save_seg:
                seg_paths.append(f"{person_name}_{Path(path).stem}_seg.png")
            tmp_path = f"_tmp_{person_name}_{fname}.png"
            pil_img.save(tmp_path)
            tmp_paths.append(tmp_path)
            tmp_names.append(fname)
        except Exception as e:
            print(f"  [skip] {e}")

    if len(tmp_paths) < 2:
        raise ValueError(f"유효한 이미지 부족: {len(tmp_paths)}개")

    print(f"\n{'='*50}")
    print(f"[10fingers] 집계 분석 ({len(tmp_paths)}장)")
    print(f"{'='*50}")

    try:
        agg = aggregate_fingers(tmp_paths, finger_names=tmp_names)
    finally:
        for p in tmp_paths:
            try:
                os.remove(p)
            except Exception:
                pass

    print(f"\n{'='*50}")
    print(f"[결과] {person_name}")
    print(f"{'='*50}")
    print(f"  L={agg.L}  a={agg.a}  b={agg.b}")
    print(f"  warmness={agg.warmness}  brightness={agg.brightness:.3f}")
    print(f"  saturation={agg.saturation:.3f}  contrast={agg.contrast:.3f}")
    print(f"  undertone={agg.undertone}  skinHex={agg.skin_hex}")
    print(f"  유효손가락={agg.valid_fingers}/{agg.total_fingers}  "
          f"이상치={agg.outlier_count}개  신뢰도={agg.reliability}")

    outliers = [f for f in agg.finger_details if f["is_outlier"]]
    if outliers:
        print("  [이상치]")
        for f in outliers:
            print(f"    {f['finger_name']}: {f['outlier_reason']}")

    return {"person": person_name, "aggregated": agg.to_dict(), "seg_paths": seg_paths}


# =============================================================================
# 8. 보정맵 생성
# =============================================================================

def run_calibrate(box_image_path: str) -> None:
    print(f"[calibrate] 박스 사진 로드: {box_image_path}")
    img = np.array(Image.open(box_image_path)).astype(np.float32) / 255.0
    H, W = img.shape[:2]

    cx        = W // 2
    zone_w    = int(W * 0.15)
    zone      = img[:, cx-zone_w:cx+zone_w]
    zone_mean = zone.mean(axis=1)
    target    = zone_mean.mean(axis=0)

    qr_region  = img[H//3:2*H//3, W//8:W//3]
    white_mask = qr_region.mean(axis=2) > 0.6
    qr_ref_rgb = qr_region[white_mask].mean(axis=0).tolist() \
                 if white_mask.sum() > 50 else [0.97, 0.97, 0.97]

    gain_map = np.ones((H, W, 3), dtype=np.float32)
    gain_1d  = target / np.clip(zone_mean, 1e-3, None)
    for x in range(W):
        gain_map[:, x, :] = gain_1d
    np.save(BOX_GAIN_MAP_NPY, gain_map)

    calib = {"qr_ref_rgb": qr_ref_rgb, "target_rgb": target.tolist(),
             "finger_zone_cx": cx, "finger_zone_w": zone_w, "image_size": [W, H]}
    with open(BOX_CALIB_JSON, "w") as f:
        json.dump(calib, f, indent=2)

    print(f"[calibrate] QR기준: {[f'{v:.3f}' for v in qr_ref_rgb]}")
    print(f"[calibrate] 저장 완료: {BOX_CALIB_JSON}")


# =============================================================================
# 9. CLI
# =============================================================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Naily 피부톤 분석 파이프라인")
    parser.add_argument("images", nargs="+",
                        help="사진 경로 / 폴더(10fingers) / 박스사진(calibrate)")
    parser.add_argument("--mode", default="single",
                        choices=["single", "multi", "10fingers", "calibrate"])
    parser.add_argument("--names",   nargs="+", help="사람 이름들 (multi)")
    parser.add_argument("--person",  default="user", help="사람 이름 (10fingers)")
    parser.add_argument("--fingers", nargs="+", help="손가락 이름 리스트 (10fingers)")
    parser.add_argument("--no-save", action="store_true", help="seg 저장 안 함")
    args = parser.parse_args()

    if args.mode == "calibrate":
        run_calibrate(args.images[0])

    elif args.mode == "single":
        run_pipeline(args.images[0], save_seg=not args.no_save)

    elif args.mode == "10fingers":
        if len(args.images) == 1 and os.path.isdir(args.images[0]):
            folder = args.images[0]
            exts   = (".jpg", ".jpeg", ".png", ".JPG", ".JPEG", ".PNG")
            image_paths = sorted([
                os.path.join(folder, f) for f in os.listdir(folder)
                if f.endswith(exts)
            ])
            if not image_paths:
                print(f"[오류] {folder} 폴더에 이미지가 없습니다.")
                sys.exit(1)
            person_name = args.person if args.person != "user" else Path(folder).name
            print(f"[10fingers] {folder} 폴더에서 {len(image_paths)}장 발견")
        else:
            image_paths = args.images
            person_name = args.person

        run_pipeline_10fingers(
            image_paths=image_paths, person_name=person_name,
            save_seg=not args.no_save, finger_names=args.fingers,
        )

    else:  # multi
        names = args.names if args.names else [Path(p).stem for p in args.images]
        run_pipeline_multi(args.images, names)