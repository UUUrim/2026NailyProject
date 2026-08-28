"""
server.py — A안 (스캔 서버 주도 아키텍처)
-----------------------------------------
스캔 서버가 로컬 카메라로 직접 촬영 → 측정 → STL 생성 → 결과만 S3 업로드 → Spring Boot 콜백

흐름:
  POST /analyze/measure
    1. 로컬 카메라로 5손가락 순차 촬영 (탑뷰 + 측면뷰)
    2. nail_measurer.py 로 각 손가락 측정
    3. personal_color.py 로 퍼스널컬러 진단
    4. annotated 이미지 + 측정 JSON → S3 업로드
    5. Spring Boot 콜백 (측정값 + annotated URL)

  POST /analyze/stl
    1. 저장된 측정값으로 nail_exact_stl.py 실행
    2. STL → S3 업로드
    3. Spring Boot 콜백 (STL URL)

Usage:
    uvicorn server:app --host 0.0.0.0 --port 8000 --reload
"""

import json
import math
import os
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
from pydantic import BaseModel

from skin_color import recommend_nail_colors, lab_to_rgb_hex

BASE         = os.path.dirname(os.path.abspath(__file__))
BUCKET       = "naily-scans"
FINGER_ORDER = ["thumb", "index", "middle", "ring", "pinky"]

# ── 카메라 설정 (환경에 맞게 조정) ────────────────────────────
CAMERA_TOP        = 0       # 탑뷰 카메라 인덱스
CAMERA_SIDE       = 1       # 측면뷰(end-on C-curve) 카메라 인덱스 (-1: 없음)
ARUCO_SIZE_MM     = 20.0    # ArUco 마커 실물 크기 (mm)
CROP_BOTTOM_PX    = 0       # 탑뷰 하단 crop 픽셀 (0 = 크롭 없음; 더 이상 필요하지 않음)
STABLE_FRAMES     = 20      # ArUco 안정 판정 프레임 수
STABLE_PX_THRESH  = 20      # 안정 판정 픽셀 임계값
COUNTDOWN_SEC     = 3       # 자동 촬영 카운트다운 (초)
SKIN_FRACTION_MIN = 0.04    # 손가락 감지 최소 피부 비율
# 탑뷰 웹 스트림에서 ArUco 마커를 가리기 위한 왼쪽 crop 설정 (측정용 저장
# 사진에는 영향 없음 — _capture_top_stream 참고).
MARKER_HIDE_MARGIN_PX      = 40    # 마커 오른쪽 끝에서 추가로 더 잘라낼 여백
MARKER_HIDE_MIN_VISIBLE_PX = 200   # 잘라내고도 최소한 이만큼은 화면에 남긴다
# ─────────────────────────────────────────────────────────────

app = FastAPI()


# ── .env 로드 ─────────────────────────────────────────────────
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


# ── S3 ────────────────────────────────────────────────────────
def _s3_client():
    return boto3.client(
        "s3",
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
        region_name=os.environ.get("AWS_DEFAULT_REGION", "ap-northeast-2"),
    )

def _s3_url(key: str) -> str:
    return f"https://{BUCKET}.s3.amazonaws.com/{key}"

def _upload_file(local_path: str, s3_key: str):
    client = _s3_client()
    client.upload_file(local_path, BUCKET, s3_key)
    print(f"  [S3] 업로드: {s3_key}")


# ── 카메라 유틸 ──────────────────────────────────────────────
# nail_measurer.py의 오프라인 detect_aruco()가 실제로 인식하는 딕셔너리
# 전부와 맞춰야 한다 — 라이브 스트림에서 4x4_50 하나만 쓰던 이전 코드는
# 이 리그에 실제로 붙어있는 마커(6x6_50)를 한 번도 인식하지 못했다.
# 그 결과 화면의 "마커: ✓/✗" 표시, 자동 촬영(안정화→카운트다운) 게이트가
# 전부 조용히 죽어있었고, 지금 추가하는 마커-가림 crop도 똑같이 동작하지
# 않았을 것 — 그래서 여기서 같이 고친다.
ARUCO_DICTS = {
    "4x4_50":  aruco.DICT_4X4_50,
    "4x4_100": aruco.DICT_4X4_100,
    "5x5_50":  aruco.DICT_5X5_50,
    "5x5_100": aruco.DICT_5X5_100,
    "6x6_50":  aruco.DICT_6X6_50,
    "6x6_100": aruco.DICT_6X6_100,
}

def _make_aruco_detectors():
    """One ArucoDetector per dictionary in ARUCO_DICTS."""
    return [aruco.ArucoDetector(aruco.getPredefinedDictionary(did),
                                aruco.DetectorParameters())
            for did in ARUCO_DICTS.values()]


def _detect_markers_multi(detectors: list, gray: np.ndarray, prefer_idx: int = 0):
    """Try *detectors* starting at prefer_idx (whichever dict matched last
    frame) so the common case costs one detectMarkers() call, falling back
    to scanning the rest only when that one misses (e.g. the very first
    frame, or a dropped detection). Returns (corners, ids, matched_idx) —
    matched_idx is None when nothing matched this frame.
    """
    order = [prefer_idx] + [i for i in range(len(detectors)) if i != prefer_idx]
    for i in order:
        corners, ids, _ = detectors[i].detectMarkers(gray)
        if ids is not None and len(ids) > 0:
            return corners, ids, i
    return None, None, None

