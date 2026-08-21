"""
server.py — Naily 통합 서버 (스캔 + 프린터)
--------------------------------------------
스캔 서버(scan/server.py)와 프린터 서버(printer/server.py)를 하나로 합쳐
ngrok 터널 하나만으로 EC2 Spring Boot와 통신한다.

Usage:
    uvicorn server:app --host 0.0.0.0 --port 8000 --reload

엔드포인트:
  [공통]
    GET  /health

  [스캔]
    POST /analyze/measure     — 스캔 시작 (카메라 촬영 → 측정 → S3 업로드 → 콜백)
    POST /analyze/stl         — STL 생성 → S3 업로드 → 콜백
    GET  /stream/top          — 탑뷰 MJPEG 스트림 (ArUco 가이드선 포함)
    GET  /stream/side         — 사이드뷰 MJPEG 스트림 (오버레이 없음)
    GET  /status/events       — SSE: 손가락 촬영 진행상황
    POST /capture/force       — 수동 촬영 트리거 (웹 "지금 촬영" 버튼)
    GET  /capture/status      — 현재 촬영 세션 상태

  [프린터]
    GET  /print/status        — 프린터 현재 상태/진행률 (Spring Boot 폴링용)
    POST /print/merge         — 한 손 STL 병합 → S3 → 콜백
    POST /print/merge-both    — 양손 STL 병합 → S3 → 콜백
    POST /print/start         — 슬라이싱 + 프린터 출력 시작
"""

import asyncio
import json
import math
import os
import queue as _q
import subprocess
import sys
import threading
import time
from collections import deque

import boto3
import cv2
import cv2.aruco as aruco
import numpy as np
import requests
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# ── 프린터 관련 모듈 (printer/ 디렉터리)
# 통합 서버를 어느 디렉터리에 두든 동작하도록 sys.path 처리
_THIS_DIR    = os.path.dirname(os.path.abspath(__file__))
_PRINTER_DIR = os.path.join(_THIS_DIR, "printer")   # 필요하면 경로 조정
_SCAN_DIR    = os.path.join(_THIS_DIR, "scan")       # 필요하면 경로 조정
for _p in [_PRINTER_DIR, _SCAN_DIR, _THIS_DIR]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

from merge_fingers   import merge_hand, merge_both_hands          # printer/
from slice_and_print import (slice_and_send_to_printer,           # printer/
                              PRINTER_IP, PRINTER_ACCESS_CODE, PRINTER_SERIAL)

# ─────────────────────────────────────────────────────────────
BASE   = _THIS_DIR
BUCKET = "naily-scans"
FINGER_ORDER = ["thumb", "index", "middle", "ring", "pinky"]

# ── 카메라 설정 ───────────────────────────────────────────────
CAMERA_TOP        = 0
CAMERA_SIDE       = 1       # -1 이면 사이드 카메라 없음
ARUCO_SIZE_MM     = 20.0
CROP_BOTTOM_PX    = 270
STABLE_FRAMES     = 20
STABLE_PX_THRESH  = 20
COUNTDOWN_SEC     = 3
SKIN_FRACTION_MIN = 0.04

# ─────────────────────────────────────────────────────────────
app = FastAPI(title="Naily 통합 서버")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ══════════════════════════════════════════════════════════════
# 공통 유틸
# ══════════════════════════════════════════════════════════════

def _load_env():
    env_path = os.path.join(BASE, ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip())

_load_env()


def _s3_client():
    return boto3.client(
        "s3",
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
        region_name=os.environ.get("AWS_DEFAULT_REGION", "ap-northeast-2"),
    )


def _s3_url(key: str) -> str:
    return f"https://{BUCKET}.s3.amazonaws.com/{key}"


def _upload_file(local_path: str, s3_key: str) -> str:
    _s3_client().upload_file(local_path, BUCKET, s3_key)
    print(f"  [S3] {s3_key}")
    return _s3_url(s3_key)


def safe_float(val, default=0.0):
    try:
        v = float(val) if val is not None else default
        return default if (math.isnan(v) or math.isinf(v)) else v
    except (TypeError, ValueError):
        return default


# ══════════════════════════════════════════════════════════════
# 프린터 관련
# ══════════════════════════════════════════════════════════════

_printer_singleton = None


