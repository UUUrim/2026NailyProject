"""
톤 판정(skin_color.tone_from_score, 노란기 점수 b - 0.5a)과 네일 컬러 선택(nail_palette)의 동작 확인.

실행:  python scan/tests/test_color_logic.py      (scan/ 에서 실행해도 된다)
기준값(TONE_SCORE_COOL_MAX / TONE_SCORE_WARM_MIN)을 바꿨을 때 다시 돌려서 구성이 무너지지 않는지 본다.
"""
import collections
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import nail_palette as npal
import nail_palette as sc_pal
import skin_color as sc

failures = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f"   {extra}" if extra else ""))
    if not cond:
        failures.append(name)


HEX = re.compile(r"^#[0-9A-F]{6}$")

# ── 1) 톤 경계 (노란기 점수 b - 0.5a) ─────────────────────────────────────
cool, warm = sc.TONE_SCORE_COOL_MAX, sc.TONE_SCORE_WARM_MIN
check("경계: 쿨 기준 바로 아래는 쿨", sc.tone_from_score(cool - 0.01) == "cool")
check("경계: 쿨 기준 값은 뉴트럴", sc.tone_from_score(cool) == "neutral")
check("경계: 웜 기준 값은 뉴트럴", sc.tone_from_score(warm) == "neutral")
check("경계: 웜 기준 바로 위는 웜", sc.tone_from_score(warm + 0.01) == "warm")
check("기준값 순서가 올바름(쿨 < 웜)", cool < warm)
check("노란기 점수 계산 b - 0.5a", abs(sc.warm_score(20.0, 25.0) - 15.0) < 1e-9)

# 프론트 슬라이더용 환산: 쿨 경계 -> 55, 웜 경계 -> 63, 단조 증가, 라벨과 같은 쪽에 놓인다
check("환산: 쿨 경계 점수 -> 55도", abs(sc.warmness_from_score(cool) - 55.0) < 1e-9)
check("환산: 웜 경계 점수 -> 63도", abs(sc.warmness_from_score(warm) - 63.0) < 1e-9)
scores = [10 + 0.25 * i for i in range(0, 41)]
check("환산: 점수가 커지면 warmness도 커짐(단조)", all(sc.warmness_from_score(x) < sc.warmness_from_score(y) for x, y in zip(scores, scores[1:])))
check("환산: 라벨과 슬라이더 구간이 일치", all(
    (sc.tone_from_score(x) == "cool") == (sc.warmness_from_score(x) < 55.0)
    and (sc.tone_from_score(x) == "warm") == (sc.warmness_from_score(x) > 63.0) for x in scores))
check("환산: 경계 바깥 점수 1 차이는 슬라이더 3도(양끝으로 날려 보내지 않음)",
      abs(sc.warmness_from_score(cool - 1.0) - 52.0) < 1e-9 and abs(sc.warmness_from_score(warm + 1.0) - 66.0) < 1e-9)

# 색상각 계산(참고용): a>0,b>0 사분면, a=b는 45도
check("색상각 45도", abs(sc.skin_hue(10, 10) - 45) < 1e-6)
check("색상각 0~360 범위(음수 a)", 0 <= sc.skin_hue(-5, 3) < 360 and 0 <= sc.skin_hue(0, 0) < 360)

# ── 2) 모든 조합에서 팔레트가 정상 ───────────────────────────────────────
combos = []
for score_target, L in [(9.0, 45), (11.0, 55), (13.0, 60), (14.9, 62), (15.27, 75), (15.65, 62), (17.5, 85), (20.0, 70), (24.0, 50)]:
    a = 20.0
    b = score_target + 0.5 * a                      # b - 0.5a = score_target
    combos.append((score_target, L, a, b))

