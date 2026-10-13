"""
nail_palette.py
===============
피부색(Lab)에 맞는 네일 컬러 30개를 고른다.

예전에는 피부를 웜/쿨/뉴트럴 3가지로만 나눠서, 같은 톤이면 누가 스캔해도 똑같은 30색이 나왔다.
지금은 피부 Lab(밝기 L, 색상각 hue, 채도 C)을 연속값으로 받아서 색마다 점수를 매기고, 비슷한 색이 몰리지
않게 다양성 페널티를 주면서 고른다. 피부값이 조금만 달라도 뽑히는 색과 순서가 달라진다.

점수 구성 (색 하나당)
  1) 톤 적합도   피부 웜 정도(-1 쿨 ~ +1 웜, 색상각 59도 기준 +-12도)와 색의 웜 정도(-1 ~ +1)가 가까울수록 높다.
                 정반대 톤(차이가 크면)은 처음부터 후보에서 뺀다.
  2) 채도 궁합   피부 채도가 높으면(홍조/붉은기) 차분한 색을, 낮으면 선명한 색을 조금 더 높게 본다.
  3) 보색 궁합   붉은기가 강한 피부(색상각이 작음)에는 초록/청록 계열, 노란기가 강한 피부에는 보라/파랑 계열을
                 조금 더 높게 본다. (붉은기/노란기를 눌러 주는 색)
  4) 다양성      이미 뽑은 색과 Lab 거리가 가까울수록 감점해서, 같은 색이 여러 개 들어가지 않게 한다.
  밝기 구간(light/mid/deep) 개수는 피부 밝기에 따라 연속적으로 조절한다. 같은 색 계열(hue)이 몰리지 않게 제한한다.

색을 추가/수정하려면 NAIL_COLORS만 고치면 된다. (이름, hex, 웜 정도) 형식이다.
웜 정도: +1 웜 / +0.5 약간 웜 / 0 뉴트럴 / -0.5 약간 쿨 / -1 쿨

[임시값] 피부 기준값(SKIN_REF_*)은 이 카메라 설정에서 잰 몇 사람의 값으로 잡은 임시값이다. 여러 사람을 스캔한
뒤에 맞춘다. 바꿀 때는 scan/tests/test_color_logic.py를 다시 돌린다.
"""

from __future__ import annotations

import math

