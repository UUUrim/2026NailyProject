"""
양옆 배경이 서로 다른 박스(한쪽 흰 종이 + 가운데 검은 가이드)에서의 측정 보조 로직 확인.

실행:  python scan/tests/test_mixed_background.py      (scan/ 에서 실행해도 된다)

  1) detect_free_edge : 양옆 배경이 섞여도(흰 종이/검은 가이드) 매트 위로 튀어나온 흰 끝을 잡는다.
  2) grow_shadowed_skin : 한쪽 옆면이 그늘진 손가락 마스크를 되살린다. 어두운 가이드는 먹지 않는다.
  3) measure_top 재시도 게이트 : 마스크가 거의 안 잘렸으면(그늘 약함) 키우지 않는다.
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


MPP = 0.09
H, W = 600, 500
PAPER = (205, 208, 205)         # 가이드 바깥 흰 종이
BLACK = (40, 40, 40)            # 검은 가이드
PINK = (172, 185, 235)          # 밝은 쪽 살
SHADE = (62, 78, 140)           # 그늘진 살 (L≈100, a*≈+20)
WHITE = (240, 248, 250)         # 손톱 흰 끝


def scene(shaded_flank=False):
    img = np.full((H, W, 3), PAPER, np.uint8)
    cv2.rectangle(img, (110, 0), (390, H), BLACK, -1)               # 가이드
    cv2.rectangle(img, (160, 250), (240, H), PINK, -1)              # 손가락 밝은 쪽
    if shaded_flank:
        cv2.rectangle(img, (240, 250), (285, H), SHADE, -1)         # 그늘진 옆면
    cv2.rectangle(img, (170, 226), (232, 250), WHITE, -1)           # 윗선(250) 밖으로 튀어나온 흰 끝
    return cv2.GaussianBlur(img, (3, 3), 0)


def mask_of(img):
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2Lab)
    m = ((lab[:, :, 0] > 120) & (lab[:, :, 1] > 131)).astype(np.uint8) * 255
    m[:, :110] = 0
    m[:, 390:] = 0                                                  # 종이 제외
    return m


# ── 1) 섞인 배경에서도 흰 끝이 잡힌다 ──────────────────────────────────────
img = scene()
fm = mask_of(img)
bbox = cv2.boundingRect(fm)
fe = nm.detect_free_edge(img, fm, bbox, MPP)
up = bbox[1] - fe["tip_y"]
check("섞인 배경: 흰 끝을 잡는다(≥15px)", up >= 15, f"extended {up}px (expected ≈24)")
check("섞인 배경: 실제 끝(226)을 넘어가지 않는다", fe["tip_y"] >= 222, f"tip_y={fe['tip_y']}")

# ── 2) 그늘진 옆면 되살리기 ───────────────────────────────────────────────
img = scene(shaded_flank=True)
fm = mask_of(img)
w0 = int((fm[400] > 0).sum())
grown, gb = nm.grow_shadowed_skin(img, fm, MPP)
w1 = int((grown[400] > 0).sum())
check("그늘진 옆면이 마스크에 들어온다", w1 > w0 + 30, f"width {w0} -> {w1}px (shade strip = 45px)")
check("검은 가이드는 먹지 않는다", int(grown[400, 300:380].sum()) == 0)
check("종이 쪽(왼쪽)으로 번지지 않는다", int(grown[400, :150].sum()) == 0)

# ── 3) 그늘이 없으면 마스크를 거의 안 키운다 ──────────────────────────────
img = scene(shaded_flank=False)
fm = mask_of(img)
grown, _ = nm.grow_shadowed_skin(img, fm, MPP)
rows = slice(250, 250 + int(22 / MPP))
ratio = float((grown[rows] > 0).sum()) / float((fm[rows] > 0).sum())
check("그늘 없음: 마스크 증가 < 10% (재시도 안 함)", ratio < 1.10, f"growth x{ratio:.3f}")

print()
if failures:
    print(f"{len(failures)}개 실패: {failures}")
    sys.exit(1)
print("모두 통과")
