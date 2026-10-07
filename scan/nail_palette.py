"""
nail_palette.py
===============
피부 톤(웜/쿨/뉴트럴)과 피부 밝기에 맞는 네일 컬러 30개를 고른다.

예전 방식(색을 수학 점수로 생성)은 "피부와 밝기 차이가 클수록 점수가 높다"는 구조라서 항상 어두운
색만 뽑혔다. 지금은 실제로 네일에 쓰는 색을 손으로 고른 목록(NAIL_COLORS)에서 고른다.

  - 각 색에 "잘 어울리는 톤"(warm / cool / neutral)이 붙어 있다. (퍼스널컬러에서 흔히 쓰는 분류)
  - 밝기 구간(light / mid / deep)별로 개수를 정해서, 파스텔·누드부터 딥 컬러까지 고르게 들어간다.
  - 같은 색 계열이 몰리지 않게 계열마다 개수를 제한한다.

색을 추가/수정하려면 NAIL_COLORS만 고치면 된다. (이름, hex, 톤) 형식이다.
"""

from __future__ import annotations

import math
from typing import Optional

# (한글 이름, hex, 잘 어울리는 톤)  톤: "warm" | "cool" | "neutral"(누구에게나 무난)
NAIL_COLORS = [
    # ── 밝은 색: 누드 / 파스텔 / 밀키 ─────────────────────────────
    ("밀키 화이트",   "#F6F1EA", "neutral"),
    ("아이보리",      "#F3E9D2", "warm"),
    ("크림",          "#F4E3C1", "warm"),
    ("샴페인",        "#EAD7B7", "warm"),
    ("누드 베이지",   "#E8CDB5", "neutral"),
    ("피치 누드",     "#F2C6A8", "warm"),
    ("살구",          "#F6B999", "warm"),
    ("피치 핑크",     "#F7B8B0", "warm"),
    ("파스텔 코랄",   "#FBA897", "warm"),
    ("버터 옐로",     "#F8E49C", "warm"),
    ("레몬",          "#F6EDA4", "neutral"),
    ("베이비 핑크",   "#F7CAD3", "cool"),
    ("로즈 누드",     "#E9BEBE", "cool"),
    ("핑크 라일락",   "#E8C7DE", "cool"),
    ("라일락",        "#CDB4DB", "cool"),
    ("라벤더",        "#D8C8EE", "cool"),
    ("베이비 블루",   "#BFD9F2", "cool"),
    ("스카이 블루",   "#A8D4F0", "cool"),
    ("민트",          "#BFE9D6", "cool"),
    ("연한 세이지",   "#CBD9C0", "neutral"),
    ("쿨 그레이 라이트", "#D5D9DE", "cool"),
    ("그레이지",      "#D8CFC6", "neutral"),
    # ── 중간 톤 ───────────────────────────────────────────────
    ("코랄",          "#F2796B", "warm"),
    ("살몬",          "#F08C78", "warm"),
    ("테라코타",      "#C8705A", "warm"),
    ("오렌지",        "#F28C38", "warm"),
    ("머스터드",      "#D9A22B", "warm"),
    ("카라멜",        "#C48F5C", "warm"),
    ("카멜",          "#B98A57", "warm"),
    ("올리브",        "#8E9A4B", "warm"),
    ("모스 그린",     "#8DA06A", "warm"),
    ("토마토 레드",   "#E5483A", "warm"),
    ("세이지",        "#9CAF88", "neutral"),
    ("토프",          "#A89386", "neutral"),
    ("더스티 로즈",   "#C98F95", "cool"),
    ("모브",          "#B48A9B", "cool"),
    ("로즈 핑크",     "#E27B9B", "cool"),
    ("핫핑크",        "#E8508F", "cool"),
    ("푸시아",        "#D45B9E", "cool"),
    ("오키드",        "#B374C4", "cool"),
    ("라벤더 퍼플",   "#9B87D0", "cool"),
    ("페리윙클",      "#8E9BE0", "cool"),
    ("코발트",        "#4F7CC4", "cool"),
    ("슬레이트 블루", "#6F8FAF", "cool"),
    ("에메랄드",      "#3DAE8C", "cool"),
    ("청록 민트",     "#6CC5B0", "cool"),
    ("틸",            "#3E9C9C", "neutral"),
    ("스모키 그레이", "#8A8F96", "cool"),
    # ── 딥 / 다크 ───────────────────────────────────────────
    ("브릭 레드",     "#A5412F", "warm"),
    ("번트 오렌지",   "#B5541F", "warm"),
    ("러스트",        "#9A4A2B", "warm"),
    ("올리브 다크",   "#5C6030", "warm"),
    ("초콜릿 브라운", "#5A3A2A", "warm"),
    ("모카",          "#7A5441", "warm"),
    ("로즈우드",      "#8E4B4F", "neutral"),
    ("에스프레소",    "#3E2A22", "neutral"),
    ("포레스트 그린", "#2F5D3A", "neutral"),
    ("블랙",          "#1B1B1D", "neutral"),
    ("체리",          "#B01E3A", "cool"),
    ("와인",          "#7A2338", "cool"),
    ("버건디",        "#6E1F2E", "cool"),
    ("베리",          "#8A2D5C", "cool"),
    ("플럼",          "#5E2A52", "cool"),
    ("그레이프",      "#5B3A7A", "cool"),
    ("네이비",        "#1F2F5C", "cool"),
    ("인디고",        "#35407F", "cool"),
    ("딥 틸",         "#1F5F66", "cool"),
    ("차콜",          "#3A3D42", "cool"),
]

# 밝기 구간 경계 (색의 L*)
LIGHT_MIN_L = 75.0
MID_MIN_L = 50.0