def _get_printer():
    global _printer_singleton
    if _printer_singleton is None:
        from bambulabs_api import Printer
        _printer_singleton = Printer(PRINTER_IP, PRINTER_ACCESS_CODE, PRINTER_SERIAL)
        _printer_singleton.connect()
    return _printer_singleton


def _fetch_printer_status() -> dict:
    p = _get_printer()
    return {
        "state":            str(p.get_current_state()),
        "percentage":       p.get_percentage(),
        "currentLayer":     p.current_layer_num,
        "totalLayer":       p.total_layer_num,
        "remainingTimeMin": p.get_time(),
        "nozzleTemp":       p.get_nozzle_temperature(),
        "bedTemp":          p.get_bed_temperature(),
    }


def _upload_3mf(local_path: str, s3_key: str) -> str:
    return _upload_file(local_path, s3_key)


def _download_3mf_from_url(url: str, local_path: str):
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    resp = requests.get(url)
    resp.raise_for_status()
    with open(local_path, "wb") as f:
        f.write(resp.content)


def _slice_and_print_local(local_3mf: str, output_dir: str, callback_url: str):
    try:
        gcode_path = slice_and_send_to_printer(local_3mf, output_dir)
        requests.post(callback_url, json={
            "success": True, "status": "PRINTING", "gcodePath": gcode_path})
    except Exception as e:
        requests.post(callback_url, json={"success": False, "message": str(e)})


def _run_merge_one_hand(userid, session, hand, shapes, callback_url, print_callback_url=None):
    try:
        result     = merge_hand(userid, session, hand, shapes)
        s3_key     = f"print/{userid}/{session}/{hand}/hand_merged.3mf"
        merged_url = _upload_3mf(result["path"], s3_key)
        requests.post(callback_url, json={
            "success": True, "mergedModelUrl": merged_url, "missing": result["missing"]})
        if print_callback_url:
            _slice_and_print_local(result["path"], os.path.dirname(result["path"]), print_callback_url)
    except Exception as e:
        requests.post(callback_url, json={"success": False, "message": str(e)})


def _run_merge_both_hands(userid, left_session, right_session,
                           left_shapes, right_shapes, callback_url, print_callback_url=None):
    try:
        result = merge_both_hands(userid, left_session, right_session, left_shapes, right_shapes)
        s3_key     = f"print/{userid}/{left_session}_{right_session}/both/both_hands_merged.3mf"
        merged_url = _upload_3mf(result["path"], s3_key)
        requests.post(callback_url, json={
            "success": True, "mergedModelUrl": merged_url,
            "missingLeft": result["missingLeft"], "missingRight": result["missingRight"]})
        if print_callback_url:
            _slice_and_print_local(result["path"], os.path.dirname(result["path"]), print_callback_url)
    except Exception as e:
        requests.post(callback_url, json={"success": False, "message": str(e)})


def _run_slice_and_print(merged_model_url, output_dir, callback_url):
    try:
        local_3mf = os.path.join(output_dir, "input_for_slicing.3mf")
        _download_3mf_from_url(merged_model_url, local_3mf)
        gcode_path = slice_and_send_to_printer(local_3mf, output_dir)
        requests.post(callback_url, json={
            "success": True, "status": "PRINTING", "gcodePath": gcode_path})
    except Exception as e:
        requests.post(callback_url, json={"success": False, "message": str(e)})


# ══════════════════════════════════════════════════════════════
# 스캔 관련
# ══════════════════════════════════════════════════════════════

# ── 스트리밍 상태 ─────────────────────────────────────────────
class _StreamState:
    def __init__(self):
        self.top_frame:    _q.Queue = _q.Queue(maxsize=1)
        self.side_frame:   _q.Queue = _q.Queue(maxsize=1)
        self.events:       _q.Queue = _q.Queue(maxsize=200)
        self.force_capture: threading.Event = threading.Event()
        self.active:       bool = False
        self.current_finger: str | None = None
        self.done_fingers: list = []

_S = _StreamState()


def _push_frame(q: _q.Queue, frame: np.ndarray):
    if q.full():
        try: q.get_nowait()
        except _q.Empty: pass
    q.put(frame)


def _push_event(payload: dict):
    try: _S.events.put_nowait(payload)
    except _q.Full: pass


def _make_aruco_detector():
    d = aruco.getPredefinedDictionary(aruco.DICT_4X4_50)
    return aruco.ArucoDetector(d, aruco.DetectorParameters())