# (한글 이름, hex, 웜 정도)
NAIL_COLORS = [
    # ── 밝은 색: 누드 / 파스텔 / 밀키 ─────────────────────────────
    ("밀키 화이트",     "#F6F1EA", 0.0),
    ("펄 화이트",       "#F1EEF4", -0.5),
    ("아이보리",        "#F3E9D2", 0.5),
    ("크림",            "#F4E3C1", 0.5),
    ("바닐라",          "#F5E6C8", 0.5),
    ("샴페인",          "#EAD7B7", 0.5),
    ("오트밀",          "#E5D8C5", 0.0),
    ("누드 베이지",     "#E8CDB5", 0.0),
    ("스톤 베이지",     "#D6CBBE", 0.0),
    ("토스트 누드",     "#E0BFA0", 0.5),
    ("소프트 피치",     "#F8D5C2", 0.5),
    ("피치 크림",       "#F7DCC4", 0.5),
    ("피치 누드",       "#F2C6A8", 0.5),
    ("살구",            "#F6B999", 0.5),
    ("피치 핑크",       "#F7B8B0", 0.5),
    ("파스텔 코랄",     "#FBA897", 1.0),
    ("버터 옐로",       "#F8E49C", 0.5),
    ("레몬",            "#F6EDA4", 0.0),
    ("라임 소르베",     "#E3EDA3", 0.5),
    ("피스타치오",      "#D1E3B8", 0.5),
    ("스프링 그린",     "#C8E6B0", 0.5),
    ("연한 세이지",     "#CBD9C0", 0.0),
    ("민트",            "#BFE9D6", -0.5),
    ("아쿠아",          "#BDE8E8", -0.5),
    ("베이비 핑크",     "#F7CAD3", -0.5),
    ("라이트 로즈",     "#F3C1CF", -0.5),
    ("핑크 누드",       "#EBC6C4", -0.5),
    ("로즈 누드",       "#E9BEBE", -0.5),
    ("코튼 캔디",       "#F6CBE3", -1.0),
    ("핑크 라일락",     "#E8C7DE", -1.0),
    ("라일락",          "#CDB4DB", -1.0),
    ("라벤더",          "#D8C8EE", -1.0),
    ("라일락 그레이",   "#CFC6DA", -0.5),
    ("라이트 모브",     "#D9BFC9", -0.5),
    ("아이스 블루",     "#D3E6F2", -1.0),
    ("베이비 블루",     "#BFD9F2", -1.0),
    ("소다 블루",       "#B5DDEB", -0.5),
    ("스카이 블루",     "#A8D4F0", -1.0),
    ("쿨 그레이 라이트", "#D5D9DE", -0.5),
    ("그레이지",        "#D8CFC6", 0.0),
    # ── 중간 톤 ───────────────────────────────────────────────
    ("코랄",            "#F2796B", 1.0),
    ("살몬",            "#F08C78", 1.0),
    ("코랄 핑크",       "#F58A9A", 0.0),
    ("스트로베리",      "#E0475B", 0.0),
    ("토마토 레드",     "#E5483A", 1.0),
    ("테라코타",        "#C8705A", 1.0),
    ("핑크 베이지",     "#C99A8E", 0.0),
    ("오렌지",          "#F28C38", 1.0),
    ("호박",            "#E0A030", 1.0),
    ("머스터드",        "#D9A22B", 1.0),
    ("골드",            "#C9A43F", 1.0),
    ("진저",            "#C9783A", 1.0),
    ("카라멜",          "#C48F5C", 1.0),
    ("카멜",            "#B98A57", 1.0),
    ("시나몬",          "#A9684A", 1.0),
    ("올리브",          "#8E9A4B", 0.5),
    ("카키",            "#8A8A55", 0.5),
    ("모스 그린",       "#8DA06A", 0.5),
    ("라임",            "#A8C93A", 0.5),
    ("세이지",          "#9CAF88", 0.0),
    ("토프",            "#A89386", 0.0),
    ("웜 그레이",       "#A39A91", 0.5),
    ("더스티 로즈",     "#C98F95", -0.5),
    ("로즈 브라운",     "#A8656C", -0.5),
    ("모브",            "#B48A9B", -0.5),
    ("스모크 모브",     "#9A7F8F", -0.5),
    ("로즈 핑크",       "#E27B9B", -0.5),
    ("버블검",          "#F078B0", -0.5),
    ("라즈베리 핑크",   "#D94F7F", -0.5),
    ("핫핑크",          "#E8508F", -1.0),
    ("푸시아",          "#D45B9E", -1.0),
    ("마젠타",          "#C8368E", -1.0),
    ("오키드",          "#B374C4", -1.0),
    ("라벤더 퍼플",     "#9B87D0", -1.0),
    ("퍼플 그레이",     "#8E849E", -0.5),
    ("페리윙클",        "#8E9BE0", -1.0),
    ("스카이 코발트",   "#5B8DD9", -0.5),
    ("코발트",          "#4F7CC4", -1.0),
    ("시안 블루",       "#4FA3C7", -0.5),
    ("슬레이트 블루",   "#6F8FAF", -0.5),
    ("블루 그레이",     "#7C8FA3", -0.5),
    ("에메랄드",        "#3DAE8C", -1.0),
    ("민트 그린",       "#5DBB8A", 0.0),
    ("청록 민트",       "#6CC5B0", -0.5),
    ("아쿠아 틸",       "#43B3AE", -0.5),
    ("틸",              "#3E9C9C", 0.0),
    ("피콕 그린",       "#2F8F83", 0.0),
    ("스모키 그레이",   "#8A8F96", -0.5),
    ("쿨 그레이",       "#9AA3AE", -0.5),
    # ── 딥 / 다크 ───────────────────────────────────────────
    ("브릭 레드",       "#A5412F", 1.0),
    ("번트 오렌지",     "#B5541F", 1.0),
    ("탄제린 다크",     "#A8481C", 1.0),
    ("러스트",          "#9A4A2B", 1.0),
    ("다크 코랄",       "#B8473F", 0.5),
    ("올리브 다크",     "#5C6030", 0.5),
    ("카키 다크",       "#44482E", 0.5),
    ("다크 올리브",     "#4A4F2A", 0.5),
    ("초콜릿 브라운",   "#5A3A2A", 1.0),
    ("다크 초콜릿",     "#3B2A24", 0.5),
    ("모카",            "#7A5441", 1.0),
    ("로즈우드",        "#8E4B4F", 0.0),
    ("에스프레소",      "#3E2A22", 0.0),
    ("포레스트 그린",   "#2F5D3A", 0.0),
    ("다크 에메랄드",   "#0F5A4A", -0.5),
    ("블랙",            "#1B1B1D", 0.0),
    ("오닉스",          "#232326", 0.0),
    ("체리",            "#B01E3A", -0.5),
    ("와인",            "#7A2338", -0.5),
    ("마룬",            "#5A1F2B", -0.5),
    ("블랙체리",        "#4A1626", -0.5),
    ("와인 브라운",     "#5E3340", -0.5),
    ("버건디",          "#6E1F2E", -0.5),
    ("베리",            "#8A2D5C", -1.0),
    ("플럼",            "#5E2A52", -1.0),
    ("그레이프",        "#5B3A7A", -1.0),
    ("딥 퍼플",         "#3E2562", -1.0),
    ("네이비",          "#1F2F5C", -1.0),
    ("미드나잇 블루",   "#1B2545", -1.0),
    ("인디고",          "#35407F", -1.0),
    ("스틸 블루",       "#3E5875", -0.5),
    ("딥 틸",           "#1F5F66", -0.5),
    ("차콜",            "#3A3D42", -0.5),
]

