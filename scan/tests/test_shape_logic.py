"""
추천 쉐입(nail_measurer.recommend_nail_shape)의 동작 확인.

실행:  python scan/tests/test_shape_logic.py      (scan/ 에서 실행해도 된다)
쉐입은 이 사람 손톱의 너비/길이(열 손가락 평균)만 보고 정한다 - 평균이나 논문 기준과 비교하지 않는다.
_SHAPE_BY_WIDTH_OVER_LENGTH 기준값을 바꿨을 때 다시 돌려서 방향(통통하고 짧을수록 길게 좁히는 쉐입)이
뒤집히지 않는지 본다.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import nail_measurer as nm

failures = []
EPS = 1e-6   # 경계 판정이 부동소수점 오차에 흔들리지 않게 경계 위/아래로 살짝만 벗어나서 본다


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f"   {extra}" if extra else ""))
    if not cond:
        failures.append(name)


def shape_for(ratio, fingers=10):
    """모든 손가락의 너비/길이가 ratio인 손의 추천 쉐입."""
    return nm.recommend_nail_shape([{"measured_wl": ratio}] * fingers)


# ── 1) 방향: 통통하고 짧을수록 길게 좁히는 쪽, 가늘고 길수록 좁히지 않는 쪽 ─────────────
check("매우 통통함(1.05) -> 스틸레토", shape_for(1.05) == "stiletto")
check("통통함(0.85) -> 발레리나", shape_for(0.85) == "ballerina")
check("약간 통통함(0.75) -> 아몬드", shape_for(0.75) == "almond")
check("중간(0.70) -> 오벌", shape_for(0.70) == "oval")
check("약간 가늘고 김(0.63) -> 스퀘어", shape_for(0.63) == "square")
check("가늘고 김(0.55) -> 라운드", shape_for(0.55) == "round")
check("예시 손(10.5 / 14.6mm = 0.719, 아몬드 경계 0.72 바로 아래) -> 오벌", shape_for(10.5 / 14.6) == "oval")

# ── 2) 경계: 기준값 "이상"이 윗 구간 ──────────────────────────────────────────────
for threshold, shape in nm._SHAPE_BY_WIDTH_OVER_LENGTH:
    check(f"경계: 너비/길이={threshold} 은 {shape}", shape_for(threshold) == shape)
    check(f"경계: 너비/길이={threshold} 바로 아래는 {shape} 아님", shape_for(threshold - EPS) != shape)

# ── 3) 구간이 위에서 아래로 내림차순이고 쉐입이 겹치지 않는다 ───────────────────────
cuts = [t for t, _ in nm._SHAPE_BY_WIDTH_OVER_LENGTH]
check("기준값이 내림차순", cuts == sorted(cuts, reverse=True))
used = [s for _, s in nm._SHAPE_BY_WIDTH_OVER_LENGTH] + [nm._SHAPE_NARROWEST]
check("쉐입이 겹치지 않고 모두 유효", len(set(used)) == len(used) and set(used) <= set(nm.NAIL_SHAPES))

# ── 4) 입력 형태 ─────────────────────────────────────────────────────────────────
check("인자는 wl_checks 하나뿐", nm.recommend_nail_shape.__code__.co_argcount == 1)
check("측정값이 없으면 기본 라운드", nm.recommend_nail_shape([]) == "round")
check("measured_wl이 없는 항목은 건너뜀",
      nm.recommend_nail_shape([{"wl_diff": 0.5}, {"measured_wl": None}, {"measured_wl": 0.70}]) == "oval")
check("기준 비율(wl_diff 등)은 쓰지 않는다 - measured_wl만 본다",
      nm.recommend_nail_shape([{"measured_wl": 0.70, "wl_diff": -0.5, "wl_std_dev": 0.07}] * 5) == "oval")

# 손가락마다 값이 달라도 평균으로 판정
mixed = [{"measured_wl": 0.60}, {"measured_wl": 0.80}]   # 평균 0.70
check("손가락별 값은 평균으로 합친다", nm.recommend_nail_shape(mixed) == "oval")

print()
if failures:
    print(f"{len(failures)}개 실패:", ", ".join(failures))
    sys.exit(1)
print("모두 통과")
