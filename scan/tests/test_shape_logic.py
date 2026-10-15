"""
추천 쉐입(nail_measurer.recommend_nail_shape)의 동작 확인.

실행:  python scan/tests/test_shape_logic.py      (scan/ 에서 실행해도 된다)
_SHAPE_BY_WL_Z 기준값을 바꿨을 때 다시 돌려서 방향(넓고 짧을수록 길게 좁히는 쉐입)이 뒤집히지 않는지 본다.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import nail_measurer as nm

failures = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f"   {extra}" if extra else ""))
    if not cond:
        failures.append(name)


def shape_for(z, fingers=5):
    """모든 손가락이 같은 z(= wl_diff / wl_std_dev)를 갖는 손의 추천 쉐입."""
    sd = 0.07
    return nm.recommend_nail_shape([{"wl_diff": z * sd, "wl_std_dev": sd}] * fingers)


# ── 1) 방향: 넓고 짧을수록 길게 좁히는 쪽, 좁고 길수록 좁히지 않는 쪽 ──────────────
check("매우 넓고 짧음 -> 스틸레토", shape_for(2.0) == "stiletto")
check("넓고 짧음 -> 발레리나", shape_for(1.0) == "ballerina")
check("약간 넓고 짧음 -> 아몬드", shape_for(0.5) == "almond")
check("평균 -> 오벌", shape_for(0.0) == "oval")
check("약간 좁고 김 -> 스퀘어", shape_for(-0.5) == "square")
check("좁고 김 -> 라운드", shape_for(-1.0) == "round")
check("매우 좁고 김 -> 라운드", shape_for(-4.5) == "round")

# ── 2) 경계: 기준값 "이상"이 윗 구간 ──────────────────────────────────────────────
for threshold, shape in nm._SHAPE_BY_WL_Z:
    check(f"경계: z={threshold} 은 {shape}", shape_for(threshold) == shape)
    check(f"경계: z={threshold} 바로 아래는 {shape} 아님", shape_for(threshold - 0.01) != shape)

# ── 3) 구간이 위에서 아래로 내림차순이고 쉐입이 겹치지 않는다 ───────────────────────
cuts = [t for t, _ in nm._SHAPE_BY_WL_Z]
check("기준값이 내림차순", cuts == sorted(cuts, reverse=True))
used = [s for _, s in nm._SHAPE_BY_WL_Z] + [nm._SHAPE_NARROWEST]
check("쉐입이 겹치지 않고 모두 유효", len(set(used)) == len(used) and set(used) <= set(nm.NAIL_SHAPES))

# ── 4) 손톱 자체 크기와 무관 / 입력 형태 ──────────────────────────────────────────
check("인자는 wl_checks 하나뿐", nm.recommend_nail_shape.__code__.co_argcount == 1)
check("z 정보가 없으면 기본 라운드", nm.recommend_nail_shape([]) == "round")
check("wl_std_dev가 없는 항목은 건너뜀",
      nm.recommend_nail_shape([{"wl_diff": 0.5, "wl_std_dev": 0}, {"wl_diff": 0.0, "wl_std_dev": 0.07}]) == "oval")

# 손가락마다 z가 달라도 평균으로 판정
mixed = [{"wl_diff": 0.14, "wl_std_dev": 0.07}, {"wl_diff": -0.14, "wl_std_dev": 0.07}]   # +2, -2 -> 평균 0
check("손가락별 z는 평균으로 합친다", nm.recommend_nail_shape(mixed) == "oval")

print()
if failures:
    print(f"{len(failures)}개 실패:", ", ".join(failures))
    sys.exit(1)
print("모두 통과")
