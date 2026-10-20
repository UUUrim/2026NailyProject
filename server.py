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
    POST /analyze/measure     — 스캔 시작 (카메라 촬영 → 손가락별 측정 파일 → 양손이 모이면 최종 measurements.json → 상태 콜백)
    POST /analyze/stl         — STL 생성 (로컬 results/.../stl 에 저장) → 콜백
    POST /analyze/measurements/merge-both — 손가락별 측정 파일 10개 → 양손 최종 measurements.json (로컬 + S3)
    GET  /stream/top          — 탑뷰 MJPEG 스트림 (큐티클 가이드는 프론트가 /capture/stability의 guide로 그림)
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
    POST /print/merge-both    — 양손 로컬 STL 병합 → 양손 3MF를 S3에 업로드 → 콜백
    POST /print/start         — 슬라이싱 + 프린터 출력 시작
"""

import asyncio
import json
from datetime import datetime
import math
import os
import queue as _q
import re
import shutil
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

from merge_fingers   import merge_both_hands                      # printer/
from slice_and_print import (slice_and_send_to_printer,           # printer/
                              PRINTER_IP, PRINTER_ACCESS_CODE, PRINTER_SERIAL)
import final_measurements                                        # scan/ - 양손 최종 measurements.json
try:
    from measure_ccurve import side_edge_blur_px, find_finger_point, focus_score, finger_box_norm   # scan/ - 초점 확인, 손가락 위치, 초점 점수
except Exception:                                                # 없어도 스캔은 돌아가야 한다
    side_edge_blur_px = None
    find_finger_point = None
    focus_score = None
    finger_box_norm = None
import skin_snapshot                                             # scan/ - 피부색 확인용 사진 한 장

# 탑뷰 라이브 측정 - nail_live.py(로컬 CLI 도구)와 동일한 실시간 측정을 재사용한다.
# 매 프레임 nail_measurer로 실측정을 돌리되, 웹 화면에는 깨끗한 카메라 화면만 보내고
# 상태·W/L 표시는 프론트가 그린다. 자동 촬영은 없음 - 탑뷰/사이드뷰 모두 조작자가
# 촬영 버튼을 눌러야만 저장된다.
from nail_live import (MeasureWorker,                                 # scan/
                        median_result as _live_median_result,
                        MEDIAN_N as _LIVE_MEDIAN_N,
                        stability as _live_stability,
                        detect_marker_only as _live_detect_marker_only,
                        guide_line_row as _live_guide_line_row,
                        guide_line_offset_mm as _live_guide_offset_mm,
                        marker_mm_per_px as _live_marker_mm_per_px,
                        apply_fixed_focus as _live_apply_fixed_focus)

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
# 탑뷰 카메라 노출/화이트밸런스 고정 (None이면 카메라 자동 설정을 그대로 쓴다).
# 손톱 측정/실시간 영상은 카메라 원래(자동) 설정으로 찍어야 해서 None으로 둔다 - 노출을 고정하면
# 영상과 측정 사진이 달라져서 손톱 크기 측정에 영향이 있다.
# 참고(박스 조명 켠 상태, 이 PC의 C920, DirectShow 노출값은 log2 초):
#   자동 노출 : 노출 -6, 마커 흰색이 255로 날아감(픽셀 33% 포화), 검정 매트가 중간 회색(146)
#               -> 피부가 과노출되어 붉은기가 줄고 노랗게(웜으로) 보임
#   노출 -8 / WB 6000K : 마커 흰색 약 190(안 날아감), 매트 약 55, 피부 L 61 - 피부색 측정에 적합
CAMERA_EXPOSURE   = None
CAMERA_WB_TEMP    = None
ARUCO_SIZE_MM     = 20.0
# 네일팁 STL 쉘 두께(mm). 안 넘기면 nail_exact_stl.py 기본값 0.6이 쓰인다. 0.2mm 노즐 선폭(0.22)
# 기준으로 0.5는 벽 약 2줄 — 더 얇게 하면 PETG 팁이 약해진다.
NAIL_THICKNESS_MM = 0.5
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
        "state":            str(p.get_current_state()),   # stg_cur 기반 "단계" (PRINTING/IDLE 등)
        "gcodeState":       str(p.get_state()),           # gcode_state 기반 (IDLE/PREPARE/RUNNING/PAUSE/FINISH/FAILED)
        "gcodeFile":        str(p.get_file_name() or ""),
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
    """병합 직후 자동 출력 요청을 프린트 큐에 넣는다.

    예전엔 여기서 바로 슬라이싱+업로드+폴링을 해서 큐를 완전히 우회했다. 그 결과 앞 출력이
    진행 중이어도 다음 주문이 같은 프린터에 동시에 업로드/시작되고, 같은 이름의 파일을 덮어쓰고,
    둘 다 "출력 중"으로 보였다. 이제 /print/start와 똑같이 큐 워커가 한 번에 하나씩 처리한다.

    주문마다 폴더를 따로 만들고 병합 3MF를 거기로 복사한다: 같은 스캔 조합으로 다시 신청하면
    병합 결과 파일(hand_merged.3mf 등)이 덮어써지는데, 그 전에 대기 중이던 앞 주문이 새 모델을
    출력하거나 출력 중 파일이 바뀌는 일을 막기 위해서다.
    """
    try:
        order_id = _order_id_from_callback(callback_url)
        order_dir = os.path.join(output_dir, f"order_{order_id}")
        os.makedirs(order_dir, exist_ok=True)
        job_3mf = os.path.join(order_dir, "input_for_slicing.3mf")
        shutil.copy2(local_3mf, job_3mf)
        _enqueue_print_job({"localPath": job_3mf, "outputDir": order_dir, "callbackUrl": callback_url})
        # 백엔드에 "큐에 들어갔다"를 알려서 화면에 '프린터 대기 중'으로 보이게 한다.
        # (실제 출력이 시작되면 워커가 PRINTING 콜백을 보낸다)
        requests.post(callback_url, json={"success": True, "status": "WAITING_IN_QUEUE"})
    except Exception as e:
        requests.post(callback_url, json={"success": False, "message": str(e)})


def _order_id_from_callback(callback_url: str) -> str:
    """콜백 주소(.../prints/<주문ID>/print-result)에서 주문 ID를 꺼낸다. 없으면 시각으로 대체."""
    m = re.search(r"/prints/(\d+)/", callback_url or "")
    return m.group(1) if m else time.strftime("t%Y%m%d_%H%M%S")

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

def _run_slice_and_print(merged_model_url, output_dir, callback_url, local_3mf=None):
    try:
        if local_3mf is None:
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


def _poll_until_complete(callback_url: str, interval: int = 10, timeout: int = 21600,
                          startup_grace_sec: int = 180, already_started: bool = False):
    """출력 완료될 때까지 폴링하고, 끝나면 콜백으로 COMPLETED/실패를 보낸다.

    프린터 상태는 두 가지를 같이 본다 (bambulabs_api 소스로 확인한 값).
      - gcodeState = get_state(): IDLE / PREPARE / RUNNING / PAUSE / FINISH / FAILED
      - state      = get_current_state() (stg_cur 단계): PRINTING / HEATBED_PREHEATING ... / IDLE
    예전 코드는 단계(state)에서 RUNNING/PREPARE를 찾아서 영원히 못 찾았고, 그래서
    출력 중이어도 "시작 안 됨"으로 오판해 180초 뒤 실패 처리했다.

    주의: 직전 작업이 끝난 뒤 gcodeState는 다음 작업이 시작될 때까지 FINISH로 남아 있다.
    그래서 "시작을 한 번이라도 확인한 뒤"에만 FINISH/FAILED/IDLE을 끝 신호로 인정한다.
    """
    start = time.time()
    last_percentage = 0
    has_started = already_started  # 서버 재시작 후 이어서 폴링할 땐 이미 출력 중이던 작업
    ACTIVE_GCODE = ("PREPARE", "RUNNING", "PAUSE")

    def _fail(msg):
        requests.post(callback_url, json={"success": False, "message": msg})

    while time.time() - start < timeout:
        time.sleep(interval)
        try:
            status = _fetch_printer_status()
            stage = str(status.get("state", "")).upper()
            gcode = str(status.get("gcodeState", "")).upper()
            pct = status.get("percentage")
            pct = pct if isinstance(pct, (int, float)) else 0
            last_percentage = max(last_percentage, pct)
            print(f"[Poll] stage={stage} gcode={gcode} pct={pct} file={status.get('gcodeFile')}")

            stage_active = bool(stage) and "IDLE" not in stage and "UNKNOWN" not in stage
            if gcode in ACTIVE_GCODE or stage_active:
                has_started = True

            if not has_started:
                # 아직 예열/업로드 처리 중이거나 시작 명령이 먹지 않은 상태
                if time.time() - start >= startup_grace_sec:
                    _fail(f"{startup_grace_sec}초가 지나도 출력이 시작되지 않았습니다. "
                          f"프린터 상태를 확인해 주세요. (단계={stage}, gcode={gcode})")
                    return
                continue

            if gcode == "FINISH":
                requests.post(callback_url, json={"success": True, "status": "COMPLETED"})
                return
            if gcode == "FAILED":
                _fail(f"프린터에서 출력이 실패했습니다 (진행률 {last_percentage}%).")
                return
            if gcode in ("IDLE", "UNKNOWN") and not stage_active:
                if last_percentage >= 95:
                    requests.post(callback_url, json={"success": True, "status": "COMPLETED"})
                else:
                    _fail(f"출력이 중간에 취소되거나 중단됐습니다 (진행률 {last_percentage}%에서 중단).")
                return
        except Exception as e:
            print(f"[Poll] 폴링 오류: {e}")  # 연결 끊겨도 폴링 계속

    # 예전엔 timeout이 지나면 아무 콜백도 없이 조용히 끝났다. 그러면 워커가 다음 작업을 바로
    # 시작해서, 아직 출력 중인 프린터에 새 파일을 올리는 일이 생긴다.
    try:
        requests.post(callback_url, json={
            "success": False,
            "message": f"출력 상태를 {timeout // 3600}시간이 넘도록 확인하지 못했습니다. 프린터를 확인해 주세요."})
    except Exception:
        pass

# ── 프린트 큐 ────────────────────────────────────────────────
def _wait_until_printer_free(interval: int = 15, max_wait: int = 21600):
    """프린터가 출력 중(PREPARE/RUNNING/PAUSE)이면 끝날 때까지 기다린다.

    큐 워커는 앞 작업이 끝나야 다음 작업으로 넘어가지만, 앞 작업의 감시가 어떤 이유로든
    일찍 끝났거나(연결 문제 등), 프린터 화면/Bambu Studio에서 직접 출력을 시작한 경우에도
    출력 중인 프린터에 새 파일을 올려 덮어쓰지 않도록 시작 직전에 한 번 더 확인한다.
    프린터에 연결이 안 되는 경우(연속 3회 실패)는 기다리지 않고 진행해서, 업로드 단계의
    오류가 사용자에게 보고되게 한다.
    """
    start = time.time()
    fails = 0
    while time.time() - start < max_wait:
        try:
            gcode = str(_fetch_printer_status().get("gcodeState", "")).upper()
            fails = 0
        except Exception as e:
            fails += 1
            print(f"[PrintQueue] 프린터 상태 확인 오류({fails}/3): {e}")
            if fails >= 3:
                return
            time.sleep(interval)
            continue
        if gcode not in ("PREPARE", "RUNNING", "PAUSE"):
            return
        print(f"[PrintQueue] 프린터가 출력 중입니다(gcode={gcode}) - 끝날 때까지 대기")
        time.sleep(interval)

# 큐가 메모리에만 있으면 server.py를 재시작할 때 대기 작업이 사라지고, 백엔드에는
# "프린터 대기 중"으로 영원히 남는다. 그래서 대기 목록과 진행 중인 작업을 JSON 파일에
# 저장해 두고, 시작할 때 복구한다.
_print_job_queue: _q.Queue = _q.Queue()
_PRINT_QUEUE_FILE = os.path.join(BASE, "print_queue_state.json")
_print_queue_lock = threading.Lock()
_pending_jobs: list = []          # 대기 중 작업 (큐와 같은 내용을 파일 저장용으로 미러링)
_current_job: dict | None = None  # 지금 처리 중인 작업

# 앞 출력이 끝나고 다음 출력을 시작하기까지 두는 간격(초). 베드 정리/교체 시간을 주기 위한 것.
# 환경변수 PRINT_COOLDOWN_SEC로 바꿀 수 있고, 0이면 바로 시작한다.
PRINT_COOLDOWN_SEC = int(os.environ.get("PRINT_COOLDOWN_SEC", "120"))
_last_job_finished_at: float = 0.0  # 마지막 작업이 끝난 시각(time.time())


def _wait_print_cooldown():
    """직전 작업이 끝난 뒤 PRINT_COOLDOWN_SEC가 지날 때까지 기다린다."""
    remain = PRINT_COOLDOWN_SEC - (time.time() - _last_job_finished_at)
    if remain <= 0:
        return
    print(f"[PrintQueue] 다음 출력 시작 전 {int(remain)}초 대기합니다 (출력 간 간격 {PRINT_COOLDOWN_SEC}초)")
    time.sleep(remain)


def _save_print_queue_state():
    """호출하는 쪽이 _print_queue_lock을 잡고 있어야 한다."""
    try:
        tmp = _PRINT_QUEUE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"current": _current_job, "pending": _pending_jobs}, f, ensure_ascii=False)
        os.replace(tmp, _PRINT_QUEUE_FILE)
    except Exception as e:
        print(f"[PrintQueue] 큐 상태 저장 실패: {e}")


def _enqueue_print_job(job: dict):
    with _print_queue_lock:
        _pending_jobs.append(job)
        _save_print_queue_state()
    _print_job_queue.put(job)


def _restore_print_queue():
    """서버 시작 시 저장된 큐를 복구한다."""
    try:
        with open(_PRINT_QUEUE_FILE, encoding="utf-8") as f:
            saved = json.load(f)
    except FileNotFoundError:
        return
    except Exception as e:
        print(f"[PrintQueue] 저장된 큐를 읽지 못했습니다: {e}")
        return

    interrupted = saved.get("current")
    if interrupted:
        # 재시작 전에 처리 중이던 작업: 프린터가 아직 출력 중이면 폴링만 이어서 하고,
        # 이미 IDLE이면 (슬라이싱/업로드 도중 끊겼거나 출력이 끝난 경우) 실패로 알린다.
        try:
            st = _fetch_printer_status()
            state = str(st.get("state", "")).upper()
            gcode = str(st.get("gcodeState", "")).upper()
        except Exception:
            state, gcode = "", ""
        if gcode in ("PREPARE", "RUNNING", "PAUSE") or (state and "IDLE" not in state and "UNKNOWN" not in state):
            _enqueue_print_job({**interrupted, "resume": True})
            print("[PrintQueue] 재시작 전 출력 중이던 작업의 상태 확인을 이어서 합니다.")
        else:
            try:
                requests.post(interrupted["callbackUrl"], json={
                    "success": False,
                    "message": "프린터 서버가 재시작되어 출력이 중단됐습니다. 다시 신청해 주세요."})
            except Exception:
                pass

    for job in saved.get("pending", []):
        _pending_jobs.append(job)
        _print_job_queue.put(job)
    if saved.get("pending"):
        print(f"[PrintQueue] 대기 작업 {len(saved['pending'])}개를 복구했습니다.")
    with _print_queue_lock:
        _save_print_queue_state()


def _print_queue_worker():
    """한 번에 하나씩 순서대로 처리하는 워커."""
    global _current_job, _last_job_finished_at
    _restore_print_queue()
    while True:
        job = _print_job_queue.get()
        callback_url = job["callbackUrl"]
        # 대기 목록(_pending_jobs)에 남겨 둔 채로 기다린다: 서버가 재시작돼도 복구된다.
        # (재시작 후 상태 확인만 이어가는 resume 작업은 새 출력이 아니라서 기다리지 않는다)
        if not job.get("resume"):
            _wait_print_cooldown()
        with _print_queue_lock:
            if job in _pending_jobs:
                _pending_jobs.remove(job)
            _current_job = job
            _save_print_queue_state()
        try:
            print(f"[PrintQueue] 출력 시작 (대기 {_print_job_queue.qsize()}개 남음)")
            if job.get("resume"):
                _poll_until_complete(callback_url, already_started=True)
            else:
                _wait_until_printer_free()
                _run_slice_and_print(job.get("mergedModelUrl"), job["outputDir"], callback_url,
                                     local_3mf=job.get("localPath"))
        except Exception as e:
            print(f"[PrintQueue] 작업 실패: {e}")
            try:
                requests.post(callback_url, json={"success": False, "message": str(e)})
            except Exception:
                pass
        finally:
            _last_job_finished_at = time.time()
            with _print_queue_lock:
                _current_job = None
                _save_print_queue_state()
            _print_job_queue.task_done()


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
        # 안정(촬영 가능) 구간의 손톱 W/L 평균 + median 프레임의 손톱 위치(원본 px) —
        # 화면 표시 전용(_top_measure). 불안정하면 None이라 프론트가 W/L을 안 띄운다.
        self.live_measure: dict | None = None
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
        # 웹 화면(사이드뷰)에 잠깐 띄우는 안내 문구: (text, BGR color, 사라질 시각). 초점 확인 결과용.
        self.side_note: tuple | None = None
        # 지금 촬영 중인 손의 (userid, session). /analyze/cancel로 취소된 세션이 이것과 같을 때만
        # cancel_capture를 켠다 - 켜지면 탑뷰/사이드뷰 촬영 루프가 다음 손가락을 기다리지 않고 빠져나온다.
        self.capture_session: tuple | None = None
        self.cancel_capture: threading.Event = threading.Event()

_S = _StreamState()


# 취소된 스캔 세션 (userid, session). 사용자가 촬영 도중 "다시 촬영해야 한다"는 경고를 확인하고
# 페이지를 나가면 Spring이 /analyze/cancel로 알려 준다. 이 세션들은 촬영을 멈추고, 측정이 끝나도
# 양손 최종 measurements.json을 만들거나 성공 콜백을 보내지 않는다.
_CANCELLED_SESSIONS: set = set()
_CANCELLED_LOCK = threading.Lock()
_CANCELLED_CALLBACK = {"success": False, "message": "촬영이 취소되었습니다."}


class ScanCancelled(Exception):
    """촬영 도중 스캔이 취소됨 (/analyze/cancel)"""


def _is_cancelled(userid: str, session: str | None) -> bool:
    if not session:
        return False
    with _CANCELLED_LOCK:
        return (userid, str(session)) in _CANCELLED_SESSIONS


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
        self._focus_point      = None
        self._focus_point_done = False
        self.focus_fd          = None    # 초점 보정으로 정한 수동 초점 거리 (폰이 지원하는 단위 그대로)
        self.calib_run         = None    # 초점 보정 요청 번호 (폰이 status 로 읽어 가면 시작)
        self.calib_scores      = []      # [(fd, score)]
        self.calib_box         = None    # 보정 동안 모든 프레임에서 선명도를 재는 고정 상자(손가락 위치, 0~1)
        self.calib_none        = 0       # 선명도를 못 잰 프레임 수

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
        self._focus_point = None
        self._focus_point_done = False
        self._capture_wanted.set()

    def focus_point(self):
        """촬영 요청 직후 폰에 알려줄 초점/노출 지점 - 최신 프리뷰에서 손가락(손톱) 위치를 찾아
        폰 카메라 프레임 기준 (0~1) 좌표로 돌려준다. 못 찾으면 None (폰은 저장된 기본 지점을 쓴다).
        프리뷰는 서버에서 180도 돌려 저장하므로, 폰이 쓰는 원래 프레임 좌표로 되돌린다."""
        if self._focus_point_done:
            return self._focus_point
        self._focus_point_done = True
        self._focus_point = None
        if find_finger_point is None:
            return None
        with self._lock:
            frame = None if self._preview is None else self._preview.copy()
        if frame is None:
            return None
        try:
            pt = find_finger_point(frame)
        except Exception as e:
            print(f"[Phone] 손가락 위치 찾기 실패: {e}")
            return None
        if pt is not None:
            self._focus_point = {"x": round(1.0 - pt[0], 4), "y": round(1.0 - pt[1], 4)}
        return self._focus_point

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

        # MJPG로 열어서 카메라가 기기 안에서 압축하게 한다. 포맷을 안 정하면 기본(YUY2, 비압축)
        # 으로 1920x1080을 받아서 USB 대역폭이 모자라 초당 5장밖에 안 나온다
        # (scan/_legacy_camera_stream.py 설명 참고).
        # [주의] 순서가 중요하다 - 이 PC의 C920(DirectShow)에서 실제로 재 본 결과:
        #   해상도 -> MJPG (FPS 지정 없음)          : 29.9 fps (MJPG)
        #   MJPG -> 해상도, 또는 어디서든 FPS 지정   : 5.0 fps (YUY2로 되돌아감)
        # 그래서 해상도를 먼저, MJPG를 나중에 지정하고, CAP_PROP_FPS는 지정하지 않는다.
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        # 노출/화이트밸런스 고정 - 자동이면 어두운 매트에 맞춰 노출을 올려서 손가락/마커가 과노출되고
        # 피부색(톤 판정)이 노랗게 치우친다. DirectShow: AUTO_EXPOSURE 0.25 = 수동, 0.75 = 자동.
        if CAMERA_EXPOSURE is not None:
            cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 0.25)
            cap.set(cv2.CAP_PROP_EXPOSURE, CAMERA_EXPOSURE)
        if CAMERA_WB_TEMP is not None:
            cap.set(cv2.CAP_PROP_AUTO_WB, 0)
            cap.set(cv2.CAP_PROP_WB_TEMPERATURE, CAMERA_WB_TEMP)
        # 오토포커스는 박스 바닥에 맞춰져 손톱이 흐려지는 일이 있어서, 손톱(마커)과 같은 높이에 초점을
        # 고정한다. 값은 scan/nail_live.py 의 CAM_FOCUS.
        _live_apply_fixed_focus(cap)
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
                _push_frame(_S.side_frame, _with_side_note(frame))
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


def _top_measure() -> dict | None:
    """안정(촬영 가능) 상태일 때만 손톱 너비/길이와 화면 위치 — 스트림 화면(_top_view_rect
    창) 기준 비율. widthMm/lengthMm는 지금 촬영하면 최종값이 되는 그 구간 평균이다."""
    m, rect = _S.live_measure, _S.top_view_rect
    if m is None or rect is None:
        return None
    x0, y0, x1, y1 = rect
    view_w, view_h = x1 - x0, y1 - y0
    return {
        "widthMm":  round(m["width_mm"], 1),
        "lengthMm": round(m["length_mm"], 1),
        "tipX":     (m["tip_x"] - x0) / view_w,                  # 손톱 가운데 열, 0~1
        "tipY":     (m["tip_y"] - y0) / view_h,                  # 손톱 끝 행, 0~1
        "cuticleY": (m["cuticle_y"] - y0) / view_h,              # 큐티클 행, 0~1
        "halfW":    m["width_mm"] / m["mpp"] / 2 / view_h,       # 너비 절반, 화면 높이 비율
    }


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

    매 프레임 nail_measurer로 실측정을 돌리고, 화면에는 깨끗한 카메라 화면을 보낸다
    (측정 상태와 안정 시 폭/길이는 프론트가 /capture/stability로 받아 그린다).
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
    _S.live_measure = None
    _S.live_wl.pop((hand, finger), None)
    _push_event({"type": "finger_start", "finger": finger.upper()})
    print(f"\n  [{finger}] 탑뷰 스트리밍 시작 (실시간 측정)")

    accepted = None
    frame = None
    _last_status_print = 0.0
    _fps_frames = 0           # 마지막 상태 출력 이후 읽은 프레임 수 (루프 실제 fps 확인용)
    _S.top_capture_busy.set()
    try:
        while True:
            if _S.cancel_capture.is_set():
                return False
            ret, frame = cap.read()
            if not ret:
                return False
            _fps_frames += 1
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
            # 화면 표시용 — 안정(촬영 가능)일 때만 손톱 너비/길이와 위치를 프론트로
            # 보낸다(_top_measure). W/L은 지금 촬영하면 최종값으로 덮어써질 바로 그
            # 구간 평균(아래 _S.live_wl과 같은 계산), 위치는 촬영 시 저장될 median
            # 프레임 기준. 측정·저장에는 쓰지 않는다.
            if is_stable:
                med = _live_median_result(history)["data"]
                _S.live_measure = {
                    "width_mm":  sum(h["data"]["width_mm"]  for h in history) / len(history),
                    "length_mm": sum(h["data"]["length_mm"] for h in history) / len(history),
                    "tip_x":     float(med["_tip_x"]),
                    "tip_y":     float(med["_tip_y"]),
                    "cuticle_y": float(med["_cuticle_y"]),
                    "mpp":       float(med["_mpp"]),
                }
            else:
                _S.live_measure = None
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
                fps = _fps_frames / (now - _last_status_print) if _last_status_print else 0.0
                _fps_frames = 0
                _last_status_print = now
                mk = "OK" if result.get("marker_ok") else "--"
                fk = "OK" if result.get("finger_ok") else "--"
                mm = "OK" if result.get("ok") else "--"
                tail = f"  ({result['err']})" if result.get("err") else ""
                print(f"  [{finger}] 마커:{mk}  손가락:{fk}  측정:{mm}  영상:{fps:4.1f}fps{tail}")

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

            # 웹 화면에는 측정 오버레이(상태 테두리·L/W 글자·폭 표시선)를 굽지 않은
            # 깨끗한 카메라 화면만 보낸다 — 측정 중/촬영 가능 표시와 안정 상태의
            # 너비·길이는 프론트가 /capture/stability(ratio·ready·measure)로 그린다.
            # 측정은 위에서 원본 프레임으로 그대로 돌고 있다.
            _push_frame(_S.top_frame, _top_view(frame))

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

        # 촬영이 확정된 순간 - 손가락이 확실히 그 자리에 있다 - 피부색 확인용 사진을 한 장 더 찍는다.
        # 손톱 측정 사진은 카메라 원래(자동 노출) 설정 그대로 두고, 이 사진은 노출을 잠깐 낮춰서
        # 마커 흰색이 날아가지 않게 찍은 것이라 피부색(톤) 계산에만 쓴다 (scan/skin_snapshot.py).
        # top_capture_busy가 아직 켜져 있어서 idle 미리보기 스레드가 같은 카메라를 읽지 않는다.
        if CAMERA_EXPOSURE is None:
            skin_path = os.path.join(os.path.dirname(save_path), f"{finger}_skin.jpg")
            if skin_snapshot.capture_skin_snapshot(cap, skin_path, crop_top_px=CROP_TOP_PX):
                print(f"  [{finger}] 피부 확인용 사진 저장: {skin_path}")
            else:
                print(f"  [{finger}] 피부 확인용 사진을 못 찍음 - 피부색은 측정 사진에서 대신 잰다")
    finally:
        worker.stop()
        _S.live_guide = None
        _S.live_measure = None
        # 화면 표시용 게이지도 비운다 — 안 비우면 촬영 직후(측면 사진 저장을 기다리는 동안)
        # 마지막 "촬영 가능"이 다음 손가락 시작 전까지 남아, 이미 찍은 손가락에 대해
        # "지금 촬영해 주세요"가 다시 뜰 수 있다. 측정·저장은 history/accepted만 쓴다.
        _S.stability = {"ratio": 0.0, "ready": False}
        _S.top_capture_busy.clear()

    h = accepted["frame"].shape[0]
    y2 = h - CROP_BOTTOM_PX if CROP_BOTTOM_PX > 0 else h
    cv2.imwrite(save_path, accepted["frame"][:y2, :])
    print(f"  [{finger}] 탑뷰 저장: {save_path}")
    _push_event({"type": "finger_captured", "finger": finger.upper()})
    return True


def _set_side_note(text: str, color, secs: float = 10.0):
    _S.side_note = (text, color, time.time() + secs)


def _with_side_note(frame: np.ndarray) -> np.ndarray:
    """사이드뷰 웹 화면 아래쪽에 초점 확인 결과를 잠깐 겹쳐 그린다 (콘솔 로그를 못 보는 경우를 위해).
    cv2.putText의 Hershey 글꼴은 한글이 안 나오므로 영어로만 쓴다."""
    note = _S.side_note
    if not note or time.time() > note[2]:
        return frame
    text, color, _ = note
    out = frame.copy()
    h, w = out.shape[:2]
    bar = max(34, int(h * 0.05))
    cv2.rectangle(out, (0, h - bar), (w, h), (0, 0, 0), -1)
    scale = max(0.5, w / 900.0)
    cv2.putText(out, text, (10, h - int(bar * 0.3)), cv2.FONT_HERSHEY_SIMPLEX, scale, color, 2)
    return out


def _log_side_sharpness(finger: str, img) -> None:
    """저장한 사이드 사진의 손가락 경계가 얼마나 흐린지 로그로 남긴다 (초점 맞추기 피드백용).
    번짐 폭이 작을수록 선명하다: 약 8px 이하 선명 / 8~20px 보통 / 20px 초과 흐림."""
    if side_edge_blur_px is None or img is None:
        return
    try:
        b = side_edge_blur_px(img)
    except Exception as e:
        print(f"  [{finger}] 사이드뷰 선명도 계산 실패: {e}")
        return
    if b is None:
        print(f"  [{finger}] 사이드뷰 선명도: 손가락 경계를 못 찾음")
        _set_side_note(f"{finger.upper()}: focus unknown (finger edge not found)", (0, 200, 255))
    else:
        label = "선명" if b <= 8 else ("보통" if b <= 20 else "흐림 - 폰 초점 설정(⚙)을 확인하세요")
        print(f"  [{finger}] 사이드뷰 선명도: 경계 번짐 {b:.0f}px ({label})")
        if b <= 8:
            _set_side_note(f"{finger.upper()}: FOCUS OK ({b:.0f}px)", (80, 220, 80))
        elif b <= 20:
            _set_side_note(f"{finger.upper()}: focus so-so ({b:.0f}px)", (0, 220, 255))
        else:
            _set_side_note(f"{finger.upper()}: BLURRY ({b:.0f}px) - retake / check phone focus", (60, 60, 255))


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
            if _S.cancel_capture.is_set():
                return False
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
                _push_frame(_S.side_frame, _with_side_note(disp))
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
                        _push_frame(_S.side_frame, _with_side_note(disp))
                    full = None
                    for attempt in (1, 2):
                        cap.request_capture()
                        full = cap.capture_full(timeout=15.0)
                        if full is not None:
                            break
                        print(f"  [{finger}] 폰 고화질 촬영 실패(타임아웃, {attempt}/2)")
                    if full is None:
                        # 예전에는 640px 프리뷰를 사이드 사진으로 저장했지만, 프리뷰는 화각이 달라 손가락이
                        # 측정 영역 밖에 있어서 C-curve 가 엉뚱한 값으로 나왔다 → 저장하지 않고 건너뛴다.
                        _set_side_note(f"{finger.upper()}: side photo FAILED - skipped (c-curve = fallback)", (60, 60, 255))
                        print(f"  [{finger}] 고화질 사이드 사진을 못 받음 → 이 손가락 사이드뷰 건너뜀 "
                              f"(폰 카메라 페이지가 열려있는지/Wi-Fi 확인)")
                        return False
                    cv2.imwrite(save_path, full)
                else:
                    cv2.imwrite(save_path, frame)
                print(f"  [{finger}] 사이드뷰 저장: {save_path}")
                _log_side_sharpness(finger, full if is_phone else frame)
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

    # 세션을 먼저 걸고 취소 신호를 비운 뒤 취소 목록을 확인한다 - 이 순서여야 촬영 시작 직전/직후에
    # 들어온 취소(/analyze/cancel)도 놓치지 않는다.
    _S.capture_session = (userid, str(session))
    _S.cancel_capture.clear()
    _S.active = True
    _S.done_fingers = []

    top_idle_stop = threading.Event()
    threading.Thread(target=_top_camera_idle_preview_loop,
                      args=(cap_top, top_idle_stop), daemon=True).start()

    try:
        if _is_cancelled(userid, session):
            raise ScanCancelled()
        for finger in FINGER_ORDER:
            _S.current_finger = finger
            _S.force_capture_top.clear()
            _S.force_capture_side.clear()

            top_ok, _ = _capture_finger_both(cap_top, cap_side, finger, local_dir, hand)
            if _S.cancel_capture.is_set():
                raise ScanCancelled()
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
        _S.current_finger = None
        _S.capture_session = None
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
        _sm = cv2.imread(side_path, cv2.IMREAD_REDUCED_COLOR_8)
        if _sm is not None and _sm.shape[1] * 8 >= 2000:
            cmd += ["--ccurve-top", side_path]
        else:
            print(f"  [{finger}] 사이드 사진이 저해상도라 C-curve 측정에 쓰지 않음")
    # 피부색 확인용 사진(노출을 낮춰 찍은 것)이 있으면 피부색은 거기서 잰다 - 측정은 위 사진으로 한다.
    skin_path = os.path.join(photos_root, f"{finger}_skin.jpg")
    if os.path.isfile(skin_path):
        cmd += ["--skin-photo", skin_path]

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


def _run_merge_both_measurements(userid: str, left_session: str, right_session: str,
                                  callback_url: str):
    """Build the both-hands final measurements.json from the per-finger
    nail_measurements.json files of the two sessions (scan/final_measurements.py)
    and upload it to S3 under results/{userid}/{left}_{right}/both/. Normally this
    is done automatically when the second hand finishes measuring; this endpoint
    rebuilds it for explicit sessions.
    """
    try:
        # 손가락별 nail_measurements.json(왼손 5 + 오른손 5)에서 직접 만든다 -
        # 손 단위 measurements.json은 더 이상 입력으로 쓰지 않는다.
        combined_path = final_measurements.write_final_measurements(
            os.path.join(BASE, "results"), userid, left_session, right_session)
        with open(combined_path, encoding="utf-8") as f:
            combined = json.load(f)
        both_summary = combined["summary"]

        s3_key = final_measurements.final_s3_key(userid, left_session, right_session)
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


def _upload_final_measurements_async(local_path: str, userid: str,
                                     left_session: str, right_session: str):
    """최종 measurements.json을 S3에 올린다. 화면은 로컬 파일을 읽으므로 기다리지 않게
    백그라운드 스레드로 보낸다 - 실패해도 로컬 결과에는 영향이 없다."""
    def _run():
        try:
            _upload_file(local_path, final_measurements.final_s3_key(userid, left_session, right_session))
        except Exception as e:
            print(f"[Final] measurements.json S3 업로드 실패(로컬 파일은 정상): {e}")
    threading.Thread(target=_run, daemon=True).start()


# 손 세션마다 "측정이 끝났는지" 신호. 오른손 측정이 왼손 측정(백그라운드)보다 먼저 끝나는 경우에
# 짝 손이 끝나기를 잠깐 기다리기 위한 것이다. (이 서버가 시작을 본 세션만 등록된다)
_MEASURE_DONE: dict = {}
_MEASURE_DONE_LOCK = threading.Lock()
PAIR_WAIT_SEC = 180


def _measure_done_event(userid: str, session: str) -> threading.Event:
    with _MEASURE_DONE_LOCK:
        return _MEASURE_DONE.setdefault((userid, session), threading.Event())


def _build_final_measurements_if_ready(userid: str, session: str, hand: str, paired_session: str | None):
    """한 손의 측정이 끝났을 때 호출 - 스캔 시작 때 정해진 짝 손(paired_session)의 측정 결과가
    있으면 그 둘로 최종 measurements.json을 만든다. 짝이 정해지지 않았으면(=이 손이 먼저 찍힌 손)
    아무것도 안 한다. "가장 최근 반대 손"을 찾아 붙이지 않는다 - 한 손만 찍고 멈춘 데이터나 앞 사람
    손이 다음 사람과 짝지어지는 것을 막기 위해서다. 스캔 흐름을 막지 않도록 예외는 여기서 삼킨다."""
    try:
        if paired_session:
            with _MEASURE_DONE_LOCK:
                partner_done = _MEASURE_DONE.get((userid, paired_session))
            if partner_done is not None and not partner_done.is_set():
                print(f"[Final] 짝 손(세션 {paired_session})의 측정이 끝나길 기다리는 중 (최대 {PAIR_WAIT_SEC}초)")
                partner_done.wait(PAIR_WAIT_SEC)
        path = final_measurements.build_for_pair(
            os.path.join(BASE, "results"), userid, session, hand, paired_session)
        if path is None:
            print(f"[Final] {userid}/{session}/{hand}: 짝 손이 정해지지 않았거나 측정 결과가 없음 - 최종 JSON은 아직 안 만듦")
            return
        with open(path, encoding="utf-8") as f:
            meta = json.load(f)
        print(f"[Final] 최종 measurements.json 생성: {path}")
        _upload_final_measurements_async(path, userid, meta["leftSession"], meta["rightSession"])
    except Exception as e:
        print(f"[Final] 최종 measurements.json 생성 오류: {e}")


def _build_callback_data(userid: str, session: str, hand: str) -> dict:
    """손 하나의 측정이 끝났다는 상태만 Spring에 알린다 (분석 값은 보내지 않는다).

    피부톤/추천 컬러/치수 등 화면에 쓰는 값은 양손 최종 measurements.json에만 있고,
    Spring이 그 로컬 파일을 직접 읽는다. 여기서는 Spring이 이 스캔의 상태(MEASURED/FAILED)를
    바꿀 수 있도록 "측정에 성공한 손가락이 몇 개인지"만 보낸다.
    """
    measured = final_measurements.load_finger_payloads(
        os.path.join(BASE, "results"), userid, session, hand)
    if not measured:
        return {"success": False, "measuredFingers": 0,
                "message": "측정에 성공한 손가락이 없습니다."}
    return {"success": True, "measuredFingers": len(measured)}


def _run_measure_and_callback(userid: str, session: str, hand: str, callback_url: str,
                              paired_session: str | None = None):
    done_event = _measure_done_event(userid, session)
    try:
        # 1. 캡처 (카메라 사용) — 끝나는 순간 _S.active = False 됨
        _capture_all_fingers(userid, session, hand)

        # 2. 측정은 백그라운드로 분리 — 캡처 끝나자마자 다음 손 캡처 가능
        def _background_measure():
            try:
                try:
                    _run_measure_only(userid, session, hand)
                finally:
                    done_event.set()     # 오른손이 이 손을 기다리고 있을 수 있다
                # 이 손을 측정하는 사이에 스캔이 취소됐으면(예: 왼손 측정 중에 오른손 촬영 도중 나감)
                # 결과를 쓰지 않는다 - 성공 콜백이 가면 Spring에서 취소(FAILED)가 MEASURED로 덮인다.
                if _is_cancelled(userid, session) or _is_cancelled(userid, paired_session):
                    print(f"[Pipeline] 취소된 스캔 - 측정 결과를 쓰지 않음: {hand}/{session}")
                    requests.post(callback_url, json=_CANCELLED_CALLBACK)
                    return
                # 손 단위 합치기/분석은 없다 - 손가락별 파일만 쌓이다가, 반대 손도 측정돼 있으면
                # (=10손가락이 모이면) 양손 최종 measurements.json을 만든다.
                # 콜백(= Spring 상태 MEASURED)보다 먼저 만들어서, 화면이 "완료"를 본 시점에
                # 파일이 이미 있도록 한다.
                _build_final_measurements_if_ready(userid, session, hand, paired_session)
                data = _build_callback_data(userid, session, hand)
                requests.post(callback_url, json=data)
                print(f"[Pipeline] 콜백 완료: {hand}")
            except Exception as e:
                print(f"[Pipeline] 측정 오류: {e}")
                requests.post(callback_url, json={"success": False, "message": str(e)})

        threading.Thread(target=_background_measure, daemon=True).start()

    except ScanCancelled:
        done_event.set()
        print(f"[Scan] 촬영 취소됨: {userid}/{session}/{hand}")
        requests.post(callback_url, json=_CANCELLED_CALLBACK)
    except Exception as e:
        done_event.set()
        print(f"[Scan] 오류: {e}")
        requests.post(callback_url, json={"success": False, "message": str(e)})


def _run_stl_and_callback(userid: str, session: str, hand: str, shape: str, callback_url: str,
                          tip_extension_mm: float | None = None):
    """손가락별로 "내 실측 손톱 길이 + 연장 길이(tip_extension_mm)"짜리 STL을 만들어 로컬에 저장한다(S3 업로드 없음).
    tip_extension_mm이 None이면 nail_exact_stl.py가 쉐입별 기본값(TIP_EXTENSION_DEFAULT_MM)을 쓴다."""
    try:
        results_root = os.path.join(BASE, "results", userid, session, hand)
        stl_dir      = os.path.join(results_root, "stl")
        os.makedirs(stl_dir, exist_ok=True)
        rel_prefix   = f"results/{userid}/{session}/{hand}"   # 콜백에 담을 로컬 상대 경로의 앞부분

        # 입력은 손가락별 측정 파일(results/.../{finger}/nail_measurements.json) - 손별 파일은 없다
        finger_files = {
            f: os.path.join(results_root, f, final_measurements.FINGER_FILE)
            for f in FINGER_ORDER
            if os.path.isfile(os.path.join(results_root, f, final_measurements.FINGER_FILE))
        }
        if not finger_files:
            raise RuntimeError(f"손가락별 측정 파일 없음: {results_root}")
        available_fingers = set(finger_files)

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
                "--input", finger_files[finger], "--shape", shape, "--finger", finger, "--output", stl_dir,
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

        # STL은 S3에 올리지 않고 로컬(results/.../stl)에만 둔다 - 병합 단계가 여기서 바로 읽는다.
        # 이번에 못 만든 손가락의 예전 파일은 위에서 생성 직전에 이미 지웠기 때문에, 병합 단계에서
        # "빠진 손가락(missing)"으로 정상 처리된다(사용자가 고른 길이와 다른 옛 팁이 출력되지 않음).
        # stlUrl 자리에는 로컬 상대 경로를 보낸다(Spring은 이 값을 읽는 화면이 없다).
        fingers_data = [
            {"finger": finger.upper(),
             "stlUrl": f"{rel_prefix}/stl/nail_{finger}_{shape}.stl"}
            for finger in FINGER_ORDER if finger in succeeded
        ]

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
    # 이 손과 같은 스캔에서 찍는 반대 손의 세션(scanId). 오른손처럼 짝이 먼저 정해진 손에만 온다.
    # 이게 있어야 양손 최종 measurements.json이 만들어진다.
    pairedSession: str | None = None

class CancelScanRequest(BaseModel):
    # 취소할 세션들 - 같은 스캔의 왼손/오른손 scanId
    userid: str; sessions: list[str]

class StlRequest(BaseModel):
    userid: str; session: str; hand: str; shape: str; callbackUrl: str
    # 출력 화면에서 사용자가 설정한 팁 연장 길이(mm). 없으면 쉐입별 기본값을 쓴다.
    # (이 필드가 없으면 pydantic이 Spring이 보낸 값을 조용히 버린다)
    tip_extension_mm: float | None = None

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
    threading.Thread(target=_print_queue_worker, daemon=True).start()
    threading.Thread(target=_phone_side_idle_preview_loop, daemon=True).start()


@app.get("/health")
def health():
    return {"status": "ok"}


# ── 스캔 ─────────────────────────────────────────────────────

@app.post("/analyze/measure")
def analyze_measure(request: MeasureRequest):
    threading.Thread(
        target=_run_measure_and_callback,
        args=(request.userid, request.session, request.hand, request.callbackUrl, request.pairedSession),
        daemon=True,
    ).start()
    return {"status": "started", "message": "스캔이 시작되었습니다. 카메라 화면을 확인하세요."}


@app.post("/analyze/cancel")
def analyze_cancel(request: CancelScanRequest):
    """사용자가 촬영 도중 경고를 확인하고 페이지를 나가 스캔을 취소했을 때 Spring이 부른다.
    그 세션을 촬영 중이면 다음 손가락을 기다리지 않고 바로 멈추고, 이미 촬영이 끝나 측정 중인 손은
    측정이 끝나도 결과를 쓰지 않는다. 아직 촬영 요청이 오지 않은 세션은 나중에 와도 바로 취소된다."""
    keys = {(request.userid, str(s)) for s in request.sessions}
    with _CANCELLED_LOCK:
        _CANCELLED_SESSIONS.update(keys)
    if _S.capture_session in keys:
        _S.cancel_capture.set()
    print(f"[Scan] 스캔 취소 요청: {request.userid} / 세션 {', '.join(request.sessions)}")
    return {"status": "cancelled"}


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
    """탑뷰 정확도 게이지 + 손가락/큐티클 가이드 위치 + 안정 시 손톱 W/L 조회 — 프론트가
    짧은 주기로 폴링. guide는 마커를 아직 못 잡았으면 null (_top_guide 참고),
    measure는 촬영 가능(ready) 상태가 아니면 null (_top_measure 참고)."""
    return {**_S.stability, "guide": _top_guide(), "measure": _top_measure()}


# ── 폰 사이드뷰 카메라 ───────────────────────────────────────
# getUserMedia는 보안 컨텍스트(HTTPS 또는 localhost)에서만 동작하므로, 폰에서
# 이 페이지를 열 때는 LAN IP를 그대로 쓰지 말고 ngrok 같은 https 터널을 쓰거나
# 크롬의 "insecure origins treated as secure" 플래그에 이 서버 주소를 등록해야 함.

@app.get("/phone/side")
def phone_side_page():
    # 폰 브라우저가 예전 페이지를 캐시해 두면 새 기능(초점 보정 등)이 폰에서 안 돌아간다 → 캐시 금지
    return FileResponse(os.path.join(BASE, "phone_side.html"),
                        headers={"Cache-Control": "no-store, max-age=0"})


@app.post("/phone/side/frame")
async def phone_side_frame(request: Request):
    data = await request.body()
    # 디코딩 + 180도 회전은 이벤트 루프를 막지 않게 스레드풀에서 (탑뷰 측정이 바쁠 때도 프리뷰가 밀리지 않게)
    def _decode_and_push():
        frame = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
        if frame is not None:
            _phone_cam.push_preview(frame)
        return frame is not None
    ok = await asyncio.get_running_loop().run_in_executor(None, _decode_and_push)
    return {"ok": ok}


_phone_poll = {"t": 0.0, "v": None, "busy": None, "calibrating": None, "txt": None, "n": 0}


@app.get("/phone/side/status")
def phone_side_status(v: str = "", b: int = -1, c: int = -1, txt: str = ""):
    _phone_poll.update(t=time.time(), v=v or None, busy=b, calibrating=c, txt=txt or None, n=_phone_poll["n"] + 1)
    wanted = _phone_cam.capture_wanted()
    # 초점 보정 요청은 3분 안에 폰이 가져가지 않으면 버린다 (나중에 폰을 켰을 때 갑자기 시작되지 않게)
    if _phone_cam.calib_run is not None and time.time() - _phone_cam.calib_run > 180:
        _phone_cam.calib_run = None
    return {"capture": wanted, "point": _phone_cam.focus_point() if wanted else None,
            "calibrate": _phone_cam.calib_run, "fd": _phone_cam.focus_fd}


@app.post("/phone/side/photo")
async def phone_side_photo(request: Request):
    data = await request.body()
    frame = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is not None:
        _phone_cam.push_full_res(frame)
    return {"ok": frame is not None}


FOCUS_FILE = os.path.join(TEST_CAPTURE_DIR, "phone_focus.json")


def _load_focus_fd():
    try:
        with open(FOCUS_FILE, encoding="utf-8") as f:
            return json.load(f).get("fd")
    except Exception:
        return None


_phone_cam.focus_fd = _load_focus_fd()


@app.get("/phone/side/calibrate")
def phone_side_calibrate():
    """PC 브라우저에서 한 번 열면 폰이 초점 보정(수동 초점 거리를 훑으며 가장 선명한 거리 찾기)을 시작한다.
    손가락 하나를 박스에 평소처럼 넣고 가만히 둔 채로 연다. 약 20~30초 걸린다."""
    _phone_cam.calib_scores = []
    _phone_cam.calib_none = 0
    _phone_cam.calib_box = None
    try:
        with _phone_cam._lock:
            prev = None if _phone_cam._preview is None else _phone_cam._preview.copy()
        if prev is not None and finger_box_norm is not None:
            # 폰이 보내는 보정 프레임은 서버가 돌리기 전의 원래 방향이므로 상자도 그 방향으로 만든다
            _phone_cam.calib_box = finger_box_norm(cv2.rotate(prev, cv2.ROTATE_180))
    except Exception as e:
        print(f"[Calib] 손가락 상자 찾기 실패: {e}")
    _phone_cam.calib_run = int(time.time())
    os.makedirs(os.path.join(TEST_CAPTURE_DIR, "calib"), exist_ok=True)
    _set_side_note("FOCUS CALIBRATION requested - keep the finger still", (0, 220, 255), 40)
    return Response(
        "<meta charset='utf-8'><body style='font-family:sans-serif;padding:24px'>"
        "<h3>폰 초점 보정을 요청했습니다</h3><p>폰 화면이 켜져 있고 카메라 시작이 눌린 상태여야 합니다. "
        "손가락을 평소처럼 박스에 넣고 <b>약 30초 동안 가만히</b> 두세요. 진행 상황은 Naily 사이드뷰 화면 아래에 표시됩니다.</p>"
        "<p>결과 확인: <a href='/phone/side/focus'>/phone/side/focus</a></p></body>", media_type="text/html")


@app.post("/phone/side/calib")
async def phone_side_calib(request: Request, run: int = 0, fd: float = 0.0):
    """보정 중 폰이 보내는 프레임(해당 초점 거리에서 찍은 것) 한 장의 선명도를 잰다."""
    if _phone_cam.calib_run is None or run != _phone_cam.calib_run:
        return {"ok": False, "message": "no active calibration"}
    data = await request.body()
    box = _phone_cam.calib_box
    def _score():
        img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
        try:   # 나중에 점수를 다시 계산해 볼 수 있게 프레임을 남긴다
            with open(os.path.join(TEST_CAPTURE_DIR, "calib", f"{run}_fd{fd:.3f}.jpg"), "wb") as f:
                f.write(data)
        except Exception:
            pass
        return None if (img is None or focus_score is None) else focus_score(img, box)
    sc = await asyncio.get_running_loop().run_in_executor(None, _score)
    if sc is not None:
        _phone_cam.calib_scores.append((fd, sc))
    else:
        _phone_cam.calib_none += 1
    n = len(_phone_cam.calib_scores)
    _set_side_note(f"FOCUS CALIBRATION {n} frames measured", (0, 220, 255), 20)
    return {"ok": True, "score": sc}


@app.post("/phone/side/calib/peek")
def phone_side_calib_peek(run: int = 0):
    """거친 훑기가 끝난 뒤, 지금까지 가장 선명했던 거리를 알려준다 (폰이 그 주변을 촘촘히 다시 훑는다)."""
    if _phone_cam.calib_run is None or run != _phone_cam.calib_run or len(_phone_cam.calib_scores) < 5:
        return {"best": None}
    pts = max(_phone_cam.calib_scores, key=lambda p: p[1])
    return {"best": float(pts[0])}


@app.post("/phone/side/calib/done")
def phone_side_calib_done(run: int = 0):
    if _phone_cam.calib_run is None or run != _phone_cam.calib_run:
        return {"ok": False, "best": None}
    pts = sorted(_phone_cam.calib_scores)
    _phone_cam.calib_run = None
    if len(pts) < 5:
        _set_side_note("FOCUS CALIBRATION FAILED (finger not found in frames)", (60, 60, 255), 30)
        return {"ok": False, "best": None, "message": "too few usable frames"}
    fds = np.array([p[0] for p in pts]); sc = np.array([p[1] for p in pts])
    sm = np.convolve(np.pad(sc, 1, mode="edge"), np.ones(3) / 3.0, mode="valid")     # 3-tap smoothing
    i = int(np.argmax(sm))
    prominence = float(sm[i] / max(np.median(sm), 1e-6))
    edge = i in (0, len(sm) - 1)
    if prominence < 1.25:
        _set_side_note(f"FOCUS CALIBRATION: no clear peak ({prominence:.2f}x) - try again", (60, 60, 255), 30)
        return {"ok": False, "best": None, "prominence": prominence, "message": "no clear sharpness peak"}
    best = float(fds[i])
    if edge:
        # 피크가 초점 범위 끝이면 진짜 최적이 아니라 "점수가 평평하거나 단조로움"인 경우다(폰이 박스에 안 장착돼
        # 방을 찍고 있었는데 fd 0.0 이 저장돼 모든 사이드 촬영에 적용된 일이 있었다). 저장하지 않는다.
        _set_side_note("FOCUS CALIBRATION FAILED: peak at the edge of the range - check the phone is mounted "
                       "and the finger is in place, then try again", (60, 60, 255), 30)
        return {"ok": False, "best": None, "prominence": prominence, "at_edge_of_range": True,
                "message": "peak at range edge - not saved"}
    _phone_cam.focus_fd = best
    os.makedirs(TEST_CAPTURE_DIR, exist_ok=True)
    with open(FOCUS_FILE, "w", encoding="utf-8") as f:
        json.dump({"fd": best, "prominence": prominence, "at_edge_of_range": edge,
                   "scores": [[float(a), float(b)] for a, b in pts],
                   "at": datetime.now().isoformat(timespec="seconds")}, f, indent=2)
    _set_side_note(f"FOCUS SET: distance {best:.3f} ({prominence:.1f}x sharper than median)" + (" - AT RANGE EDGE" if edge else ""),
                   (80, 220, 80) if not edge else (0, 220, 255), 30)
    return {"ok": True, "best": best, "prominence": prominence, "at_edge_of_range": edge}


@app.get("/phone/side/focus")
def phone_side_focus():
    try:
        with open(FOCUS_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"fd": None, "message": "아직 초점 보정을 하지 않았습니다 (/phone/side/calibrate)"}


@app.get("/phone/side/debug")
def phone_side_debug():
    """폰 페이지가 마지막으로 서버에 물어본 시각/버전/상태 문구 - 폰 화면을 직접 볼 수 없을 때 진단용."""
    now = time.time()
    return {"seconds_since_last_poll": None if not _phone_poll["t"] else round(now - _phone_poll["t"], 1),
            "page_version": _phone_poll["v"], "phone_busy": _phone_poll["busy"], "phone_calibrating": _phone_poll["calibrating"],
            "phone_screen_text": _phone_poll["txt"], "polls": _phone_poll["n"],
            "preview_age_s": round(now - _phone_cam._last_preview_t, 1) if _phone_cam._last_preview_t else None,
            "calibration_requested": _phone_cam.calib_run, "calibration_frames": len(_phone_cam.calib_scores),
            "calibration_unscored_frames": _phone_cam.calib_none, "calibration_box": _phone_cam.calib_box,
            "focus_fd": _phone_cam.focus_fd}


@app.post("/phone/side/caps")
async def phone_side_caps(request: Request):
    """폰 카메라 페이지가 보고하는 카메라 지원 기능/현재 설정 (초점·노출 고정이 실제로 먹는지 확인용)."""
    try:
        body = await request.json()
        os.makedirs(TEST_CAPTURE_DIR, exist_ok=True)
        with open(os.path.join(TEST_CAPTURE_DIR, "phone_caps.json"), "w", encoding="utf-8") as f:
            json.dump(body, f, indent=2, ensure_ascii=False)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/phone/side/caps")
def phone_side_caps_get():
    p = os.path.join(TEST_CAPTURE_DIR, "phone_caps.json")
    if not os.path.isfile(p):
        return {"ok": False, "message": "아직 폰이 보고한 값이 없습니다."}
    with open(p, encoding="utf-8") as f:
        return json.load(f)


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
        return {
            "success": True,
            "queueSize": _print_job_queue.qsize(),  # ← 추가
            **_fetch_printer_status()
        }
    except Exception as e:
        return {"success": False, "message": str(e)}


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
    _enqueue_print_job({"mergedModelUrl": request.mergedModelUrl,
                        "outputDir": request.outputDir,
                        "callbackUrl": request.callbackUrl})
    waiting = _print_job_queue.qsize() - 1
    return {
        "status": "queued",
        "queuePosition": _print_job_queue.qsize(),
        "message": f"출력 대기열에 추가되었습니다. (앞에 {waiting}개 대기 중)"
    }

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