def _detect_finger(frame: np.ndarray):
    """HSV로 피부색 감지. (finger_present, skin_fraction) 반환."""
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv,
                       np.array([0, 20, 60],  dtype=np.uint8),
                       np.array([25, 200, 255], dtype=np.uint8))
    frac = mask.sum() / 255.0 / (frame.shape[0] * frame.shape[1])
    return frac >= SKIN_FRACTION_MIN, frac

def _marker_center(corners):
    return corners[0][0].mean(axis=0)


# ── 손가락 1개 탑뷰 촬영 ─────────────────────────────────────
def _capture_top(cap: cv2.VideoCapture, detector, finger: str, save_path: str) -> bool:
    """
    탑뷰 카메라로 한 손가락 촬영.
    ArUco + 손가락 안정 → 자동 카운트다운 → 촬영 → ENTER 확인
    Returns: True(저장 성공) / False(취소)
    """
    win = f"Nail Scan — {finger.upper()} [탑뷰]  |  SPACE:강제촬영  Q:종료"
    recent = deque(maxlen=STABLE_FRAMES)
    countdown_start = None
    captured = None

    print(f"\n  [{finger}] 탑뷰 촬영 — ArUco 마커 + 손가락을 카메라에 보이게 해주세요.")

    while True:
        ret, frame = cap.read()
        if not ret:
            print(f"  [{finger}] 카메라 읽기 실패")
            return False

        h, w = frame.shape[:2]
        key = cv2.waitKey(1) & 0xFF

        if key == ord('q'):
            cv2.destroyWindow(win)
            return False

        # ── 리뷰 모드 (촬영 완료 후 확인)
        if captured is not None:
            disp = captured.copy()
            cv2.putText(disp, "ENTER: 저장  |  R: 다시 찍기  |  Q: 종료",
                        (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 200, 255), 2)
            cv2.rectangle(disp, (0, 0), (w-1, h-1), (0, 200, 255), 8)
            cv2.imshow(win, disp)
            if key == 13:  # ENTER
                y2 = h - CROP_BOTTOM_PX if CROP_BOTTOM_PX > 0 else h
                cv2.imwrite(save_path, captured[:y2, :])
                print(f"  [{finger}] 탑뷰 저장 완료: {save_path}")
                cv2.destroyWindow(win)
                return True
            elif key == ord('r'):
                captured = None
                recent.clear()
                countdown_start = None
            continue

        # ── 라이브 프리뷰
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        corners, ids, _ = detector.detectMarkers(gray)
        detected = ids is not None and len(ids) > 0
        finger_ok, frac = _detect_finger(frame)

        if detected and finger_ok:
            cx, cy = _marker_center(corners)
            recent.append((cx, cy))
        else:
            recent.clear()
            countdown_start = None

        spread = None
        if len(recent) >= 2:
            xs = [p[0] for p in recent]
            ys = [p[1] for p in recent]
            spread = max(max(xs) - min(xs), max(ys) - min(ys))

        if detected and finger_ok and len(recent) == STABLE_FRAMES:
            if spread is not None and spread <= STABLE_PX_THRESH:
                if countdown_start is None:
                    countdown_start = time.time()
            else:
                countdown_start = None

        countdown_val = None
        if countdown_start is not None:
            elapsed = time.time() - countdown_start
            remaining = COUNTDOWN_SEC - elapsed
            if remaining <= 0:
                captured = frame.copy()
                countdown_start = None
                recent.clear()
                continue
            countdown_val = int(remaining) + 1

        if key == ord(' '):
            captured = frame.copy()
            countdown_start = None
            recent.clear()
            continue

        # 화면 표시
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
            color = (0, 255, 0) if (detected and finger_ok) else \
                    (0, 165, 255) if detected else (0, 0, 255)
            cv2.rectangle(disp, (0, 0), (w-1, h-1), color, 8)
            status = (f"마커: {'OK' if detected else 'NG'}  |  "
                      f"손가락: {'OK' if finger_ok else 'NG'}  |  "
                      f"피부: {frac*100:.1f}%")
            cv2.putText(disp, status, (10, 40),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.75, color, 2)

        # crop 가이드선
        if CROP_BOTTOM_PX > 0:
            cv2.line(disp, (0, h - CROP_BOTTOM_PX), (w, h - CROP_BOTTOM_PX),
                     (255, 255, 0), 2)

        cv2.imshow(win, disp)


