"""
eval_ccurve.py
--------------
라벨(scan/ccurve_labels.json, label_ccurve.py로 찍은 3점)과 자동 C-curve 측정을 비교하는 평가 스크립트.
촬영 환경(초점·조명)을 바꾼 뒤 새로 찍은 사진으로 자동 측정이 좋아졌는지 숫자로 확인하는 용도다.

사용 (저장소 루트에서):
    venv\\Scripts\\python scan\\eval_ccurve.py                  # 라벨이 있는 모든 사진
    venv\\Scripts\\python scan\\eval_ccurve.py 135 136          # 해당 세션만
    venv\\Scripts\\python scan\\eval_ccurve.py --exclude 131/left/index

각 사진마다
  - 3점 클릭 값(mm) = 호 높이/현 길이 비율 x 손톱 폭(results의 width_mm)
  - 자동 측정값(mm)  = scan/measure_ccurve.py (파이프라인과 같은 설정)
  - 경계 번짐 폭(px) = 손가락 경계가 얼마나 흐린지 (작을수록 초점이 맞음)
를 표로 보여주고, 오차와 번짐 폭의 관계도 함께 낸다.
"""

import argparse
import contextlib
import io
import json
import os
import re
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

import nail_measurer as nm                                   # noqa: E402
from measure_ccurve import measure_ccurve, side_edge_blur_px  # noqa: E402

KO = {"thumb": "엄지", "index": "검지", "middle": "중지", "ring": "약지", "pinky": "새끼"}
ORDER = list(KO)


