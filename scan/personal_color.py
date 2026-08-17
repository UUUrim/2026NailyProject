"""
퍼스널컬러 진단 로직 (main_proto.py 기반)

손 촬영 이미지에서 피부 영역을 추출하고 16계절 퍼스널컬러를 분류합니다.
"""

from __future__ import annotations

import math
import os
from typing import Any

import cv2
import numpy as np

# 프론트엔드 designPreferences.ts 와 동일한 팔레트
PERSONAL_COLOR_SWATCHES: dict[str, list[str]] = {
    "spring_light": [
        "#FBDBDD", "#F8C8CA", "#F7B7BA", "#FFFCEF", "#FEE2CB", "#FEDBB3", "#F9BF97", "#FFF0DD",
        "#FBF5B9", "#FFF0AD", "#FFE88B", "#FDE1B5", "#e3edcb", "#e0ebbf", "#d2e091", "#f6bdbd",
        "#E9F5F2", "#C6E7F4", "#A5DAEC", "#F7B7B4", "#EDDDEE", "#F8D4E8", "#E3B2D4", "#F7BBAE",
    ],
    "spring_bright": [
        "#ED6C79", "#EB5C5A", "#EB5A49", "#FFF7D2", "#F7A55A", "#F7A743", "#EF7E2F", "#FEE4BE",
        "#FBEC50", "#FFDC38", "#FFD019", "#FED59A", "#d0dc70", "#cddb63", "#c5d546", "#ec5f5d",
        "#9DD1D8", "#6FB3DF", "#60AEDC", "#E66B63", "#D182B4", "#AE79B2", "#7F5EA3", "#F07858",
    ],
    "spring_vivid": [
        "#E94040", "#E20E15", "#E42321", "#FFF7D2", "#F38F2F", "#F08212", "#EB6010", "#FEE4BE",
        "#FFEB33", "#FED606", "#FCC909", "#fed59a", "#d2d81e", "#b7ce22", "#39aa37", "#e51f1f",
        "#3ABCE7", "#40A3DA", "#407FBF", "#e4231b", "#AB5CA0", "#844190", "#6F3C8E", "#E6341F",
    ],
    "spring_soft": [
        "#F1C2BF", "#EDB9AE", "#E8A79F", "#F5F1E4", "#F6DAC3", "#F0D3B3", "#E5BA9D", "#DAC6AD",
        "#E8E3D0", "#E9DFB6", "#EADB9C", "#E0BB8F", "#e7e4d0", "#cfcc9b", "#b0bf97", "#eaa1a2",
        "#DFEBE8", "#A2CDCB", "#A3C7D3", "#ECAFA6", "#E0D2E5", "#DCC1D7", "#DBB1D4", "#F4AE98",
    ],
    "summer_light": [
        "#FAE5E8", "#F6D1DC", "#E3ACCB", "#FFFFFF", "#FDF6C6", "#F6ECB3", "#FDEA75", "#EDEDED",
        "#C2E2D9", "#B8D7C2", "#A2D2B7", "#D9B9B9", "#a8cfe4", "#a5d7d9", "#91ced2", "#f5bad5",
        "#D2E1EB", "#9a9dca", "#7c84c0", "#f7bace", "#E1D9ED", "#D1BCD7", "#B798C8", "#F4AAB6",
    ],
    "summer_mute": [
        "#998B8E", "#B58D98", "#A76B8B", "#FFFFFF", "#A09C7B", "#AEA560", "#C1AF41", "#767675",
        "#6E7875", "#778B7D", "#638771", "#554544", "#667f89", "#6e9094", "#588c92", "#a47488",
        "#778690", "#7e8991", "#40456d", "#a37481", "#78787a", "#837384", "#6c5571", "#a26971",
    ],
    "summer_bright": [
        "#EC5F74", "#EA6293", "#E777AC", "#FFFFFF", "#FDEB34", "#FBEC50", "#F3E949", "#C6C6C6",
        "#7DC5A6", "#79C39E", "#6EC1BB", "#878787", "#59b4e1", "#67a0ce", "#757bb7", "#e26fa7",
        "#6a6baf", "#8083b6", "#9369a7", "#ea6ca2", "#E56BA5", "#E06895", "#D976AD", "#E95D82",
    ],
    "summer_soft": [
        "#DAAEB6", "#DD9EAC", "#D78DB0", "#FFFFFF", "#ECE6AC", "#D8CE73", "#E8D870", "#E2E2E2",
        "#B7D8CE", "#9CCAAB", "#9FCFB1", "#C49997", "#95c1d7", "#91c5c9", "#8ccbd1", "#f3bfd4",
        "#afcddf", "#8b91b9", "#6b78ae", "#f3c0cc", "#D3C3D9", "#C29FC0", "#AF8DB5", "#F3B0B6",
    ],
    "autumn_dark": [
        "#5B4241", "#6E2831", "#75160E", "#FFF7D2", "#655240", "#7A5431", "#782E0F", "#634E43",
        "#6F6C44", "#887628", "#8C6D14", "#432918", "#494929", "#565a2c", "#1e371d", "#7d1713",
        "#41575f", "#3d5c67", "#0f334d", "#7c3112", "#3A2B3A", "#352839", "#3B2257", "#7F4411",
    ],
    "autumn_deep": [
        "#BF3E4E", "#BE312F", "#C23A1A", "#FFF7D2", "#C9772D", "#C87F1B", "#C26516", "#936037",
        "#CDBD24", "#D1AF13", "#D2B207", "#7C4E24", "#a0ac40", "#9fac35", "#7da82a", "#cb3e3a",
        "#65a4ac", "#3c85b4", "#204f90", "#cb483d", "#a44f85", "#834986", "#362562", "#ce5636",
    ],
    "autumn_mute": [
        "#8A6F6C", "#AB877F", "#BB7570", "#F5F1E4", "#8E7D6F", "#B29B85", "#B58B6B", "#DAC6AD",
        "#827F74", "#AAA183", "#B9AA6B", "#E0BB8F", "#7f7e73", "#8e8d6b", "#7f8e66", "#a36062",
        "#7d8482", "#718d8b", "#6f97a2", "#a26c64", "#7b737c", "#9b8998", "#ac7ba1", "#aa6e5b",
    ],
    "autumn_soft": [
        "#DDC1C3", "#DAAEB4", "#CF9A9F", "#FFFCEF", "#DFC5B2", "#DEBF9D", "#DDA785", "#E4D5C4",
        "#DED7A4", "#E2D396", "#E1CB79", "#E4C7A2", "#c6d0b2", "#c5cda6", "#b8c17d", "#d8a6a8",
        "#ced7d5", "#adcbd9", "#90becd", "#d9a09d", "#c4b8d2", "#d5b0d3", "#ba91c1", "#daa499",
    ],
    "winter_dark": [
        "#513E40", "#632139", "#5A0E33", "#FFFFFF", "#615D3E", "#756E20", "#665C1A", "#29245B",
        "#292929", "#1D3C2C", "#043934", "#1D1D1B", "#334046", "#2a2a4a", "#242754", "#612142",
        "#26263b", "#2a2a4a", "#241d48", "#68213f", "#493d42", "#482733", "#380c26", "#671a2e",
    ],
    "winter_deep": [
        "#B91818", "#AF144A", "#A81258", "#FFFFFF", "#008E40", "#00784A", "#0C8067", "#282A5E",
        "#0E8E87", "#02726D", "#055E5B", "#1D1D1B", "#0169a3", "#015089", "#223565", "#aa1643",
        "#25356f", "#252e60", "#262c5f", "#ac182e", "#8b1d6b", "#78216c", "#591b50", "#ac1916",
    ],
    "winter_light": [
        "#FCE9F2", "#F9CEDF", "#F195B6", "#FFFFFF", "#FEFBD9", "#FCF7CA", "#FEF292", "#29245B",
        "#E4F1E7", "#D3EAE9", "#A5D8E5", "#1D1D1B", "#e9f6fc", "#c7e8f7", "#96c0e7", "#f4cfd9",
        "#d9effc", "#d0d0e9", "#9ab6e0", "#f6d2e5", "#fbe6f1", "#f0d0e7", "#e09ac3", "#f0cce2",
    ],
    "winter_vivid": [
        "#E51A4D", "#E6074C", "#CD0B5C", "#FFFFFF", "#FFE008", "#FCDB03", "#E5C703", "#29245B",
        "#53BBB3", "#2CAA56", "#00A471", "#1D1D1B", "#29a5df", "#217fc2", "#16438f", "#dd0a76",
        "#3a8aca", "#4459a4", "#243064", "#df1a70", "#ab63a5", "#9b3f8f", "#c40d60", "#df144c",
    ],
}

