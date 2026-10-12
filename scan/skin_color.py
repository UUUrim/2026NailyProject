"""
skin_color.py
=============
피부 LAB 속성 추출 + 피부색에 어울리는 네일 컬러 30가지 추천.

temp/2026NailyProject/color 의 naily_color.py + nail_recommend.py 에서 이식.
scan 쪽엔 원격 SAM 세그멘테이션/ICC/flat-field가 필요 없으므로(이미
nail_measurer.py가 손톱판을 피한 정밀한 피부 밴드 마스크를 갖고 있음)
그 부분은 빼고 순수 LAB 변환 + 속성 계산 + 컬러 추천 수학만 가져왔다.

사용법:
    from skin_color import analyze_skin, recommend_nail_colors

    metrics = analyze_skin(image_bgr, skin_mask)   # nail_measurer.py의 skin_mask 재사용
    if metrics:
        result = recommend_nail_colors(metrics["L"], metrics["a"], metrics["b"],
                                        metrics["warmness"], metrics["saturation"])
        # result["best"]  -> 30개, result["skin_summary"]["tone"] -> warm/cool/neutral
"""

from __future__ import annotations

import math
from typing import Optional

import cv2
import numpy as np


# =============================================================================
# 1. sRGB <-> LAB (D65)
# =============================================================================

_M_SRGB_TO_XYZ = np.array([
    [0.4124564, 0.3575761, 0.1804375],
    [0.2126729, 0.7151522, 0.0721750],
    [0.0193339, 0.1191920, 0.9503041],
], dtype=np.float64)

_D65 = np.array([0.95047, 1.00000, 1.08883], dtype=np.float64)


def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    """sRGB 감마 디코딩 (IEC 61966-2-1)."""
    c = np.clip(c.astype(np.float64), 0.0, 1.0)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """
    sRGB [0,1] -> CIE LAB (D65).
    shape (..., 3) 아무 형태나 받는다. L: 0~100, a/b: 대략 -128~127.
    """
    lin = srgb_to_linear(rgb)
    xyz = lin @ _M_SRGB_TO_XYZ.T
    xyz = xyz / _D65

    eps = 216.0 / 24389.0
    kappa = 24389.0 / 27.0
    f = np.where(xyz > eps, np.cbrt(xyz), (kappa * xyz + 16.0) / 116.0)

    fx, fy, fz = f[..., 0], f[..., 1], f[..., 2]
    L = 116.0 * fy - 16.0
    a = 500.0 * (fx - fy)
    b = 200.0 * (fy - fz)
    return np.stack([L, a, b], axis=-1)


def lab_to_rgb_hex(L: float, a: float, b: float) -> str:
    """대표 LAB 값을 hex 문자열로."""
    fy = (L + 16.0) / 116.0
    fx = fy + a / 500.0
    fz = fy - b / 200.0
    eps, kappa = 216.0 / 24389.0, 24389.0 / 27.0

    def finv(t):
        return t ** 3 if t ** 3 > eps else (116.0 * t - 16.0) / kappa

    xyz = np.array([finv(fx), finv(fy), finv(fz)]) * _D65
    lin = np.linalg.inv(_M_SRGB_TO_XYZ) @ xyz
    lin = np.clip(lin, 0.0, 1.0)
    srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)
    r, g, bb = (np.clip(srgb, 0, 1) * 255).round().astype(int)
    return f"#{r:02X}{g:02X}{bb:02X}"


# =============================================================================
# 1-b. 마커 흰색 기준 화이트밸런스 보정
# =============================================================================
# 박스 조명/카메라의 색 쏠림은 피부에도 똑같이 걸린다. ArUco 마커의 흰 여백은 같은 사진 안에
# 있는 "진짜 흰색" 기준이라, 그 흰색이 무채색(R=G=B)이 되도록 채널별 이득(gain)을 구해서
# 피부 분석용 사진에만 적용한다. (원본 사진/측정에는 영향 없음)
# 흰색이 날아갔거나(포화) 너무 어두우면 기준으로 쓸 수 없으니 보정하지 않는다.