def repeat_check(left_sess: str, right_sess: str, user: str = "1"):
    """같은 손을 왼손 파트와 오른손 파트에 한 번씩 넣어 스캔했을 때(정답 라벨 없이) 손가락별 C-curve가
    얼마나 일치하는지 본다. 같은 손가락이면 값이 거의 같아야 하므로, 차이가 곧 측정의 흔들림이다."""
    print(f"| 손가락 | 폭 왼/오른(mm) | C-curve 왼 | 오른 | 차이 | 출처 왼/오른 | 번짐 왼/오른(px) |")
    print("|---|---|---|---|---|---|---|")
    src_ko = {"end_on": "실측", "fallback_average": "평균대체", "brightness": "밝기추정"}
    diffs = []
    for f in ORDER:
        row = {}
        for h, sess in (("left", left_sess), ("right", right_sess)):
            rj = os.path.join(BASE, "results", user, sess, h, f, "nail_measurements.json")
            if not os.path.isfile(rj):
                row[h] = None
                continue
            n = json.load(open(rj, encoding="utf-8"))["nails"][0]
            img = cv2.imread(os.path.join(BASE, "photos", user, sess, h, f + "_side.jpg"))
            lowres = img is None or img.shape[1] < 2000
            blur = None if lowres else side_edge_blur_px(img)
            row[h] = (n["width_mm"], n["c_curve_mm"], n.get("c_curve_source"), blur, lowres)
        if not row["left"] or not row["right"]:
            print(f"| {KO[f]} | 결과 없음 |")
            continue
        L, R = row["left"], row["right"]
        tag = lambda x: ("저해상도(사용 안 함)" if x[4] else src_ko.get(x[2], str(x[2])))
        ok = L[2] == "end_on" and R[2] == "end_on" and not L[4] and not R[4]
        d = R[1] - L[1]
        if ok:
            diffs.append(abs(d))
        bl = lambda x: "-" if x[3] is None else f"{x[3]:.0f}"
        print(f"| {KO[f]} | {L[0]:.2f} / {R[0]:.2f} | {L[1]:.2f} | {R[1]:.2f} | {d:+.2f} | {tag(L)} / {tag(R)} | {bl(L)} / {bl(R)} |")
    if diffs:
        print(f"\n실측끼리 비교 {len(diffs)}개: 평균 |차이| {np.mean(diffs):.2f}mm, 최대 {np.max(diffs):.2f}mm "
              f"(같은 손이라 0에 가까울수록 좋음)")
    else:
        print("\n두 손 모두 실측인 손가락이 없어 비교할 수 없습니다.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeat", nargs=2, metavar=("왼손세션", "오른손세션"),
                    help="같은 손을 두 파트에 넣어 스캔한 경우: 두 세션의 손가락별 C-curve 일치도 (라벨 불필요)")
    ap.add_argument("sessions", nargs="*", help="평가할 세션 번호 (생략하면 전부)")
    ap.add_argument("--exclude", nargs="*", default=["131/left/index"],
                    help="이상치로 뺄 사진: 세션/손/손가락 (기본: 131/left/index)")
    args = ap.parse_args()
    if args.repeat:
        repeat_check(*args.repeat)
        return

    labels = json.load(open(os.path.join(HERE, "ccurve_labels.json"), encoding="utf-8"))["labels"]
    rows = []
    for k, v in labels.items():
        m = re.search(r"photos/(\d+)/(\d+)/(left|right)/(\w+)_side", k)
        if not m:
            continue
        user, sess, hand, f = m.groups()
        if args.sessions and sess not in args.sessions:
            continue
        rj = os.path.join(BASE, "results", user, sess, hand, f, "nail_measurements.json")
        if not os.path.isfile(rj):
            continue
        path = os.path.join(BASE, k)
        img = cv2.imread(path)
        if img is None:
            continue
        w = json.load(open(rj, encoding="utf-8"))["nails"][0]["width_mm"]
        lab = v["ratio"] * w
        blur = side_edge_blur_px(img)
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                r = measure_ccurve(path, w, None, table_edge=True,
                                   top_crop_frac=nm.CCURVE_TOP_CROP_FRAC, bottom_crop_frac=nm.CCURVE_BOTTOM_CROP_FRAC,
                                   left_crop_frac=nm.CCURVE_LEFT_CROP_FRAC, right_crop_frac=nm.CCURVE_RIGHT_CROP_FRAC)
            auto = float(r["c_curve_mm"])
        except Exception:
            auto = None
        rows.append(dict(sess=sess, hand=hand, finger=f, w=w, lab=lab, auto=auto, blur=blur,
                         excl=f"{sess}/{hand}/{f}" in args.exclude))

    rows.sort(key=lambda r: (-int(r["sess"]), r["hand"] != "left", ORDER.index(r["finger"])))
    print("| 세션 | 손 | 손가락 | 폭(mm) | 3점 클릭 | 자동 측정 | 차이 | 경계 번짐(px) |")
    print("|---|---|---|---|---|---|---|---|")
    for r in rows:
        a = "측정 실패" if r["auto"] is None else f"{r['auto']:.2f}"
        d = "-" if r["auto"] is None else f"{r['auto'] - r['lab']:+.2f}"
        b = "-" if r["blur"] is None else f"{r['blur']:.0f}"
        tag = " (제외)" if r["excl"] else ""
        print(f"| {r['sess']} | {'왼' if r['hand'] == 'left' else '오른'} | {KO[r['finger']]}{tag} | {r['w']:.2f} | "
              f"{r['lab']:.2f} | {a} | {d} | {b} |")

    use = [r for r in rows if not r["excl"] and r["auto"] is not None]
    if not use:
        print("\n비교할 사진이 없습니다.")
        return
    err = np.array([abs(r["auto"] - r["lab"]) for r in use])
    lab = np.array([r["lab"] for r in use])
    auto = np.array([r["auto"] for r in use])
    print(f"\n비교 {len(use)}장 (이상치·측정 실패 제외, 실패 {sum(r['auto'] is None for r in rows)}장)")
    print(f"  평균 절대오차 {err.mean():.2f}mm / 중앙값 {np.median(err):.2f}mm / 0.5mm 이내 {int((err <= 0.5).sum())}장 / "
          f"1.0mm 이내 {int((err <= 1.0).sum())}장")
    if len(use) > 2 and lab.std() > 0 and auto.std() > 0:
        print(f"  자동 측정과 클릭 값의 상관계수 {np.corrcoef(auto, lab)[0, 1]:+.2f}  "
              f"(기준: 항상 중앙값 {np.median(lab):.2f}mm로 답하면 평균 오차 {np.abs(lab - np.median(lab)).mean():.2f}mm)")
    bl = [(r["blur"], abs(r["auto"] - r["lab"])) for r in use if r["blur"] is not None]
    if len(bl) > 3:
        bins = [("≤8px(선명)", lambda b: b <= 8), ("8~20px(보통)", lambda b: 8 < b <= 20), (">20px(흐림)", lambda b: b > 20)]
        parts = []
        for name, f_ in bins:
            es = [e for b, e in bl if f_(b)]
            parts.append(f"{name} {len(es)}장 평균오차 {np.mean(es):.2f}mm" if es else f"{name} 0장")
        print("  경계 번짐별: " + " / ".join(parts))


if __name__ == "__main__":
    main()