# ── 손가락 1개 측면뷰 촬영 (end-on C-curve) ─────────────────
def _capture_side(cap: cv2.VideoCapture, finger: str, save_path: str) -> bool:
    """
    측면뷰(end-on) 카메라로 C-curve 촬영.
    SPACE로 촬영, ENTER 확인. Q/ENTER(영상 없이)로 스킵 가능.
    Returns: True(저장 성공) / False(스킵/취소)
    """
    win = f"Nail Scan — {finger.upper()} [측면뷰 C-curve]  |  SPACE:촬영  Q:스킵"
    captured = None
    print(f"  [{finger}] 측면뷰 촬영 — 손가락 끝을 카메라 방향으로 향하게 해주세요.")

    while True:
        ret, frame = cap.read()
        if not ret:
            print(f"  [{finger}] 측면 카메라 읽기 실패 → 스킵")
            cv2.destroyWindow(win)
            return False

        h, w = frame.shape[:2]
        key = cv2.waitKey(1) & 0xFF

        if key == ord('q'):
            print(f"  [{finger}] 측면뷰 스킵 → brightness fallback 사용")
            cv2.destroyWindow(win)
            return False

        if captured is not None:
            disp = captured.copy()
            cv2.putText(disp, "ENTER: 저장  |  R: 다시 찍기  |  Q: 스킵",
                        (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 200, 255), 2)
            cv2.rectangle(disp, (0, 0), (w-1, h-1), (0, 200, 255), 8)
            cv2.imshow(win, disp)
            if key == 13:
                cv2.imwrite(save_path, captured)
                print(f"  [{finger}] 측면뷰 저장 완료: {save_path}")
                cv2.destroyWindow(win)
                return True
            elif key == ord('r'):
                captured = None
            continue

        disp = frame.copy()
        cv2.putText(disp, "SPACE: 촬영  |  Q: 스킵(brightness fallback)",
                    (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 0), 2)
        cv2.rectangle(disp, (0, 0), (w-1, h-1), (180, 180, 0), 4)
        cv2.imshow(win, disp)

        if key == ord(' '):
            captured = frame.copy()


# ── 5손가락 순차 촬영 (메인 캡처 함수) ──────────────────────
def capture_all_fingers(userid: str, session: str, hand: str) -> str:
    """
    로컬 카메라로 5손가락을 순차적으로 촬영.
    탑뷰(필수) + 측면뷰(선택, CAMERA_SIDE >= 0 일 때).
    Returns: 사진이 저장된 로컬 디렉토리 경로
    """
    local_dir = os.path.join(BASE, "photos", userid, session, hand)
    os.makedirs(local_dir, exist_ok=True)

    # 탑뷰 카메라 열기
    cap_top = cv2.VideoCapture(CAMERA_TOP, cv2.CAP_DSHOW)
    cap_top.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
    cap_top.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
    if not cap_top.isOpened():
        raise RuntimeError(f"탑뷰 카메라(인덱스 {CAMERA_TOP})를 열 수 없습니다.")

    # 측면뷰 카메라 열기 (옵션)
    cap_side = None
    if CAMERA_SIDE >= 0:
        _c = cv2.VideoCapture(CAMERA_SIDE, cv2.CAP_DSHOW)
        if _c.isOpened():
            cap_side = _c
            print(f"[Capture] 측면뷰 카메라(인덱스 {CAMERA_SIDE}) 연결됨")
        else:
            print(f"[Capture] 측면뷰 카메라(인덱스 {CAMERA_SIDE}) 없음 → brightness fallback")

    detector = _make_aruco_detector()

    try:
        for finger in FINGER_ORDER:
            top_path  = os.path.join(local_dir, f"{finger}_top.jpg")
            side_path = os.path.join(local_dir, f"{finger}_side.jpg")

            # 탑뷰 촬영
            ok = _capture_top(cap_top, detector, finger, top_path)
            if not ok:
                print(f"  [{finger}] 탑뷰 촬영 건너뜀")
                continue

            # 측면뷰 촬영 (카메라 있을 때만)
            if cap_side:
                _capture_side(cap_side, finger, side_path)

    finally:
        cap_top.release()
        if cap_side:
            cap_side.release()
        cv2.destroyAllWindows()

    return local_dir


# ── crop + measure ───────────────────────────────────────────
def run_measure_only(userid: str, session: str, hand: str):
    photos_root  = os.path.join(BASE, "photos",  userid, session, hand)
    results_root = os.path.join(BASE, "results", userid, session, hand)

    for finger in FINGER_ORDER:
        top_path   = os.path.join(photos_root, f"{finger}_top.jpg")
        side_path  = os.path.join(photos_root, f"{finger}_side.jpg")
        finger_out = os.path.join(results_root, finger)
        os.makedirs(finger_out, exist_ok=True)

        if not os.path.isfile(top_path):
            print(f"  [{finger}] 탑뷰 사진 없음 → 건너뜀")
            continue

        # nail_capture.py에서 이미 crop해서 저장했으므로 추가 crop 불필요.
        # 혹시 raw 사진이면 하단 crop (이미 저장시 crop 됐으면 그대로 사용)
        cmd = [
            sys.executable,
            os.path.join(BASE, "nail_measurer.py"),
            "--top",        top_path,
            "--finger",     finger,
            "--aruco-size", str(ARUCO_SIZE_MM),
            "--output",     finger_out,
        ]
        if os.path.isfile(side_path):
            cmd += ["--ccurve-top", side_path]
            print(f"  [{finger}] C-curve: end-on 사진 사용")
        else:
            print(f"  [{finger}] C-curve: brightness fallback")

        result = subprocess.run(cmd, cwd=BASE, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"  [{finger}] 측정 실패: {result.stderr[-300:]}")
            continue
        print(f"  [{finger}] 측정 완료")


