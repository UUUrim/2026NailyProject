"""
새 박스(흰 A4 종이 + 검정 띠 가이드) 실제 사진 회귀 테스트. 사진은 new_box_photos/ 의 두 세트만 쓴다.

실행:  python scan/tests/test_new_box_photos.py      (어느 폴더에서 실행해도 된다)

  세트 A : 기존 조명 5장 (13_07~13_08)     세트 B : LED 1개 추가 5장 (13_19~13_20)

캘리퍼 실측값이 없으므로 "정답 값"이 아니라 이전에 깨졌던 것들이 다시 깨지지 않는지만 본다:
  1) 마커 mm/px 가 사진마다 흔들리지 않는다 (흰 종이 바깥 테두리를 마커로 잡으면 13% 어긋났다)
  2) 손가락 마스크가 옆 손가락을 합치지 않고 검정 띠 안쪽에만 있다
  3) 측정이 성공하고 폭/길이가 사람 손톱으로 말이 되는 범위에 든다
"""
import glob
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

import cv2
import numpy as np

import nail_live as nl
import nail_measurer as nm

PHOTO_DIR = os.path.join(HERE, "..", "..", "new_box_photos")
MPP_RANGE = (0.083, 0.087)       # 마커 검은 정사각형 20mm ≈ 236px
# 엄지 아래 마디는 22.6mm까지 나온다. 옆 손가락이 섞였을 때(수정 전)는 38~57mm 였다.
FINGER_MAX_W_MM = 26.0           # 이보다 넓으면 옆 손가락이 섞인 것

failures = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f"   {extra}" if extra else ""))
    if not cond:
        failures.append(name)


photos = sorted(glob.glob(os.path.join(PHOTO_DIR, "*.jpg")))
check("new_box_photos 에 사진이 있다", len(photos) >= 10, f"{len(photos)}장")

for p in photos:
    tag = os.path.basename(p)[-12:-4]
    img = cv2.imread(p)
    mpp, corners, _ = nm.detect_aruco(img, 20.0)
    check(f"{tag} 마커 mm/px 안정", MPP_RANGE[0] <= mpp <= MPP_RANGE[1], f"{mpp:.4f}")

    strip = nm.find_finger_strip(img, corners, mpp)
    check(f"{tag} 검정 띠를 찾는다", strip is not None, str(strip))
    if strip is None:
        continue

    _, _, bbox = nm.segment_finger(img, corners, mpp)
    bx, _, bw, _ = bbox
    check(f"{tag} 마스크가 띠 안쪽에 있다", bx >= strip[0] - 2 and bx + bw <= strip[1] + 2,
          f"x={bx}..{bx + bw} strip={strip}")
    check(f"{tag} 손가락 하나 폭", bw * mpp <= FINGER_MAX_W_MM, f"{bw * mpp:.1f}mm")

    r = nl.measure_frame(img, "index", 20.0, draw_guide=False)
    check(f"{tag} 측정 성공", r.get("ok"), r.get("err", ""))
    if r.get("ok"):
        w, ln = r["data"]["width_mm"], r["data"]["length_mm"]
        check(f"{tag} 폭/길이가 손톱 범위", 6.0 <= w <= 15.0 and 8.0 <= ln <= 22.0,
              f"W={w} L={ln}")

# 어두운 매트 전체가 검정인 옛 환경: 띠 경계가 없으니 None 이어야 예전 방식으로 동작한다
dark = np.full((600, 800, 3), 30, np.uint8)
fake = np.array([[100, 100], [200, 100], [200, 200], [100, 200]], np.float32)
check("바닥 전체가 어두우면 띠 없음(None)", nm.find_finger_strip(dark, fake, 0.09) is None)

print()
print("ALL PASS" if not failures else f"{len(failures)} FAILED")
sys.exit(1 if failures else 0)