for score_target, L, a, b in combos:
    r = sc.recommend_nail_colors(L, a, b)
    best, worst, summ = r["best"], r["worst"], r["skin_summary"]
    hexes = [e["hex"] for e in best]
    tag = f"점수={score_target} L={L} -> {summ['tone']}"
    check(f"[{tag}] 30개, hex 형식 정상, 중복 없음", len(best) == 30 and all(HEX.match(h) for h in hexes) and len(set(hexes)) == 30)
    check(f"[{tag}] worst 10개", len(worst) == 10 and all(HEX.match(e["hex"]) for e in worst))
    bands = collections.Counter(e["band"] for e in best)
    tones = collections.Counter(e["tone"] for e in best)
    dark_share = sum(1 for e in best if e["L"] < 40) / len(best)
    check(f"[{tag}] 밝은 색 8개 이상", bands["light"] >= 8, str(dict(bands)))
    check(f"[{tag}] 어두운 색(L<40)이 40% 이하", dark_share <= 0.40, f"{dark_share:.0%}")
    if score_target >= 19.0:
        check(f"[{tag}] 뚜렷한 웜 피부에 쿨 색은 없음", tones["cool"] == 0, str(dict(tones)))
    if score_target <= 11.5:
        check(f"[{tag}] 뚜렷한 쿨 피부에 웜 색은 없음", tones["warm"] == 0, str(dict(tones)))
    if score_target >= 17.0:
        check(f"[{tag}] 웜 피부는 웜 색이 쿨 색보다 많음", tones["warm"] > tones["cool"], str(dict(tones)))
    if score_target <= 13.5:
        check(f"[{tag}] 쿨 피부는 쿨 색이 웜 색보다 많음", tones["cool"] > tones["warm"], str(dict(tones)))
    check(f"[{tag}] summary에 점수/warmness/색상각, 라벨과 warmness가 같은 구간",
          abs(summ["warm_score"] - score_target) < 0.01 and 0 <= summ["skin_hue"] < 360
          and (summ["tone"] == "cool") == (summ["warmness"] < 55.0) and (summ["tone"] == "warm") == (summ["warmness"] > 63.0))

# ── 3) 톤에 따라 팔레트가 실제로 달라진다 ─────────────────────────────────
pw = {e["hex"] for e in sc.recommend_nail_colors(62, 10, 25)["best"]}      # 웜(점수 20)
pc = {e["hex"] for e in sc.recommend_nail_colors(62, 20, 20)["best"]}      # 쿨(점수 10)
jacc = len(pw & pc) / len(pw | pc)
check("웜/쿨 팔레트가 충분히 다름(겹침 40% 미만)", jacc < 0.40, f"겹침 {jacc:.0%}")

# ── 4) 같은 입력이면 같은 결과 ────────────────────────────────────────────
check("결정적(같은 입력은 같은 결과)",
      [e["hex"] for e in sc.recommend_nail_colors(60, 15, 22)["best"]] == [e["hex"] for e in sc.recommend_nail_colors(60, 15, 22)["best"]])

# ── 5) 예전 인자(warmness, saturation)를 넘겨도 동작 ──────────────────────
check("예전 호출 방식(5개 인자)도 동작", len(sc.recommend_nail_colors(62, 10, 17, 19.3, 0.5)["best"]) == 30)

# ── 6) 카탈로그 자체 점검 ─────────────────────────────────────────────────
cat = npal.CATALOG
check("카탈로그 hex 형식/중복 없음", all(HEX.match(e["hex"]) for e in cat) and len({e["hex"] for e in cat}) == len(cat))
check("카탈로그 이름 중복 없음", len({e["name"] for e in cat}) == len(cat))
check("톤 값이 warm/cool/neutral 중 하나", all(e["tone"] in ("warm", "cool", "neutral") for e in cat))
for t in ("warm", "cool"):
    usable = [e for e in cat if e["tone"] in (t, "neutral")]
    per_band = collections.Counter(e["band"] for e in usable)
    check(f"{t} 피부용 후보가 구간마다 충분(밝은 10/중간 12/딥 10 이상)",
          per_band["light"] >= 10 and per_band["mid"] >= 12 and per_band["deep"] >= 10, str(dict(per_band)))