# ── 손가락 1개 즉시 분석 (크기/C-curve + 피부 LAB) ──────────────
def _analyze_finger(userid: str, session: str, hand: str, finger: str):
    """
    이 손가락의 top(+side) 촬영이 끝나는 즉시 백그라운드 스레드에서 실행.
    capture_all_fingers가 이 스레드를 기다리지 않고 바로 다음 손가락
    촬영으로 넘어가므로, 촬영과 분석이 병렬로 겹쳐 돌아간다 — 카메라가
    분석 때문에 멈추지 않는다는 게 이 함수를 쓰는 이유.
    """
    photos_root  = os.path.join(BASE, "photos",  userid, session, hand)
    results_root = os.path.join(BASE, "results", userid, session, hand)
    top_path     = os.path.join(photos_root, f"{finger}_top.jpg")
    side_path    = os.path.join(photos_root, f"{finger}_side.jpg")
    finger_out   = os.path.join(results_root, finger)
    os.makedirs(finger_out, exist_ok=True)

    if not os.path.isfile(top_path):
        print(f"  [{finger}] 탑뷰 사진 없음 → 분석 스킵")
        _push_event({"type": "finger_measured", "finger": finger.upper(), "ok": False})
        return

    cmd = [
        sys.executable,
        os.path.join(BASE, "nail_measurer.py"),
        "--top",        top_path,
        "--finger",     finger,
        "--aruco-size", str(ARUCO_SIZE_MM),
        "--output",     finger_out,
    ]
    if os.path.isfile(side_path):
        cmd += ["--ccurve-top", side_path]

    result = subprocess.run(cmd, cwd=BASE, capture_output=True, text=True)
    ok = result.returncode == 0
    if not ok:
        print(f"  [{finger}] 측정 실패: {result.stderr[-300:]}")
    else:
        print(f"  [{finger}] 측정 완료 (백그라운드)")
    _push_event({"type": "finger_measured", "finger": finger.upper(), "ok": ok})


# ── 결과를 S3에 업로드 ────────────────────────────────────────
def upload_results_to_s3(userid: str, session: str, hand: str):
    """
    annotated 이미지 + 측정 JSON + 취합 결과(scan_result.json)를 S3에 업로드.
    STL은 나중에 run_stl_and_callback에서 별도 업로드.
    """
    results_root = os.path.join(BASE, "results", userid, session, hand)
    s3_prefix    = f"results/{userid}/{session}/{hand}"

    # 손 전체 취합 결과 (skinToneHex/tone/brightness/saturation/recommendedColors
    # 등 콜백으로 보내는 것과 동일한 내용) — run_measure_and_callback이 콜백
    # 보내기 전에 미리 파일로 저장해둔다.
    result_json_path = os.path.join(results_root, "scan_result.json")
    if os.path.isfile(result_json_path):
        _upload_file(result_json_path, f"{s3_prefix}/scan_result.json")

    for finger in FINGER_ORDER:
        finger_dir = os.path.join(results_root, finger)
        for fname in [
            f"{finger}_annotated.jpg",
            "nail_measurements.json",
            "profile.json",
        ]:
            local_path = os.path.join(finger_dir, fname)
            if os.path.isfile(local_path):
                _upload_file(local_path, f"{s3_prefix}/{finger}/{fname}")


# ── nan/inf 안전 변환 ─────────────────────────────────────────
def safe_float(val, default=0.0):
    try:
        v = float(val) if val is not None else default
        if math.isnan(v) or math.isinf(v):
            return default
        return v
    except (TypeError, ValueError):
        return default


