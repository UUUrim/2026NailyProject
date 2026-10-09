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

# ── 7) 실제 측정 샘플: 촬영 직후 노출을 낮춘 확인용 사진 + 마커 흰색 보정으로 잰 손가락 피부 ─────
# (본인 손, 본인이 쿨톤이라고 판단. 같은 손가락을 3번 재서 L 66.8~67.2, a 19.2~19.5, b 26.3~26.9)
r = sc.recommend_nail_colors(67.0, 19.4, 26.5)
print(f"\n실측 샘플(L=67.0 a=19.4 b=26.5): 색상각 {r['skin_summary']['skin_hue']}° -> {r['skin_summary']['tone']}")
print("추천:", ", ".join(e["name"] for e in r["best"]))
check("실측 샘플(본인 손, 쿨톤이라고 판단)이 쿨로 나옴", r["skin_summary"]["tone"] == "cool", f"{r['skin_summary']['skin_hue']}°")
check("실측 샘플의 추천 컬러에 웜 색이 없음", all(e["tone"] != "warm" for e in r["best"]))

print("\nALL PASS" if not failures else f"\nFAILED {len(failures)}: {failures}")
sys.exit(1 if failures else 0)
