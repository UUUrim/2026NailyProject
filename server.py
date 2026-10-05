"""
server.py — Naily 통합 서버 (스캔 + 프린터)
--------------------------------------------
스캔 서버(scan/_legacy_server.py, 미사용 레거시)와 프린터 서버(printer/server.py)를 하나로 합쳐
ngrok 터널 하나만으로 EC2 Spring Boot와 통신한다.

Usage:
    uvicorn server:app --host 0.0.0.0 --port 8000 --reload

엔드포인트:
  [공통]
    GET  /health

  [스캔]
    POST /analyze/measure     — 스캔 시작 (카메라 촬영 → 측정 → 콜백; measurements.json은 로컬에만 저장)
    POST /analyze/stl         — STL 생성 → S3 업로드 → 콜백
<<<<<<< HEAD
    GET  /stream/top          — 탑뷰 MJPEG 스트림 (큐티클 가이드는 프론트가 /capture/stability의 guide로 그림)
=======
    POST /analyze/measurements/merge-both — 양손 measurements.json 통합 → S3 업로드 → 콜백
    GET  /stream/top          — 탑뷰 MJPEG 스트림 (ArUco 가이드선 포함)
>>>>>>> e045054c81304a0fbd9571d72ad255ed0a1ff19f
    GET  /stream/side         — 사이드뷰 MJPEG 스트림 (오버레이 없음)
    GET  /status/events       — SSE: 손가락 촬영 진행상황
    POST /capture/force       — 수동 촬영 트리거 (웹 "지금 촬영" 버튼)
    GET  /capture/status      — 현재 촬영 세션 상태
    GET  /capture/stability   — 탑뷰 정확도 게이지 (ratio/ready)

  [폰 사이드뷰 카메라] — CAMERA_SIDE = -2 일 때 물리 웹캠 대신 사용
    GET  /phone/side          — 폰 브라우저에서 여는 카메라 페이지
    POST /phone/side/frame    — 폰 → 서버: 라이브 프리뷰 프레임 업로드 (~1fps)
    GET  /phone/side/status   — 폰 → 서버: 고화질 촬영 요청 여부 폴링
    POST /phone/side/photo    — 폰 → 서버: 고화질 원본 사진 업로드

  [폰 사이드뷰 단독 테스트] — 전체 스캔 플로우 없이 c-curve 사진만 뽑아보는 도구
    GET  /test/side           — 데스크톱에서 여는 촬영 컨트롤 페이지 (라이브 프리뷰 + 촬영 버튼)
    POST /test/side/capture   — 폰에 고화질 촬영 요청 → test_captures/ 에 저장

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
from concurrent.futures import ThreadPoolExecutor

# Windows console's default stdout encoding is the system codepage (cp949 on
# Korean Windows), which can't encode every character this file and its
# subprocesses print (em-dashes, arrows). An unencodable print() raises
# UnicodeEncodeError and kills the process it's running in - fatal here since
# this is the long-lived server itself, not a one-off subprocess. Same fix
# already applied in nail_measurer.py/measure_ccurve.py.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

# uvicorn logs every request ("GET /phone/side/status HTTP/1.1" 200 OK) at
# INFO level through this logger - with the phone side-camera preview
# polling /phone/side/status ~1x/second, that drowns out the print()
# diagnostics this file actually cares about (measurement stages, S3
# uploads, errors). Runs at import time, so it's in effect before uvicorn
# starts serving regardless of how it's launched (CLI or programmatically) -
# doesn't touch print() or logging.error/warning calls, which still show.
import logging
logging.getLogger("uvicorn.access").disabled = True

import boto3
import cv2
import numpy as np
import requests
from fastapi import FastAPI, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel

# ── 프린터 관련 모듈 (printer/ 디렉터리)
# 통합 서버를 어느 디렉터리에 두든 동작하도록 sys.path 처리
_THIS_DIR    = os.path.dirname(os.path.abspath(__file__))
_PRINTER_DIR = os.path.join(_THIS_DIR, "printer")   # 필요하면 경로 조정
_SCAN_DIR    = os.path.join(_THIS_DIR, "scan")       # 필요하면 경로 조정
for _p in [_PRINTER_DIR, _SCAN_DIR, _THIS_DIR]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

from dotenv import load_dotenv
load_dotenv(os.path.join(_SCAN_DIR, ".env"))

from merge_fingers   import merge_hand, merge_both_hands          # printer/
from slice_and_print import (slice_and_send_to_printer,           # printer/
                              PRINTER_IP, PRINTER_ACCESS_CODE, PRINTER_SERIAL)
from skin_color import recommend_nail_colors, lab_to_rgb_hex      # scan/
from nail_measurer import (recommend_nail_shape, merge_hand_measurements,  # scan/
                            classify_size_totals)

# 탑뷰 라이브 프리뷰 - nail_live.py(로컬 CLI 도구)와 동일한 실시간 측정 화면을
# 웹 스트림에도 그대로 재사용한다. 매 프레임 nail_measurer로 실측정을 돌리되,
# 자동 촬영은 없음 - 탑뷰/사이드뷰 모두 조작자가 촬영 버튼을 눌러야만 저장된다.
from nail_live import (MeasureWorker, compose as _live_compose,     # scan/
                        median_result as _live_median_result,
                        MEDIAN_N as _LIVE_MEDIAN_N,
                        stability as _live_stability,
                        detect_marker_only as _live_detect_marker_only,
                        guide_line_row as _live_guide_line_row,
                        guide_line_offset_mm as _live_guide_offset_mm,
                        marker_mm_per_px as _live_marker_mm_per_px)

# ─────────────────────────────────────────────────────────────
BASE   = _THIS_DIR
BUCKET = "naily-scans"
FINGER_ORDER = ["thumb", "index", "middle", "ring", "pinky"]

# 폰 사이드뷰 단독 촬영 테스트(GET/POST /test/side*)가 저장하는 폴더.
# 미리 만들어둬야 아래 StaticFiles 마운트가 앱 시작 시 실패하지 않는다.
TEST_CAPTURE_DIR = os.path.join(BASE, "test_captures")
os.makedirs(TEST_CAPTURE_DIR, exist_ok=True)

# ── 카메라 설정 ───────────────────────────────────────────────
# 이 데스크톱은 물리 웹캠이 C920 하나뿐이고 OpenCV에서 인덱스 0으로 잡힘
# (인덱스 1은 존재하지 않는 장치라 VideoCapture.open이 예외를 던지고 실패함).
CAMERA_TOP        = 0       # 탑뷰: USB 웹캠 (C920)
CAMERA_SIDE       = -2      # 사이드/c-curve: 폰 카메라(/phone/side).  -1: 사용 안 함
ARUCO_SIZE_MM     = 20.0
CROP_BOTTOM_PX    = 0       # 탑뷰 하단 crop 픽셀 (0 = 크롭 없음; 더 이상 필요하지 않음)
# 탑뷰 상단 crop 픽셀 (0 = 크롭 없음). 리그 상단 가장자리의 빨간 물체(1080p 기준
# y≈0~95)가 피부색 임계값을 통과해 손가락으로 오인식되던 문제 - 카메라에서
# 읽은 직후 잘라내서 라이브 측정/화면/저장 사진이 모두 같은 크롭을 쓴다.
CROP_TOP_PX       = 120
# 탑뷰 웹 스트림에서 ArUco 마커를 가리기 위한 왼쪽 crop 설정 (측정용 저장
# 사진에는 영향 없음 — _capture_top_stream 참고). 마커는 매트에 고정된
# 위치라 오른쪽 끝 + 여백을 한 번 잡으면 그 finger 촬영 내내 그대로 쓴다.
MARKER_HIDE_MARGIN_PX      = 40    # 마커 오른쪽 끝에서 추가로 더 잘라낼 여백
# 손가락 자리의 가로 중심 — 마커 오른쪽 끝에서 손가락 중심까지 거리(mm).
# 실제 촬영 사진 17장(09-04, 세션 145~149)에서 손가락 중심이 49~64mm,
# 중앙값 56mm에 놓여 있었다. 박스/매트 배치가 바뀌면 여기만 조정한다.
FINGER_SLOT_FROM_MARKER_MM = 55.0
# 화면 창의 가로/세로 비율 — 프론트 .hand-scan-fs__feed의 aspect-ratio(11/8)와
# 같게 맞춰서 브라우저의 object-fit: cover가 추가로 잘라내지 않게 한다.
TOP_VIEW_ASPECT            = 11 / 8
# 큐티클 라인이 화면 높이에서 놓일 위치(위=0, 아래=1). 손끝과 안내 라벨이
# 들어갈 위쪽 여백을 두면서 손가락이 들어오는 아래쪽도 조금 보이게 한다.
# 프레임 아래 끝에 막히면 그보다 위에 놓인다.
TOP_VIEW_CUTICLE_Y         = 0.72
TOP_VIEW_MIN_W_PX          = 480   # 창이 이보다 좁아지면 예전 방식(마커 왼쪽만 잘라냄)으로
# 손가락이 잠깐 인식 안 된 한두 측정 사이클 동안 가이드 선이 마커 기준
# 추정 위치로 튀지 않도록 마지막 실측 guide_y를 유지하는 시간.
GUIDE_LIVE_HOLD_SEC  = 0.5

# ─────────────────────────────────────────────────────────────
app = FastAPI(title="Naily 통합 서버")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# /test/side/capture가 저장한 사진을 브라우저에서 바로 열어볼 수 있게.
app.mount("/test_captures", StaticFiles(directory=TEST_CAPTURE_DIR), name="test_captures")


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


_s3_client_singleton = None
_s3_client_lock = threading.Lock()

def _s3_client():
    """Cached boto3 client, built once and reused.

    Result-page latency was traced back to _upload_results calling this
    once per file (up to 15 times per hand) - constructing a fresh
    boto3.client() each time is not free (credential setup, connection
    pool init), so that was 15 redundant client builds stacked on top of
    the actual uploads. boto3 clients are safe to share across threads for
    making calls concurrently, so one client works for the whole process.
    """
    global _s3_client_singleton
    if _s3_client_singleton is None:
        with _s3_client_lock:
            if _s3_client_singleton is None:
                _s3_client_singleton = boto3.client(
                    "s3",
                    aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
                    aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
                    region_name=os.environ.get("AWS_DEFAULT_REGION", "ap-northeast-2"),
                )
    return _s3_client_singleton


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
    if str(p.get_current_state()) == 'UNKNOWN':
            time.sleep(3)  # 처음 연결 시만 대기
    return {
        "state":            str(p.get_current_state()),
        "percentage":       p.get_percentage(),
        "currentLayer":     p.current_layer_num(),
        "totalLayer":       p.total_layer_num(),
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

        # 완료 감지 폴링
        _poll_until_complete(callback_url)
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

def _poll_until_complete(callback_url: str, interval: int = 10, timeout: int = 7200):
    start = time.time()
    while time.time() - start < timeout:
        time.sleep(interval)
        try:
            status = _fetch_printer_status()
            state = status.get("state", "")
            print(f"[Poll] 프린터 상태: {state}")  # ← 로그 확인용
            if "FINISH" in state.upper() or "IDLE" in state.upper():
                requests.post(callback_url, json={"success": True, "status": "COMPLETED"})
                return
        except Exception as e:
            print(f"[Poll] 폴링 오류: {e}")

def _run_slice_and_print(merged_model_url, output_dir, callback_url):
    try:
        local_3mf = os.path.join(output_dir, "input_for_slicing.3mf")
        _download_3mf_from_url(merged_model_url, local_3mf)
        gcode_path = slice_and_send_to_printer(local_3mf, output_dir)

        # 출력 시작 콜백
        requests.post(callback_url, json={
            "success": True, "status": "PRINTING", "gcodePath": gcode_path})

        # 완료 감지 폴링
        _poll_until_complete(callback_url)

    except Exception as e:
        requests.post(callback_url, json={"success": False, "message": str(e)})


def _poll_until_complete(callback_url: str, interval: int = 10, timeout: int = 7200):
    """출력 완료될 때까지 폴링, 완료되면 콜백으로 COMPLETED 전송"""
    start = time.time()
    while time.time() - start < timeout:
        time.sleep(interval)
        try:
            status = _fetch_printer_status()
            state = status.get("state", "")
            if "FINISH" in state.upper() or "IDLE" in state.upper():
                requests.post(callback_url, json={"success": True, "status": "COMPLETED"})
                return
        except Exception:
            pass  # 연결 끊겨도 폴링 계속


# ══════════════════════════════════════════════════════════════
# 스캔 관련
# ══════════════════════════════════════════════════════════════

# ── 스트리밍 상태 ─────────────────────────────────────────────
class _StreamState:
    def __init__(self):
        self.top_frame:    _q.Queue = _q.Queue(maxsize=1)
        self.side_frame:   _q.Queue = _q.Queue(maxsize=1)
        self.events:       _q.Queue = _q.Queue(maxsize=200)
        # Separate Events per stream, not one shared flag: _capture_top_stream
        # and _capture_side_stream run as two threads each doing their own
        # is_set()-then-clear() on the signal, and with a single shared Event
        # that's a check-then-act race - whichever thread's poll loop wins
        # clears it before the other thread's next iteration sees it, so the
        # loser silently misses the capture (the side stream has no deadline
        # of its own, so a lost race there just leaves it waiting for the
        # operator to press capture again instead of ever timing out).
        self.force_capture_top:  threading.Event = threading.Event()
        self.force_capture_side: threading.Event = threading.Event()
        # Set while _capture_side_stream is actively driving _S.side_frame
        # for one finger, so the idle phone-preview loop (which fills the
        # feed the rest of the time) knows to back off instead of fighting
        # it for the same queue slot.
        self.side_capture_busy: threading.Event = threading.Event()
        # Same idea for the top webcam: set while _capture_top_stream owns
        # cap_top for one finger, so the idle top-preview loop knows to
        # back off instead of reading the same cv2.VideoCapture at once.
        self.top_capture_busy:  threading.Event = threading.Event()
        self.active:       bool = False
        self.current_finger: str | None = None
        self.done_fingers: list = []
        # 탑뷰 웹 스트림에 보낼 화면 창 (x0, y0, x1, y1, 원본 프레임 px) —
        # 마커는 가리고 손가락 자리를 가운데 둔다(_top_view_rect). 마커가
        # 처음 잡힐 때 정해지고, idle preview 루프(_top_camera_idle_preview_loop)도
        # 같은 창을 써서 손가락 사이 대기 화면에서도 마커가 드러나지 않게 한다.
        # None이면 아직 마커를 못 잡은 것.
        self.top_view_rect: tuple | None = None
        # 손가락 자리 가로 중심(원본 프레임 px) — 가이드 실루엣이 놓이는 열.
        self.finger_slot_x: float = 0.0
        # 마커를 처음 잡았을 때의 코너 — 손가락이 아직 없을 때도 프론트
        # 가이드의 큐티클 라인 위치와 실루엣 크기(mm/px)를 계산하는 데 쓴다.
        self.marker_corners = None
        # 실측 중인 guide_y(원본 프레임 px)와 마지막으로 확인된 시각. 측정이
        # 실제로 쓰는 행이라 있으면 마커 기준 추정보다 항상 우선한다.
        self.live_guide: tuple | None = None
        # 탑뷰 측정 정확도 게이지 — 프론트가 /capture/stability로 폴링해서
        # 화면 왼쪽 게이지 바를 채운다. ratio: 0~1 (최근 측정 이력이 얼마나
        # 찼는지), ready: 최근 MEDIAN_N개 측정의 W/L이 서로 합의된 상태
        # (nail_live.stability와 동일한 기준) — true일 때만 촬영 버튼 활성화.
        self.stability: dict = {"ratio": 0.0, "ready": False}
        # 손가락별 라이브 측정 평균값 — 촬영 순간 게이지를 채운 그 안정 구간
        # (nail_live.stability가 합의로 판단한 연속 프레임들)의 width_mm/
        # length_mm 평균을 담아둔다. 키는 (hand, finger) — 왼손/오른손이
        # 같은 손가락 이름을 쓰므로 섞이지 않게 구분. _measure_one_finger가
        # 오프라인 재측정 직후 이 값으로 최종 width_mm/length_mm을 덮어써서,
        # "여러 프레임이 합의한 값"이 실제로 최종 결과에 반영되게 한다 —
        # 재측정 자체는 사진 한 장짜리 단일 프레임 값이라 라이브 평균보다
        # 노이즈에 더 취약하기 때문.
        self.live_wl: dict = {}

_S = _StreamState()


class PhoneCamera:
    """cv2.VideoCapture-shaped source fed by a phone browser over HTTP.

    .read() mirrors VideoCapture so _capture_side_stream can treat it like any
    other cap. The phone posts a low-res preview (~1fps) that .read() returns
    for the live display; request_capture()/capture_full() are the extra pair
    that get the phone to take one full-sensor-resolution photo on demand, so
    the accepted image isn't limited to preview quality.

    The phone is mounted upright in the capture rig, but the camera ends up
    facing the finger upside down - confirmed by rotating a real captured
    photo through all four orientations and checking which one shows the
    finger resting on the rig's table with the ArUco card flat beside it,
    the way the rig is actually built. Rotating here, at the single point
    frames enter the system, means the live preview, the saved side.jpg and
    the debug overlay all agree - nothing downstream needs to know the phone
    is mounted upside down.
    """

    ROTATE = cv2.ROTATE_180

    def __init__(self):
        self._lock            = threading.Lock()
        self._preview         = None
        self._full_res        = None
        self._capture_wanted  = threading.Event()
        self._full_res_ready  = threading.Event()
        self._last_preview_t  = 0.0

    def isOpened(self):
        return True

    def is_connected(self, max_age: float = 3.0) -> bool:
        """폰 카메라 페이지가 최근 max_age초 안에 프리뷰를 보냈는지 - 폰 없이
        탑뷰만으로 테스트할 때 사이드뷰 고화질 촬영 타임아웃(8초)을 손가락마다
        기다리지 않고 바로 건너뛰기 위한 판단 기준."""
        return time.time() - self._last_preview_t < max_age

    def read(self):
        with self._lock:
            frame = self._preview
        return (True, frame.copy()) if frame is not None else (False, None)

    def push_preview(self, frame: np.ndarray):
        with self._lock:
            self._preview = cv2.rotate(frame, self.ROTATE)
            self._last_preview_t = time.time()

    def capture_wanted(self) -> bool:
        return self._capture_wanted.is_set()

    def request_capture(self):
        self._full_res_ready.clear()
        self._capture_wanted.set()

    def push_full_res(self, frame: np.ndarray):
        with self._lock:
            self._full_res = cv2.rotate(frame, self.ROTATE)
        self._capture_wanted.clear()
        self._full_res_ready.set()

    def capture_full(self, timeout: float = 8.0):
        if self._full_res_ready.wait(timeout):
            with self._lock:
                return self._full_res
        return None

    def release(self):
        pass   # long-lived singleton; nothing to tear down between sessions


_phone_cam = PhoneCamera()

# 탑뷰 카메라를 손(왼손→오른손) 사이마다 release()/reopen 하지 않고 세션 내내 계속
# 잡고 있는다. Windows DSHOW는 방금 놓아준 카메라를 곧바로 다시 열 때 예외를 던지는
# 경우가 잦아서(_capture_all_fingers의 재시도 루프로도 못 잡을 만큼 자주), 아예
# 재오픈 자체를 안 하는 쪽이 근본적으로 더 안전하다. /camera/config로 인덱스가
# 바뀔 때만 새로 연다.
_top_cam_lock  = threading.Lock()
_top_cam       = None
_top_cam_index = None

def _get_top_cam() -> cv2.VideoCapture:
    global _top_cam, _top_cam_index
    with _top_cam_lock:
        if _top_cam is not None and _top_cam_index == CAMERA_TOP and _top_cam.isOpened():
            return _top_cam

        if _top_cam is not None:
            _top_cam.release()
            _top_cam = None

        cap = None
        for attempt in range(4):
            try:
                cap = cv2.VideoCapture(CAMERA_TOP, cv2.CAP_DSHOW)
                if cap.isOpened():
                    break
                cap.release()
            except Exception as e:
                # DSHOW가 가끔 "raised unknown C++ exception!"과 함께 첫 시도를 그냥
                # 실패시킴 - isOpened()가 False인 경우만 재시도하면 이 예외는 못 잡아서
                # 재시도 루프 자체가 통째로 건너뛰어지고 1번 시도만에 바로 실패한다.
                print(f"[Capture] 탑뷰 카메라 열기 예외 (시도 {attempt + 1}/4): {e!r} - 재시도")
                cap = None
                time.sleep(0.8)
                continue
            print(f"[Capture] 탑뷰 카메라 열기 실패 (시도 {attempt + 1}/4) - 재시도")
            time.sleep(0.8)

        if cap is None or not cap.isOpened():
            raise RuntimeError(f"탑뷰 카메라(인덱스 {CAMERA_TOP})를 열 수 없습니다.")

        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
        _top_cam       = cap
        _top_cam_index = CAMERA_TOP
        return _top_cam


def _crop_top(frame: np.ndarray) -> np.ndarray:
    return frame[CROP_TOP_PX:, :] if CROP_TOP_PX > 0 else frame


def _push_frame(q: _q.Queue, frame: np.ndarray):
    if q.full():
        try: q.get_nowait()
        except _q.Empty: pass
    q.put(frame)


def _push_event(payload: dict):
    try: _S.events.put_nowait(payload)
    except _q.Full: pass


def _phone_side_idle_preview_loop():
    """Keeps /stream/side live between per-finger capture windows.

    _capture_side_stream only feeds _S.side_frame while it's actively
    waiting on ONE finger's side photo (now unbounded - it waits until the
    operator captures) - outside that window nothing pushes a frame, so the
    feed drops to the black placeholder and
    the phone-camera view on the web page looks like it keeps
    connecting/disconnecting once per finger. The phone's preview sits in
    memory the whole time regardless of scan state (PhoneCamera.read() is
    just a lock-protected read, safe to call from any thread), so keep
    pushing it here whenever _capture_side_stream isn't already driving the
    display itself.
    """
    while True:
        if CAMERA_SIDE == -2 and not _S.side_capture_busy.is_set():
            ret, frame = _phone_cam.read()
            if ret:
                _push_frame(_S.side_frame, frame)
        time.sleep(0.15)


def _top_view_rect(frame_w: int, frame_h: int, corners) -> tuple[tuple, float]:
    """탑뷰 웹 스트림 화면 창 (x0, y0, x1, y1)과 손가락 자리 가로 중심 x.

    예전엔 마커 왼쪽만 잘라내고 나머지를 전부 보여줘서, 화면 중심이 실제
    손가락 자리보다 한참 오른쪽에 있었다(손가락이 왼쪽으로 치우쳐 보임).
    이제 손가락 자리(마커 오른쪽 끝 + FINGER_SLOT_FROM_MARKER_MM)를 중심으로
    좌우 대칭 창을 잡는다 — 왼쪽 끝은 마커를 가리는 선, 오른쪽 끝은 프레임
    끝을 넘지 않는 한에서 가장 넓게. 세로는 TOP_VIEW_ASPECT에 맞춰 정하고,
    큐티클 라인이 TOP_VIEW_CUTICLE_Y 높이에 오도록 위치시킨다.
    """
    mpp = _live_marker_mm_per_px(corners, ARUCO_SIZE_MM)
    marker_right = float(corners[:, 0].max())
    left_limit = marker_right + MARKER_HIDE_MARGIN_PX
    slot_x = marker_right + FINGER_SLOT_FROM_MARKER_MM / mpp
    half_w = min(slot_x - left_limit, frame_w - slot_x)

    if half_w * 2 < TOP_VIEW_MIN_W_PX:
        # 손가락 자리가 마커나 프레임 끝에 너무 붙어 있어 대칭 창이 너무
        # 작아지는 배치 — 예전처럼 마커 왼쪽만 잘라내고 나머지를 보여준다.
        x0 = int(min(left_limit, frame_w - TOP_VIEW_MIN_W_PX))
        return (x0, 0, frame_w, frame_h), (x0 + frame_w) / 2

    view_w = min(half_w * 2, frame_h * TOP_VIEW_ASPECT)
    view_h = view_w / TOP_VIEW_ASPECT
    cuticle_y = _live_guide_line_row(corners, slot_x, _live_guide_offset_mm("") / mpp)
    y0 = min(max(cuticle_y - view_h * TOP_VIEW_CUTICLE_Y, 0.0), frame_h - view_h)
    x0 = slot_x - view_w / 2
    rect = (int(round(x0)), int(round(y0)),
            int(round(x0 + view_w)), int(round(y0 + view_h)))
    return rect, slot_x


def _top_view(frame: np.ndarray) -> np.ndarray:
    """웹 스트림에 보낼 부분만 잘라낸다 — 마커를 아직 못 잡았으면 원본 그대로."""
    rect = _S.top_view_rect
    if rect is None:
        return frame
    x0, y0, x1, y1 = rect
    return frame[y0:y1, x0:x1]


def _remember_marker(frame: np.ndarray):
    """마커를 처음 잡았을 때 한 번만 위치를 기록한다 — 웹 스트림 화면 창과
    프론트 가이드 계산용 코너/손가락 자리. 마커는 매트에 고정돼 있어 한 번
    잡히면 세션 내내 안 바뀌므로 이후엔 바로 반환한다."""
    if _S.top_view_rect is not None:
        return
    marker_corners = _live_detect_marker_only(frame, ARUCO_SIZE_MM)
    if marker_corners is None:
        return
    rect, slot_x = _top_view_rect(frame.shape[1], frame.shape[0], marker_corners)
    print(f"[Capture] 탑뷰 화면 창: {rect} (손가락 자리 x={slot_x:.0f}px)")
    _S.marker_corners = marker_corners
    _S.finger_slot_x = slot_x
    _S.top_view_rect = rect   # 마지막에 — None 여부가 "마커 잡힘" 표시라서


def _top_guide() -> dict | None:
    """프론트 탑뷰 손가락/큐티클 가이드 위치 — 스트림 화면(_top_view_rect 창) 기준 비율.

    cuticleY는 측정이 실제로 쓰는 guide_y 행 그대로다: 손가락이 잡혀 있으면
    MeasureWorker의 실측값(EMA 포함), 아니면 같은 함수(guide_line_row)를
    손가락 자리 열에서 마커만으로 계산한 값. 예전에 스트림에 직접
    그리던 파란 점선과 같은 위치이고, 그리는 방식만 프론트로 옮겼다.
    """
    corners, rect = _S.marker_corners, _S.top_view_rect
    if corners is None or rect is None:
        return None
    x0, y0, x1, y1 = rect
    view_w, view_h = x1 - x0, y1 - y0
    mpp = _live_marker_mm_per_px(corners, ARUCO_SIZE_MM)

    live = _S.live_guide
    if live is not None and time.time() - live[1] < GUIDE_LIVE_HOLD_SEC:
        guide_y = live[0]
    else:
        offset_px = _live_guide_offset_mm(_S.current_finger or "") / mpp
        guide_y = _live_guide_line_row(corners, _S.finger_slot_x, offset_px)

    return {
        "aspect":   view_w / view_h,                      # 스트림 화면 가로/세로 비율
        "cuticleY": (guide_y - y0) / view_h,              # 0(위)~1(아래)
        "centerX":  (_S.finger_slot_x - x0) / view_w,     # 0(왼쪽)~1(오른쪽)
        "mmToH":    1.0 / mpp / view_h,                   # 1mm가 화면 높이에서 차지하는 비율
    }


def _top_camera_idle_preview_loop(cap: cv2.VideoCapture, stop_event: threading.Event):
    """Keeps /stream/top live between per-finger capture windows.

    cap_top stays open for the whole 5-finger hand scan, but
    _capture_top_stream only reads it while actively working on ONE
    finger - the instant that finger's photo is accepted (auto-capture on
    measurement stability, or the operator's manual button), the function
    returns and nothing pushes to _S.top_frame until the next finger's
    loop starts (which can be delayed further by the side shot still being
    in progress in parallel). That gap is what made the top feed look like
    it keeps connecting/disconnecting. Read the same cap here whenever
    _capture_top_stream isn't already using it - the busy flag keeps the
    two from ever calling .read() on it at the same time.
    """
    while not stop_event.is_set():
        if not _S.top_capture_busy.is_set():
            ret, frame = cap.read()
            if ret:
                frame = _crop_top(frame)
                # 세션 시작 직후(_capture_top_stream이 아직 첫 프레임도 못 돌린
                # 찰나) 이 idle 루프가 먼저 프레임을 밀어넣는 경우, 마커가
                # 아직 안 잡혀 있어(_S.top_view_rect is None) 그대로 노출된다 —
                # 손가락 없이도 되는 가벼운 감지라 여기서도 똑같이 시도해서
                # 그 틈을 없앤다. 한 번 잡히면 이후로는 추가 비용이 없다.
                _remember_marker(frame)
                _push_frame(_S.top_frame, _top_view(frame))
        time.sleep(0.05)


def _capture_top_stream(cap, finger: str, save_path: str, hand: str) -> bool:
    """탑뷰 스트리밍 - nail_live.py(로컬 CLI)와 동일한 실시간 측정 미리보기.

    매 프레임 nail_measurer로 실측정을 돌려 폭/길이와 윤곽선을 그려 보여준다.
    자동 촬영은 없음 - 조작자가 "촬영하기" 버튼(force_capture_top)을 눌러야만
    저장된다. 버튼을 누른 순간 최근 MEDIAN_N개 측정이 서로 합의된 상태였으면
    그 median을, 아니면 그 순간의 단일 프레임을 accept한다 (nail_live.py의
    ENTER 키 동작과 동일) - 사이드뷰(force_capture_side)와 같은 원칙.
    """
    # 큐티클 가이드는 프론트가 /capture/stability의 guide로 직접 그린다 —
    # 스트림에 점선을 또 구우면 두 줄이 겹쳐 보이므로 여기선 끈다.
    worker = MeasureWorker(finger, ARUCO_SIZE_MM, draw_guide=False)
    worker.start()
    history  = deque(maxlen=_LIVE_MEDIAN_N)
    last_t   = 0.0
    # No deadline: waits for the measurement to stabilise (auto-capture) or
    # the operator's manual button, however long that takes - same as the
    # side/c-curve view.
    _S.force_capture_top.clear()
    _S.stability = {"ratio": 0.0, "ready": False}
    _S.live_guide = None
    _S.live_wl.pop((hand, finger), None)
    _push_event({"type": "finger_start", "finger": finger.upper()})
    print(f"\n  [{finger}] 탑뷰 스트리밍 시작 (실시간 측정)")

    accepted = None
    frame = None
    _last_status_print = 0.0
    # Web display only — smooths over single-frame measurement misses so the
    # guide line / width-length text don't blink out every time one frame in
    # the background MeasureWorker fails (finger blur, autofocus hunt, a
    # frame straddling the guide window). Does NOT touch `history` or the
    # accept-on-capture logic below, both of which still key off the real,
    # unsmoothed `result` — this only decides what gets drawn on screen.
    last_ok_result = None
    last_ok_t = 0.0
    # 1.2s was long enough to smooth flicker but also long enough that
    # pulling the finger out left a stale "ghost" overlay on screen for
    # over a second, which read as lag - shortened so it still absorbs a
    # single bad frame (measurement noise, ~0.3-0.8s apart per
    # nail_live.py's own docs) without holding on to a genuinely-removed
    # finger for long.
    HOLD_LAST_OK_SEC = 0.5
    _S.top_capture_busy.set()
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                return False
            frame = _crop_top(frame)

            worker.submit(frame)
            result = worker.latest()

            if result is not None and result["t"] != last_t:
                last_t = result["t"]
                if result["ok"]:
                    history.append(result)
                else:
                    history.clear()

            # ── 정확도 게이지 갱신: history가 찰수록 ratio가 오르고, MEDIAN_N개
            # 읽음값의 W/L이 서로 합의(agree)하면 ready=true (초록) — nail_live.py
            # CLI의 auto-capture 조건과 동일한 기준을 재사용한다.
            is_stable, _dw, _dl = _live_stability(history)
            _S.stability = {
                "ratio": min(len(history) / _LIVE_MEDIAN_N, 1.0),
                "ready": is_stable,
            }

            # measure_frame silences nail_measurer's own prints (see
            # quiet()), so without this the operator has no way to see
            # WHERE positioning is going wrong (marker not seen at all vs.
            # marker fine but finger not segmented vs. both fine but the
            # measurement itself came out unusable) — only a red border on
            # screen. Once/sec regardless of ok/fail, so the operator can
            # watch it flip ✗→✓ live while repositioning, without flooding
            # the console at ~framerate.
            now = time.time()
            if result is not None and now - _last_status_print > 1.0:
                _last_status_print = now
                mk = "OK" if result.get("marker_ok") else "--"
                fk = "OK" if result.get("finger_ok") else "--"
                mm = "OK" if result.get("ok") else "--"
                tail = f"  ({result['err']})" if result.get("err") else ""
                print(f"  [{finger}] 마커:{mk}  손가락:{fk}  측정:{mm}{tail}")

            # 마커 위치는 손가락 유무와 무관하게 독립적으로 추적한다 — 전체
            # 측정(result.ok)은 손가락이 놓이기 전까지 계속 실패하므로, 거기
            # 얹어서 갱신하면 "손가락을 넣어주세요" 안내가 떠 있는 동안 내내
            # 마커가 가려지지 않는다 (실제로 확인된 문제). 마커는 매트에
            # 고정돼 있어 한 번 잡히면 세션(손가락 5개) 내내 안 바뀌므로,
            # 이미 잡힌 뒤에는 매 프레임 다시 돌릴 필요가 없다.
            _remember_marker(frame)

            # 프론트 큐티클 가이드는 측정이 실제로 쓰는 행을 따라가야 한다 —
            # 손가락이 잡힌 측정 결과가 있는 동안 계속 갱신하고, 끊기면
            # GUIDE_LIVE_HOLD_SEC 뒤 _top_guide가 마커 기준 추정으로 돌아간다.
            if result is not None and result.get("guide_y") is not None:
                _S.live_guide = (float(result["guide_y"]), now)

            if result is not None and result.get("ok"):
                last_ok_result, last_ok_t = result, now
            display_result = result
            if (result is None or not result.get("ok")) and \
                    last_ok_result is not None and now - last_ok_t < HOLD_LAST_OK_SEC:
                display_result = last_ok_result

            _push_frame(_S.top_frame, _live_compose(
                display_result, frame, history, finger, 0,
                crop_rect=_S.top_view_rect, show_pip=False))

            if _S.force_capture_top.is_set():
                _S.force_capture_top.clear()
                # Manual button = capture THIS instant regardless of whether
                # the live measurement succeeded - unlike auto-capture, this
                # is the operator overriding the algorithm, not deferring to
                # it. Still prefers a validated reading when one happens to
                # be available (nail_live.py's ENTER-key priority), but a raw
                # frame beats silently ignoring the button press: analysis
                # runs again later on the saved photo regardless.
                if len(history) == _LIVE_MEDIAN_N:
                    accepted = _live_median_result(history)
                    print(f"  [{finger}] 탑뷰 수동 촬영 (median of {_LIVE_MEDIAN_N})")
                    # 게이지를 초록으로 만든 그 합의 구간 자체가 신호 — 사진은
                    # median 프레임 하나를 저장하지만(자기 자신을 재측정해도
                    # 같은 값이 나오는 실제 프레임이어야 하므로), 최종 W/L은
                    # 그 구간 전체의 평균을 쓰는 게 단일 프레임보다 노이즈에
                    # 덜 흔들린다 — _measure_one_finger가 재측정 직후 이 값으로
                    # 덮어쓴다.
                    _S.live_wl[(hand, finger)] = {
                        "width_mm":  sum(h["data"]["width_mm"]  for h in history) / len(history),
                        "length_mm": sum(h["data"]["length_mm"] for h in history) / len(history),
                    }
                elif result is not None and result["ok"]:
                    accepted = result
                    print(f"  [{finger}] 탑뷰 수동 촬영 (단일 프레임)")
                    # 합의 구간이 없으니(연속 측정 부족) 평균 낼 것도 없다 —
                    # 이 한 프레임의 값을 그대로 라이브 값으로 둔다.
                    _S.live_wl[(hand, finger)] = {
                        "width_mm":  result["data"]["width_mm"],
                        "length_mm": result["data"]["length_mm"],
                    }
                else:
                    accepted = {"frame": frame}
                    print(f"  [{finger}] 탑뷰 수동 촬영 (측정 실패, 원본 프레임 저장)")
                    # 라이브 측정 자체가 없었으니 override 없이 재측정 결과를 그대로 쓴다.
                break
    finally:
        worker.stop()
        _S.live_guide = None
        _S.top_capture_busy.clear()

    h = accepted["frame"].shape[0]
    y2 = h - CROP_BOTTOM_PX if CROP_BOTTOM_PX > 0 else h
    cv2.imwrite(save_path, accepted["frame"][:y2, :])
    print(f"  [{finger}] 탑뷰 저장: {save_path}")
    _push_event({"type": "finger_captured", "finger": finger.upper()})
    return True


def _capture_side_stream(cap, finger: str, save_path: str) -> bool:
    """
    버그였던 부분: 예전 버전은 폰 프리뷰가 한 번도 안 온 상태(ret=False)면
    `continue`로 바로 다음 루프로 넘어가 버려서, 그 아래에 있는
    force_capture_side 체크 자체를 절대 못 봤다 — 즉 폰 카메라 페이지가 아직
    안 열려있거나 연결이 끊긴 상태에서 조작자가 "지금 촬영"을 눌러도 아무
    일도 안 일어나고, 이 스레드는 join()에서 영원히 안 풀려서 다음 손가락으로
    절대 못 넘어갔다 (실제로 확인된 증상: 엄지 찍고 검지로 안 넘어감).
    request_capture()/capture_full()은 프리뷰 프레임이 없어도 동작하므로,
    프리뷰가 아직 없어도 force_capture_side 체크까지는 통과시킨다.
    """
    _push_event({"type": "side_ready", "finger": finger.upper()})
    _S.force_capture_side.clear()
    is_phone  = isinstance(cap, PhoneCamera)

    _S.side_capture_busy.set()
    try:
        while True:
            ret, frame = cap.read()

            if ret:
                h, w = frame.shape[:2]
                disp = frame.copy()
                # English only: cv2.putText's Hershey fonts have no Korean glyphs, so
                # Korean text here renders as garbled boxes on screen.
                cv2.putText(disp,
                            f"[SIDE] {finger.upper()}  |  press CAPTURE on the web page",
                            (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200,200,0), 2)
                cv2.rectangle(disp, (0,0), (w-1,h-1), (180,180,0), 4)
                _push_frame(_S.side_frame, disp)
            elif not is_phone:
                return False
            # is_phone and not ret: 아직 프리뷰가 없다 — 그래도 아래 force
            # 체크는 계속 통과시킨다 (더 이상 여기서 continue하지 않음).

            if _S.force_capture_side.is_set():
                _S.force_capture_side.clear()
                if is_phone and not cap.is_connected():
                    # 폰 카메라 페이지가 안 열려있음 - 8초 타임아웃을 기다리지 않고
                    # 바로 건너뛴다. 탑뷰만으로도 측정은 진행된다 (c-curve만 생략).
                    print(f"  [{finger}] 폰 사이드뷰 미연결 → 사이드뷰 건너뜀 (탑뷰만 측정)")
                    return False
                if is_phone:
                    if ret:
                        cv2.putText(disp, "Capturing full-res photo - hold the phone still",
                                    (10, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0,255,255), 2)
                        _push_frame(_S.side_frame, disp)
                    cap.request_capture()
                    full = cap.capture_full(timeout=8.0)
                    if full is None:
                        print(f"  [{finger}] 폰 고화질 촬영 실패(타임아웃) → 프리뷰 프레임으로 대체")
                        full = frame   # 프리뷰도 한 번도 못 받았으면 여전히 None
                    if full is None:
                        print(f"  [{finger}] 사이드뷰 저장 실패 — 폰에서 미리보기/사진 모두 못 받음 "
                              f"(폰 카메라 페이지가 열려있는지 확인) → 이 손가락 사이드뷰 건너뜀")
                        return False
                    cv2.imwrite(save_path, full)
                else:
                    cv2.imwrite(save_path, frame)
                print(f"  [{finger}] 사이드뷰 저장: {save_path}")
                return True

            time.sleep(0.03 if ret else 0.05)
    finally:
        _S.side_capture_busy.clear()


def _capture_finger_both(cap_top, cap_side, finger: str, local_dir: str, hand: str):
    """탑뷰 + 사이드뷰 동시 캡처. /capture/force 한 번으로 두 카메라 동시 촬영."""
    top_path  = os.path.join(local_dir, f"{finger}_top.jpg")
    side_path = os.path.join(local_dir, f"{finger}_side.jpg")

    top_result  = [False]
    side_result = [False]

    def capture_top():
        top_result[0] = _capture_top_stream(cap_top, finger, top_path, hand)

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

    # 왼손 끝나고 release() 했다가 오른손에서 바로 다시 여는 게 DSHOW 예외의 원인이었다 -
    # 이제 손 사이에 놓지 않고 세션 내내 계속 잡고 있는 카메라를 그대로 재사용한다.
    cap_top = _get_top_cam()

    cap_side = None
    if CAMERA_SIDE == -2:
        cap_side = _phone_cam
        print("[Capture] 사이드 카메라: 폰 (/phone/side)")
    elif CAMERA_SIDE >= 0:
        _c = cv2.VideoCapture(CAMERA_SIDE, cv2.CAP_DSHOW)
        if _c.isOpened():
            cap_side = _c
        else:
            print(f"[Capture] 사이드 카메라(인덱스 {CAMERA_SIDE}) 없음 → brightness fallback")

    _S.active = True
    _S.done_fingers = []

    top_idle_stop = threading.Event()
    threading.Thread(target=_top_camera_idle_preview_loop,
                      args=(cap_top, top_idle_stop), daemon=True).start()

    try:
        for finger in FINGER_ORDER:
            _S.current_finger = finger
            _S.force_capture_top.clear()
            _S.force_capture_side.clear()

            top_ok, _ = _capture_finger_both(cap_top, cap_side, finger, local_dir, hand)
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
        top_idle_stop.set()
        time.sleep(0.1)   # let the idle loop's in-flight read() finish before release()
        # cap_top은 release() 안 함 - 세션 내내(왼손→오른손) 계속 잡고 있는 공용 카메라라서
        # 여기서 놓아버리면 다음 손 시작할 때 다시 여는 지점에서 DSHOW 예외가 재발한다.
        if cap_side and cap_side is not _phone_cam:
            cap_side.release()

    return local_dir


def _measure_one_finger(finger: str, photos_root: str, results_root: str, hand: str):
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

    # 촬영 순간 게이지를 채운 라이브 평균값이 있으면, 재측정(사진 한 장짜리
    # 단일 프레임)이 내놓는 값 대신 그걸 최종 width_mm/length_mm으로 쓴다 —
    # 여러 프레임이 합의한 값이 노이즈에 더 강하다는 게 이 override의 취지.
    live = _S.live_wl.pop((hand, finger), None)
    if live is not None:
        cmd += ["--live-width-mm", str(live["width_mm"]),
                "--live-length-mm", str(live["length_mm"])]

    result = subprocess.run(cmd, cwd=_SCAN_DIR, capture_output=True, text=True,
                             encoding="utf-8", errors="replace")
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
            args=(finger, photos_root, results_root, hand),
            daemon=True,
        )
        for finger in FINGER_ORDER
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()


def _merge_hand_results(userid: str, session: str, hand: str) -> str | None:
    """Combine each finger's own nail_measurements.json (written by its own
    nail_measurer.py subprocess - see _measure_one_finger) into a single
    hand-level measurements.json, with a summary recomputed across all of
    that hand's fingers instead of each finger's own single-finger one.

    The per-finger nail_measurements.json files are internal intermediates
    only (never uploaded, never read by the callback/STL steps) and are
    removed once merged, so a hand only ever leaves behind one
    measurements.json.
    """
    results_root = os.path.join(BASE, "results", userid, session, hand)
    per_finger = {}
    for finger in FINGER_ORDER:
        p = os.path.join(results_root, finger, "nail_measurements.json")
        if os.path.isfile(p):
            try:
                with open(p, encoding="utf-8") as f:
                    per_finger[finger] = json.load(f)
            except Exception as e:
                print(f"  [{finger}] measurements 읽기 오류: {e}")
    if not per_finger:
        return None

    merged   = merge_hand_measurements(per_finger)
    out_path = os.path.join(results_root, "measurements.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)

    for finger in per_finger:
        try:
            os.remove(os.path.join(results_root, finger, "nail_measurements.json"))
        except Exception:
            pass
    return out_path


def _run_merge_both_measurements(userid: str, left_session: str, right_session: str,
                                  callback_url: str):
    """Combine the left/right hands' local-only measurements.json (each
    written by _merge_hand_results once that hand's scan finishes) into one
    both-hands JSON, and upload only that combined file to S3 - mirrors
    _run_merge_both_hands' left_session_right_session S3 key convention for
    the merged STL.
    """
    try:
        left_path  = os.path.join(BASE, "results", userid, left_session,  "left",  "measurements.json")
        right_path = os.path.join(BASE, "results", userid, right_session, "right", "measurements.json")
        missing = [p for p in (left_path, right_path) if not os.path.isfile(p)]
        if missing:
            raise RuntimeError(f"measurements.json 없음: {missing}")

        with open(left_path, encoding="utf-8") as f:
            left_data = json.load(f)
        with open(right_path, encoding="utf-8") as f:
            right_data = json.load(f)

        # 손가락 각각을 지 손가락 평균과 비교해서 5/10개 판정을 다수결로 모으는
        # 대신, 양손 10개 손톱의 측정값 합계를 아시아 여성 평균 10개 손톱 합계와
        # 통째로 비교한 "양손 vs 양손" 단일 판정 (팀장 요청) - nail_measurer.
        # classify_size_totals() 참고.
        all_nails    = left_data.get("nails", []) + right_data.get("nails", [])
        both_summary = classify_size_totals(all_nails)

        combined = {"left": left_data, "right": right_data, "summary": both_summary}

        both_dir = os.path.join(BASE, "results", userid, f"{left_session}_{right_session}", "both")
        os.makedirs(both_dir, exist_ok=True)
        combined_path = os.path.join(both_dir, "measurements.json")
        with open(combined_path, "w", encoding="utf-8") as f:
            json.dump(combined, f, indent=2, ensure_ascii=False)

        s3_key = f"results/{userid}/{left_session}_{right_session}/both/measurements.json"
        measurements_url = _upload_file(combined_path, s3_key)

        requests.post(callback_url, json={
            "success":          True,
            "measurementsUrl":  measurements_url,
            "overallSize":      both_summary["nail_size"],
            "widthSize":        both_summary["width_size"],
            "lengthSize":       both_summary["length_size"],
            "summaryText":      both_summary["summary_text"],
        })
    except Exception as e:
        requests.post(callback_url, json={"success": False, "message": str(e)})


def _build_callback_data(userid: str, session: str, hand: str) -> dict:
    results_root = os.path.join(BASE, "results", userid, session, hand)
    measurements_path = os.path.join(results_root, "measurements.json")

    fingers_data = []
    skin_tones   = []
    skin_metrics = []
    sizes        = []
    wl_checks    = []
    summary_text = ""

    mj = {}
    if os.path.isfile(measurements_path):
        try:
            with open(measurements_path, encoding="utf-8") as f:
                mj = json.load(f)
        except Exception as e:
            print(f"  measurements.json 읽기 오류: {e}")

    by_finger    = mj.get("by_finger", {})
    summary_text = (mj.get("summary") or {}).get("summary_text", "")

    for finger in FINGER_ORDER:
        fd = by_finger.get(finger)
        if not fd:
            continue
        try:
            # [레거시] fd["nail_size"]는 이 손가락 하나를 그 손가락 전용 아시아
            # 여성 평균과 비교한 개별 판정 - sizes에 모아 아래 overall_size를
            # 만드는 데만 쓴다 (recommend_nail_shape 게이팅용, 계속 필요).
            # "평균보다 크다/작다/평균이다" 라는 고객 노출용 종합 판정은 더 이상
            # 이 방식(손가락별 비교 후 다수결)을 쓰지 않고, 양손 스캔이 다 끝난
            # 뒤 /analyze/measurements/merge-both가 10개 손톱 합계 대 합계로
            # 다시 계산한다 (nail_measurer.classify_size_totals 참고).
            nail_size = fd.get("nail_size", "average")
            skin_tone = fd.get("skin_tone_hex", "")
            if fd.get("wl_ratio_check"):
                wl_checks.append(fd["wl_ratio_check"])
            if skin_tone: skin_tones.append(skin_tone)
            sizes.append(nail_size)

            # nail_measurer.py가 손톱판/매니큐어를 피한 밴드에서 뽑아준 LAB
            # 메트릭 — 있는 손가락만 모아서 나중에 평균낸다 (scan/_legacy_server.py와 동일).
            if fd.get("skin_L") is not None:
                skin_metrics.append({
                    "L":          fd["skin_L"],
                    "a":          fd["skin_a"],
                    "b":          fd["skin_b"],
                    "warmness":   fd["skin_warmness"],
                    "saturation": fd["skin_saturation"],
                })

            fingers_data.append({
                "finger": finger.upper(),
                "measurements": {
                    # 측정 수치
                    "widthMm":           safe_float(fd.get("width_mm")),
                    "lengthMm":          safe_float(fd.get("length_mm")),
                    "correctedLengthMm": safe_float(fd.get("corrected_length_mm")),
                    "cCurveMm":          safe_float(fd.get("c_curve_mm")),
                    "arcRadiusMm":       safe_float(fd.get("arc_radius_mm")),
                    "thicknessMm":       safe_float(fd.get("thickness_mm")),
                    # 논문 기준 비교값
                    "widthVsAvgMm":  safe_float(fd.get("width_vs_avg_mm")),
                    "lengthVsAvgMm": safe_float(fd.get("length_vs_avg_mm")),
                    "widthSize":     fd.get("width_size", "average"),
                    "lengthSize":    fd.get("length_size", "average"),
                    "nailSize":      fd.get("nail_size", "average"),
                },
                "size": nail_size,
            })
        except Exception as e:
            print(f"  [{finger}] 결과 읽기 오류: {e}")

    skin_tone_hex = skin_tones[0] if skin_tones else "#C8A882"
    # [레거시] 이 손(hand) 5개 손가락의 개별 판정 다수결 - recommend_nail_shape
    # 게이팅에만 쓴다. 아래 return의 overallSize/summaryText는 이 값 그대로라
    # 마찬가지로 레거시(잠정값)이고, 최종 종합 판정은 merge-both 콜백에서 온다.
    overall_size  = max(set(sizes), key=sizes.count) if sizes else "average"
    recommended_colors = []
    tone = brightness = saturation = None

    recommended_shape = recommend_nail_shape(wl_checks, overall_size)
    print(f"  [Shape] recommended={recommended_shape}  "
          f"(from {len(wl_checks)}손가락 W/L, overall_size={overall_size})")

    # 유효한 손가락들의 LAB 평균으로 피부색/웜쿨/명도/채도/추천컬러 30개를
    # 한 번에 계산한다 (scan/_legacy_server.py의 build_callback_data와 동일한 방식).
    if skin_metrics:
        avg_L    = sum(m["L"] for m in skin_metrics) / len(skin_metrics)
        avg_a    = sum(m["a"] for m in skin_metrics) / len(skin_metrics)
        avg_b    = sum(m["b"] for m in skin_metrics) / len(skin_metrics)
        avg_warm = sum(m["warmness"] for m in skin_metrics) / len(skin_metrics)
        avg_sat  = sum(m["saturation"] for m in skin_metrics) / len(skin_metrics)

        skin_tone_hex = lab_to_rgb_hex(avg_L, avg_a, avg_b)
        brightness    = round(avg_L / 100.0, 3)
        saturation    = round(avg_sat, 3)

        result = recommend_nail_colors(avg_L, avg_a, avg_b, avg_warm, avg_sat)
        recommended_colors = [c["hex"] for c in result["best"]]
        tone = result["skin_summary"]["tone"]
        print(f"  [SkinColor] tone={tone} brightness={brightness} "
              f"saturation={saturation} colors={len(recommended_colors)}개 "
              f"({len(skin_metrics)}손가락 평균)")
    else:
        print("  [SkinColor] 유효한 피부 LAB 데이터 없음 → 기본값 사용")

    return {
        "shape":             recommended_shape,
        "skinToneHex":       skin_tone_hex,
        "overallSize":       overall_size,  # [레거시] 잠정값 - 최종은 merge-both 콜백 참고
        "summaryText":       summary_text,  # [레거시] 잠정값 - 최종은 merge-both 콜백 참고
        "recommendedColors": recommended_colors,
        "tone":              tone,
        "brightness":        brightness,
        "saturation":        saturation,
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
                # 왼손/오른손 각각의 measurements.json은 로컬에만 남기고, S3에는
                # /analyze/measurements/merge-both가 두 손 다 끝난 뒤 하나로
                # 합친 결과만 올린다.
                _merge_hand_results(userid, session, hand)
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


def _run_stl_and_callback(userid: str, session: str, hand: str, shape: str, callback_url: str,
                          tip_extension_mm: float | None = None):
    """손가락별로 "내 실측 손톱 길이 + 연장 길이(tip_extension_mm)"짜리 STL을 만들어 S3에 올린다.
    tip_extension_mm이 None이면 nail_exact_stl.py가 쉐입별 기본값(TIP_EXTENSION_DEFAULT_MM)을 쓴다."""
    try:
        results_root = os.path.join(BASE, "results", userid, session, hand)
        stl_dir      = os.path.join(results_root, "stl")
        os.makedirs(stl_dir, exist_ok=True)
        s3_prefix    = f"results/{userid}/{session}/{hand}"

        mp = os.path.join(results_root, "measurements.json")
        if not os.path.isfile(mp):
            raise RuntimeError(f"measurements.json 없음: {mp}")
        with open(mp, encoding="utf-8") as f:
            available_fingers = set(json.load(f).get("by_finger", {}))

        ext_label = f"+{tip_extension_mm}mm" if tip_extension_mm is not None else "쉐입 기본값"
        print(f"[STL] {userid}/{session}/{hand} shape={shape} 연장 길이={ext_label}")

        succeeded = []
        for finger in FINGER_ORDER:
            if finger not in available_fingers:
                continue
            # STL 파일명엔 길이가 안 들어가서(nail_{finger}_{shape}.stl) 이전 출력 때 만든 파일과
            # 이름이 같다. 이번 생성이 실패했을 때 예전 길이의 파일이 남아 있다가 업로드·출력되지
            # 않도록, 먼저 지우고 새로 만든다.
            out_path = os.path.join(stl_dir, f"nail_{finger}_{shape}.stl")
            if os.path.isfile(out_path):
                os.remove(out_path)

            cmd = [
                sys.executable, os.path.join(_SCAN_DIR, "nail_exact_stl.py"),
                "--input", mp, "--shape", shape, "--finger", finger, "--output", stl_dir,
            ]
            if tip_extension_mm is not None:
                cmd += ["--tip-extension", str(tip_extension_mm)]
            stl_result = subprocess.run(cmd, cwd=_SCAN_DIR, capture_output=True, text=True,
                                        encoding="utf-8", errors="replace")
            if stl_result.returncode != 0 or not os.path.isfile(out_path):
                print(f"  [{finger}] STL 생성 실패: {stl_result.stderr[-500:]}")
            else:
                print(f"  [{finger}] STL 생성 완료")
                succeeded.append(finger)

        fingers_data = []
        for finger in FINGER_ORDER:
            s3_key = f"{s3_prefix}/stl/nail_{finger}_{shape}.stl"
            if finger in succeeded:
                _upload_file(os.path.join(stl_dir, f"nail_{finger}_{shape}.stl"), s3_key)
                fingers_data.append({"finger": finger.upper(), "stlUrl": _s3_url(s3_key)})
            else:
                # 이번에 못 만든 손가락은 S3에 남아 있을 수 있는 예전 길이의 STL을 지운다 - 안 그러면
                # 병합 단계가 그 파일을 그대로 받아서 사용자가 고른 길이와 다른 팁이 출력된다.
                # 지우면 병합 단계에서 "빠진 손가락(missing)"으로 정상 처리된다.
                try:
                    _s3_client().delete_object(Bucket=BUCKET, Key=s3_key)
                except Exception as e:
                    print(f"  [{finger}] 이전 STL 삭제 실패: {e}")

        if not succeeded:
            raise RuntimeError("STL을 하나도 생성하지 못했습니다.")
        requests.post(callback_url, json={"success": True, "fingers": fingers_data})
    except Exception as e:
        print(f"[STL] 오류: {e}")
        requests.post(callback_url, json={"success": False, "message": str(e)})


# ══════════════════════════════════════════════════════════════
# 요청 모델
# ══════════════════════════════════════════════════════════════

class MeasureRequest(BaseModel):
    userid: str; session: str; hand: str; callbackUrl: str

class StlRequest(BaseModel):
    userid: str; session: str; hand: str; shape: str; callbackUrl: str
    # 출력 화면에서 사용자가 설정한 팁 연장 길이(mm). 없으면 쉐입별 기본값을 쓴다.
    # (이 필드가 없으면 pydantic이 Spring이 보낸 값을 조용히 버린다)
    tip_extension_mm: float | None = None

class MergeOneHandRequest(BaseModel):
    userid: str; session: str; hand: str
    shapes: dict[str, str]; callbackUrl: str
    printCallbackUrl: str | None = None

class MergeBothHandsRequest(BaseModel):
    userid: str; leftSession: str; rightSession: str
    leftShapes: dict[str, str]; rightShapes: dict[str, str]
    callbackUrl: str; printCallbackUrl: str | None = None

class MergeBothMeasurementsRequest(BaseModel):
    userid: str; leftSession: str; rightSession: str; callbackUrl: str

class StartPrintRequest(BaseModel):
    mergedModelUrl: str; outputDir: str; callbackUrl: str


# ══════════════════════════════════════════════════════════════
# 엔드포인트
# ══════════════════════════════════════════════════════════════

@app.on_event("startup")
def _startup():
    threading.Thread(target=_phone_side_idle_preview_loop, daemon=True).start()


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
        args=(request.userid, request.session, request.hand, request.shape, request.callbackUrl,
              request.tip_extension_mm),
        daemon=True,
    ).start()
    return {"status": "started", "message": "STL 생성이 시작되었습니다."}


@app.post("/analyze/measurements/merge-both")
def analyze_measurements_merge_both(request: MergeBothMeasurementsRequest):
    threading.Thread(
        target=_run_merge_both_measurements,
        args=(request.userid, request.leftSession, request.rightSession, request.callbackUrl),
        daemon=True,
    ).start()
    return {"status": "started", "message": "양손 측정 결과 통합이 시작되었습니다."}


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
    # Both Events are set together so the top and side capture threads fire
    # on the same button press, but each thread only ever touches its own
    # Event - see the _StreamState comment for why a single shared flag
    # would let one thread silently steal the signal from the other.
    _S.force_capture_top.set()
    _S.force_capture_side.set()
    return {"ok": True, "finger": _S.current_finger}


@app.get("/capture/status")
def capture_status():
    return {"active": _S.active, "currentFinger": _S.current_finger, "doneFinger": _S.done_fingers}


@app.get("/capture/stability")
def capture_stability():
    """탑뷰 정확도 게이지 + 손가락/큐티클 가이드 위치 조회 — 프론트가 짧은 주기로 폴링.
    guide는 마커를 아직 못 잡았으면 null (_top_guide 참고)."""
    return {**_S.stability, "guide": _top_guide()}


# ── 폰 사이드뷰 카메라 ───────────────────────────────────────
# getUserMedia는 보안 컨텍스트(HTTPS 또는 localhost)에서만 동작하므로, 폰에서
# 이 페이지를 열 때는 LAN IP를 그대로 쓰지 말고 ngrok 같은 https 터널을 쓰거나
# 크롬의 "insecure origins treated as secure" 플래그에 이 서버 주소를 등록해야 함.

@app.get("/phone/side")
def phone_side_page():
    return FileResponse(os.path.join(BASE, "phone_side.html"))


@app.post("/phone/side/frame")
async def phone_side_frame(request: Request):
    data = await request.body()
    frame = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is not None:
        _phone_cam.push_preview(frame)
    return {"ok": frame is not None}


@app.get("/phone/side/status")
def phone_side_status():
    return {"capture": _phone_cam.capture_wanted()}


@app.post("/phone/side/photo")
async def phone_side_photo(request: Request):
    data = await request.body()
    frame = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is not None:
        _phone_cam.push_full_res(frame)
    return {"ok": frame is not None}


# 디버그용: 폰이 실제로 뭘 보내고 있는지 브라우저/curl로 바로 확인
@app.get("/phone/side/preview.jpg")
def phone_side_preview_jpg():
    ok, frame = _phone_cam.read()
    if not ok:
        return Response(status_code=204)
    _, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
    return Response(jpeg.tobytes(), media_type="image/jpeg")


@app.get("/phone/side/photo.jpg")
def phone_side_photo_jpg():
    with _phone_cam._lock:
        frame = _phone_cam._full_res
    if frame is None:
        return Response(status_code=204)
    _, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return Response(jpeg.tobytes(), media_type="image/jpeg")


# ── 폰 사이드뷰 단독 테스트 ──────────────────────────────────
# 5손가락 전체 스캔 플로우를 거치지 않고, 폰 카메라 한 장만 골라 찍어서
# c-curve 알고리즘 튜닝용 샘플을 모으기 위한 별도 도구. HandScanPage와
# 완전히 분리되어 있어 탑뷰 카메라나 측정 파이프라인은 전혀 건드리지 않는다.

@app.get("/test/side")
def test_side_page():
    return FileResponse(os.path.join(BASE, "side_capture_test.html"))


@app.post("/test/side/capture")
def test_side_capture():
    _phone_cam.request_capture()
    frame = _phone_cam.capture_full(timeout=15.0)
    if frame is None:
        return {"ok": False, "message": "폰 촬영 타임아웃 - phone_side.html이 열려있는지 확인하세요"}

    os.makedirs(TEST_CAPTURE_DIR, exist_ok=True)
    fname = f"side_{time.strftime('%Y%m%d_%H%M%S')}.jpg"
    cv2.imwrite(os.path.join(TEST_CAPTURE_DIR, fname), frame)
    print(f"[Test] 사이드뷰 저장: test_captures/{fname}")
    return {"ok": True, "file": fname}


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
def set_camera_config(top: int = 0, side: int = -2):
    """카메라 인덱스 변경. 스캔 시작 전에 호출해야 적용됨."""
    global CAMERA_TOP, CAMERA_SIDE
    CAMERA_TOP = top
    CAMERA_SIDE = side
    return {"ok": True, "top": CAMERA_TOP, "side": CAMERA_SIDE}