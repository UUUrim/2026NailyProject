"""
final_measurements.py
=====================
손가락별 nail_measurements.json 10개(왼손 5 + 오른손 5)를 모아서 최종
measurements.json 하나로 만든다.

손 단위 중간 파일/분석 없이, 손가락 파일만 쌓아 두었다가 두 손이 모두
측정되면 그때 한 번에 계산한다:
  - 치수/크기 판정 (양손 10개 합계 기준, nail_measurer.classify_size_totals)
  - 10손가락 피부 LAB 평균 → skinToneHex / tone(색상각 기준) / hue / brightness / saturation
  - 추천 컬러 30개 (skin_color.recommend_nail_colors)
  - 추천 쉐입 (nail_measurer.recommend_nail_shape)

로컬 경로:  results/{userid}/{left}_{right}/both/measurements.json
S3 키:      results/{userid}/{left}_{right}/both/measurements.json  (같은 경로)

사용 예:
    path = build_for_pair(RESULTS_DIR, userid, session, hand, partner_session)   # 짝 손은 스캔 시작 때 정해진다
"""

from __future__ import annotations

import json
import math
import os
from datetime import datetime
from typing import Optional

from nail_measurer import (merge_hand_measurements, classify_size_totals,
                           recommend_nail_shape)
from skin_color import recommend_nail_colors, lab_to_rgb_hex

FINGER_ORDER   = ["thumb", "index", "middle", "ring", "pinky"]
FINGER_FILE    = "nail_measurements.json"
SCHEMA_VERSION = 1


# ── 경로 규칙 ────────────────────────────────────────────────────────────

def final_json_path(results_dir: str, userid: str, left_session: str, right_session: str) -> str:
    return os.path.join(results_dir, userid, f"{left_session}_{right_session}", "both", "measurements.json")


def final_s3_key(userid: str, left_session: str, right_session: str) -> str:
    return f"results/{userid}/{left_session}_{right_session}/both/measurements.json"


def _finger_file(results_dir: str, userid: str, session: str, hand: str, finger: str) -> str:
    return os.path.join(results_dir, userid, session, hand, finger, FINGER_FILE)


# ── 손가락 파일 읽기 ─────────────────────────────────────────────────────

def load_finger_payloads(results_dir: str, userid: str, session: str, hand: str) -> dict:
    """{finger: payload} - 측정에 성공한(파일이 있는) 손가락만."""
    payloads = {}
    for finger in FINGER_ORDER:
        p = _finger_file(results_dir, userid, session, hand, finger)
        if not os.path.isfile(p):
            continue
        try:
            with open(p, encoding="utf-8") as f:
                payload = json.load(f)
        except Exception as e:
            print(f"  [{hand}/{session}/{finger}] 측정 파일 읽기 오류: {e}")
            continue
        if payload.get("nails"):
            payloads[finger] = payload
    return payloads


def find_latest_session(results_dir: str, userid: str, hand: str) -> Optional[str]:
    """그 사용자의 hand 쪽에서 손가락 측정 파일이 하나라도 있는 가장 최근(번호가 큰) 세션.

    세션 폴더 이름은 scanId(숫자)다. 짝 폴더("12_13")처럼 숫자가 아닌 이름은 건너뛴다.
    """
    user_dir = os.path.join(results_dir, userid)
    if not os.path.isdir(user_dir):
        return None
    candidates = []
    for name in os.listdir(user_dir):
        if not name.isdigit():
            continue
        if any(os.path.isfile(_finger_file(results_dir, userid, name, hand, f)) for f in FINGER_ORDER):
            candidates.append(name)
    return max(candidates, key=int) if candidates else None


# ── 최종 JSON 계산 ───────────────────────────────────────────────────────

def _num(val) -> Optional[float]:
    try:
        v = float(val)
    except (TypeError, ValueError):
        return None
    return None if (math.isnan(v) or math.isinf(v)) else v