# ── 콜백 데이터 빌드 ─────────────────────────────────────────
def build_callback_data(userid: str, session: str, hand: str) -> dict:
    results_root = os.path.join(BASE, "results", userid, session, hand)
    s3_prefix    = f"results/{userid}/{session}/{hand}"

    fingers_data = []
    skin_tones   = []
    skin_metrics = []
    sizes        = []

    for finger in FINGER_ORDER:
        finger_dir        = os.path.join(results_root, finger)
        measurements_path = os.path.join(finger_dir, "nail_measurements.json")
        profile_path      = os.path.join(finger_dir, "profile.json")

        if not os.path.exists(measurements_path) or not os.path.exists(profile_path):
            print(f"  [{finger}] 결과 파일 없음 → 건너뜀")
            continue

        try:
            with open(measurements_path) as f:
                measurements_json = json.load(f)
            finger_data = measurements_json.get("by_finger", {}).get(finger, {})

            with open(profile_path) as f:
                profile = json.load(f)

            # profile.json 구조: {"summary": {"nail_size": ...}, "fingers": [...]}
            summary     = profile.get("summary") or {}
            nail_size   = summary.get("nail_size", "average")
            skin_tone   = finger_data.get("skin_tone_hex", "")

            if skin_tone:
                skin_tones.append(skin_tone)
            sizes.append(nail_size)

            # nail_measurer.py가 손톱판/매니큐어를 피한 밴드에서 뽑아준 LAB
            # 메트릭 — 있는 손가락만 모아서 나중에 평균낸다.
            if finger_data.get("skin_L") is not None:
                skin_metrics.append({
                    "L":         finger_data["skin_L"],
                    "a":         finger_data["skin_a"],
                    "b":         finger_data["skin_b"],
                    "warmness":  finger_data["skin_warmness"],
                    "saturation": finger_data["skin_saturation"],
                })

            # S3에 올라간 annotated 이미지 URL
            annotated_s3_key = f"{s3_prefix}/{finger}/{finger}_annotated.jpg"
            annotated_url    = _s3_url(annotated_s3_key)

            fingers_data.append({
                "finger":            finger.upper(),
                "annotatedImageUrl": annotated_url,
                "measurements": {
                    "widthMm":           safe_float(finger_data.get("width_mm")),
                    "lengthMm":          safe_float(finger_data.get("length_mm")),
                    "correctedLengthMm": safe_float(finger_data.get("corrected_length_mm")),
                    "cCurveMm":          safe_float(finger_data.get("c_curve_mm")),
                    "arcRadiusMm":       safe_float(finger_data.get("arc_radius_mm")),
                    "thicknessMm":       safe_float(finger_data.get("thickness_mm")),
                },
                "size": nail_size,
            })
        except Exception as e:
            print(f"  [{finger}] 결과 읽기 오류: {e}")
            continue

    skin_tone_hex      = skin_tones[0] if skin_tones else "#C8A882"
    overall_size       = max(set(sizes), key=sizes.count) if sizes else "average"
    recommended_colors = []
    tone               = None
    brightness         = None
    saturation         = None

    # 유효한 손가락들의 LAB 평균으로 피부색/웜쿨/명도/채도/추천컬러 30개를
    # 한 번에 계산한다 (손가락 1개짜리 사진보다 평균이 더 안정적).
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
        "shape":             "round",
        "skinToneHex":       skin_tone_hex,
        "overallSize":       overall_size,
        "recommendedColors": recommended_colors,
        "tone":              tone,
        "brightness":        brightness,
        "saturation":        saturation,
        "fingers":           fingers_data,
    }


# ── 측정 파이프라인 ──────────────────────────────────────────
def run_measure_and_callback(userid: str, session: str, hand: str, callback_url: str):
    try:
        print(f"\n[Pipeline] 촬영 시작: {userid}/{session}/{hand}")
        capture_all_fingers(userid, session, hand)

        # 각 손가락 측정은 이미 촬영 도중 백그라운드로 시작됐다.
        # 마지막 한두 손가락 것만 아직 안 끝났을 수 있으므로 여기서 마저 기다린다.
        print(f"[Pipeline] 백그라운드 측정 마무리 대기 ({len(_S.pending_analysis)}개)")
        for t in _S.pending_analysis:
            t.join()

        print(f"[Pipeline] 결과 취합 (크기/C-curve/피부색/추천 30색)")
        callback_data = build_callback_data(userid, session, hand)

        # 취합 결과를 scan_result.json으로 저장 — upload_results_to_s3가
        # 이 파일도 함께 S3에 올린다. 콜백 payload와 완전히 동일한 내용.
        results_root      = os.path.join(BASE, "results", userid, session, hand)
        os.makedirs(results_root, exist_ok=True)
        result_json_path  = os.path.join(results_root, "scan_result.json")
        with open(result_json_path, "w", encoding="utf-8") as f:
            json.dump(callback_data, f, ensure_ascii=False, indent=2)

        print(f"[Pipeline] 결과 S3 업로드")
        upload_results_to_s3(userid, session, hand)

        print(f"[Pipeline] 콜백 전송: {callback_url}")
        response = requests.post(callback_url, json=callback_data)
        print(f"[Pipeline] 콜백 응답: {response.status_code}")

    except Exception as e:
        print(f"[Pipeline] 오류: {e}")
        requests.post(callback_url, json={"success": False, "message": str(e)})


# ── STL 생성 파이프라인 ──────────────────────────────────────
def run_stl_and_callback(userid: str, session: str, hand: str, shape: str, callback_url: str):
    try:
        results_root = os.path.join(BASE, "results", userid, session, hand)
        stl_dir      = os.path.join(results_root, "stl")
        os.makedirs(stl_dir, exist_ok=True)
        s3_prefix    = f"results/{userid}/{session}/{hand}"
        s3_base_url  = f"https://{BUCKET}.s3.amazonaws.com"

        for finger in FINGER_ORDER:
            measurements_path = os.path.join(results_root, finger, "nail_measurements.json")
            if not os.path.isfile(measurements_path):
                print(f"[STL] {finger}: 측정 JSON 없음 → 건너뜀")
                continue

            result = subprocess.run(
                [
                    sys.executable,
                    os.path.join(BASE, "nail_exact_stl.py"),
                    "--input",  measurements_path,
                    "--shape",  shape,
                    "--finger", finger,
                    "--output", stl_dir,
                ],
                cwd=BASE, capture_output=True, text=True,
            )
            if result.returncode != 0:
                print(f"[STL] {finger} 오류: {result.stderr[-200:]}")

        # STL → S3 업로드
        from s3_upload import upload_folder
        upload_folder(stl_dir, f"{s3_prefix}/stl")

        fingers_data = [
            {
                "finger": finger.upper(),
                "stlUrl": f"{s3_base_url}/{s3_prefix}/stl/nail_{finger}_{shape}.stl",
            }
            for finger in FINGER_ORDER
        ]
        response = requests.post(callback_url, json={"fingers": fingers_data})
        print(f"[STL] 콜백 응답: {response.status_code}")

    except Exception as e:
        print(f"[STL] 오류: {e}")
        requests.post(callback_url, json={"success": False, "message": str(e)})


