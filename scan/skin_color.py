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
# 3. 네일 컬러 추천 (nail_recommend.py 이식)
# =============================================================================

def lch_to_hex(L: float, C: float, H: float) -> str:
    h = math.radians(H % 360)
    return lab_to_rgb_hex(float(L), float(C * math.cos(h)), float(C * math.sin(h)))


def hue_diff(h1: float, h2: float) -> float:
    d = abs(h1 - h2) % 360
    return min(d, 360 - d)


def skin_hue(a: float, b: float) -> float:
    return math.degrees(math.atan2(b, a)) % 360


def skin_chroma(a: float, b: float) -> float:
    return math.hypot(a, b)


FAMILIES = [
    ("red",    (346, 15)),
    ("coral",  (16,  35)),
    ("orange", (36,  55)),
    ("yellow", (56,  85)),
    ("lime",   (86, 115)),
    ("green",  (116, 155)),
    ("teal",   (156, 195)),
    ("mint",   (196, 220)),
    ("blue",   (221, 255)),
    ("indigo", (256, 280)),
    ("purple", (281, 315)),
    ("pink",   (316, 345)),
]


def get_family(H: float, C: float, L: float) -> str:
    if C < 6:
        if L > 85: return "white"
        elif L < 25: return "black"
        else: return "gray"
    H = H % 360
    for name, (lo, hi) in FAMILIES:
        if lo <= hi:
            if lo <= H <= hi: return name
        else:
            if H >= lo or H <= hi: return name
    return "red"


def get_sort_hue(H: float, C: float, L: float) -> float:
    if C < 6: return 999 if L > 85 else 998 if L < 25 else 997
    return H % 360


def hue_to_name(H: float, C: float, L: float) -> str:
    if C < 6:
        if L > 85: return "화이트"
        elif L < 25: return "블랙"
        else: return "그레이"
    H = H % 360
    if L < 35: p = "딥 "
    elif L > 82: p = "파스텔 "
    elif C > 35: p = "비비드 "
    elif C < 15: p = "뮤트 "
    else: p = ""
    KO = {
        "red": "레드", "coral": "코랄", "orange": "오렌지", "yellow": "옐로",
        "lime": "라임", "green": "그린", "teal": "틸", "mint": "민트",
        "blue": "블루", "indigo": "인디고", "purple": "퍼플", "pink": "핑크",
    }
    return p + KO.get(get_family(H, C, L), "")


def harmony_score(
    skin_L: float, skin_a: float, skin_b: float,
    skin_warmness: float, skin_sat: float,
    nail_L: float, nail_C: float, nail_H: float,
) -> float:
    s_hue = skin_hue(skin_a, skin_b)
    score = 0.0
    H = nail_H % 360

    # ── 1. 명도 대비 ────────────────────────────────────────────────────
    L_diff = abs(nail_L - skin_L)
    if 20 <= L_diff <= 45:   score += 30
    elif 10 <= L_diff < 20:  score += 20
    elif 45 < L_diff <= 65:  score += 15
    elif L_diff < 10:        score -= 15
    else:                    score -= 8

    if nail_L > 82 and nail_C <= 18: score += 12
    if nail_L < 50 and nail_C >= 15: score += 15

    # ── 2. warmness → hue 편향 ──────────────────────────────────────────
    warm_dev = (skin_warmness - 13.0) * 8.0
    nail_is_warm = (H <= 90) or (H >= 330)
    nail_is_cool = 190 <= H <= 320
    if nail_is_warm: score += warm_dev
    if nail_is_cool: score -= warm_dev
    if skin_warmness > 13.5 and 200 <= H <= 300: score -= 35
    if skin_warmness < 12.5 and 20 <= H <= 80:   score -= 35

    # ── 3. saturation → preferred_C ─────────────────────────────────────
    sat_dev = skin_sat - 0.46
    preferred_C = max(8, min(46, 14 + sat_dev * 200))

    C_diff = abs(nail_C - preferred_C)
    score += max(0, 35 - C_diff * 2.5)

    if nail_C > preferred_C + 20: score -= 20
    if nail_C < preferred_C - 20: score -= 15

    # ── 4. 색조 조화 ─────────────────────────────────────────────────────
    h_diff = hue_diff(nail_H, s_hue)
    if 140 <= h_diff <= 220: score += 15
    elif h_diff <= 60:       score += 10

    # ── 5. 실측 보정 (warmness 12.5~14.5 구간) ──────────────────────────
    if 12.5 <= skin_warmness <= 14.5:
        if (H >= 320 or H <= 60) and nail_L < 60 and nail_C >= 15: score += 28
        if nail_L > 82 and nail_C < 15:                             score += 18
        if 10 <= H <= 50 and 45 <= nail_L <= 70 and 8 <= nail_C <= 18: score += 20
        if 230 <= H <= 270 and 38 <= nail_L <= 58 and 12 <= nail_C <= 25: score += 22
        if 14 <= nail_C <= 25 and 55 <= nail_L <= 80:               score -= 18

    return score


