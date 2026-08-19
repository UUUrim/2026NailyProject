"""
사용법:
    python test_client.py --only generate
    python test_client.py --only inpaint
    python test_client.py --only parts
    python test_client.py --only colors_per_nail
    python test_client.py                        # 전부 순서대로

    python test_client.py --gen-url http://<IP>:8000 --detect-url http://<IP>:8001

기본값: 생성 서버 http://localhost:8000, 검출 서버 http://localhost:8001
(두 서버를 같은 컴퓨터에서 띄우는 경우 --gen-url/--detect-url 안 줘도 됩니다.)
"""

import argparse
import base64
import pathlib

import requests

OUT_DIR = pathlib.Path("test_outputs")
OUT_DIR.mkdir(exist_ok=True)
BASE_IMAGE_CACHE = OUT_DIR / "1_txt2img.png"


def save_b64(b64_str: str, filename: str):
    path = OUT_DIR / filename
    path.write_bytes(base64.b64decode(b64_str))
    print(f"  saved -> {path}")


def load_base_image_b64() -> str:
    if not BASE_IMAGE_CACHE.exists():
        raise SystemExit(
            f"{BASE_IMAGE_CACHE} 가 없습니다. 먼저 --only generate 로 이미지를 한 번 생성해두세요."
        )
    return base64.b64encode(BASE_IMAGE_CACHE.read_bytes()).decode()


def check_health(url: str, label: str):
    r = requests.get(f"{url}/health", timeout=10)
    r.raise_for_status()
    print(f"{label} health check ok:", r.json())


# ---------------------------------------------------------------------------
# 생성 서버 (main_gen.py)
# ---------------------------------------------------------------------------
def run_generate(gen_url: str) -> str:
    print("txt2img 테스트...")
    payload = {
        "prompt": (
            "A studio product photo of five almond-shaped press-on nail tips "
            "arranged in a perfectly straight horizontal line with equal spacing "
            "between each tip, nailart, blue, silver base color, thumb features "
            "blue with wave art, index features white with surfboard art, middle "
            "features glitter with 3D silver stud, ring features white, pinky "
            "features blue, cool and refreshing mood, summer, top-down flat lay "
            "view, plain white background, no shadow, no hands, no fingers, "
            "no text, no watermark, product shot"
        ),
        "seed": 647744376769594,
        "steps": 30,
        "guidance_scale": 1,
        "width": 512,
        "height": 384,
    }
    r = requests.post(f"{gen_url}/generate", json=payload, timeout=900)
    if not r.ok:
        print("  [debug] 서버 응답 본문:", r.text)
    r.raise_for_status()
    b64_img = r.json()["image_base64"]
    save_b64(b64_img, "1_txt2img.png")
    return b64_img


def run_inpaint(gen_url: str):
    print("inpaint 테스트...")
    base_b64 = load_base_image_b64()
    payload = {
        "image_base64": base_b64,
        "prompt": (
            "A studio product photo of individual ballerina-shaped press-on nail tip nailart, glossy pink glitter base with large 3D ivory colored plastic bow charm, top-down flat lay view, plain white background, no shadow, no hands, no fingers, no text, no watermark, no reflection, product shot"
        ),
        "mask_prompt": "nail tip with small silver metallic stud",
        "seed": 692153262017725,
        "steps": 30,
        "strength": 0.8,
        "guidance_scale": 1,
        "threshold": 0.35,
        "mask_offset": 8,
        "grow_mask_by": 10,
    }
    r = requests.post(f"{gen_url}/inpaint", json=payload, timeout=900)
    if not r.ok:
        print("  [debug] 서버 응답 본문:", r.text)
    r.raise_for_status()
    save_b64(r.json()["image_base64"], "2_inpaint.png")


# ---------------------------------------------------------------------------
# 검출 서버 (main_detect.py)
# ---------------------------------------------------------------------------
def run_parts(detect_url: str):
    print("파츠 검출 테스트...")
    base_b64 = load_base_image_b64()
    payload = {"image_base64": base_b64, "parts": ["bow on nail tip"], "threshold": 0.4}
    r = requests.post(f"{detect_url}/parts", json=payload, timeout=300)
    if not r.ok:
        print("  [debug] 서버 응답 본문:", r.text)
    r.raise_for_status()
    data = r.json()
    for phrase, crops_b64 in data.items():
        safe_name = phrase.replace(" ", "_")
        if not crops_b64:
            print(f"  '{phrase}' -> 검출된 파츠 없음")
        for i, b64_img in enumerate(crops_b64):
            save_b64(b64_img, f"3_part_{safe_name}_{i}.png")


def run_colors_per_nail(detect_url: str):
    print("손톱별 컬러 추출 테스트...")
    base_b64 = load_base_image_b64()
    payload = {
        "image_base64": base_b64,
        "segment_prompt": "nail tip",
        "threshold": 0.35,
        "mask_shrink": 6,
        "min_area": 200,
        "color_diff_threshold": 40.0,
    }
    r = requests.post(f"{detect_url}/colors_per_nail", json=payload, timeout=300)
    if not r.ok:
        print("  [debug] 서버 응답 본문:", r.text)
    r.raise_for_status()
    for nail in r.json()["nails"]:
        print(f"  손톱 {nail['nail_index']}: {nail['colors']}")


GEN_STEPS = {"generate": run_generate, "inpaint": run_inpaint}
DETECT_STEPS = {"parts": run_parts, "colors_per_nail": run_colors_per_nail}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--gen-url", default="http://localhost:8000")
    parser.add_argument("--detect-url", default="http://localhost:8001")
    parser.add_argument(
        "--only", choices=list(GEN_STEPS.keys()) + list(DETECT_STEPS.keys()), default=None
    )
    args = parser.parse_args()

    if args.only:
        if args.only in GEN_STEPS:
            check_health(args.gen_url, "생성 서버")
            GEN_STEPS[args.only](args.gen_url)
        else:
            check_health(args.detect_url, "검출 서버")
            DETECT_STEPS[args.only](args.detect_url)
    else:
        check_health(args.gen_url, "생성 서버")
        check_health(args.detect_url, "검출 서버")
        run_generate(args.gen_url)
        run_inpaint(args.gen_url)
        run_parts(args.detect_url)
        run_colors_per_nail(args.detect_url)

    print("\n완료. test_outputs/ 폴더 확인하세요.")