# ── API 모델 ─────────────────────────────────────────────────
class MeasureRequest(BaseModel):
    userid:      str
    session:     str
    hand:        str
    callbackUrl: str

class StlRequest(BaseModel):
    userid:      str
    session:     str
    hand:        str
    shape:       str
    callbackUrl: str


# ── 엔드포인트 ───────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/analyze/measure")
def analyze_measure(request: MeasureRequest):
    print(f"\n[Server] measure 요청: {request}")
    thread = threading.Thread(
        target=run_measure_and_callback,
        args=(request.userid, request.session, request.hand, request.callbackUrl),
        daemon=True,
    )
    thread.start()
    return {"status": "started", "message": "스캔이 시작되었습니다. 카메라 화면을 확인하세요."}

@app.post("/analyze/stl")
def analyze_stl(request: StlRequest):
    print(f"\n[Server] STL 요청: {request}")
    thread = threading.Thread(
        target=run_stl_and_callback,
        args=(request.userid, request.session, request.hand, request.shape, request.callbackUrl),
        daemon=True,
    )
    thread.start()
    return {"status": "started", "message": "STL 생성이 시작되었습니다."}


# ═══════════════════════════════════════════════════════════════
# 웹 스트리밍 추가 (A안 — 스캔 서버가 카메라 직접 제어)
# ═══════════════════════════════════════════════════════════════

import asyncio
import queue as _q
from fastapi import WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # 실제 배포 시 EC2 도메인으로 제한
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 스트리밍 세션 전역 상태 ───────────────────────────────────
class _StreamState:
    def __init__(self):
        # 최신 프레임만 유지 (MJPEG 스트리밍용)
        self.top_frame:  _q.Queue = _q.Queue(maxsize=1)
        self.side_frame: _q.Queue = _q.Queue(maxsize=1)
        # SSE 이벤트 큐 (손가락 진행상황)
        self.events: _q.Queue = _q.Queue(maxsize=200)
        # 수동 촬영 트리거
        self.force_capture: threading.Event = threading.Event()
        # 현재 상태
        self.active: bool = False
        self.current_finger: str | None = None
        self.done_fingers: list = []
        # 손가락별 측정/컬러 분석이 백그라운드에서 도는 스레드들.
        # 캡처 루프는 이걸 기다리지 않고 바로 다음 손가락으로 넘어가고,
        # 콜백을 보내기 직전에만 전부 join해서 기다린다.
        self.pending_analysis: list = []

_S = _StreamState()


def _push_frame(q: _q.Queue, frame: np.ndarray):
    """큐가 가득 차면 오래된 프레임 버리고 새 프레임 넣기."""
    if q.full():
        try:
            q.get_nowait()
        except _q.Empty:
            pass
    q.put(frame)


def _push_event(payload: dict):
    """SSE 이벤트 큐에 상태 업데이트 추가."""
    try:
        _S.events.put_nowait(payload)
    except _q.Full:
        pass


