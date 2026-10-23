"""
color_card.py
=============
손가락 띠(검은 종이) 위쪽 끝에 붙인 컬러 기준 카드(docs/calibration_card.png)를 다룬다.

[임시 - 색 보정 로직을 맞추는 동안만 쓴다. 다 끝나면 아래 훅을 빼서 원복한다]
카드에는 피부색 칸이 있어서, 손가락 분리(nail_measurer.segment_finger)가 이 칸들을 손가락으로 잡았다
(카드가 손가락 끝보다 위에 있어서 "맨 위에 있는 피부색 덩어리"로 뽑혀 No finger detected /
UNUSABLE length_mm=-27 이 났다). 그래서 길이/너비를 재기 전에 카드 자리를 띠 색으로 덮은 사본을 만든다.
색(피부/카드 읽기)에는 원본 사진을 쓴다.

훅(원복할 때 이 줄들만 빼면 된다):
  - nail_measurer.measure_finger   : detect_aruco 직후  top_img = color_card.suppress_card(...)
  - nail_live.measure_frame        : detect_aruco 직후  frame = color_card.suppress_card(...)
백업: scan_backup_before_card_2026-10-23 (이 파일을 빼도 다른 코드에는 영향이 없다)
"""

from __future__ import annotations

import cv2
import numpy as np

# 카드의 피부색 칸(4.0 x 5.5 mm, 간격 0.5 mm, 5칸이 한 줄)을 찾아서 그 둘레를 덮는다. 띠의 위쪽 끝에 붙어 있든,
# 띠 위 어디에 있든(카메라 위치가 바뀌어도) 상관없다. 카드가 띠보다 멀리 있어서 마커 면보다 조금 작게 보인다.
CARD_PATCH_W_MM, CARD_PATCH_H_MM, CARD_PITCH_MM = 4.0, 5.5, 4.5
CARD_PLANE_MPP_FACTOR = 1.1  # 카드 면의 mm/px는 마커 면보다 약 10% 크다 (카드가 마커보다 카메라에서 멀다)
CARD_MIN_PATCHES = 4         # 한 줄에서 이만큼 이상 찾아야 카드로 본다
CARD_SKIN_MIN_L = 90         # 피부색 칸 판정 (OpenCV Lab): 밝고(L) 노란기(b*)가 있는 칸. 채도가 낮은 칸은 a*가 낮아서 b*로 본다
CARD_SKIN_MIN_B = 146        # OpenCV b = b* + 128 이라 b* > 18 (회색/흰색 칸은 b*가 0 근처; 칸 사이 흰 틈이 번져서 칸이 붙지 않게 넉넉히)
CARD_PAINT_SIDE_MM = 4.0     # 피부색 칸 줄 좌우로 덮는 여백 (카드 흰 여백)
CARD_PAINT_ABOVE_MM = 11.0   # 위쪽: 회색 칸 줄 + 여백
CARD_PAINT_BELOW_MM = 4.0    # 아래쪽: 여백만 (손가락 끝을 덮지 않게 적게)
CARD_PAD_COLOR = (35, 36, 38)  # 덮을 색 (BGR, 어두운 띠 색)