def generate_candidates(skin_L: float, skin_sat: float) -> list:
    candidates = []
    L_levels = [
        max(12, skin_L - 50),
        max(18, skin_L - 40),
        max(25, skin_L - 30),
        max(35, skin_L - 20),
        min(96, skin_L + 18),
        min(94, skin_L + 14),
    ]
    if skin_sat >= 0.50:
        C_levels = [8, 14, 22, 30, 38, 46]
    elif skin_sat >= 0.43:
        C_levels = [6, 12, 18, 26, 34]
    else:
        C_levels = [4, 8, 14, 20, 28]

    for H in range(0, 360, 4):
        for L in L_levels:
            for C in C_levels:
                candidates.append((L, C, H))

    for L in [8, 15, 25, 45, 60, 75, 88, 94, 97]:
        for C in [2, 4, 6]:
            for H in [60, 90, 240, 350]:
                candidates.append((L, C, H))
    return candidates


def pick_diverse(
    pool: list,
    n: int,
    max_per_family: int = 2,
    max_achromatic: int = 1,
    min_hue_gap: float = 22,
    min_L_gap: float = 10,
) -> list:
    picked = []
    for gap in [min_hue_gap, 18, 14, 10, 6]:
        picked = []
        fam_cnt: dict = {}
        for (s, nL, nC, nH) in pool:
            fam = get_family(nH, nC, nL)
            limit = max_achromatic if fam in {"black", "gray", "white"} else max_per_family
            if fam_cnt.get(fam, 0) >= limit: continue
            if any(hue_diff(nH, pH) < gap and abs(nL - pL) < min_L_gap
                   for (_, pL, pC, pH) in picked): continue
            picked.append((s, nL, nC, nH))
            fam_cnt[fam] = fam_cnt.get(fam, 0) + 1
            if len(picked) >= n: break
        if len(picked) >= n: break

    # 계열/무채색 상한 때문에 n을 못 채웠으면, 개수를 맞추기 위해
    # 상한을 무시하고 점수 높은 순으로 나머지 자리를 채운다.
    if len(picked) < n:
        picked_keys = {(round(nL, 1), round(nC, 1), round(nH, 1)) for (_, nL, nC, nH) in picked}
        for (s, nL, nC, nH) in pool:
            key = (round(nL, 1), round(nC, 1), round(nH, 1))
            if key in picked_keys: continue
            picked.append((s, nL, nC, nH))
            picked_keys.add(key)
            if len(picked) >= n: break

    return picked


def sort_by_hue(items: list) -> list:
    return sorted(items, key=lambda x: get_sort_hue(x[3], x[2], x[1]))


def recommend_nail_colors(
    L: float,
    a: float,
    b: float,
    warmness: float,
    saturation: float,
    n_best: int = 30,
    n_worst: int = 10,
) -> dict:
    """
    피부 LAB 수치에서 베스트 n_best색 + 워스트 n_worst색 반환.

    Returns:
        {
            "best":  [{"hex","name","name_ko","score","L","C","H"}, ...],
            "worst": [{"hex","name","name_ko","score",...}, ...],
            "skin_summary": {...}
        }
    """
    candidates = generate_candidates(L, saturation)

    scored = sorted(
        [(harmony_score(L, a, b, warmness, saturation, nL, nC, nH), nL, nC, nH)
         for (nL, nC, nH) in candidates],
        key=lambda x: -x[0]
    )

    best_raw  = sort_by_hue(pick_diverse(scored,       n_best,  max_per_family=2, max_achromatic=1))
    worst_raw = sort_by_hue(pick_diverse(scored[::-1], n_worst, max_per_family=1, max_achromatic=1))

    def fmt(items):
        return [{
            "hex":     lch_to_hex(nL, nC, nH),
            "name":    hue_to_name(nH, nC, nL),
            "name_ko": hue_to_name(nH, nC, nL),
            "score":   round(s, 1),
            "L": round(nL, 1), "C": round(nC, 1), "H": round(nH, 1),
        } for (s, nL, nC, nH) in items]

    s_hue = skin_hue(a, b)
    sat_dev = saturation - 0.46
    preferred_C = max(8, min(46, 14 + sat_dev * 200))

    # NOTE: tone 임계값(warmness > 13.45 / < 12.39)은 temp/2026NailyProject
    # 쪽 카메라·조명으로 찍은 5명 샘플에서 뽑은 값이다. scan의 촬영 박스는
    # 카메라/조명이 다르므로 이 경계가 그대로 맞는다는 보장이 없다 — 이
    # 박스로 찍은 실측 샘플이 쌓이면 temp/2026NailyProject/color/_calib_run.py
    # 같은 방식으로 재조정할 것.
    summary = {
        "tone":        "warm" if warmness > 13.45 else "cool" if warmness < 12.39 else "neutral",
        "skin_hue":    round(s_hue, 1),
        "warmness":    warmness,
        "saturation":  saturation,
        "preferred_C": round(preferred_C, 1),
    }

    return {"best": fmt(best_raw), "worst": fmt(worst_raw), "skin_summary": summary}


def get_skin_summary(L, a, b, warmness, saturation) -> dict:
    return recommend_nail_colors(L, a, b, warmness, saturation)["skin_summary"]


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