WB_MIN_WHITE_MEAN = 110      # 마커 흰색의 평균 밝기(0~255)가 이보다 어두우면 기준으로 안 씀
WB_MAX_WHITE_CHANNEL = 247   # 한 채널이라도 이보다 높으면 포화(날아감)로 보고 기준으로 안 씀
WB_GAIN_MIN, WB_GAIN_MAX = 0.75, 1.30      # 채널 사이 색 보정 이득 한계 (이 범위를 벗어나면 보정 안 함)
# 보정 후 마커 흰색이 갖게 될 밝기(0~255). 조명이 그때그때 조금 달라도(램프 밝기, 노출) 피부 밝기가
# "마커 흰색 대비"로 같은 기준이 되게 한다. 이 값은 피부 L*의 절대 크기를 정한다(nail_palette의
# SKIN_LIGHT_L/SKIN_DARK_L 기준과 같이 본다).
WB_TARGET_WHITE = 225
WB_BRIGHTNESS_MIN, WB_BRIGHTNESS_MAX = 0.60, 3.50   # 밝기 정규화 배율 한계 (벗어나면 색 보정만 함)
# (실측: 낮춘 노출에서 마커 흰색이 세션마다 150~190 -> 배율 1.4~2.2. 흰색 110 미만은 'too_dark'로 어차피 제외)
WB_MAX_CAST = 0.35           # 흰색 세 채널이 평균에서 이만큼(35%) 넘게 벗어나면 흰색이 아님(가려짐 등)
_WB_RING_OUTER, _WB_RING_INNER = 1.12, 0.80


def _srgb_to_lin(v):
    v = np.asarray(v, dtype=np.float32) / 255.0
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def _lin_to_srgb255(v):
    v = np.clip(v, 0.0, 1.0)
    return np.where(v <= 0.0031308, v * 12.92, 1.055 * v ** (1 / 2.4) - 0.055) * 255.0


def marker_white_rgb(image_bgr: np.ndarray, aruco_corners: np.ndarray) -> Optional[np.ndarray]:
    """마커 바깥 흰 여백에서 가장 밝은 픽셀들의 중앙값(RGB 0~255). 마커가 화면 밖/너무 작으면 None."""
    pts = np.asarray(aruco_corners, dtype=np.float32).reshape(-1, 2)
    if pts.shape[0] < 4:
        return None
    c = pts.mean(axis=0)
    outer = np.zeros(image_bgr.shape[:2], np.uint8)
    inner = np.zeros_like(outer)
    cv2.fillConvexPoly(outer, ((pts - c) * _WB_RING_OUTER + c).astype(np.int32), 255)
    cv2.fillConvexPoly(inner, ((pts - c) * _WB_RING_INNER + c).astype(np.int32), 255)
    ring = cv2.bitwise_and(outer, cv2.bitwise_not(inner))
    px = image_bgr[ring > 0].astype(np.float32)
    if px.shape[0] < 200:
        return None
    lum = px.mean(axis=1)
    bright = px[lum >= np.percentile(lum, 60)]          # 여백(흰색)만 남기고 검은 테두리/바깥 매트 제외
    return np.median(bright, axis=0)[::-1]              # BGR -> RGB