# ── 탑뷰 헤드리스 캡처 (GUI 없이, 프레임을 스트림 큐에 넣음) ─
def _capture_top_stream(cap: cv2.VideoCapture,
                        detectors: list, finger: str, save_path: str) -> bool:
    """
    GUI 없이 탑뷰 캡처.
    - 처리된 프레임(오버레이 포함)을 _S.top_frame 큐에 실시간 push
    - 안정 상태 → 자동 카운트다운 → 촬영
    - /capture/force 로 수동 촬영 가능
    Returns: True(저장 성공) / False(취소)

    측정용 사진(save_path)은 ArUco 마커가 그대로 찍힌 원본 프레임(frame)을
    저장한다 — 스케일 계산에 마커가 필요하기 때문. 반면 웹으로 스트리밍하는
    화면(disp)은 마커가 있는 왼쪽 구간을 잘라내고 내보낸다 — 사용자가 우리
    마커 디자인을 보지 못하게 하기 위해서다. 두 프레임은 여기서부터 서로
    다른 배열이라 한쪽을 바꿔도 다른 쪽에 영향이 없다.
    """
    recent = deque(maxlen=STABLE_FRAMES)
    countdown_start = None
    _S.force_capture.clear()

    # 마커를 가리기 위해 왼쪽에서 잘라낼 폭(px). 마커가 처음 잡힐 때부터
    # 그 오른쪽 끝 + 여백으로 갱신되고, 이후 마커가 잠깐 안 잡히는 프레임에도
    # (조명/각도 흔들림 등) 화면이 매 프레임 깜빡이지 않도록 마지막 값을 유지한다.
    marker_hide_x = 0
    dict_idx = 0   # 마지막으로 성공한 딕셔너리 — 다음 프레임에 그것부터 시도

    _push_event({"type": "finger_start", "finger": finger.upper()})
    print(f"\n  [{finger}] 탑뷰 스트리밍 시작 (웹에서 확인)")

    while True:
        ret, frame = cap.read()
        if not ret:
            return False

        h, w = frame.shape[:2]

        # ── ArUco + 손가락 감지
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        corners, ids, matched_idx = _detect_markers_multi(detectors, gray, dict_idx)
        detected = ids is not None and len(ids) > 0
        if matched_idx is not None:
            dict_idx = matched_idx
        finger_ok, frac = _detect_finger(frame)

        if detected:
            marker_right_px = int(round(float(corners[0][0][:, 0].max())))
            marker_hide_x = min(
                max(marker_hide_x, marker_right_px + MARKER_HIDE_MARGIN_PX),
                w - MARKER_HIDE_MIN_VISIBLE_PX)

        # ── 안정성 추적
        if detected and finger_ok:
            cx, cy = _marker_center(corners)
            recent.append((cx, cy))
        else:
            recent.clear()
            countdown_start = None

        spread = None
        if len(recent) >= 2:
            xs = [p[0] for p in recent]
            ys = [p[1] for p in recent]
            spread = max(max(xs) - min(xs), max(ys) - min(ys))

        if detected and finger_ok and len(recent) == STABLE_FRAMES:
            if spread is not None and spread <= STABLE_PX_THRESH:
                if countdown_start is None:
                    countdown_start = time.time()
                    _push_event({"type": "countdown_start", "finger": finger.upper()})
            else:
                countdown_start = None

        countdown_val = None
        elapsed = 0.0
        if countdown_start is not None:
            elapsed = time.time() - countdown_start
            remaining = COUNTDOWN_SEC - elapsed
            countdown_val = max(1, int(remaining) + 1)

        # ── 오버레이 그리기 (마커가 찍힌 왼쪽 구간을 잘라낸 화면 위에)
        disp = frame[:, marker_hide_x:].copy()
        dh, dw = disp.shape[:2]

        if countdown_val is not None:
            color = (0, 255, 0)
            cv2.rectangle(disp, (0, 0), (dw-1, dh-1), color, 12)
            cv2.putText(disp, str(countdown_val),
                        (dw // 2 - 60, dh // 2 + 80),
                        cv2.FONT_HERSHEY_SIMPLEX, 10, color, 20, cv2.LINE_AA)
            cv2.putText(disp, "가만히! 자동 촬영 중...",
                        (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.9, color, 2)
        else:
            color = (0, 255, 0) if (detected and finger_ok) else \
                    (0, 165, 255) if detected else (0, 0, 255)
            cv2.rectangle(disp, (0, 0), (dw-1, dh-1), color, 8)
            label = (f"{finger.upper()}  |  "
                     f"마커: {'✓' if detected else '✗'}  |  "
                     f"손가락: {'✓' if finger_ok else '✗'}  |  "
                     f"피부: {frac*100:.0f}%")
            cv2.putText(disp, label, (10, 40),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.75, color, 2)
            # 안정화 진행 바
            if detected and finger_ok and len(recent) > 0:
                ratio = min(len(recent) / STABLE_FRAMES, 1.0)
                bar_w = int((dw - 20) * ratio)
                cv2.rectangle(disp, (10, dh - 25), (10 + bar_w, dh - 10), color, -1)
                cv2.rectangle(disp, (10, dh - 25), (dw - 10, dh - 10), (150, 150, 150), 1)

        # crop 가이드선 (하단 crop — 현재 CROP_BOTTOM_PX=0이라 꺼져 있음)
        if CROP_BOTTOM_PX > 0:
            cv2.line(disp, (0, dh - CROP_BOTTOM_PX), (dw, dh - CROP_BOTTOM_PX),
                     (255, 255, 0), 2)
            cv2.putText(disp, "crop line",
                        (8, dh - CROP_BOTTOM_PX - 6),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 0), 1)

        _push_frame(_S.top_frame, disp)

        # ── 자동 촬영
        captured = None
        if countdown_start is not None and elapsed >= COUNTDOWN_SEC:
            captured = frame.copy()

        # ── 수동 촬영 (/capture/force)
        if _S.force_capture.is_set():
            captured = frame.copy()
            _S.force_capture.clear()

        if captured is not None:
            y2 = h - CROP_BOTTOM_PX if CROP_BOTTOM_PX > 0 else h
            cv2.imwrite(save_path, captured[:y2, :])
            print(f"  [{finger}] 탑뷰 저장: {save_path}")
            _push_event({"type": "finger_captured", "finger": finger.upper()})
            return True


# ── 사이드뷰 스트리밍 (오버레이 없이 피드만) ─────────────────
def _capture_side_stream(cap: cv2.VideoCapture,
                         finger: str, save_path: str) -> bool:
    """
    사이드뷰 캡처. 오버레이 없이 피드만 스트리밍.
    /capture/force 로 수동 촬영.
    Returns: True(저장 성공) / False(스킵)
    """
    _push_event({"type": "side_ready", "finger": finger.upper()})
    print(f"  [{finger}] 사이드뷰 대기 중 (손가락 끝을 카메라로)")
    _S.force_capture.clear()

    deadline = time.time() + 30  # 30초 안에 촬영 안 하면 스킵

    while time.time() < deadline:
        ret, frame = cap.read()
        if not ret:
            return False

        h, w = frame.shape[:2]
        disp = frame.copy()
        remaining = max(0, int(deadline - time.time()))
        cv2.putText(disp,
                    f"[사이드] {finger.upper()}  |  웹에서 촬영 버튼 누르세요  ({remaining}s)",
                    (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 0), 2)
        cv2.rectangle(disp, (0, 0), (w-1, h-1), (180, 180, 0), 4)

        _push_frame(_S.side_frame, disp)

        if _S.force_capture.is_set():
            _S.force_capture.clear()
            cv2.imwrite(save_path, frame)
            print(f"  [{finger}] 사이드뷰 저장: {save_path}")
            return True

        time.sleep(0.03)

    print(f"  [{finger}] 사이드뷰 타임아웃 → brightness fallback")
    return False


# ── capture_all_fingers 스트리밍 버전으로 교체 ───────────────
def capture_all_fingers(userid: str, session: str, hand: str) -> str:  # noqa: F811
    """스트리밍 버전: GUI 없이 카메라 피드를 웹으로 스트리밍하며 촬영."""
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
            print(f"[Capture] 사이드뷰 카메라(인덱스 {CAMERA_SIDE}) 연결됨")
        else:
            print(f"[Capture] 사이드뷰 카메라 없음 → brightness fallback")

    detectors = _make_aruco_detectors()

    _S.active = True
    _S.done_fingers = []
    _S.pending_analysis = []

    try:
        for finger in FINGER_ORDER:
            _S.current_finger = finger
            top_path  = os.path.join(local_dir, f"{finger}_top.jpg")
            side_path = os.path.join(local_dir, f"{finger}_side.jpg")

            ok = _capture_top_stream(cap_top, detectors, finger, top_path)
            if not ok:
                print(f"  [{finger}] 탑뷰 건너뜀")
                continue

            if cap_side:
                _capture_side_stream(cap_side, finger, side_path)

            # 이 손가락 사진은 다 찍혔으니 측정+피부색 분석을 백그라운드로
            # 바로 시작한다. join하지 않고 다음 손가락 촬영으로 즉시 진행 —
            # 분석이 끝나길 기다리느라 카메라가 멈추는 일이 없게 하는 지점.
            t = threading.Thread(
                target=_analyze_finger,
                args=(userid, session, hand, finger),
                daemon=True,
            )
            t.start()
            _S.pending_analysis.append(t)

            _S.done_fingers.append(finger)
            idx = FINGER_ORDER.index(finger)
            next_f = FINGER_ORDER[idx + 1].upper() if idx + 1 < len(FINGER_ORDER) else None
            _push_event({
                "type":        "finger_done",
                "finger":      finger.upper(),
                "nextFinger":  next_f,
                "doneCount":   len(_S.done_fingers),
            })

        _S.current_finger = None
        _push_event({"type": "capture_complete", "doneCount": len(_S.done_fingers)})

    finally:
        _S.active = False
        cap_top.release()
        if cap_side:
            cap_side.release()

    return local_dir


# ── 스트리밍 엔드포인트 ───────────────────────────────────────
@app.get("/stream/top")
def stream_top():
    """탑뷰 MJPEG 스트림 (가이드선 포함)."""
    def generate():
        while True:
            try:
                frame = _S.top_frame.get(timeout=1.0)
                _, jpeg = cv2.imencode('.jpg', frame,
                                       [cv2.IMWRITE_JPEG_QUALITY, 70])
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n'
                       + jpeg.tobytes() + b'\r\n')
            except _q.Empty:
                continue
    return StreamingResponse(
        generate(),
        media_type='multipart/x-mixed-replace; boundary=frame',
    )