# ── 7) 실제 측정 샘플 (새 세팅: 흰 종이 기준 색 보정 + 노출 -8 고정, 10손가락 평균) ─────────────────────
# 정답(퍼스널 컬러)을 아는 3명을 정식 스캔한 값. (표시 밝기 L, 측정 a, 측정 b) - recommend_nail_colors에 넘기는 값이다.
# (표시 밝기 = 측정 L + 11: skin_color.display_skin_lab)
REAL = {
    "1번(겨울쿨)":       (77.9, 19.9, 24.0),    # 측정 L 66.9, 점수 14.05, 색상각 50.3도
    "2번(겨울쿨)":       (81.0, 16.4, 23.1),    # 측정 L 70.0, 점수 14.90, 색상각 54.7도 (가장 밝고 채도 낮음)
    "3번(봄 브라이트)":  (76.6, 19.1, 25.2),    # 측정 L 65.6, 점수 15.65, 색상각 52.9도
}
EXPECT_TONE = {"1번(겨울쿨)": "cool", "2번(겨울쿨)": "cool", "3번(봄 브라이트)": "warm"}
real = {k: sc.recommend_nail_colors(*v) for k, v in REAL.items()}
for k, r in real.items():
    print(f"실측 {k}: 점수 {r['skin_summary']['warm_score']} (색상각 {r['skin_summary']['skin_hue']}도) -> {r['skin_summary']['tone']} / 슬라이더용 warmness {r['skin_summary']['warmness']} | 앞6: " + ", ".join(e["name"] for e in r["best"][:6]))
for k, r in real.items():
    check(f"[{k}] 정답에 맞는 톤 판정({EXPECT_TONE[k]})", r["skin_summary"]["tone"] == EXPECT_TONE[k], f"점수 {r['skin_summary']['warm_score']}")
check("[회귀] 색상각으로는 3번이 가장 웜이 아니어도 노란기 점수로는 3번이 가장 높음",
      real["3번(봄 브라이트)"]["skin_summary"]["warm_score"] > max(real["1번(겨울쿨)"]["skin_summary"]["warm_score"], real["2번(겨울쿨)"]["skin_summary"]["warm_score"]))

# [회귀] 예전에는 기준값이 새 세팅의 실제 값 범위 밖이라 모두 같은 값으로 붙어서
# 채도가 다른 두 사람의 추천 30색이 순서까지 똑같이 나왔다. 포화되지 않고 값마다 다른 입력으로 처리돼야 한다.
pa = sc_pal.skin_profile("neutral", REAL["2번(겨울쿨)"][0], REAL["2번(겨울쿨)"][1], REAL["2번(겨울쿨)"][2])
pb = sc_pal.skin_profile("neutral", REAL["1번(겨울쿨)"][0], REAL["1번(겨울쿨)"][1], REAL["1번(겨울쿨)"][2])
check("채도가 다른 두 사람의 채도 입력이 포화되지 않고 서로 다름", abs(pa["chroma_z"] - pb["chroma_z"]) > 0.5 and abs(pa["chroma_z"]) < 1.5 and abs(pb["chroma_z"]) < 1.5,
      f"chroma_z {pa['chroma_z']:+.2f} vs {pb['chroma_z']:+.2f}")
check("[회귀] 웜 정도 입력도 포화되지 않고 세 사람이 서로 다름",
      len({round(sc_pal.skin_profile("neutral", *REAL[k])["warmth"], 2) for k in REAL}) == 3
      and all(abs(sc_pal.skin_profile("neutral", *REAL[k])["warmth"]) < 1.0 for k in REAL))
check("채도가 다른 두 사람(1번, 2번)의 추천 30색이 순서까지 똑같지 않음",
      [e["hex"] for e in real["2번(겨울쿨)"]["best"]] != [e["hex"] for e in real["1번(겨울쿨)"]["best"]])