def white_balance_to_marker(image_bgr: np.ndarray, aruco_corners: np.ndarray, reference_bgr: np.ndarray = None):
    """마커 흰색이 무채색이 되도록 보정한 (이미지 BGR uint8, 정보 dict)를 돌려준다.

    보정하지 않은 경우에도 원본 이미지를 그대로 돌려주고, info["applied"]=False와 사유를 담는다.
    info: {"applied", "reason", "white_rgb", "gain"(RGB), "brightness_scale", "brightness_normalized"}

    reference_bgr : 같은 장면을 더 어둡게 찍어 마커 흰색이 날아가지 않은 사진. 주어지면 흰색(색 쏠림)을
    그 사진에서 재서 image_bgr에 적용한다. 두 사진의 밝기 단계가 달라서 밝기 정규화는 하지 않는다.
    (image_bgr은 피부가 덜 어두운 사진이라 마커 흰색은 날아가도 피부는 멀쩡하다.)
    """
    info = {"applied": False, "reason": "", "white_rgb": None, "gain": None}
    if aruco_corners is None:
        info["reason"] = "no_marker"
        return image_bgr, info
    white = marker_white_rgb(reference_bgr if reference_bgr is not None else image_bgr, aruco_corners)
    if white is None:
        info["reason"] = "marker_ring_unreadable"
        return image_bgr, info
    info["white_rgb"] = [round(float(x), 1) for x in white]
    if float(white.mean()) < WB_MIN_WHITE_MEAN:
        info["reason"] = "white_too_dark"
        return image_bgr, info
    if float(white.max()) > WB_MAX_WHITE_CHANNEL:
        info["reason"] = "white_clipped"
        return image_bgr, info
    if float(np.max(np.abs(white / white.mean() - 1.0))) > WB_MAX_CAST:
        info["reason"] = "white_not_neutral_enough"
        return image_bgr, info

    wl = _srgb_to_lin(white)
    color_gain = float(wl.mean()) / wl                  # 채널 사이 색 쏠림을 없애는 이득(선형 RGB)
    if float(color_gain.min()) < WB_GAIN_MIN or float(color_gain.max()) > WB_GAIN_MAX:
        info["reason"] = "gain_out_of_range"
        return image_bgr, info
    # 밝기 정규화: 마커 흰색이 WB_TARGET_WHITE가 되도록 전체 밝기 배율을 곱한다. 배율이 너무 크면
    # (조명이 너무 어둡거나 너무 밝으면) 믿기 어려우니 색 보정만 하고 밝기는 그대로 둔다.
    brightness = float(_srgb_to_lin(np.array([WB_TARGET_WHITE] * 3))[0]) / float(wl.mean())
    info["brightness_scale"] = round(brightness, 3)
    if reference_bgr is not None or not (WB_BRIGHTNESS_MIN <= brightness <= WB_BRIGHTNESS_MAX):
        info["brightness_normalized"] = False
        brightness = 1.0
    else:
        info["brightness_normalized"] = True
    gain = color_gain * brightness
    info["gain"] = [round(float(g), 4) for g in gain]

    # 채널별 256단계 변환표(LUT)로 한 번에 적용 - 큰 사진에서도 빠르다. LUT는 BGR 순서.
    levels = np.arange(256, dtype=np.float32)
    lut = np.zeros((256, 1, 3), np.uint8)
    for rgb_idx, bgr_idx in ((0, 2), (1, 1), (2, 0)):
        lut[:, 0, bgr_idx] = np.round(_lin_to_srgb255(_srgb_to_lin(levels) * gain[rgb_idx])).astype(np.uint8)
    info["applied"] = True
    return cv2.LUT(image_bgr, lut), info


# =============================================================================
# 2. 피부 속성 추출
# =============================================================================

def _detrend(L_map: np.ndarray, mask: np.ndarray):
    """
    마스크 영역 L에 2D 평면을 최소자승 피팅하고 빼서 조명 기울기를 제거한다.
    Returns: (잔차 L 값 1D 배열, 기울기 크기)
    """
    ys, xs = np.nonzero(mask)
    vals = L_map[ys, xs].astype(np.float64)

    x = (xs - xs.mean()) / (xs.std() + 1e-6)
    y = (ys - ys.mean()) / (ys.std() + 1e-6)

    A = np.column_stack([np.ones_like(x), x, y])
    coef, *_ = np.linalg.lstsq(A, vals, rcond=None)

    fitted = A @ coef
    residual = vals - fitted + coef[0]  # 평균 밝기는 유지
    slope = float(np.hypot(coef[1], coef[2]))

    return residual, slope