def _detect_finger(frame: np.ndarray):
    hsv  = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv,
                       np.array([0, 20, 60],   dtype=np.uint8),
                       np.array([25, 200, 255], dtype=np.uint8))
    frac = mask.sum() / 255.0 / (frame.shape[0] * frame.shape[1])
    return frac >= SKIN_FRACTION_MIN, frac


def _marker_center(corners):
    return corners[0][0].mean(axis=0)


def _capture_top_stream(cap, detector, finger: str, save_path: str) -> bool:
    recent = deque(maxlen=STABLE_FRAMES)
    countdown_start = None
    _S.force_capture.clear()
    _push_event({"type": "finger_start", "finger": finger.upper()})
    print(f"\n  [{finger}] 탑뷰 스트리밍 시작")

    while True:
        ret, frame = cap.read()
        if not ret:
            return False

        h, w = frame.shape[:2]
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        corners, ids, _ = detector.detectMarkers(gray)
        detected  = ids is not None and len(ids) > 0
        finger_ok, frac = _detect_finger(frame)

        if detected and finger_ok:
            cx, cy = _marker_center(corners)
            recent.append((cx, cy))
        else:
            recent.clear()
            countdown_start = None

        spread = None
        if len(recent) >= 2:
            xs = [p[0] for p in recent]; ys = [p[1] for p in recent]
            spread = max(max(xs) - min(xs), max(ys) - min(ys))

        if detected and finger_ok and len(recent) == STABLE_FRAMES:
            if spread is not None and spread <= STABLE_PX_THRESH:
                if countdown_start is None:
                    countdown_start = time.time()
                    _push_event({"type": "countdown_start", "finger": finger.upper()})
            else:
                countdown_start = None

        elapsed = 0.0
        countdown_val = None
        if countdown_start is not None:
            elapsed = time.time() - countdown_start
            countdown_val = max(1, int(COUNTDOWN_SEC - elapsed) + 1)

        # 오버레이
        disp = frame.copy()
        if detected:
            aruco.drawDetectedMarkers(disp, corners, ids)

        if countdown_val is not None:
            color = (0, 255, 0)
            cv2.rectangle(disp, (0, 0), (w-1, h-1), color, 12)
            cv2.putText(disp, str(countdown_val),
                        (w//2 - 60, h//2 + 80),
                        cv2.FONT_HERSHEY_SIMPLEX, 10, color, 20, cv2.LINE_AA)
            cv2.putText(disp, "가만히! 자동 촬영 중...",
                        (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.9, color, 2)
        else:
            color = (0,255,0) if (detected and finger_ok) else \
                    (0,165,255) if detected else (0,0,255)
            cv2.rectangle(disp, (0,0), (w-1, h-1), color, 8)
            label = (f"{finger.upper()}  |  마커: {'✓' if detected else '✗'}  |  "
                     f"손가락: {'✓' if finger_ok else '✗'}  |  피부: {frac*100:.0f}%")
            cv2.putText(disp, label, (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.75, color, 2)
            if detected and finger_ok and len(recent) > 0:
                bar_w = int((w - 20) * min(len(recent) / STABLE_FRAMES, 1.0))
                cv2.rectangle(disp, (10, h-25), (10+bar_w, h-10), color, -1)
                cv2.rectangle(disp, (10, h-25), (w-10, h-10), (150,150,150), 1)

        if CROP_BOTTOM_PX > 0:
            cv2.line(disp, (0, h-CROP_BOTTOM_PX), (w, h-CROP_BOTTOM_PX), (255,255,0), 2)
            cv2.putText(disp, "crop line", (8, h-CROP_BOTTOM_PX-6),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255,255,0), 1)

        _push_frame(_S.top_frame, disp)

        # 자동 / 수동 촬영
        captured = None
        if countdown_start is not None and elapsed >= COUNTDOWN_SEC:
            captured = frame.copy()
        if _S.force_capture.is_set():
            captured = frame.copy()
            _S.force_capture.clear()

        if captured is not None:
            y2 = h - CROP_BOTTOM_PX if CROP_BOTTOM_PX > 0 else h
            cv2.imwrite(save_path, captured[:y2, :])
            print(f"  [{finger}] 탑뷰 저장: {save_path}")
            _push_event({"type": "finger_captured", "finger": finger.upper()})
            return True


def _capture_side_stream(cap, finger: str, save_path: str) -> bool:
    _push_event({"type": "side_ready", "finger": finger.upper()})
    _S.force_capture.clear()
    deadline = time.time() + 30

    while time.time() < deadline:
        ret, frame = cap.read()
        if not ret:
            return False
        h, w = frame.shape[:2]
        disp = frame.copy()
        cv2.putText(disp,
                    f"[사이드] {finger.upper()}  |  웹에서 촬영 버튼 누르세요 ({max(0,int(deadline-time.time()))}s)",
                    (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200,200,0), 2)
        cv2.rectangle(disp, (0,0), (w-1,h-1), (180,180,0), 4)
        _push_frame(_S.side_frame, disp)

        if _S.force_capture.is_set():
            _S.force_capture.clear()
            cv2.imwrite(save_path, frame)
            print(f"  [{finger}] 사이드뷰 저장: {save_path}")
            return True
        time.sleep(0.03)

    print(f"  [{finger}] 사이드뷰 타임아웃 → brightness fallback")
    return False


def _capture_finger_both(cap_top, cap_side, detector, finger: str, local_dir: str):
    """탑뷰 + 사이드뷰 동시 캡처. force_capture 신호 하나로 두 카메라 동시 촬영."""
    top_path  = os.path.join(local_dir, f"{finger}_top.jpg")
    side_path = os.path.join(local_dir, f"{finger}_side.jpg")

    top_result  = [False]
    side_result = [False]

    def capture_top():
        top_result[0] = _capture_top_stream(cap_top, detector, finger, top_path)

    def capture_side():
        side_result[0] = _capture_side_stream(cap_side, finger, side_path)

    threads = [threading.Thread(target=capture_top)]
    if cap_side:
        threads.append(threading.Thread(target=capture_side))

    for t in threads:
        t.start()
    for t in threads:
        t.join()

    return top_result[0], side_result[0]


def _capture_all_fingers(userid: str, session: str, hand: str) -> str:
    local_dir = os.path.join(BASE, "photos", userid, session, hand)
    os.makedirs(local_dir, exist_ok=True)

    cap_top = cv2.VideoCapture(CAMERA_TOP, cv2.CAP_DSHOW)
    cap_top.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
    cap_top.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
    if not cap_top.isOpened():
        raise RuntimeError(f"탑뷰 카메라(인덱스 {CAMERA_TOP})를 열 수 없습니다.")

    cap_side = None
    if CAMERA_SIDE >= 0:
        _c = cv2.VideoCapture(CAMERA_SIDE, cv2.CAP_DSHOW)
        if _c.isOpened():
            cap_side = _c
        else:
            print(f"[Capture] 사이드 카메라(인덱스 {CAMERA_SIDE}) 없음 → brightness fallback")

    detector = _make_aruco_detector()
    _S.active = True
    _S.done_fingers = []

    try:
        for finger in FINGER_ORDER:
            _S.current_finger = finger
            _S.force_capture.clear()

            top_ok, _ = _capture_finger_both(cap_top, cap_side, detector, finger, local_dir)
            if not top_ok:
                print(f"  [{finger}] 탑뷰 실패 → 건너뜀")
                continue

            _S.done_fingers.append(finger)
            idx    = FINGER_ORDER.index(finger)
            next_f = FINGER_ORDER[idx + 1].upper() if idx + 1 < len(FINGER_ORDER) else None
            _push_event({
                "type": "finger_done", "finger": finger.upper(),
                "nextFinger": next_f, "doneCount": len(_S.done_fingers),
            })

        _S.current_finger = None
        _push_event({"type": "capture_complete", "doneCount": len(_S.done_fingers)})
    finally:
        _S.active = False
        cap_top.release()
        if cap_side:
            cap_side.release()

    return local_dir


def _measure_one_finger(finger: str, photos_root: str, results_root: str):
    top_path   = os.path.join(photos_root, f"{finger}_top.jpg")
    side_path  = os.path.join(photos_root, f"{finger}_side.jpg")
    finger_out = os.path.join(results_root, finger)
    os.makedirs(finger_out, exist_ok=True)

    if not os.path.isfile(top_path):
        print(f"  [{finger}] 탑뷰 사진 없음 → 건너뜀")
        return

    cmd = [
        sys.executable, os.path.join(_SCAN_DIR, "nail_measurer.py"),
        "--top", top_path, "--finger", finger,
        "--aruco-size", str(ARUCO_SIZE_MM), "--output", finger_out,
    ]
    if os.path.isfile(side_path):
        cmd += ["--ccurve-top", side_path]

    result = subprocess.run(cmd, cwd=_SCAN_DIR, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  [{finger}] 측정 실패: {result.stderr[-300:]}")
    else:
        print(f"  [{finger}] 측정 완료")


def _run_measure_only(userid: str, session: str, hand: str):
    photos_root  = os.path.join(BASE, "photos",  userid, session, hand)
    results_root = os.path.join(BASE, "results", userid, session, hand)

    # 5손가락 병렬 측정
    threads = [
        threading.Thread(
            target=_measure_one_finger,
            args=(finger, photos_root, results_root),
            daemon=True,
        )
        for finger in FINGER_ORDER
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()


def _upload_results(userid: str, session: str, hand: str):
    results_root = os.path.join(BASE, "results", userid, session, hand)
    s3_prefix    = f"results/{userid}/{session}/{hand}"
    for finger in FINGER_ORDER:
        finger_dir = os.path.join(results_root, finger)
        for fname in [f"{finger}_annotated.jpg", "nail_measurements.json", "profile.json"]:
            lp = os.path.join(finger_dir, fname)
            if os.path.isfile(lp):
                _upload_file(lp, f"{s3_prefix}/{finger}/{fname}")


def _build_callback_data(userid: str, session: str, hand: str) -> dict:
    results_root = os.path.join(BASE, "results", userid, session, hand)
    photos_root  = os.path.join(BASE, "photos",  userid, session, hand)
    s3_prefix    = f"results/{userid}/{session}/{hand}"

    fingers_data = []
    skin_tones   = []
    sizes        = []

    for finger in FINGER_ORDER:
        finger_dir        = os.path.join(results_root, finger)
        measurements_path = os.path.join(finger_dir, "nail_measurements.json")
        profile_path      = os.path.join(finger_dir, "profile.json")
        if not (os.path.exists(measurements_path) and os.path.exists(profile_path)):
            continue
        try:
            with open(measurements_path) as f:
                mj = json.load(f)
            fd = mj.get("by_finger", {}).get(finger, {})
            with open(profile_path) as f:
                prof = json.load(f)
            summary   = prof.get("summary") or {}
            nail_size = summary.get("nail_size", "average")
            skin_tone = fd.get("skin_tone_hex", "")
            if skin_tone: skin_tones.append(skin_tone)
            sizes.append(nail_size)
            # profile.json fingers 배열에서 이 손가락 데이터 찾기
            finger_prof = next(
                (f for f in prof.get("fingers", []) if f.get("finger") == finger),
                {}
            )

            fingers_data.append({
                "finger":            finger.upper(),
                "annotatedImageUrl": _s3_url(f"{s3_prefix}/{finger}/{finger}_annotated.jpg"),
                "measurements": {
                    # 측정 수치
                    "widthMm":           safe_float(fd.get("width_mm")),
                    "lengthMm":          safe_float(fd.get("length_mm")),
                    "correctedLengthMm": safe_float(fd.get("corrected_length_mm")),
                    "cCurveMm":          safe_float(fd.get("c_curve_mm")),
                    "arcRadiusMm":       safe_float(fd.get("arc_radius_mm")),
                    "thicknessMm":       safe_float(fd.get("thickness_mm")),
                    # profile.json 논문 기준 비교값
                    "widthVsAvgMm":  safe_float(finger_prof.get("width_vs_avg_mm")),
                    "lengthVsAvgMm": safe_float(finger_prof.get("length_vs_avg_mm")),
                    "widthSize":     finger_prof.get("width_size", "average"),
                    "lengthSize":    finger_prof.get("length_size", "average"),
                    "nailSize":      finger_prof.get("nail_size", "average"),
                },
                "size": nail_size,
            })
        except Exception as e:
            print(f"  [{finger}] 결과 읽기 오류: {e}")

    skin_tone_hex = skin_tones[0] if skin_tones else "#C8A882"
    overall_size  = max(set(sizes), key=sizes.count) if sizes else "average"
    recommended_colors = []
    season_code = season_name_ko = None

    from personal_color import diagnose_personal_color
    for finger in ("index", "middle", "ring", "thumb"):
        d = diagnose_personal_color(os.path.join(photos_root, f"{finger}_top.jpg"))
        if d and "error" not in d:
            skin_tone_hex      = d["skinToneHex"]
            recommended_colors = d["recommendedColors"]
            season_code        = d["seasonCode"]
            season_name_ko     = d["seasonNameKo"]
            break

    # summary_text: 왼손 profile.json summary에서 가져옴
    summary_text = ""
    for finger in FINGER_ORDER:
        profile_path = os.path.join(results_root, finger, "profile.json")
        if os.path.exists(profile_path):
            try:
                with open(profile_path) as f:
                    _p = json.load(f)
                summary_text = _p.get("summary", {}).get("summary_text", "")
                if summary_text:
                    break
            except Exception:
                pass

    return {
        "shape":             "round",
        "skinToneHex":       skin_tone_hex,
        "overallSize":       overall_size,
        "summaryText":       summary_text,
        "recommendedColors": recommended_colors,
        "seasonCode":        season_code,
        "seasonNameKo":      season_name_ko,
        "fingers":           fingers_data,
    }


def _run_measure_and_callback(userid: str, session: str, hand: str, callback_url: str):
    try:
        # 1. 캡처 (카메라 사용) — 끝나는 순간 _S.active = False 됨
        _capture_all_fingers(userid, session, hand)

        # 2. 측정은 백그라운드로 분리 — 캡처 끝나자마자 다음 손 캡처 가능
        def _background_measure():
            try:
                _run_measure_only(userid, session, hand)
                _upload_results(userid, session, hand)
                data = _build_callback_data(userid, session, hand)
                requests.post(callback_url, json=data)
                print(f"[Pipeline] 콜백 완료: {hand}")
            except Exception as e:
                print(f"[Pipeline] 측정 오류: {e}")
                requests.post(callback_url, json={"success": False, "message": str(e)})

        threading.Thread(target=_background_measure, daemon=True).start()

    except Exception as e:
        print(f"[Scan] 오류: {e}")
        requests.post(callback_url, json={"success": False, "message": str(e)})


def _run_stl_and_callback(userid: str, session: str, hand: str, shape: str, callback_url: str):
    try:
        results_root = os.path.join(BASE, "results", userid, session, hand)
        stl_dir      = os.path.join(results_root, "stl")
        os.makedirs(stl_dir, exist_ok=True)
        s3_prefix    = f"results/{userid}/{session}/{hand}"

        for finger in FINGER_ORDER:
            mp = os.path.join(results_root, finger, "nail_measurements.json")
            if not os.path.isfile(mp):
                continue
            subprocess.run([
                sys.executable, os.path.join(_SCAN_DIR, "nail_exact_stl.py"),
                "--input", mp, "--shape", shape, "--finger", finger, "--output", stl_dir,
            ], cwd=_SCAN_DIR, capture_output=True)

        from s3_upload import upload_folder
        upload_folder(stl_dir, f"{s3_prefix}/stl")

        fingers_data = [
            {"finger": f.upper(),
             "stlUrl": _s3_url(f"{s3_prefix}/stl/nail_{f}_{shape}.stl")}
            for f in FINGER_ORDER
        ]
        requests.post(callback_url, json={"fingers": fingers_data})
    except Exception as e:
        requests.post(callback_url, json={"success": False, "message": str(e)})


# ══════════════════════════════════════════════════════════════
# 요청 모델
# ══════════════════════════════════════════════════════════════

class MeasureRequest(BaseModel):
    userid: str; session: str; hand: str; callbackUrl: str

class StlRequest(BaseModel):
    userid: str; session: str; hand: str; shape: str; callbackUrl: str

class MergeOneHandRequest(BaseModel):
    userid: str; session: str; hand: str
    shapes: dict[str, str]; callbackUrl: str
    printCallbackUrl: str | None = None

class MergeBothHandsRequest(BaseModel):
    userid: str; leftSession: str; rightSession: str
    leftShapes: dict[str, str]; rightShapes: dict[str, str]
    callbackUrl: str; printCallbackUrl: str | None = None

class StartPrintRequest(BaseModel):
    mergedModelUrl: str; outputDir: str; callbackUrl: str


# ══════════════════════════════════════════════════════════════
# 엔드포인트
# ══════════════════════════════════════════════════════════════

@app.on_event("startup")
def _startup():
    pass  # 프린터는 /print/start 호출 시 연결


@app.get("/health")
def health():
    return {"status": "ok"}


# ── 스캔 ─────────────────────────────────────────────────────

@app.post("/analyze/measure")
def analyze_measure(request: MeasureRequest):
    threading.Thread(
        target=_run_measure_and_callback,
        args=(request.userid, request.session, request.hand, request.callbackUrl),
        daemon=True,
    ).start()
    return {"status": "started", "message": "스캔이 시작되었습니다. 카메라 화면을 확인하세요."}


@app.post("/analyze/stl")
def analyze_stl(request: StlRequest):
    threading.Thread(
        target=_run_stl_and_callback,
        args=(request.userid, request.session, request.hand, request.shape, request.callbackUrl),
        daemon=True,
    ).start()
    return {"status": "started", "message": "STL 생성이 시작되었습니다."}


def _placeholder_jpeg(text: str = "") -> bytes:
    img = np.zeros((480, 640, 3), dtype=np.uint8)
    _, jpeg = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 60])
    return jpeg.tobytes()


@app.get("/stream/top")
def stream_top():
    placeholder = _placeholder_jpeg("Scan ready")
    def generate():
        while True:
            try:
                frame = _S.top_frame.get(timeout=0.5)
                _, jpeg = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
                yield b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + jpeg.tobytes() + b'\r\n'
            except _q.Empty:
                yield b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + placeholder + b'\r\n'
    return StreamingResponse(generate(), media_type='multipart/x-mixed-replace; boundary=frame')


@app.get("/stream/side")
def stream_side():
    placeholder = _placeholder_jpeg("Side ready")
    def generate():
        while True:
            try:
                frame = _S.side_frame.get(timeout=0.5)
                _, jpeg = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
                yield b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + jpeg.tobytes() + b'\r\n'
            except _q.Empty:
                yield b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + placeholder + b'\r\n'
    return StreamingResponse(generate(), media_type='multipart/x-mixed-replace; boundary=frame')


@app.get("/status/events")
async def status_events():
    async def generate():
        while True:
            if not _S.events.empty():
                yield f"data: {json.dumps(_S.events.get())}\n\n"
            else:
                yield ": keepalive\n\n"
            await asyncio.sleep(0.1)
    return StreamingResponse(generate(), media_type='text/event-stream')


@app.post("/capture/force")
def capture_force():
    _S.force_capture.set()
    return {"ok": True, "finger": _S.current_finger}


@app.get("/capture/status")
def capture_status():
    return {"active": _S.active, "currentFinger": _S.current_finger, "doneFinger": _S.done_fingers}


# ── 프린터 ───────────────────────────────────────────────────

@app.get("/print/status")
def print_status():
    try:
        return {"success": True, **_fetch_printer_status()}
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.post("/print/merge")
def merge_one_hand(request: MergeOneHandRequest):
    threading.Thread(
        target=_run_merge_one_hand,
        args=(request.userid, request.session, request.hand, request.shapes,
              request.callbackUrl, request.printCallbackUrl),
        daemon=True,
    ).start()
    return {"status": "started", "message": "병합이 시작되었습니다."}


@app.post("/print/merge-both")
def merge_both(request: MergeBothHandsRequest):
    threading.Thread(
        target=_run_merge_both_hands,
        args=(request.userid, request.leftSession, request.rightSession,
              request.leftShapes, request.rightShapes,
              request.callbackUrl, request.printCallbackUrl),
        daemon=True,
    ).start()
    return {"status": "started", "message": "양손 병합이 시작되었습니다."}


@app.post("/print/start")
def start_print(request: StartPrintRequest):
    threading.Thread(
        target=_run_slice_and_print,
        args=(request.mergedModelUrl, request.outputDir, request.callbackUrl),
        daemon=True,
    ).start()
    return {"status": "started", "message": "슬라이싱 및 출력이 시작되었습니다."}


# ── 카메라 인덱스 설정 (웹 UI에서 카메라 선택용) ─────────────
@app.get("/camera/config")
def get_camera_config():
    """현재 카메라 설정 조회."""
    return {"top": CAMERA_TOP, "side": CAMERA_SIDE}

@app.post("/camera/config")
def set_camera_config(top: int = 0, side: int = -1):
    """카메라 인덱스 변경. 스캔 시작 전에 호출해야 적용됨."""
    global CAMERA_TOP, CAMERA_SIDE
    CAMERA_TOP = top
    CAMERA_SIDE = side
    return {"ok": True, "top": CAMERA_TOP, "side": CAMERA_SIDE}