# 서로 다른 사람은 추천 30색이 충분히 달라야 한다 (노란기 점수 차이가 0.5 이상이거나 채도 차이가 2 이상이거나 밝기 차이가 3 이상인 쌍)
names = list(real)
import math as _m
for i in range(len(names)):
    for j in range(i + 1, len(names)):
        (La, aa, ba), (Lb, ab, bb) = REAL[names[i]], REAL[names[j]]
        ds = abs(sc.warm_score(aa, ba) - sc.warm_score(ab, bb)); dc = abs(_m.hypot(aa, ba) - _m.hypot(ab, bb)); dl = abs(La - Lb)
        if ds < 0.5 and dc < 2.0 and dl < 3.0:
            continue          # 값이 거의 같은 두 사람은 추천이 비슷해도 된다
        A = {e["hex"] for e in real[names[i]]["best"]}
        B = {e["hex"] for e in real[names[j]]["best"]}
        jac = len(A & B) / len(A | B)
        check(f"[{names[i]} vs {names[j]}] 값이 다르면 추천 30색도 다름(겹침 80% 미만)", jac < 0.80, f"점수차 {ds:.2f} 채도차 {dc:.1f} 밝기차 {dl:.1f} 겹침 {jac:.0%}")

# 피부값이 아주 조금(점수 0.05, 밝기 0.5) 달라지면 추천도 크게 튀지 않는다 (몇 군데 값에서 평균: 점수 변화 하나가 색 묶음 경계를
# 넘는 지점에서는 한 번에 많이 바뀌기도 한다)
_tiny = []
for _i in range(10):
    _base = sc.recommend_nail_colors(74.0 + _i * 0.7, 16.0, 23.0 + 0.2 * _i)["best"]
    _near = sc.recommend_nail_colors(74.5 + _i * 0.7, 16.0, 23.05 + 0.2 * _i)["best"]
    _A = {e["hex"] for e in _base}; _B = {e["hex"] for e in _near}
    _tiny.append(len(_A & _B) / len(_A | _B))
check("피부값이 거의 같으면 추천도 거의 같음(10군데 평균 겹침 80% 이상)", sum(_tiny) / len(_tiny) >= 0.80, f"평균 겹침 {sum(_tiny) / len(_tiny):.0%} (최소 {min(_tiny):.0%})")

# [안정성] 같은 사람을 다시 스캔했을 때 흔들리는 정도(점수 SD 0.3, 채도 SD 1.0, 밝기 SD 1.5)에서 추천 30색의 평균 겹침.
# 반응 폭이 좁으면 사람은 잘 구분되지만 같은 사람의 재스캔에서도 많이 바뀐다. 지금은 약 68% (Jaccard, 겹치는 색 비율로는 약 80%).
import random as _random
_rng = _random.Random(0)
def _ov(x, y):
    X, Y = set(x), set(y); return len(X & Y) / len(X | Y)
_overlaps = []
for _name, (_L, _a, _b) in REAL.items():
    _c = [e["hex"] for e in sc.recommend_nail_colors(_L, _a, _b)["best"]]
    for _ in range(12):
        _C = (_a ** 2 + _b ** 2) ** 0.5 + _rng.gauss(0, 1.0); _h = _m.atan2(_b, _a)
        _r = sc.recommend_nail_colors(_L + _rng.gauss(0, 1.5), _C * _m.cos(_h), _C * _m.sin(_h) + _rng.gauss(0, 0.3))["best"]
        _overlaps.append(_ov(_c, [e["hex"] for e in _r]))
_mean_ov = sum(_overlaps) / len(_overlaps)
check("[안정성] 같은 사람을 다시 스캔해도 추천 30색이 평균 55% 이상 겹침", _mean_ov >= 0.55, f"평균 겹침 {_mean_ov:.0%}")
# 그리고 서로 다른 사람(정답이 다른 1번 쿨 vs 3번 웜)은 재스캔 겹침보다 훨씬 덜 겹친다 (사람 차이가 재스캔 흔들림보다 크다)
_pp = _ov([e["hex"] for e in real["1번(겨울쿨)"]["best"]], [e["hex"] for e in real["3번(봄 브라이트)"]["best"]])
check("[안정성] 서로 다른 사람(1번 쿨, 3번 웜)의 겹침이 같은 사람 재스캔 겹침보다 낮음", _pp < _mean_ov - 0.15, f"사람끼리 {_pp:.0%} / 재스캔 {_mean_ov:.0%}")