# 밝기 구간 경계 (색의 L*)
LIGHT_MIN_L = 75.0
MID_MIN_L = 50.0

# ── 피부 기준 (이 카메라 설정에서 잰 값 기준의 임시값) ───────────────────────────
SKIN_REF_HUE = 59.0       # 이 색상각이 웜 정도 0 (skin_color의 쿨 55 / 웜 63의 한가운데 = 뉴트럴)
SKIN_WARM_SPAN = 12.0     # 기준에서 이만큼(도) 벗어나면 웜 정도가 +-1 (47도 이하 완전 쿨, 71도 이상 완전 웜)
SKIN_REF_CHROMA = 33.0    # 이 채도 위/아래로 차분한 색 / 선명한 색을 더 높게 본다
SKIN_CHROMA_SPAN = 4.0
SKIN_L_LOW, SKIN_L_HIGH = 60.0, 76.0     # 이 사이에서 밝은 색/딥 색 개수가 연속으로 바뀐다

# 피부 밝기에 따른 구간별 개수: 밝은 피부 쪽 / 어두운 피부 쪽 양 끝 (중간은 보간)
QUOTA_LIGHT_SKIN = {"light": 11, "mid": 12, "deep": 7}
QUOTA_DARK_SKIN = {"light": 8, "mid": 12, "deep": 10}

# 같은 색 계열(hue 30도 구간)에서 최대 개수 / 무채색·누드 계열 최대 개수
MAX_PER_FAMILY = 3
MAX_NEUTRAL_FAMILY = 5
NEUTRAL_CHROMA = 14.0

# 점수 가중치
W_TONE = 1.0
W_CHROMA = 0.30
W_COMPLEMENT = 0.20
NEUTRAL_PENALTY = 0.35      # 흰색/회색/베이지처럼 채도가 거의 없는 색은 무난하지만 '추천'으로는 조금 덜 앞세운다
DIVERSITY_PENALTY = 1.1     # 이미 뽑은 색과 같은 색일 때의 감점 (색을 고를 때)
ORDER_DIVERSITY = 0.45      # 같은 감점을, 고른 색을 화면 순서로 늘어놓을 때는 이만큼만 쓴다
DIVERSITY_DELTA_E = 14.0    # Lab 거리 이만큼이면 유사도가 약 37%로 줄어든다
MAX_MISMATCH_STEPS = (1.0, 1.4, 9.0)   # 피부-색 웜 정도 차이 허용 한계 (모자라면 단계적으로 푼다)

# 보색 궁합: 붉은기가 강한 피부 -> 초록/청록, 노란기가 강한 피부 -> 보라/파랑 (Lab 색상각 기준 범위, 중심, 폭)
COMPLEMENT_FOR_RED = (160.0, 60.0)       # 초록~청록
COMPLEMENT_FOR_YELLOW = (290.0, 60.0)    # 보라~파랑 (Lab에서 파랑은 약 270~300도)


# ── 색 변환 (외부 모듈 의존 없이 hex -> Lab) ───────────────────────────────

def _lin(c: float) -> float:
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_lab(hex_color: str) -> tuple:
    h = hex_color.lstrip("#")
    r, g, b = (_lin(int(h[i:i + 2], 16)) for i in (0, 2, 4))
    x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
    y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b
    z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116

    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def _band(L: float) -> str:
    return "light" if L >= LIGHT_MIN_L else "mid" if L >= MID_MIN_L else "deep"