def find_card(image: np.ndarray, aruco_corners: np.ndarray, mpp: float):
    """카드의 피부색 칸 한 줄(같은 높이에 일정 간격으로 4~5개)을 찾아 카드 영역 {"x0","x1","y0","y1"}을 돌려준다. 없으면 None.

    손가락은 크고 하나뿐인 덩어리라 이 모양(작은 칸 여러 개가 한 줄)과 헷갈리지 않는다.
    """
    if aruco_corners is None or mpp is None or mpp <= 0:
        return None
    H, W = image.shape[:2]
    m = mpp * CARD_PLANE_MPP_FACTOR
    pw, ph, pitch = CARD_PATCH_W_MM / m, CARD_PATCH_H_MM / m, CARD_PITCH_MM / m
    x_start = int(np.max(aruco_corners[:, 0]))
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2Lab)
    skin = ((lab[:, :, 0] > CARD_SKIN_MIN_L) & (lab[:, :, 2] > CARD_SKIN_MIN_B)).astype(np.uint8)
    skin[:, :x_start] = 0
    skin = cv2.morphologyEx(skin, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    skin = cv2.erode(skin, np.ones((3, 3), np.uint8))   # 칸 사이 틈이 번져 이어진 것을 끊는다
    n, _, stats, cent = cv2.connectedComponentsWithStats(skin, connectivity=4)
    blobs = []
    for k in range(1, n):
        x, y, w, h, area = (int(v) for v in stats[k])
        if 0.5 * pw <= w <= 1.6 * pw and 0.5 * ph <= h <= 1.6 * ph and area >= 0.5 * pw * ph:
            blobs.append((x, y, w, h, cent[k][1]))
    best = None
    for b in blobs:
        row = [c for c in blobs if abs(c[4] - b[4]) <= 0.3 * ph]
        row.sort(key=lambda c: c[0])
        if len(row) < CARD_MIN_PATCHES:
            continue
        gaps = [row[i + 1][0] - row[i][0] for i in range(len(row) - 1)]
        if not (0.6 * pitch <= float(np.median(gaps)) <= 1.5 * pitch):
            continue
        if best is None or len(row) > len(best):
            best = row
    if best is None:
        return None
    x0 = min(c[0] for c in best); x1 = max(c[0] + c[2] for c in best)
    y0 = min(c[1] for c in best); y1 = max(c[1] + c[3] for c in best)
    return {"x0": max(0, int(x0 - CARD_PAINT_SIDE_MM / m)), "x1": min(W, int(x1 + CARD_PAINT_SIDE_MM / m)),
            "y0": max(0, int(y0 - CARD_PAINT_ABOVE_MM / m)), "y1": min(H, int(y1 + CARD_PAINT_BELOW_MM / m)),
            "patches": len(best), "skin_row": [(c[0], c[1], c[2], c[3]) for c in best]}


def suppress_card(image: np.ndarray, aruco_corners: np.ndarray, mpp: float) -> np.ndarray:
    """카드 자리를 띠 색으로 덮은 사본을 돌려준다 (손가락/손톱 측정용). 카드가 없으면 같은 사진 그대로.

    어떤 오류가 나도 예외를 던지지 않고 원본을 돌려준다 (측정 흐름을 막지 않는다)."""
    try:
        card = find_card(image, aruco_corners, mpp)
    except Exception:                                   # noqa: BLE001
        return image
    if card is None:
        return image
    out = image.copy()
    out[card["y0"]:card["y1"], card["x0"]:card["x1"]] = CARD_PAD_COLOR
    return out


# ── 카드 읽기 ────────────────────────────────────────────────────────────
# 위 줄(회색 단계) / 아래 줄(피부색 사다리). 이름은 docs/calibration_card_values.json과 같다.
CARD_ROW_GRAY = ("white", "gray80", "gray65", "gray50", "gray35")
CARD_ROW_SKIN = ("skin_mid", "skin_dark", "skin_light", "skin_lowC", "skin_highC")
CARD_ROW_PITCH_MM = 6.0      # 줄 사이 간격 (5.5 + 0.5)
CARD_SAMPLE_FRAC = 0.35      # 칸 한가운데에서 이 비율만큼(가로/세로 반 길이)만 읽는다 (가장자리 번짐 제외)


def read_card(image: np.ndarray, aruco_corners: np.ndarray, mpp: float, rgb_to_lab=None):
    """카드의 10칸을 읽어 {칸 이름: {"L","a","b","rgb"}}를 돌려준다. 피부색 줄의 5칸 위치를 못 정하면 None.

    skin 줄 5칸을 먼저 찾고(find_card), 회색 줄은 그 5칸의 위쪽 한 줄 간격(6mm)에 있다.
    rgb_to_lab: RGB(0~1) 배열 -> Lab 함수 (기본은 skin_color.rgb_to_lab). 줄 단위로 가운데 영역의 중앙값을 쓴다.
    """
    card = find_card(image, aruco_corners, mpp)
    if card is None:
        return None
    if rgb_to_lab is None:
        from skin_color import rgb_to_lab
    found = sorted(card["skin_row"], key=lambda c: c[0])
    gaps = [found[i + 1][0] - found[i][0] for i in range(len(found) - 1)]
    pitch_x = float(np.min(gaps)) if gaps else 0.0
    if pitch_x <= 0:
        return None
    # 채도가 낮은 칸은 피부색 판정(a*>3)에 안 걸려서 빠질 수 있다. 칸 사이가 정확히 두 칸 간격이면 가운데 빠진 한 칸을
    # 채워 넣는다. 양 끝 칸이 빠진 경우(5칸 중 몇 번째인지 알 수 없다)는 읽지 않는다.
    cols = [int(round((c[0] - found[0][0]) / pitch_x)) for c in found]
    if len(set(cols)) != len(cols) or cols[-1] != 4 or cols[0] != 0:
        return None
    mw, mh = int(np.median([c[2] for c in found])), int(np.median([c[3] for c in found]))
    my = float(np.median([c[1] for c in found]))
    by_col = {k: c for k, c in zip(cols, found)}
    row = []
    for k in range(5):
        if k in by_col:
            row.append(by_col[k])
        else:
            row.append((int(round(found[0][0] + k * pitch_x)), int(round(my)), mw, mh))
    dy = CARD_ROW_PITCH_MM / CARD_PITCH_MM * pitch_x          # 줄 간격(px): 가로 칸 간격 4.5mm 기준으로 환산
    out = {}
    H, W = image.shape[:2]
    for names, ysign in ((CARD_ROW_SKIN, 0.0), (CARD_ROW_GRAY, -1.0)):
        for name, (x, y, w, h) in zip(names, row):
            cx, cy = x + w / 2.0, y + h / 2.0 + ysign * dy
            hx, hy = max(2, int(CARD_SAMPLE_FRAC * w)), max(2, int(CARD_SAMPLE_FRAC * h))
            x0, x1, y0, y1 = int(cx - hx), int(cx + hx), int(cy - hy), int(cy + hy)
            if x0 < 0 or y0 < 0 or x1 > W or y1 > H:
                return None
            rgb = cv2.cvtColor(image[y0:y1, x0:x1], cv2.COLOR_BGR2RGB).astype(np.float32).reshape(-1, 3) / 255.0
            lab = rgb_to_lab(rgb.reshape(1, -1, 3)).reshape(-1, 3)
            med = np.median(lab, axis=0)
            out[name] = {"L": float(med[0]), "a": float(med[1]), "b": float(med[2]),
                         "rgb": [float(v) for v in np.median(rgb, axis=0) * 255.0]}
    return out


# ── 카드 흰색 기준 절대 밝기 ──────────────────────────────────────────────
# 카드의 흰 여백은 손가락과 같은 높이/같은 조명에 있다. 노출이나 조명이 바뀌면 흰색도 같이 변하므로, 피부의 선형 밝기(Y)를
# 흰색의 Y로 나누고 흰 종이의 반사율을 곱하면 노출과 상관없는 "피부 반사율"이 된다. 그것을 다시 L*로 바꾼 것이 절대 밝기다.
# (같은 카드의 회색 단계 4칸을 같은 방식으로 환산하면 설계 반사율과 +-8% 안에서 맞았다: 2026-10-23, 흰색 0.90 가정.)
CARD_WHITE_REFLECTANCE = 0.90    # 일반 복사지 흰색의 반사율 (L* 약 96)


def _lstar_to_y(L: float) -> float:
    return ((L + 16.0) / 116.0) ** 3 if L > 8.0 else L / 903.3


def _y_to_lstar(Y: float) -> float:
    return 116.0 * Y ** (1.0 / 3.0) - 16.0 if Y > 0.008856 else 903.3 * Y


def absolute_L(skin_L: float, white_L: float, white_reflectance: float = CARD_WHITE_REFLECTANCE) -> float:
    """피부 L*을 카드 흰색(L*=white_L)에 맞춘 절대 밝기 L*로 바꾼다. 흰색이 L*=white_L로 찍힌 사진에서 피부가 skin_L이면,
    피부 반사율 = Y(skin)/Y(white) x white_reflectance 이고 L*은 그 반사율의 L*이다."""
    return _y_to_lstar(_lstar_to_y(skin_L) / _lstar_to_y(white_L) * white_reflectance)