# 피부 밝기(L*)에 따른 구간별 개수 (30개 기준). 피부가 밝을수록 밝은 색을 조금 더 넣는다.
# 피부 L* 기준은 이 카메라 설정(노출/마커 흰색 보정)에서 잰 값 기준의 임시값이다.
SKIN_LIGHT_L = 70.0
SKIN_DARK_L = 55.0
QUOTA_LIGHT_SKIN = {"light": 11, "mid": 12, "deep": 7}
QUOTA_MEDIUM_SKIN = {"light": 10, "mid": 12, "deep": 8}
QUOTA_DARK_SKIN = {"light": 8, "mid": 12, "deep": 10}

# 같은 색 계열(hue 12구간)에서 최대 개수 / 무채색·누드 계열 최대 개수
MAX_PER_FAMILY = 3
MAX_NEUTRAL_FAMILY = 6
NEUTRAL_CHROMA = 14.0

# 피부 톤 -> 색의 톤 적합도
TONE_FIT = {
    "warm":    {"warm": 2.0, "neutral": 1.0, "cool": 0.0},
    "cool":    {"warm": 0.0, "neutral": 1.0, "cool": 2.0},
    "neutral": {"warm": 1.2, "neutral": 2.0, "cool": 1.2},
}


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


def _build_catalog() -> list:
    out = []
    for name, hex_color, tone in NAIL_COLORS:
        L, a, b = hex_to_lab(hex_color)
        C = math.hypot(a, b)
        H = math.degrees(math.atan2(b, a)) % 360
        out.append({
            "name": name, "name_ko": name, "hex": hex_color.upper(), "tone": tone,
            "L": L, "C": C, "H": H, "band": _band(L),
            "family": "neutral" if C < NEUTRAL_CHROMA else f"h{int(H // 30)}",
        })
    return out


CATALOG = _build_catalog()


def _quota(skin_L: float, n: int) -> dict:
    base = (QUOTA_LIGHT_SKIN if skin_L >= SKIN_LIGHT_L
            else QUOTA_DARK_SKIN if skin_L < SKIN_DARK_L else QUOTA_MEDIUM_SKIN)
    if n == sum(base.values()):
        return dict(base)
    scaled = {k: max(1, round(v * n / sum(base.values()))) for k, v in base.items()}
    scaled["mid"] += n - sum(scaled.values())            # 반올림 차이는 중간 톤에서 맞춤
    return scaled


def _fit(entry: dict, tone: str) -> float:
    return TONE_FIT.get(tone, TONE_FIT["neutral"])[entry["tone"]]


def pick_palette(tone: str, skin_L: float, n: int = 30) -> list:
    """톤과 피부 밝기에 맞는 네일 컬러 n개 (색상 순으로 정렬해서 반환).

    밝기 구간(light/mid/deep)마다 정해진 개수를 채우되, 다음 순서로 후보를 푼다.
      1) 어울리는 톤(적합도 1 이상)이면서 계열 제한 안에 드는 색
      2) 어울리는 톤이면서 계열 제한을 2배로 푼 색
      3) 어울리는 톤이면 계열 제한 없이
      4) 그래도 모자랄 때만 안 어울리는 톤까지
    같은 조건이면 아직 덜 뽑힌 색 계열을 먼저 뽑아서 한쪽 계열로 몰리지 않게 한다.
    """
    n = min(n, len(CATALOG))
    quota = _quota(skin_L, n)
    chosen, fam_count = [], {}
    passes = ((1, 1.0), (2, 1.0), (99, 1.0), (99, -1.0))     # (계열 제한 배수, 최소 적합도)

    def cap(e, mult):
        return (MAX_NEUTRAL_FAMILY if e["family"] == "neutral" else MAX_PER_FAMILY) * mult

    def pick_one(band, mult, min_fit):
        pool = [e for e in CATALOG
                if (band is None or e["band"] == band) and e not in chosen
                and _fit(e, tone) >= min_fit and fam_count.get(e["family"], 0) < cap(e, mult)]
        if not pool:
            return False
        best = min(pool, key=lambda e: (-_fit(e, tone), fam_count.get(e["family"], 0), e["name"]))
        chosen.append(best)
        fam_count[best["family"]] = fam_count.get(best["family"], 0) + 1
        return True

    for band in ("light", "mid", "deep"):
        got = 0
        for mult, min_fit in passes:
            while got < quota[band] and pick_one(band, mult, min_fit):
                got += 1
    for mult, min_fit in passes:                              # 구간 안에서 못 채운 만큼은 어느 구간이든
        while len(chosen) < n and pick_one(None, mult, min_fit):
            pass

    chosen.sort(key=lambda e: (e["family"] == "neutral", e["H"], -e["L"]))
    return [_public(e, _fit(e, tone)) for e in chosen]


def pick_avoid(tone: str, n: int = 10) -> list:
    """이 톤에 상대적으로 안 어울리는 색 n개 (참고용)."""
    ranked = sorted(CATALOG, key=lambda e: (_fit(e, tone), e["name"]))
    seen_family, out = {}, []
    for e in ranked:
        if len(out) >= n:
            break
        if seen_family.get(e["family"], 0) < 2:
            seen_family[e["family"]] = seen_family.get(e["family"], 0) + 1
            out.append(_public(e, _fit(e, tone)))
    return out


def _public(e: dict, fit: float) -> dict:
    return {
        "hex": e["hex"], "name": e["name"], "name_ko": e["name_ko"], "score": round(fit, 1),
        "tone": e["tone"], "band": e["band"],
        "L": round(e["L"], 1), "C": round(e["C"], 1), "H": round(e["H"], 1),
    }