def _tone_label(warmth: float) -> str:
    return "warm" if warmth > 0.25 else "cool" if warmth < -0.25 else "neutral"


def _build_catalog() -> list:
    out = []
    for name, hex_color, warmth in NAIL_COLORS:
        L, a, b = hex_to_lab(hex_color)
        C = math.hypot(a, b)
        H = math.degrees(math.atan2(b, a)) % 360
        out.append({
            "name": name, "name_ko": name, "hex": hex_color.upper(), "warmth": warmth,
            "tone": _tone_label(warmth),
            "L": L, "a": a, "b": b, "C": C, "H": H, "band": _band(L),
            "family": "neutral" if C < NEUTRAL_CHROMA else f"h{int(H // 30)}",
        })
    return out


CATALOG = _build_catalog()


# ── 피부 프로필 ───────────────────────────────────────────────────────────

# a, b를 모를 때(톤만 아는 옛 호출) 쓰는 대표 피부 색상각/채도
_TONE_DEFAULT_HUE = {"cool": 46.0, "neutral": 58.0, "warm": 70.0}


def _clip(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def skin_profile(tone: str, skin_L: float, skin_a: float = None, skin_b: float = None) -> dict:
    if skin_a is not None and skin_b is not None:
        hue = math.degrees(math.atan2(skin_b, skin_a)) % 360
        chroma = math.hypot(skin_a, skin_b)
    else:
        hue = _TONE_DEFAULT_HUE.get(tone, 58.0)
        chroma = SKIN_REF_CHROMA
    return {
        "L": skin_L, "hue": hue, "chroma": chroma,
        "warmth": _clip((hue - SKIN_REF_HUE) / SKIN_WARM_SPAN, -1.0, 1.0),          # -1 쿨 ~ +1 웜
        "redness": _clip((SKIN_REF_HUE - hue) / SKIN_WARM_SPAN, 0.0, 1.5),           # 붉은기가 강할수록 커진다
        "yellowness": _clip((hue - SKIN_REF_HUE) / SKIN_WARM_SPAN, 0.0, 1.5),        # 노란기가 강할수록 커진다
        "chroma_z": _clip((chroma - SKIN_REF_CHROMA) / SKIN_CHROMA_SPAN, -1.5, 1.5),
    }


def _quota(skin_L: float, n: int) -> dict:
    t = _clip((skin_L - SKIN_L_LOW) / (SKIN_L_HIGH - SKIN_L_LOW), 0.0, 1.0)     # 0 = 어두운 피부, 1 = 밝은 피부
    raw = {k: QUOTA_DARK_SKIN[k] + (QUOTA_LIGHT_SKIN[k] - QUOTA_DARK_SKIN[k]) * t for k in QUOTA_LIGHT_SKIN}
    scaled = {k: v * n / sum(raw.values()) for k, v in raw.items()}
    out = {k: int(round(v)) for k, v in scaled.items()}
    out["mid"] += n - sum(out.values())                      # 반올림 차이는 중간 톤에서 맞춤
    return out


def _mismatch(e: dict, prof: dict) -> float:
    return abs(prof["warmth"] - e["warmth"])


def _angle_match(H: float, center: float, half_width: float) -> float:
    d = abs((H - center + 180.0) % 360.0 - 180.0)
    return max(0.0, 1.0 - d / half_width)


def _base_score(e: dict, prof: dict) -> float:
    tone = W_TONE * (2.0 - _mismatch(e, prof))
    muted = _clip(1.0 - e["C"] / 50.0, 0.0, 1.0)                  # 1 = 차분한 색, 0 = 선명한 색
    chroma = W_CHROMA * prof["chroma_z"] * (2.0 * muted - 1.0)    # 채도 높은 피부 -> 차분한 색 가산
    comp = 0.0
    if e["C"] >= NEUTRAL_CHROMA:
        comp = W_COMPLEMENT * (prof["redness"] * _angle_match(e["H"], *COMPLEMENT_FOR_RED)
                               + prof["yellowness"] * _angle_match(e["H"], *COMPLEMENT_FOR_YELLOW))
    return tone + chroma + comp - (NEUTRAL_PENALTY if e["C"] < NEUTRAL_CHROMA else 0.0)


def _distance(e1: dict, e2: dict) -> float:
    return math.sqrt((e1["L"] - e2["L"]) ** 2 + (e1["a"] - e2["a"]) ** 2 + (e1["b"] - e2["b"]) ** 2)


def _similarity_penalty(e: dict, chosen: list, weight: float = DIVERSITY_PENALTY) -> float:
    if not chosen:
        return 0.0
    return weight * max(math.exp(-_distance(e, c) / DIVERSITY_DELTA_E) for c in chosen)


def pick_palette(tone: str, skin_L: float, n: int = 30, skin_a: float = None, skin_b: float = None) -> list:
    """피부에 맞는 네일 컬러 n개. 가장 잘 맞고 서로 다른 색이 앞에 오도록 정렬해서 돌려준다.

    skin_a/skin_b를 주면 피부 색상각/채도로 연속 점수를 매기고, 안 주면 tone(웜/쿨/뉴트럴)의 대표값을 쓴다.
    밝기 구간(light/mid/deep)마다 정해진 개수를 채우되, 정반대 톤인 색은 처음에는 후보에서 빼고
    개수가 모자랄 때만 단계적으로 허용한다.
    """
    n = min(n, len(CATALOG))
    prof = skin_profile(tone, skin_L, skin_a, skin_b)
    base = {e["name"]: _base_score(e, prof) for e in CATALOG}
    quota = _quota(skin_L, n)
    chosen, fam_count = [], {}

    def cap(e, mult):
        return (MAX_NEUTRAL_FAMILY if e["family"] == "neutral" else MAX_PER_FAMILY) * mult

    def pick_one(band, fam_mult, max_mismatch):
        pool = [e for e in CATALOG
                if (band is None or e["band"] == band) and e not in chosen
                and _mismatch(e, prof) <= max_mismatch and fam_count.get(e["family"], 0) < cap(e, fam_mult)]
        if not pool:
            return False
        best = max(pool, key=lambda e: (base[e["name"]] - _similarity_penalty(e, chosen), e["name"]))
        chosen.append(best)
        fam_count[best["family"]] = fam_count.get(best["family"], 0) + 1
        return True

    # 톤이 맞는 색 안에서 계열 제한을 먼저 풀고, 그래도 모자랄 때만 톤 허용 범위를 넓힌다
    passes = [(f, m) for m in MAX_MISMATCH_STEPS for f in (1, 2, 99)]
    for band in ("light", "mid", "deep"):
        got = 0
        for fam_mult, max_mm in passes:
            while got < quota[band] and pick_one(band, fam_mult, max_mm):
                got += 1
    for fam_mult, max_mm in passes:                            # 구간 안에서 못 채운 만큼은 어느 구간이든
        while len(chosen) < n and pick_one(None, fam_mult, max_mm):
            pass

    # 표시 순서: 밝은 색 / 중간 색 / 딥 컬러를 번갈아 가며, 각 구간에서는 점수가 높으면서 이미 나온 색과 다른 색을
    # 먼저 둔다 (화면에는 앞쪽 몇 개만 보이는데, 파스텔만 또는 회색만 줄줄이 나오지 않게)
    remaining, ordered = list(chosen), []
    pattern = ("light", "mid", "light", "mid", "deep")
    step = 0
    while remaining:
        want = pattern[step % len(pattern)]
        step += 1
        pool = [e for e in remaining if e["band"] == want] or remaining
        nxt = max(pool, key=lambda e: (base[e["name"]] - _similarity_penalty(e, ordered, ORDER_DIVERSITY), e["name"]))
        remaining.remove(nxt)
        ordered.append(nxt)
    return [_public(e, base[e["name"]]) for e in ordered]


def pick_avoid(tone: str, n: int = 10, skin_L: float = None, skin_a: float = None, skin_b: float = None) -> list:
    """이 피부에 상대적으로 안 어울리는 색 n개 (참고용): 웜 정도가 가장 반대인 색들."""
    prof = skin_profile(tone, skin_L if skin_L is not None else 65.0, skin_a, skin_b)
    ranked = sorted(CATALOG, key=lambda e: (-_mismatch(e, prof), e["name"]))
    seen_family, out = {}, []
    for e in ranked:
        if len(out) >= n:
            break
        if seen_family.get(e["family"], 0) < 2:
            seen_family[e["family"]] = seen_family.get(e["family"], 0) + 1
            out.append(_public(e, _base_score(e, prof)))
    return out


def _public(e: dict, score: float) -> dict:
    return {
        "hex": e["hex"], "name": e["name"], "name_ko": e["name_ko"], "score": round(score, 2),
        "tone": e["tone"], "warmth": e["warmth"], "band": e["band"],
        "L": round(e["L"], 1), "C": round(e["C"], 1), "H": round(e["H"], 1),
    }
