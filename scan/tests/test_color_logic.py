"""
톤 판정(skin_color.tone_from_hue)과 네일 컬러 선택(nail_palette)의 동작 확인.

실행:  python scan/tests/test_color_logic.py      (scan/ 에서 실행해도 된다)
기준값(TONE_HUE_COOL_MAX / TONE_HUE_WARM_MIN)을 바꿨을 때 다시 돌려서 구성이 무너지지 않는지 본다.
"""
import collections
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import nail_palette as npal
import skin_color as sc

failures = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f"   {extra}" if extra else ""))
    if not cond:
        failures.append(name)


HEX = re.compile(r"^#[0-9A-F]{6}$")

# ── 1) 톤 경계 ────────────────────────────────────────────────────────────
cool, warm = sc.TONE_HUE_COOL_MAX, sc.TONE_HUE_WARM_MIN
check("경계: 쿨 기준 바로 아래는 쿨", sc.tone_from_hue(cool - 0.1) == "cool")
check("경계: 쿨 기준 값은 뉴트럴", sc.tone_from_hue(cool) == "neutral")
check("경계: 웜 기준 값은 뉴트럴", sc.tone_from_hue(warm) == "neutral")
check("경계: 웜 기준 바로 위는 웜", sc.tone_from_hue(warm + 0.1) == "warm")
check("기준값 순서가 올바름(쿨 < 웜)", cool < warm)

# 색상각 계산: a>0,b>0 사분면, a=b는 45도
check("색상각 45도", abs(sc.skin_hue(10, 10) - 45) < 1e-6)
check("색상각 0~360 범위(음수 a)", 0 <= sc.skin_hue(-5, 3) < 360 and 0 <= sc.skin_hue(0, 0) < 360)

# ── 2) 모든 조합에서 팔레트가 정상 ───────────────────────────────────────
combos = []
for hue_target, L in [(45, 45), (50, 60), (59, 62), (59, 75), (66, 62), (75, 85), (80, 50)]:
    a = 20.0
    b = a * __import__("math").tan(__import__("math").radians(hue_target))
    combos.append((hue_target, L, a, b))

for hue_target, L, a, b in combos:
    r = sc.recommend_nail_colors(L, a, b)
    best, worst, summ = r["best"], r["worst"], r["skin_summary"]
    hexes = [e["hex"] for e in best]
    tag = f"hue≈{hue_target}° L={L} -> {summ['tone']}"
    check(f"[{tag}] 30개, hex 형식 정상, 중복 없음", len(best) == 30 and all(HEX.match(h) for h in hexes) and len(set(hexes)) == 30)
    check(f"[{tag}] worst 10개", len(worst) == 10 and all(HEX.match(e["hex"]) for e in worst))
    bands = collections.Counter(e["band"] for e in best)
    tones = collections.Counter(e["tone"] for e in best)
    dark_share = sum(1 for e in best if e["L"] < 40) / len(best)
    check(f"[{tag}] 밝은 색 8개 이상", bands["light"] >= 8, str(dict(bands)))
    check(f"[{tag}] 어두운 색(L<40)이 40% 이하", dark_share <= 0.40, f"{dark_share:.0%}")
    if summ["tone"] == "warm":
        check(f"[{tag}] 웜 피부에 쿨 색은 없음", tones["cool"] == 0, str(dict(tones)))
    if summ["tone"] == "cool":
        check(f"[{tag}] 쿨 피부에 웜 색은 없음", tones["warm"] == 0, str(dict(tones)))
    check(f"[{tag}] summary에 색상각/warmness", summ["skin_hue"] == summ["warmness"] and 0 <= summ["skin_hue"] < 360)

# ── 3) 톤에 따라 팔레트가 실제로 달라진다 ─────────────────────────────────
pw = {e["hex"] for e in sc.recommend_nail_colors(62, 10, 25)["best"]}      # 웜(색상각 약 68)
pc = {e["hex"] for e in sc.recommend_nail_colors(62, 20, 20)["best"]}      # 쿨(색상각 45)
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