# 앞쪽 6개가 파스텔/회색 한쪽으로 쏠리지 않고, 비슷한 색이 줄줄이 나오지 않는다
for k, r in real.items():
    first = r["best"][:6]
    check(f"[{k}] 앞 6색에 밝은 색/중간 색/딥 컬러가 섞임", len({e["band"] for e in first}) >= 2 and sum(1 for e in first if e["C"] < 14) <= 2)
    labs = [(e["L"], e["H"]) for e in first]
    check(f"[{k}] 앞 6색 hex 중복 없음", len({e["hex"] for e in first}) == 6)

# ── 8) 최종 JSON: 명도/채도 슬라이더 눈금, 칩은 화면 보정, 측정값은 그대로 ─────────────────────────────
# 실제 스캔(174_175, 3번 재스캔)의 손가락 10개 값. 예전에는 칩용 보정(+11)이 명도 숫자에도 섞여서 0.764("밝은 편" 76%)로 나왔다.
import final_measurements as fm
_FINGERS = [(63.3, 18.28, 28.25), (64.36, 18.46, 24.87), (64.91, 18.5, 24.79), (66.43, 17.72, 23.58), (67.67, 17.99, 23.03),
            (65.74, 18.13, 25.36), (66.52, 18.3, 25.03), (66.29, 18.04, 25.4), (63.91, 20.04, 23.5), (64.75, 17.8, 22.49)]
_nails = [{"skin_L": L, "skin_a": a, "skin_b": b, "skin_saturation": 0.77, "skin_wb": {"applied": True}} for L, a, b in _FINGERS]
_skin, _cols = fm._skin_and_colors(_nails)
_mL = sum(f[0] for f in _FINGERS) / len(_FINGERS); _ma = sum(f[1] for f in _FINGERS) / len(_FINGERS); _mb = sum(f[2] for f in _FINGERS) / len(_FINGERS)
check("[최종 JSON] 손가락 10개가 모두 평균에 들어감", _skin["fingerCount"] == 10, str(_skin["fingerCount"]))
check("[최종 JSON] 명도는 눈금 환산값(칩 보정 +11이 섞이지 않음)",
      abs(_skin["brightness"] - sc.brightness_ui(_mL)) < 0.0006 and _skin["brightness"] < 0.65, f"brightness {_skin['brightness']} / 측정 L {_mL:.2f}")
check("[최종 JSON] 채도는 눈금 환산값", abs(_skin["saturation"] - sc.saturation_ui(_ma, _mb)) < 0.0006, f"saturation {_skin['saturation']}")
check("[최종 JSON] 피부색 칩은 화면 보정을 거침", _skin["skinToneHex"] == sc.lab_to_rgb_hex(*sc.display_skin_lab(_mL, _ma, _mb))
      and _skin["skinToneHex"] != sc.lab_to_rgb_hex(_mL, _ma, _mb), _skin["skinToneHex"])
check("[최종 JSON] 측정 L/a/b가 그대로 남음", abs(_skin["L"] - _mL) < 0.01 and abs(_skin["a"] - _ma) < 0.01 and abs(_skin["b"] - _mb) < 0.01)
check("[최종 JSON] 베이스톤 이름 필드(tone과 일치)", (_skin["baseTone"], _skin["baseToneLabel"]) == sc.base_tone(_skin["tone"]), f"{_skin['baseToneLabel']}")

