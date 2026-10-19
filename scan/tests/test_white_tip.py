"""
손톱 흰 끝(free edge) 띠 검출(nail_measurer.detect_white_tip)의 동작 확인.

실행:  python scan/tests/test_white_tip.py      (scan/ 에서 실행해도 된다)

도경이(results/1/135, 136) 사진에서 본 모양을 합성한 이미지로 확인한다:
  매트(어두운 회색) → 분홍 지문 살 → 흰 띠 → 분홍 손톱 바닥
손톱이 지문 끝까지 닿아 있어 흰 띠가 없는 손(분홍 → 분홍)에서는 아무것도 잡히면 안 된다.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import cv2
import numpy as np

import nail_measurer as nm

failures = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f"   {extra}" if extra else ""))
    if not cond:
        failures.append(name)


MPP = 0.11                       # mm/px (도경이 사진과 비슷한 배율)
H, W = 500, 400
FY = 150                         # 손가락 윗선(지문 끝)
CX = 200
PINK = (172, 185, 235)           # BGR: 분홍 살 (L≈215, a≈+14, b≈+13)
WHITE = (240, 248, 250)          # BGR: 하얀 끝 (채도 낮음)
MAT = (62, 62, 60)               # BGR: 어두운 매트


def make_finger(band_top=None, band_mm=1.4):
    """윗선 FY에서 시작하는 손가락. band_top 행부터 band_mm 두께의 흰 띠를 칠한다."""
    img = np.full((H, W, 3), MAT, np.uint8)
    cv2.rectangle(img, (CX - 90, FY), (CX + 90, H), PINK, -1)
    cv2.ellipse(img, (CX, FY + 60), (90, 60), 0, 180, 360, PINK, -1)
    if band_top is not None:
        band_h = int(band_mm / MPP)
        cv2.rectangle(img, (CX - 70, band_top), (CX + 70, band_top + band_h), WHITE, -1)
    return cv2.GaussianBlur(img, (3, 3), 0)


bbox = (CX - 90, FY, 180, H - FY)

# ── 1) 지문 안쪽 흰 띠: 띠가 시작하는 줄을 잡는다 ────────────────────────────
band_top = FY + 18
r = nm.detect_white_tip(make_finger(band_top), bbox, MPP, CX)
check("흰 띠가 잡힌다", r["tip_y"] is not None)
check("띠 시작 줄을 잡는다(±3px)", r["tip_y"] is not None and abs(r["tip_y"] - band_top) <= 3,
      f"tip_y={r['tip_y']} expected={band_top}")

# ── 2) 흰 띠가 없는 손톱(분홍 → 분홍): 아무것도 잡지 않는다 ─────────────────────
check("흰 띠 없음 → None", nm.detect_white_tip(make_finger(None), bbox, MPP, CX)["tip_y"] is None)

# ── 3) 너무 얇은 흰 선(반사/주름)은 무시 ────────────────────────────────────────
check("0.2mm 흰 선은 무시",
      nm.detect_white_tip(make_finger(FY + 18, band_mm=0.2), bbox, MPP, CX)["tip_y"] is None)

# ── 4) 윗선보다 너무 아래(손톱 한가운데 반사)에 있는 흰 영역은 무시 ──────────────
check("윗선에서 6mm 아래의 흰 영역은 무시",
      nm.detect_white_tip(make_finger(FY + int(6 / MPP)), bbox, MPP, CX)["tip_y"] is None)

# ── 5) 윗선 밖으로 튀어나온 흰 끝(매트 위)은 detect_free_edge 몫 - 여기선 None ────
img = make_finger(None)
cv2.rectangle(img, (CX - 60, FY - 10), (CX + 60, FY + 14), WHITE, -1)
check("매트 위로 튀어나온 흰 끝은 건드리지 않음",
      nm.detect_white_tip(img, bbox, MPP, CX)["tip_y"] is None)

print()
if failures:
    print(f"{len(failures)}개 실패: {failures}")
    sys.exit(1)
print("모두 통과")