# ── 7) 실제 측정 샘플: 촬영 직후 노출을 낮춘 확인용 사진 두 장(피부용 -7 + 흰색 기준 -8) + 마커 흰색 보정 ─────
# 한 박스에서 서로 다른 사람 3명을 스캔한 최종 피부값 (10손가락 평균). 모두 밝은 피부라서 값이 비슷하다.
REAL = {
    "1번(본인, 쿨)":        (74.36, 22.98, 27.38),   # 색상각 50.0
    "2번(쿨~뉴트럴 경계)":  (74.21, 18.81, 25.98),   # 색상각 54.1
    "3번(더 붉은 쿨)":      (71.59, 23.49, 24.74),   # 색상각 46.5
}
real = {k: sc.recommend_nail_colors(*v) for k, v in REAL.items()}
for k, r in real.items():
    print(f"실측 {k}: 색상각 {r['skin_summary']['skin_hue']}° -> {r['skin_summary']['tone']} | 앞6: " + ", ".join(e["name"] for e in r["best"][:6]))
check("실측 3명 모두 쿨(본인 판단과 같음)", all(r["skin_summary"]["tone"] == "cool" for r in real.values()))
check("쿨 피부의 추천에 웜 색(웜 정도 0.5 이상)이 없음 - 1번/3번", all(e["warmth"] < 0.5 for k in ("1번(본인, 쿨)", "3번(더 붉은 쿨)") for e in real[k]["best"]))

# 피부값이 비슷해도 추천이 사람마다 달라야 한다 (같은 톤 라벨이어도 똑같은 30색이 나오면 안 됨)
names = list(real)
for i in range(len(names)):
    for j in range(i + 1, len(names)):
        A = {e["hex"] for e in real[names[i]]["best"]}
        B = {e["hex"] for e in real[names[j]]["best"]}
        jac = len(A & B) / len(A | B)
        A6 = {e["hex"] for e in real[names[i]]["best"][:6]}
        B6 = {e["hex"] for e in real[names[j]]["best"][:6]}
        check(f"[{names[i]} vs {names[j]}] 추천 30색이 다름(겹침 70% 미만)", jac < 0.70, f"겹침 {jac:.0%}")
        check(f"[{names[i]} vs {names[j]}] 화면에 보이는 앞 6색이 다름(겹침 50% 이하)", len(A6 & B6) / len(A6 | B6) <= 0.50)

# 피부값이 아주 조금(색상각 1도, 밝기 0.5) 달라지면 추천도 크게 튀지 않는다 (연속적)
base_r = sc.recommend_nail_colors(74.0, 22.0, 27.0)
near_r = sc.recommend_nail_colors(74.5, 21.9, 27.3)
Ab = {e["hex"] for e in base_r["best"]}; Bb = {e["hex"] for e in near_r["best"]}
check("피부값이 거의 같으면 추천도 거의 같음(겹침 80% 이상)", len(Ab & Bb) / len(Ab | Bb) >= 0.80, f"겹침 {len(Ab & Bb) / len(Ab | Bb):.0%}")

# 앞쪽 6개가 파스텔/회색 한쪽으로 쏠리지 않고, 비슷한 색이 줄줄이 나오지 않는다
for k, r in real.items():
    first = r["best"][:6]
    check(f"[{k}] 앞 6색에 밝은 색/중간 색/딥 컬러가 섞임", len({e["band"] for e in first}) >= 2 and sum(1 for e in first if e["C"] < 14) <= 2)
    labs = [(e["L"], e["H"]) for e in first]
    check(f"[{k}] 앞 6색 hex 중복 없음", len({e["hex"] for e in first}) == 6)

print("\nALL PASS" if not failures else f"\nFAILED {len(failures)}: {failures}")
sys.exit(1 if failures else 0)