# ── 9) 사람 6명의 슬라이더 위치/라벨 ───────────────────────────────────────────────────────────
# 실제 스캔(10손가락 평균, 서버 기록의 L/a/b). 1번은 하루 반 사이 5회, 3번은 2회 스캔했고 사람마다 평균을 쓴다.
# 같은 사람도 스캔마다 L SD 1.5, M SD 1.7 흔들려서 한 사람의 스캔 라벨이 한 칸씩 바뀔 수 있다 (눈금을 예민하게 잡은 대가).
# 프론트 라벨 기준: 명도 0.55 미만 어두운 편 / 0.65 초과 밝은 편, 채도 0.30 미만 적은 편 / 0.50 초과 있는 편.
PEOPLE = {   # 사람별 스캔의 (측정 L, 측정 a, 측정 b)
    "1번": [(66.92, 19.98, 24.0), (63.79, 18.49, 23.77), (63.9, 18.28, 23.83), (66.89, 15.26, 21.37), (63.87, 16.05, 24.37)],
    "2번": [(69.96, 16.37, 23.08)],
    "3번": [(65.75, 19.07, 25.58), (65.39, 18.33, 24.63)],
    "A": [(66.53, 20.21, 23.7)], "B": [(67.98, 15.91, 21.64)], "C": [(64.45, 17.88, 22.16)],
}
def _mean(xs): return sum(xs) / len(xs)
bu = {k: _mean([sc.brightness_ui(L) for L, a, b in v]) for k, v in PEOPLE.items()}
su = {k: _mean([sc.saturation_ui(a, b) for L, a, b in v]) for k, v in PEOPLE.items()}
def _bl(u): return "저" if u < 0.55 else ("고" if u > 0.65 else "중")
def _sl(u): return "저" if u < 0.30 else ("고" if u > 0.50 else "중")
print("사람별 명도", {k: f"{v:.2f}{_bl(v)}" for k, v in bu.items()}, "채도", {k: f"{v:.2f}{_sl(v)}" for k, v in su.items()})
check("사람 6명의 명도 슬라이더가 0.2 이상 벌어진다", max(bu.values()) - min(bu.values()) >= 0.2, f"{max(bu.values()) - min(bu.values()):.2f}")
check("사람 6명의 채도 슬라이더가 0.4 이상 벌어진다", max(su.values()) - min(su.values()) >= 0.4, f"{max(su.values()) - min(su.values()):.2f}")
check("명도 저/중/고가 모두 쓰인다", {_bl(v) for v in bu.values()} == {"저", "중", "고"})
check("채도 저/중/고가 모두 쓰인다", {_sl(v) for v in su.values()} == {"저", "중", "고"})
check("가장 밝은 사람은 2번, 가장 어두운 사람은 C", max(bu, key=bu.get) == "2번" and min(bu, key=bu.get) == "C")
check("명도 순서는 측정 L 순서 그대로", sorted(bu, key=bu.get) == sorted(PEOPLE, key=lambda k: _mean([x[0] for x in PEOPLE[k]])))
check("눈금 환산이 단조 증가하고 0~1 안에 있음",
      all(0.0 <= sc.brightness_ui(x) <= 1.0 and sc.brightness_ui(x) <= sc.brightness_ui(x + 0.5) for x in [40 + 0.5 * i for i in range(80)])
      and all(0.0 <= sc.saturation_ui(x, 24.0) <= 1.0 and sc.saturation_ui(x, 24.0) <= sc.saturation_ui(x + 0.5, 24.0) for x in [5 + 0.5 * i for i in range(50)]))
check("베이스톤 이름: 쿨 -> 핑크베이스, 웜 -> 옐로베이스, 뉴트럴 -> 뉴트럴, 모르는 값 -> 뉴트럴",
      sc.base_tone("cool") == ("pink", "핑크베이스") and sc.base_tone("warm") == ("yellow", "옐로베이스")
      and sc.base_tone("neutral") == ("neutral", "뉴트럴") and sc.base_tone("???") == ("neutral", "뉴트럴"))

print("\nALL PASS" if not failures else f"\nFAILED {len(failures)}: {failures}")
sys.exit(1 if failures else 0)