@app.get("/stream/side")
def stream_side():
    """사이드뷰 MJPEG 스트림 (오버레이 없음)."""
    def generate():
        while True:
            try:
                frame = _S.side_frame.get(timeout=1.0)
                _, jpeg = cv2.imencode('.jpg', frame,
                                       [cv2.IMWRITE_JPEG_QUALITY, 70])
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n'
                       + jpeg.tobytes() + b'\r\n')
            except _q.Empty:
                continue
    return StreamingResponse(
        generate(),
        media_type='multipart/x-mixed-replace; boundary=frame',
    )


@app.get("/status/events")
async def status_events():
    """SSE — 손가락 촬영 진행상황 실시간 전송."""
    async def generate():
        while True:
            if not _S.events.empty():
                msg = _S.events.get()
                yield f"data: {json.dumps(msg)}\n\n"
            else:
                yield ": keepalive\n\n"
            await asyncio.sleep(0.1)
    return StreamingResponse(generate(), media_type='text/event-stream')


@app.post("/capture/force")
def capture_force():
    """현재 손가락 즉시 촬영 트리거 (수동 촬영 버튼)."""
    _S.force_capture.set()
    return {"ok": True, "finger": _S.current_finger}


@app.get("/capture/status")
def capture_status():
    """현재 촬영 세션 상태 조회."""
    return {
        "active":          _S.active,
        "currentFinger":   _S.current_finger,
        "doneFinger":      _S.done_fingers,
    }