def _fingers_view(by_finger: dict) -> list:
    """화면용 손가락 목록 - 기존 /analyze/result 콜백의 fingers와 같은 필드명."""
    out = []
    for finger in FINGER_ORDER:
        fd = by_finger.get(finger)
        if not fd:
            continue
        out.append({
            "finger": finger.upper(),
            "measurements": {
                "widthMm":           _num(fd.get("width_mm")),
                "lengthMm":          _num(fd.get("length_mm")),
                "freeEdgeMm":        _num(fd.get("free_edge_mm")),
                "correctedLengthMm": _num(fd.get("corrected_length_mm")),
                "cCurveMm":          _num(fd.get("c_curve_mm")),
                "arcRadiusMm":       _num(fd.get("arc_radius_mm")),
                "thicknessMm":       _num(fd.get("thickness_mm")),
                "widthVsAvgMm":      _num(fd.get("width_vs_avg_mm")),
                "lengthVsAvgMm":     _num(fd.get("length_vs_avg_mm")),
                "widthSize":         fd.get("width_size", "average"),
                "lengthSize":        fd.get("length_size", "average"),
                "nailSize":          fd.get("nail_size", "average"),
            },
            "size": fd.get("nail_size", "average"),
        })
    return out


def _hand_block(session: str, payloads: dict) -> dict:
    """한 손의 상세 블록 (nails/by_finger/mesh_params + 화면용 fingers)."""
    block = merge_hand_measurements(payloads)
    block["session"]        = session
    block["missingFingers"] = [f for f in FINGER_ORDER if f not in payloads]
    block["fingers"]        = _fingers_view(block["by_finger"])
    return block


SKIN_MIN_L, SKIN_MAX_L, SKIN_MIN_A = 45.0, 92.0, 8.0   # L이 이 범위 밖(바닥처럼 어둡거나 하얗게 날아감)이거나 붉은기(a*)가 이보다 적으면 피부가 아니다


def _skin_and_colors(all_nails: list) -> tuple:
    """(skin dict | None, 추천 컬러 hex 리스트) - 유효한 피부 LAB이 있는 손가락 평균.

    톤은 평균 Lab의 색상각(skin_color.tone_from_hue)으로 판정하고, skin["warmness"]에는 그 색상각(도)을
    넣는다 (화면의 웜/쿨 슬라이더가 이 값을 쓴다). 각 손가락의 피부값은 nail_measurer가 마커 흰색으로
    화이트밸런스를 맞춘 사진에서 잰 값이며, 보정이 적용된 손가락 수를 whiteBalancedFingers에 남긴다.
    """
    metrics = [n for n in all_nails
               if all(_num(n.get(k)) is not None for k in ("skin_L", "skin_a", "skin_b", "skin_saturation"))]
    if not metrics:
        return None, []
    # 촬영 직후 손이 빠져서 손가락 자리에 바닥(검은 매트)이 찍힌 손가락(L 20대, a<0)이나, 노출이 안 먹어서 피부가
    # 하얗게 날아간 손가락(L 99, a<0)은 피부값이 아니다. 피부로 볼 수 있는 손가락만 평균에 쓰고, 하나도 없으면
    # 피부 분석을 비워 둔다 (잘못된 톤/추천 컬러를 보여주는 것보다 낫다).
    metrics = [n for n in metrics
               if SKIN_MIN_L <= float(n["skin_L"]) <= SKIN_MAX_L and float(n["skin_a"]) >= SKIN_MIN_A]
    if not metrics:
        return None, []

    def avg(key):
        return sum(float(n[key]) for n in metrics) / len(metrics)

    L, a, b = avg("skin_L"), avg("skin_a"), avg("skin_b")
    saturation = avg("skin_saturation")

    result = recommend_nail_colors(L, a, b)
    summary = result["skin_summary"]
    skin = {
        "skinToneHex": lab_to_rgb_hex(L, a, b),
        "tone":        summary["tone"],
        "hue":         summary["skin_hue"],
        "warmness":    summary["warmness"],
        "brightness":  round(L / 100.0, 3),
        "saturation":  round(saturation, 3),
        "L":           round(L, 2),
        "a":           round(a, 2),
        "b":           round(b, 2),
        "fingerCount": len(metrics),
        "whiteBalancedFingers": sum(1 for n in metrics if (n.get("skin_wb") or {}).get("applied")),
    }
    return skin, [c["hex"] for c in result["best"]]


