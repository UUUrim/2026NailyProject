"""
nail_recommend.py
=================
피부 LAB 수치에서 실시간으로 어울리는 네일 색상을 계산.
베스트 30색 + 워스트 10색 반환.

v6 기준:
- preferred_C: 피부 saturation에 따라 선호 채도 직접 계산
- warmness 8배 증폭으로 웜/쿨 방향 강하게 차별화
- 파스텔(L>82, C<=18) 명시적 가산
- 예서 실측 반영 (딥핑크/파스텔누드/스모키블루 베스트)
- 계열당 최대 2개, 블랙/그레이/화이트 각 1개
- hue 순 정렬
"""

from __future__ import annotations
import math
from naily_color import lab_to_rgb_hex


# =============================================================================
# 1. 유틸
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


# =============================================================================
# 2. 색상 계열 (12계열)
# =============================================================================

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


# =============================================================================
# 3. 조화 점수 (v6)
# =============================================================================

def harmony_score(
    skin_L: float, skin_a: float, skin_b: float,
    skin_warmness: float, skin_sat: float,
    nail_L: float, nail_C: float, nail_H: float,
) -> float:
    s_hue = skin_hue(skin_a, skin_b)
    s_C   = skin_chroma(skin_a, skin_b)
    score = 0.0
    H = nail_H % 360

    # ── 1. 명도 대비 (완화) ───────────────────────────────────────────────────
    L_diff = abs(nail_L - skin_L)
    if 20 <= L_diff <= 45:   score += 30
    elif 10 <= L_diff < 20:  score += 20
    elif 45 < L_diff <= 65:  score += 15
    elif L_diff < 10:        score -= 15
    else:                    score -= 8

    # 파스텔 명시적 가산
    if nail_L > 82 and nail_C <= 18: score += 12
    # 딥+채도 가산
    if nail_L < 50 and nail_C >= 15: score += 15

    # ── 2. warmness → hue 편향 (8배 증폭) ───────────────────────────────────
    warm_dev = (skin_warmness - 13.0) * 8.0
    nail_is_warm = (H <= 90) or (H >= 330)
    nail_is_cool = 190 <= H <= 320
    if nail_is_warm: score += warm_dev
    if nail_is_cool: score -= warm_dev
    if skin_warmness > 13.5 and 200 <= H <= 300: score -= 35
    if skin_warmness < 12.5 and 20 <= H <= 80:   score -= 35

    # ── 3. saturation → preferred_C (v6 핵심) ───────────────────────────────
    # 피부 sat에 따라 선호 nail_C 직접 계산
    sat_dev = skin_sat - 0.46
    preferred_C = max(8, min(46, 14 + sat_dev * 200))

    C_diff = abs(nail_C - preferred_C)
    score += max(0, 35 - C_diff * 2.5)  # preferred_C에 가까울수록 최대 35점

    if nail_C > preferred_C + 20: score -= 20
    if nail_C < preferred_C - 20: score -= 15

    # ── 4. 색조 조화 ─────────────────────────────────────────────────────────
    h_diff = hue_diff(nail_H, s_hue)
    if 140 <= h_diff <= 220: score += 15
    elif h_diff <= 60:       score += 10

    # ── 5. 예서 실측 (warmness 12.5~14.5) ────────────────────────────────────
    # 베스트: 딥핑크/로즈(H 320~60, L<60, C>=15),
    #         파스텔누드(L>82, C<15), 핑크밀키(H 10~50, L 45~70, C 8~18),
    #         스모키블루그레이(H 230~270, L 38~58, C 12~25)
    # 워스트: 중간뮤트(C 14~25, L 55~80)
    if 12.5 <= skin_warmness <= 14.5:
        if (H >= 320 or H <= 60) and nail_L < 60 and nail_C >= 15: score += 28
        if nail_L > 82 and nail_C < 15:                             score += 18
        if 10 <= H <= 50 and 45 <= nail_L <= 70 and 8 <= nail_C <= 18: score += 20
        if 230 <= H <= 270 and 38 <= nail_L <= 58 and 12 <= nail_C <= 25: score += 22
        if 14 <= nail_C <= 25 and 55 <= nail_L <= 80:               score -= 18

    return score


# =============================================================================
# 4. 후보 생성
# =============================================================================

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


# =============================================================================
# 5. 다양성 확보
# =============================================================================

def pick_diverse(
    pool: list,
    n: int,
    max_per_family: int = 2,
    max_achromatic: int = 1,
    min_hue_gap: float = 22,
    min_L_gap: float = 10,
) -> list:
    for gap in [min_hue_gap, 18, 14, 10, 6]:
        picked = []
        fam_cnt: dict[str, int] = {}
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
    return picked


def sort_by_hue(items: list) -> list:
    return sorted(items, key=lambda x: get_sort_hue(x[3], x[2], x[1]))


# =============================================================================
# 6. 메인 추천 함수
# =============================================================================

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

    best_raw  = sort_by_hue(pick_diverse(scored,         n_best,  max_per_family=2, max_achromatic=1))
    worst_raw = sort_by_hue(pick_diverse(scored[::-1],   n_worst, max_per_family=1, max_achromatic=1))

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

    summary = {
        "tone":        "warm" if warmness > 14 else "cool" if warmness < 12.3 else "neutral",
        "brightness":  "light" if L > 72 else "deep" if L < 58 else "mid",
        "chroma":      "vivid" if saturation > 0.5 else "muted" if saturation < 0.35 else "mid",
        "skin_hue":    round(s_hue, 1),
        "warmness":    warmness,
        "saturation":  saturation,
        "preferred_C": round(preferred_C, 1),
    }

    return {"best": fmt(best_raw), "worst": fmt(worst_raw), "skin_summary": summary}


def get_skin_summary(L, a, b, warmness, saturation) -> dict:
    return recommend_nail_colors(L, a, b, warmness, saturation)["skin_summary"]


# =============================================================================
# 7. 테스트
# =============================================================================

if __name__ == "__main__":
    from naily_color import lab_to_rgb_hex as shex

    people = {
        "Dogyeong": dict(L=74.73, a=6.20,  b=15.25, warmness=12.15, saturation=0.412),
        "Wonji":    dict(L=75.14, a=10.46, b=19.98, warmness=14.75, saturation=0.564),
        "Yeseo":    dict(L=76.42, a=8.86,  b=18.19, warmness=13.76, saturation=0.506),
        "Seunghee": dict(L=77.00, a=5.77,  b=15.79, warmness=12.90, saturation=0.421),
    }

    for name, d in people.items():
        r = recommend_nail_colors(**d)
        s = r["skin_summary"]
        print(f"\n[{name}]  skin={shex(d['L'],d['a'],d['b'])}"
              f"  tone={s['tone']}  preferred_C={s['preferred_C']}")
        print("  BEST:")
        for item in r["best"]:
            print(f"    {item['hex']}  {item['name_ko']:8s}  "
                  f"L={item['L']:.0f} C={item['C']:.0f} H={item['H']:.0f}")
        print("  WORST:")
        for item in r["worst"]:
            print(f"    {item['hex']}  {item['name_ko']:8s}")