def analyze_skin(image_bgr: np.ndarray, mask: np.ndarray,
                  trim_percent: float = 25.0) -> Optional[dict]:
    """
    BGR 이미지 + 2D bool/uint8 마스크에서 피부 LAB 속성을 뽑는다.

    mask는 nail_measurer.py의 skin_mask(손톱판/매니큐어를 피해 큐티클
    아래 밴드에서 뽑은 마스크)를 그대로 넘기면 된다.

    Returns: dict(L,a,b,C,warmness,brightness,saturation,contrast,
                  undertone,pixel_count,gradient_removed) 또는
             유효 픽셀이 너무 적으면 None.
    """
    mask = mask.astype(bool)
    if mask.sum() < 100:
        return None

    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    lab_map = rgb_to_lab(rgb)
    L_map = lab_map[..., 0]

    pixels = lab_map[mask]  # (N, 3)

    # 밝기 기준 상하위 trim -> 그림자/스펙큘러 하이라이트 제거
    lo = np.percentile(pixels[:, 0], trim_percent)
    hi = np.percentile(pixels[:, 0], 100 - trim_percent)
    core = pixels[(pixels[:, 0] >= lo) & (pixels[:, 0] <= hi)]
    if len(core) < 50:
        core = pixels

    L, a, b = core.mean(axis=0)
    C = float(np.hypot(a, b))

    # contrast — 조명 기울기 제거 후의 잔차 분포로 측정
    residual, slope = _detrend(L_map, mask)
    r_lo = np.percentile(residual, 14)
    r_mid = np.percentile(residual, 50)
    contrast_raw = float(r_mid - r_lo)

    warmness = float(b - a * 0.5)
    brightness = float(L / 100.0)
    saturation = float(C / 40.0)
    # L로 나눠서 밝기와 분리한다 (정규화 안 하면 contrast가 brightness의 복사본이 됨).
    contrast = float(contrast_raw / max(L, 1e-3) * 25.0)

    if a > 3 and b > 12:
        undertone = "Yellow-Warm"
    elif a > 8 and b > 8:
        undertone = "Pink-Warm"
    elif b < 8:
        undertone = "Cool"
    else:
        undertone = "Neutral"

    return {
        "L": round(float(L), 2),
        "a": round(float(a), 2),
        "b": round(float(b), 2),
        "C": round(C, 2),
        "warmness": round(warmness, 2),
        "brightness": round(brightness, 3),
        "saturation": round(saturation, 3),
        "contrast": round(contrast, 3),
        "undertone": undertone,
        "pixel_count": int(mask.sum()),
        "gradient_removed": round(slope, 3),
    }


# =============================================================================
# 3. 톤 판정 + 네일 컬러 추천
# =============================================================================
# 톤(웜/쿨/뉴트럴)은 피부 Lab의 색상각 h = atan2(b, a)로 판정한다. 값이 클수록 노란/황금빛(웜),
# 작을수록 붉은/분홍빛(쿨)이다. 예전에는 b - 0.5a 한 숫자를 다른 카메라/조명에서 맞춘 기준(13.45/12.39)
# 으로 잘랐는데, 과노출/조명 색 때문에 거의 항상 웜으로 쏠렸다.
#
# [임시 기준] 아래 두 값은 사람 한 명(본인 손, 쿨톤이라고 본인이 판단)의 측정값과 동양인 피부 색상각의
# 일반적인 범위(약 50~65도)를 참고해서 잡은 값이다. 같은 설정(촬영 직후 노출을 낮춘 확인용 사진 + 마커 흰색
# 보정)으로 잰 이 사람의 색상각은 약 53~54도였고(3회 반복에서 +-1도), 과노출된 원래 사진을 그대로 쓰면
# 76~77도(웜)로 잘못 나왔다. 톤을 아는 여러 사람을 같은 방식으로 스캔해서 맞춰야 한다. 바꿀 때는 여기 두 줄과
# Frontend/src/shared/utils/skinTone.ts 의 WARMNESS_*_CUTOFF(같은 값)를 함께 바꾼다.
TONE_HUE_COOL_MAX = 55.0   # 색상각이 이보다 작으면 쿨
TONE_HUE_WARM_MIN = 63.0   # 색상각이 이보다 크면 웜 (둘 사이는 뉴트럴)

