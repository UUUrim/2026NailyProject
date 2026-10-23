"""
컬러 기준 카드(scan/color_card.py) 검출/덮기/읽기와 절대 밝기 환산 확인.

실행:  python scan/tests/test_color_card.py      (scan/ 에서 실행해도 된다)
실제 사진 없이 합성 사진으로 확인한다 (마커 모서리는 가짜 값을 넘긴다).
"""
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import color_card as cc

failures = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f"   {extra}" if extra else ""))
    if not cond:
        failures.append(name)


MPP = 0.088
CORNERS = np.array([[160, 400], [420, 400], [420, 660], [160, 660]], np.float32)   # 마커 (오른쪽 끝 x=420)

# 합성 장면: 밝은 종이 바닥 + 검은 띠 + 카드(흰 여백, 회색 줄, 피부색 5칸 줄) + (선택) 손가락 덩어리
SKIN_ROW = [(204, 152, 123), (187, 136, 108), (222, 168, 138), (197, 154, 131), (212, 149, 114)]   # RGB 설계값
GRAYS = [(255, 255, 255), (198, 198, 198), (158, 158, 158), (119, 119, 119), (82, 82, 82)]


def scene(card_y=60, finger=True, with_card=True):
    img = np.full((960, 1920, 3), (196, 190, 190), np.uint8)             # BGR 종이 바닥
    cv2.rectangle(img, (940, 0), (1215, 959), (35, 36, 38), -1)         # 띠
    if with_card:
        pw, ph, pitch, dy = 42, 52, 46, 58
        x0 = 960
        cv2.rectangle(img, (x0 - 25, card_y - 70), (x0 + 5 * pitch + 20, card_y + ph + 25), (235, 240, 245), -1)   # 카드 흰 여백
        for i in range(5):
            cv2.rectangle(img, (x0 + i * pitch, card_y), (x0 + i * pitch + pw, card_y + ph), SKIN_ROW[i][::-1], -1)
            g = GRAYS[i]
            cv2.rectangle(img, (x0 + i * pitch, card_y - dy), (x0 + i * pitch + pw, card_y - dy + ph), (g[2], g[1], g[0]), -1)
    if finger:
        cv2.ellipse(img, (1075, 700), (80, 260), 0, 0, 360, (125, 160, 215), -1)     # 손가락 (피부색 큰 덩어리)
    return img


img = scene()
c = cc.find_card(img, CORNERS, MPP)
check("카드의 피부색 칸을 4개 이상 한 줄로 찾는다 (채도 낮은 칸은 노란기가 약해 빠질 수 있다)", c is not None and c["patches"] >= 4, str(None if c is None else c["patches"]))
check("카드 영역이 카드 위치를 감싼다(위 회색 줄까지)", c is not None and c["y0"] <= 60 - 58 and c["y1"] >= 60 + 52 and c["x0"] <= 960 and c["x1"] >= 960 + 4 * 46 + 42)

out = cc.suppress_card(img, CORNERS, MPP)
lab = cv2.cvtColor(out, cv2.COLOR_BGR2Lab)
card_area = lab[max(0, c["y0"]):c["y1"], c["x0"]:c["x1"]]
check("덮은 사본에는 카드 자리에 밝은/피부색 픽셀이 남지 않는다", int((card_area[:, :, 0] > 100).sum()) == 0)
check("원본은 바뀌지 않는다", not np.array_equal(img, out) and int((cv2.cvtColor(img, cv2.COLOR_BGR2Lab)[c["y0"]:c["y1"], c["x0"]:c["x1"], 0] > 100).sum()) > 0)
check("손가락 덩어리는 덮이지 않는다", np.array_equal(img[300:960, 1000:1150], out[300:960, 1000:1150]))

noc = scene(with_card=False)
check("카드가 없으면 못 찾고 같은 사진을 돌려준다", cc.find_card(noc, CORNERS, MPP) is None and cc.suppress_card(noc, CORNERS, MPP) is noc)
check("손가락만 있어도 카드로 오인하지 않는다", cc.find_card(scene(with_card=False, finger=True), CORNERS, MPP) is None)
check("마커 정보가 없으면 그대로", cc.suppress_card(img, None, MPP) is img and cc.suppress_card(img, CORNERS, None) is img)

# 읽기: 설계 RGB가 그대로 읽히는지 (Lab 변환은 skin_color.rgb_to_lab)
r = cc.read_card(img, CORNERS, MPP)
check("카드 10칸을 읽는다", r is not None and set(r) == set(cc.CARD_ROW_GRAY + cc.CARD_ROW_SKIN), None if r is None else str(len(r)))
if r:
    check("흰색 칸이 가장 밝고 회색 단계가 어두워진다", r["white"]["L"] > r["gray80"]["L"] > r["gray65"]["L"] > r["gray50"]["L"] > r["gray35"]["L"])
    check("회색 칸은 무채색", all(abs(r[k]["a"]) < 2 and abs(r[k]["b"]) < 2 for k in ("gray80", "gray65", "gray50", "gray35")))
    check("피부색 칸 순서: 밝게 > 중심 > 어둡게", r["skin_light"]["L"] > r["skin_mid"]["L"] > r["skin_dark"]["L"])

# 한 칸이 빠져도(채도 낮은 칸은 피부색 판정에 안 걸릴 수 있다) 가운데면 채워서 읽는다
img2 = scene()
cv2.rectangle(img2, (960 + 3 * 46, 60), (960 + 3 * 46 + 42, 60 + 52), (210, 215, 225), -1)   # 4번째 칸을 흰색에 가깝게 지움
c2 = cc.find_card(img2, CORNERS, MPP)
r2 = cc.read_card(img2, CORNERS, MPP)
check("피부색 칸 4개만 보여도 카드로 찾는다", c2 is not None and c2["patches"] == 4)
check("가운데 한 칸이 빠져도 10칸 이름이 맞게 읽힌다", r2 is not None and "skin_lowC" in r2 and "skin_highC" in r2)

# 절대 밝기: 노출이 바뀌어도(카드 흰색이 같이 변해도) 같은 피부는 같은 값
a1 = cc.absolute_L(63.87, 84.0)
check("절대 밝기: 실제 스캔(피부 63.87, 카드 흰색 84.0) 약 73.5", abs(a1 - 73.45) < 0.1, f"{a1:.2f}")
# 노출을 한 단계 낮추면 선형 밝기가 절반 -> 피부/흰색 비율은 그대로
def scale_L(L, k):
    return cc._y_to_lstar(cc._lstar_to_y(L) * k)
check("절대 밝기: 노출이 달라져도(피부와 흰색이 같은 비율로 변해도) 같다",
      abs(cc.absolute_L(scale_L(63.87, 0.5), scale_L(84.0, 0.5)) - a1) < 1e-6 and abs(cc.absolute_L(scale_L(63.87, 1.3), scale_L(84.0, 1.3)) - a1) < 1e-6)
check("절대 밝기: 피부가 밝을수록 커진다", cc.absolute_L(70.0, 84.0) > cc.absolute_L(60.0, 84.0))
check("절대 밝기: 카드 흰색이 어두워 보이는 사진일수록 같은 피부값이 더 밝게 환산됨", cc.absolute_L(63.87, 78.0) > cc.absolute_L(63.87, 90.0))

print("\nALL PASS" if not failures else f"\nFAILED {len(failures)}: {failures}")
sys.exit(1 if failures else 0)