def build_final_payload(userid: str, left_session: str, left_payloads: dict,
                        right_session: str, right_payloads: dict) -> dict:
    left_block  = _hand_block(left_session,  left_payloads)
    right_block = _hand_block(right_session, right_payloads)

    all_nails = left_block["nails"] + right_block["nails"]
    summary   = classify_size_totals(all_nails)

    widths  = [float(n["width_mm"]) for n in all_nails if _num(n.get("width_mm")) is not None]
    lengths = [float(n["length_mm"]) for n in all_nails if _num(n.get("length_mm")) is not None]
    curves  = [float(n["c_curve_mm"]) for n in all_nails if _num(n.get("c_curve_mm")) is not None]
    # 손톱이 손가락 살 끝보다 얼마나 나와 있는지 - 네일팁 출력 화면의 "내 손톱 끝" 위치에 쓴다
    free_edges = [float(n["free_edge_mm"]) for n in all_nails if _num(n.get("free_edge_mm")) is not None]
    summary["avg_width_mm"]   = round(sum(widths) / len(widths), 2) if widths else None
    summary["avg_length_mm"]  = round(sum(lengths) / len(lengths), 2) if lengths else None
    summary["avg_c_curve_mm"] = round(sum(curves) / len(curves), 2) if curves else None
    summary["avg_free_edge_mm"] = round(sum(free_edges) / len(free_edges), 2) if free_edges else None
    summary["finger_count"]   = len(all_nails)

    skin, recommended_colors = _skin_and_colors(all_nails)
    wl_checks = [n["wl_ratio_check"] for n in all_nails if n.get("wl_ratio_check")]

    return {
        "schemaVersion":     SCHEMA_VERSION,
        "userId":            userid,
        "leftSession":       left_session,
        "rightSession":      right_session,
        "scannedAt":         datetime.now().isoformat(timespec="seconds"),
        "summary":           summary,
        "skin":              skin,
        "recommendedColors": recommended_colors,
        "recommendedShape":  recommend_nail_shape(wl_checks, summary["nail_size"]),
        "left":              left_block,
        "right":             right_block,
    }


def write_final_measurements(results_dir: str, userid: str,
                             left_session: str, right_session: str) -> str:
    """두 세션의 손가락 파일로 최종 JSON을 만들어 로컬에 쓰고 경로를 돌려준다.

    한쪽 손이라도 측정된 손가락이 하나도 없으면 RuntimeError.
    같은 두 세션으로 다시 부르면 덮어쓴다(멱등).
    """
    left_payloads  = load_finger_payloads(results_dir, userid, left_session,  "left")
    right_payloads = load_finger_payloads(results_dir, userid, right_session, "right")
    if not left_payloads or not right_payloads:
        raise RuntimeError(
            f"최종 measurements.json을 만들 수 없음: 왼손 {len(left_payloads)}개 / "
            f"오른손 {len(right_payloads)}개 손가락 (세션 {left_session}, {right_session})")

    payload = build_final_payload(userid, left_session, left_payloads, right_session, right_payloads)

    path = final_json_path(results_dir, userid, left_session, right_session)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)   # 읽는 쪽이 쓰다 만 파일을 보지 않도록
    return path


def build_for_pair(results_dir: str, userid: str, session: str, hand: str,
                   partner_session: Optional[str]) -> Optional[str]:
    """한 손(session, hand)의 측정이 끝났을 때 부른다. 스캔 시작 때 정해진 짝 손(partner_session)의
    손가락 측정 파일이 있으면 그 둘로 최종 JSON을 만들고 로컬 경로를 돌려준다.

    짝(partner_session)이 없으면 None이다. 디스크에서 "가장 최근 반대 손"을 찾아 붙이지 않는다 -
    한 손만 찍고 멈춘 데이터나 앞 사람의 손이 다음 사람의 손과 짝지어지기 때문이다.
    """
    if not partner_session or str(partner_session) == str(session):
        return None
    other = "right" if hand == "left" else "left"
    if not load_finger_payloads(results_dir, userid, partner_session, other):
        return None
    left_session, right_session = (session, partner_session) if hand == "left" else (partner_session, session)
    return write_final_measurements(results_dir, userid, left_session, right_session)