# 피부 밝기/채도 구분은 네일 컬러 개수 배분에만 쓴다 (nail_palette.SKIN_*_L 참고)


def skin_hue(a: float, b: float) -> float:
    """피부 Lab의 색상각(도). 0~360."""
    return math.degrees(math.atan2(b, a)) % 360


def skin_chroma(a: float, b: float) -> float:
    return math.hypot(a, b)


def tone_from_hue(hue: float) -> str:
    if hue < TONE_HUE_COOL_MAX:
        return "cool"
    if hue > TONE_HUE_WARM_MIN:
        return "warm"
    return "neutral"


def recommend_nail_colors(
    L: float,
    a: float,
    b: float,
    warmness: float = None,
    saturation: float = None,
    n_best: int = 30,
    n_worst: int = 10,
) -> dict:
    """
    피부 Lab에서 톤을 판정하고(라벨용), 피부 Lab(밝기/색상각/채도)으로 연속 점수를 매겨서 어울리는 네일 컬러
    n_best개 + 안 어울리는 n_worst개를 돌려준다. (nail_palette.pick_palette 참고)
    (warmness, saturation 인자는 예전 호출부 호환용으로 남겨 두며 판정에는 쓰지 않는다.)

    Returns:
        {
            "best":  [{"hex","name","name_ko","score","tone","band","L","C","H"}, ...],
            "worst": [{...}, ...],
            "skin_summary": {"tone", "skin_hue", "warmness"(=색상각), "chroma", "L"}
        }
    """
    import nail_palette

    hue = skin_hue(a, b)
    tone = tone_from_hue(hue)
    summary = {
        "tone":       tone,
        "skin_hue":   round(hue, 1),
        "warmness":   round(hue, 1),      # 화면의 웜/쿨 슬라이더가 쓰는 값 = 색상각(도)
        "chroma":     round(skin_chroma(a, b), 1),
        "L":          round(L, 1),
    }
    return {
        "best":  nail_palette.pick_palette(tone, L, n_best, skin_a=a, skin_b=b),
        "worst": nail_palette.pick_avoid(tone, n_worst, skin_L=L, skin_a=a, skin_b=b),
        "skin_summary": summary,
    }


# =============================================================================
# 4. 스모크 테스트
# =============================================================================

if __name__ == "__main__":
    # 실제 사진 없이 모듈이 예외 없이 30+10개를 뽑는지만 확인.
    h, w = 200, 200
    yy, xx = np.mgrid[0:h, 0:w]
    # 은은한 조명 기울기가 섞인 살구색 그라디언트 (진짜 피부 밴드 흉내)
    base = np.array([170, 140, 200], dtype=np.float32)  # BGR
    grad = (xx / w - 0.5) * 20 + (yy / h - 0.5) * 10
    img = np.clip(base[None, None, :] + grad[..., None], 0, 255).astype(np.uint8)
    mask = np.ones((h, w), dtype=bool)

    metrics = analyze_skin(img, mask)
    assert metrics is not None, "analyze_skin returned None on a full mask"
    print("[analyze_skin]", metrics)

    result = recommend_nail_colors(
        metrics["L"], metrics["a"], metrics["b"],
        metrics["warmness"], metrics["saturation"],
    )
    assert len(result["best"]) == 30, f"best count = {len(result['best'])}"
    assert len(result["worst"]) == 10, f"worst count = {len(result['worst'])}"
    print(f"[recommend_nail_colors] best={len(result['best'])} "
          f"worst={len(result['worst'])} tone={result['skin_summary']['tone']}")
    print("OK")