SEASON_META: list[tuple[str, str, str]] = [
    ("spring_light", "봄 라이트", "warm"),
    ("spring_bright", "봄 브라이트", "warm"),
    ("spring_vivid", "봄 비비드", "warm"),
    ("spring_soft", "봄 소프트", "warm"),
    ("summer_light", "여름 라이트", "cool"),
    ("summer_mute", "여름 뮤트", "cool"),
    ("summer_bright", "여름 브라이트", "cool"),
    ("summer_soft", "여름 소프트", "cool"),
    ("autumn_dark", "가을 다크", "warm"),
    ("autumn_deep", "가을 딥", "warm"),
    ("autumn_mute", "가을 뮤트", "warm"),
    ("autumn_soft", "가을 소프트", "warm"),
    ("winter_dark", "겨울 다크", "cool"),
    ("winter_deep", "겨울 딥", "cool"),
    ("winter_light", "겨울 라이트", "cool"),
    ("winter_vivid", "겨울 비비드", "cool"),
]


def rgb_to_lab(r: float, g: float, b: float) -> tuple[float, float, float]:
    r, g, b = r / 255, g / 255, b / 255

    def f(v: float) -> float:
        return ((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92

    r, g, b = f(r), f(g), f(b)
    x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
    y = r * 0.2126 + g * 0.7152 + b * 0.0722
    z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883

    def fc(v: float) -> float:
        return v ** (1 / 3) if v > 0.008856 else 7.787 * v + 16 / 116

    return (116 * fc(y) - 16, 500 * (fc(x) - fc(y)), 200 * (fc(y) - fc(z)))


def lab_to_hex(L: float, a: float, b: float) -> str:
    def fi(v: float) -> float:
        return v ** 3 if v ** 3 > 0.008856 else (v - 16 / 116) / 7.787

    y = (L + 16) / 116
    x = a / 500 + y
    z = y - b / 200
    x, y, z = fi(x) * 0.95047, fi(y), fi(z) * 1.08883
    r = x * 3.2406 + y * -1.5372 + z * -0.4986
    g = x * -0.9689 + y * 1.8758 + z * 0.0415
    bv = x * 0.0557 + y * -0.2040 + z * 1.0570

    def s(v: float) -> float:
        v = max(0, min(1, v))
        return 1.055 * (v ** (1 / 2.4)) - 0.055 if v > 0.0031308 else 12.92 * v

    return "#{:02x}{:02x}{:02x}".format(
        round(s(r) * 255), round(s(g) * 255), round(s(bv) * 255)
    ).upper()


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _build_seasons() -> dict[str, dict[str, Any]]:
    seasons: dict[str, dict[str, Any]] = {}
    for code, name_ko, tone in SEASON_META:
        colors = PERSONAL_COLOR_SWATCHES[code]
        labs = []
        for hex_color in colors:
            r, g, b = _hex_to_rgb(hex_color)
            L, a, bv = rgb_to_lab(r, g, b)
            labs.append({"hex": hex_color.upper(), "lab": [L, a, bv]})

        avg_l = sum(item["lab"][0] for item in labs) / len(labs)
        avg_a = sum(item["lab"][1] for item in labs) / len(labs)
        avg_b = sum(item["lab"][2] for item in labs) / len(labs)
        avg_c = sum(math.sqrt(item["lab"][1] ** 2 + item["lab"][2] ** 2) for item in labs) / len(labs)

        seasons[code] = {
            "nameKo": name_ko,
            "tone": tone,
            "avgL": avg_l,
            "avgA": avg_a,
            "avgB": avg_b,
            "avgC": avg_c,
            "colors": [color.upper() for color in colors],
            "labs": labs,
        }
    return seasons


SEASONS = _build_seasons()


def classify_season(sL: float, sA: float, sB: float, contrast: float) -> list[tuple[str, float]]:
    skin_c = math.sqrt(sA ** 2 + sB ** 2)
    skin_warm = sB - sA * 0.5
    is_warm = skin_warm > 9
    is_cool = skin_warm < 6
    is_neutral = not is_warm and not is_cool

    is_vivid = contrast > 50
    is_bright = contrast > 38
    is_mute = contrast < 22
    is_soft = contrast < 32

    is_light_skin = sL > 65
    is_dark_skin = sL < 55

    scores: dict[str, float] = {}
    for code, season in SEASONS.items():
        score = 100.0
        name = season["nameKo"]
        pL = season["avgL"]
        pC = season["avgC"]

        if is_warm and season["tone"] == "warm":
            score += 30
        elif is_cool and season["tone"] == "cool":
            score += 30
        elif is_neutral:
            score += 5
        else:
            score -= 35

        dL = pL - sL
        if dL > 35:
            score -= 14
        elif dL > 18:
            score -= 4
        elif dL > 8:
            score += 10
        elif dL > -8:
            score += 4
        elif dL > -22:
            score -= 7
        else:
            score -= 16

        c_diff = pC - skin_c
        if c_diff > 15:
            score += 8
        elif c_diff > 5:
            score += 5
        elif c_diff > -5:
            score += 0
        else:
            score -= 8

        contrast_weight = 0.5 if is_dark_skin else 1.0
        if is_vivid:
            if "브라이트" in name or "비비드" in name:
                score += 18 * contrast_weight
            elif "뮤트" in name:
                score -= 15 * contrast_weight
            elif "소프트" in name:
                score -= 10 * contrast_weight
        elif is_bright:
            if "브라이트" in name or "비비드" in name:
                score += 10 * contrast_weight
            elif "소프트" in name:
                score += 5 * contrast_weight
            elif "뮤트" in name:
                score -= 8 * contrast_weight
        elif is_mute:
            if "뮤트" in name:
                score += 18 * contrast_weight
            elif "소프트" in name:
                score += 8 * contrast_weight
            elif "브라이트" in name or "비비드" in name:
                score -= 15 * contrast_weight
        elif is_soft:
            if "소프트" in name or "뮤트" in name:
                score += 10 * contrast_weight
            elif "브라이트" in name or "비비드" in name:
                score -= 10 * contrast_weight

        if (is_cool or is_neutral) and season["tone"] == "cool":
            if is_light_skin and "겨울" in name:
                score += 8
            if is_light_skin and "여름" in name:
                score -= 5
            if is_dark_skin and "여름" in name:
                score += 8
            if is_dark_skin and "겨울" in name:
                score -= 5

        if (is_warm or is_neutral) and season["tone"] == "warm":
            if is_light_skin and "봄" in name:
                score += 8
            if is_light_skin and "가을" in name:
                score -= 5
            if is_dark_skin and "가을" in name:
                score += 8
            if is_dark_skin and "봄" in name:
                score -= 5

        if is_dark_skin:
            if "다크" in name or "딥" in name:
                score += 8
        if is_light_skin:
            if "다크" in name:
                score -= 8

        if is_dark_skin and pL > 70:
            score -= 12
        if is_dark_skin and is_cool and "여름" in name:
            score -= 10

        scores[code] = score

    return sorted(scores.items(), key=lambda x: x[1], reverse=True)


def diagnose_personal_color_from_image(img: np.ndarray) -> dict[str, Any]:
    """BGR 이미지 배열에서 퍼스널컬러를 진단합니다."""
    img = cv2.resize(img, (600, 800))

    ycbcr = cv2.cvtColor(img, cv2.COLOR_BGR2YCrCb)
    Y, Cr, Cb = ycbcr[:, :, 0], ycbcr[:, :, 1], ycbcr[:, :, 2]
    skin_mask = (Cr >= 133) & (Cr <= 175) & (Cb >= 80) & (Cb <= 128) & (Y > 60)
    fg = img[skin_mask]

    if len(fg) < 200:
        skin_mask = (Cr >= 125) & (Cr <= 180) & (Cb >= 75) & (Cb <= 135) & (Y > 50)
        fg = img[skin_mask]

    if len(fg) < 50:
        return {"error": "피부 영역을 찾을 수 없습니다."}

    bright = fg[:, 0].astype(int) + fg[:, 1].astype(int) + fg[:, 2].astype(int)
    idx = np.argsort(bright)
    mid = fg[idx[len(idx) // 4 : len(idx) * 3 // 4]]

    r_avg = float(mid[:, 2].mean())
    g_avg = float(mid[:, 1].mean())
    b_avg = float(mid[:, 0].mean())
    L, a, bv = rgb_to_lab(r_avg, g_avg, b_avg)

    highlight = fg[idx[len(idx) * 9 // 10 :]]
    _, hl_a, hl_bv = rgb_to_lab(
        float(highlight[:, 2].mean()),
        float(highlight[:, 1].mean()),
        float(highlight[:, 0].mean()),
    )
    bv -= hl_bv * 0.4
    a -= hl_a * 0.3

    C = math.sqrt(a ** 2 + bv ** 2)
    contrast = float(mid.mean()) - float(fg[idx[: len(idx) // 7]].mean())
    skin_warm = bv - a * 0.5
    tone_str = "웜" if skin_warm > 8 else ("쿨" if skin_warm < 5 else "뉴트럴")

    sorted_seasons = classify_season(L, a, bv, contrast)
    top_code = sorted_seasons[0][0]
    top_season = SEASONS[top_code]

    print(
        f"[PersonalColor] L={L:.1f} a={a:.1f} b={bv:.1f} C={C:.1f} "
        f"skinWarm={skin_warm:.2f} contrast={contrast:.1f} [{tone_str}] "
        f"-> {top_season['nameKo']}"
    )

    return {
        "seasonCode": top_code,
        "seasonNameKo": top_season["nameKo"],
        "skinToneHex": lab_to_hex(L, a, bv),
        "recommendedColors": top_season["colors"][:6],
        "L": round(L, 2),
        "a": round(a, 2),
        "b": round(bv, 2),
        "C": round(C, 2),
        "contrast": round(contrast, 1),
        "skinWarm": round(skin_warm, 2),
        "tone": tone_str,
        "allSeasons": [
            {"code": code, "nameKo": SEASONS[code]["nameKo"], "score": round(score, 1)}
            for code, score in sorted_seasons[:4]
        ],
    }


def diagnose_personal_color(image_path: str) -> dict[str, Any] | None:
    """이미지 파일 경로에서 퍼스널컬러를 진단합니다."""
    if not image_path or not os.path.exists(image_path):
        return None

    img = cv2.imread(image_path)
    if img is None:
        return None

    return diagnose_personal_color_from_image(img)
