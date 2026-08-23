"""
skin_tone_api_v2.py
===================
기존 skin_tone_api.py 를 naily_color 파이프라인으로 교체한 버전.
포트/엔드포인트/응답 스키마는 그대로 유지 -> 스프링부트 쪽 수정 불필요.

실행:
    uvicorn skin_tone_api_v2:app --reload --port 8001
"""

import os
import time
import uuid
from contextlib import asynccontextmanager
from typing import Optional

import pymysql
from fastapi import FastAPI, File, UploadFile, HTTPException

from naily_color import (
    SkinToneAnalyzer, FlatFieldCorrector, lab_to_rgb_hex,
    build_finger_metrics, aggregate_finger_list, FINGER_NAMES,
)
from naily_pipeline import BoxCorrector, preprocess_bytes
from nail_recommend import recommend_nail_colors

# -----------------------------------------------------------------------------
# 설정
# -----------------------------------------------------------------------------
FLAT_FRAME_PATH = os.getenv("NAILY_FLAT_FRAME", "calib/flat_frame.png")
CARD_REFLECTANCE = float(os.getenv("NAILY_CARD_REFLECTANCE", "0.9"))  # 화이트카드 기준

DB = dict(host="localhost", user="root", password="", database="naily_db", charset="utf8mb4")

_analyzer: SkinToneAnalyzer | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """서버 기동 시 flat frame을 한 번만 로드해서 재사용."""
    global _analyzer
    ff = None
    if os.path.exists(FLAT_FRAME_PATH):
        try:
            ff = FlatFieldCorrector(FLAT_FRAME_PATH, card_reflectance=CARD_REFLECTANCE)
            print(f"[naily] flat-field 활성화: {FLAT_FRAME_PATH}")
        except Exception as e:
            print(f"[naily] flat frame 로드 실패, 평면 피팅만 사용: {e}")
    else:
        print(f"[naily] flat frame 없음({FLAT_FRAME_PATH}) — 평면 피팅 보정만 적용")

    _analyzer = SkinToneAnalyzer(flat_field=ff)
    yield


app = FastAPI(title="Naily Skin Tone API", version="2.0", lifespan=lifespan)


# -----------------------------------------------------------------------------
# 분류: 실측 분포로 재캘리브레이션할 자리
# -----------------------------------------------------------------------------
# collect_calibration() 으로 15~20명 데이터를 모은 뒤, 아래 값을 그 분포의
# 33/66 percentile 로 바꿔야 한다. 지금 값은 어디까지나 임시 시드다.
TH = {
    "warm_hi": 13.0, "warm_lo": 9.0,
    "light": 0.72, "deep": 0.58,
    "vivid": 0.55, "muted": 0.32,
    "high_contrast": 0.60, "low_contrast": 0.42,
}


def classify(m) -> str:
    warm = m.warmness > TH["warm_hi"]
    cool = m.warmness < TH["warm_lo"]
    light = m.brightness > TH["light"]
    deep = m.brightness < TH["deep"]
    vivid = m.saturation > TH["vivid"]
    muted = m.saturation < TH["muted"]
    bright = m.contrast > TH["high_contrast"]

    if warm:
        if light:
            return "spring_vivid" if vivid else "spring_bright" if bright \
                else "spring_soft" if muted else "spring_light"
        if deep:
            return "autumn_dark" if bright else "autumn_deep"
        return "autumn_deep" if bright else "autumn_mute" if muted else "autumn_soft"
    if cool:
        if light:
            return "winter_light" if vivid else "summer_bright" if bright \
                else "summer_soft" if muted else "summer_light"
        if deep:
            return "winter_dark" if bright else "winter_deep"
        return "winter_vivid" if vivid else "summer_mute" if muted else "summer_soft"
    # 뉴트럴
    if light:
        return "spring_light" if m.warmness >= 11.0 else "summer_light"
    if deep:
        return "autumn_deep" if m.warmness >= 11.0 else "winter_deep"
    return "autumn_soft" if m.warmness >= 11.0 else "summer_soft"


def fetch_season(code: str) -> dict:
    conn = pymysql.connect(**DB, cursorclass=pymysql.cursors.DictCursor)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT code, name_ko, tone, grp FROM seasons WHERE code=%s", (code,)
            )
            season = cur.fetchone()
            if not season:
                raise HTTPException(500, f"seasons 테이블에 '{code}' 없음")

            cur.execute(
                "SELECT hex FROM season_colors WHERE season_code=%s ORDER BY id", (code,)
            )
            palette = [r["hex"] for r in cur.fetchall()]
        return {"season": season, "palette": palette}
    finally:
        conn.close()


# -----------------------------------------------------------------------------
# 실시간 세션
# 사진이 한 장씩 찍히는 즉시 /session/{id}/finger 로 올려서 그때그때 seg+분석,
# 10장(또는 원하는 만큼) 다 올라가면 /session/{id}/finalize 로 집계 + 컬러 30개 추천.
# 세션 상태는 서버 메모리에 둠 (재시작하면 날아감 → 필요하면 나중에 redis로 교체).
# -----------------------------------------------------------------------------
SESSION_TTL_SEC = 30 * 60  # 30분 이상 미사용 세션은 정리
_sessions: dict[str, dict] = {}


def _cleanup_sessions():
    now = time.time()
    dead = [sid for sid, s in _sessions.items() if now - s["updated"] > SESSION_TTL_SEC]
    for sid in dead:
        del _sessions[sid]


def _get_session(session_id: str) -> dict:
    _cleanup_sessions()
    s = _sessions.get(session_id)
    if s is None:
        raise HTTPException(404, f"세션을 찾을 수 없음(만료됐거나 잘못된 id): {session_id}")
    return s


@app.post("/session/start")
async def session_start(person_name: str = "user"):
    """새 손 분석 세션 시작. 반환된 sessionId를 이후 요청에 계속 사용."""
    session_id = uuid.uuid4().hex
    _sessions[session_id] = {
        "person_name": person_name,
        "corrector": BoxCorrector(),
        "finger_list": [],
        "updated": time.time(),
    }
    return {"sessionId": session_id, "personName": person_name}


@app.post("/session/{session_id}/finger")
async def session_add_finger(
    session_id: str,
    file: UploadFile = File(...),
    finger_name: Optional[str] = None,
):
    """
    사진 1장을 즉시 seg+분석해서 세션에 쌓는다.
    손가락 찍을 때마다 이 엔드포인트를 반복 호출.
    """
    s = _get_session(session_id)
    raw = await file.read()

    idx = len(s["finger_list"])
    name = finger_name or (FINGER_NAMES[idx] if idx < len(FINGER_NAMES) else f"finger_{idx}")

    try:
        pil_rgba = preprocess_bytes(raw, s["corrector"])
        fm = build_finger_metrics(pil_rgba, idx, name, _analyzer)
    except Exception as e:
        raise HTTPException(400, f"손가락 분석 실패({name}): {e}")

    s["finger_list"].append(fm)
    s["updated"] = time.time()
    m = fm.metrics

    return {
        "sessionId":   session_id,
        "fingerIndex": idx,
        "fingerName":  name,
        "count":       len(s["finger_list"]),
        "skinHex":     lab_to_rgb_hex(m.L, m.a, m.b),
        "warmness":    m.warmness,
        "L":           m.L,
    }


@app.get("/session/{session_id}")
async def session_status(session_id: str):
    """지금까지 몇 장 쌓였는지 확인용."""
    s = _get_session(session_id)
    return {
        "sessionId":    session_id,
        "personName":   s["person_name"],
        "count":        len(s["finger_list"]),
        "fingerNames":  [f.finger_name for f in s["finger_list"]],
    }


@app.post("/session/{session_id}/finalize")
async def session_finalize(session_id: str, n_best: int = 30, n_worst: int = 10):
    """
    쌓인 손가락들을 집계해서 피부톤 확정 + 어울리는 컬러 n_best개 반환.
    호출 후 세션은 종료(메모리에서 제거)됨.
    """
    s = _get_session(session_id)
    if len(s["finger_list"]) < 2:
        raise HTTPException(
            400, f"유효한 손가락이 너무 적음: {len(s['finger_list'])}개 (최소 2개 필요)"
        )

    agg = aggregate_finger_list(s["finger_list"])
    rec = recommend_nail_colors(
        agg.L, agg.a, agg.b, agg.warmness, agg.saturation,
        n_best=n_best, n_worst=n_worst,
    )

    del _sessions[session_id]

    return {
        "sessionId":   session_id,
        "personName":  s["person_name"],
        "aggregated":  agg.to_dict(),
        "bestColors":  rec["best"],
        "worstColors": rec["worst"],
        "skinSummary": rec["skin_summary"],
    }


# -----------------------------------------------------------------------------
# 엔드포인트 (기존 - 사진 1장짜리 단발성 분석, 그대로 유지)
# -----------------------------------------------------------------------------
@app.post("/analyze-skin-tone")
async def analyze_skin_tone(file: UploadFile = File(...)):
    raw = await file.read()

    try:
        m = _analyzer.analyze(raw)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"분석 실패: {e}")

    code = classify(m)
    row = fetch_season(code)

    return {
        "seasonCode": code,
        "seasonNameKo": row["season"]["name_ko"],
        "tone": row["season"]["tone"],
        "skinAttributes": {
            "warmness": m.warmness,
            "brightness": m.brightness,
            "saturation": m.saturation,
            "contrast": m.contrast,
            "undertone": m.undertone,
        },
        "skinToneHex": lab_to_rgb_hex(m.L, m.a, m.b),
        "personalColorPalette": row["palette"],
        "meta": {
            "L": m.L, "a": m.a, "b": m.b, "C": m.C,
            "pixelCount": m.pixel_count,
            # 아래 3개가 진단의 핵심. 문제 생기면 여기부터 본다.
            "flatFieldApplied": m.flat_field_applied,
            "gradientRemoved": m.gradient_removed,
            "iccNote": m.icc_note,
        },
    }


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "flatFieldActive": _analyzer.flat is not None and _analyzer.flat.is_active,
        "flatFramePath": FLAT_FRAME_PATH,
    }