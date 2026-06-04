"""
server.py
---------
FastAPI server that receives scan requests from the Spring backend,
runs the nail measurement pipeline, and sends results back via callback.

Usage:
    uvicorn server:app --host 0.0.0.0 --port 8000 --reload
"""

import json
import os
import subprocess
import sys
import threading
import boto3
import requests
from fastapi import FastAPI
from pydantic import BaseModel

BASE = os.path.dirname(os.path.abspath(__file__))
BUCKET = "naily-scans"
FINGER_ORDER = ["thumb", "index", "middle", "ring", "pinky"]

app = FastAPI()


# ── .env 로드 ──────────────────────────────────────────────────
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


# ── S3 클라이언트 ───────────────────────────────────────────────
def _s3_client():
    return boto3.client(
        "s3",
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
        region_name=os.environ.get("AWS_DEFAULT_REGION", "ap-northeast-2"),
    )


# ── S3에서 사진 5장 다운로드 ────────────────────────────────────
def download_photos(userid: str, session: str, hand: str):
    client = _s3_client()
    local_dir = os.path.join(BASE, "photos", userid, session, hand)
    os.makedirs(local_dir, exist_ok=True)

    for finger in FINGER_ORDER:
        s3_key = f"photos/{userid}/{session}/{hand}/{finger}.jpg"
        local_path = os.path.join(local_dir, f"{finger}.jpg")
        print(f"  Downloading s3://{BUCKET}/{s3_key} -> {local_path}")
        client.download_file(BUCKET, s3_key, local_path)


# ── crop + measure만 실행 (STL/S3 없음) ────────────────────────
def run_measure_only(userid: str, session: str, hand: str):
    photos_root  = os.path.join(BASE, "photos",  userid, session, hand)
    results_root = os.path.join(BASE, "results", userid, session, hand)

    for finger in FINGER_ORDER:
        photo_path = os.path.join(photos_root, f"{finger}.jpg")
        finger_out = os.path.join(results_root, finger)
        os.makedirs(finger_out, exist_ok=True)

        # Step 1: Crop
        import cv2
        img = cv2.imread(photo_path)
        if img is None:
            raise FileNotFoundError(f"Cannot open: {photo_path}")
        h, w = img.shape[:2]
        cut = int(h * 0.7)  # 하단 30% 제거
        cropped = img[:cut, :]
        cropped_path = photo_path.replace(".jpg", "_cropped.jpg")
        cv2.imwrite(cropped_path, cropped)
        print(f"  [{finger}] Cropped: {h}x{w} -> {cut}x{w}")

        # Step 2: Measure
        result = subprocess.run(
            [
                sys.executable,
                os.path.join(BASE, "nail_measurer.py"),
                "--top",        cropped_path,
                "--finger",     finger,
                "--aruco-size", "20.0",
                "--output",     finger_out,
            ],
            cwd=BASE,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print(f"  [{finger}] Measure failed (skipping): {result.stderr[-200:]}")
            continue
        print(f"  [{finger}] Measured OK")


# ── nan/inf 를 0으로 변환 ────────────────────────────────────────
def safe_float(val, default=0.0):
    import math
    try:
        v = float(val) if val is not None else default
        if math.isnan(v) or math.isinf(v):
            return default
        return v
    except (TypeError, ValueError):
        return default


# ── 결과 JSON 읽어서 콜백 데이터 만들기 ─────────────────────────
def build_callback_data(userid: str, session: str, hand: str) -> dict:
    results_root = os.path.join(BASE, "results", userid, session, hand)

    fingers_data = []
    skin_tones = []
    sizes = []

    for finger in FINGER_ORDER:
        finger_dir = os.path.join(results_root, finger)
        measurements_path = os.path.join(finger_dir, "nail_measurements.json")
        profile_path = os.path.join(finger_dir, "profile.json")

        # 측정 실패한 손가락은 건너뜀
        if not os.path.exists(measurements_path) or not os.path.exists(profile_path):
            print(f"  [{finger}] Skipping - measurement files not found")
            continue

        try:
            with open(measurements_path, "r") as f:
                measurements_json = json.load(f)

            finger_data = measurements_json.get("by_finger", {}).get(finger, {})

            with open(profile_path, "r") as f:
                profile = json.load(f)

            size = profile.get("nail_size", "average")
            skin_tone = finger_data.get("skin_tone_hex", "")

            if skin_tone:
                skin_tones.append(skin_tone)
            sizes.append(size)

            fingers_data.append({
                "finger": finger.upper(),
                "measurements": {
                    "widthMm":           safe_float(finger_data.get("width_mm")),
                    "lengthMm":          safe_float(finger_data.get("length_mm")),
                    "correctedLengthMm": safe_float(finger_data.get("corrected_length_mm")),
                    "cCurveMm":          safe_float(finger_data.get("c_curve_mm")),
                    "arcRadiusMm":       safe_float(finger_data.get("arc_radius_mm")),
                    "thicknessMm":       safe_float(finger_data.get("thickness_mm")),
                },
                "size": size,
            })
        except Exception as e:
            print(f"  [{finger}] Skipping - error reading results: {e}")
            continue

    skin_tone_hex = skin_tones[0] if skin_tones else "#C8A882"
    overall_size  = max(set(sizes), key=sizes.count) if sizes else "average"

    return {
        "shape":             "round",
        "skinToneHex":       skin_tone_hex,
        "overallSize":       overall_size,
        "recommendedColors": [],
        "fingers":           fingers_data,
    }


# ── 파이프라인 실행 후 콜백 전송 ────────────────────────────────
def run_measure_and_callback(userid: str, session: str, hand: str, callback_url: str):
    try:
        print(f"\n[Pipeline] Downloading photos for {userid}/{session}/{hand}...")
        download_photos(userid, session, hand)

        print(f"[Pipeline] Running measurement...")
        run_measure_only(userid, session, hand)

        print(f"[Pipeline] Done! Sending callback to {callback_url}...")
        callback_data = build_callback_data(userid, session, hand)
        response = requests.post(callback_url, json=callback_data)
        print(f"[Pipeline] Callback response: {response.status_code}")

    except Exception as e:
        print(f"[Pipeline] Exception: {e}")
        requests.post(callback_url, json={"success": False, "message": str(e)})


# ── STL 생성 후 콜백 전송 ────────────────────────────────────────
def run_stl_and_callback(userid: str, session: str, hand: str, shape: str, callback_url: str):
    try:
        results_root = os.path.join(BASE, "results", userid, session, hand)
        stl_dir = os.path.join(results_root, "stl")
        os.makedirs(stl_dir, exist_ok=True)
        s3_prefix = f"results/{userid}/{session}/{hand}"
        s3_base_url = f"https://{BUCKET}.s3.amazonaws.com"

        for finger in FINGER_ORDER:
            finger_dir = os.path.join(results_root, finger)
            measurements_path = os.path.join(finger_dir, "nail_measurements.json")

            result = subprocess.run(
                [
                    sys.executable,
                    os.path.join(BASE, "nail_exact_stl.py"),
                    "--input",  measurements_path,
                    "--shape",  shape,
                    "--finger", finger,
                    "--output", stl_dir,
                ],
                cwd=BASE,
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                print(f"[STL] ERROR for {finger}:\n{result.stderr}")

        # S3 업로드
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
        print(f"[STL] Callback response: {response.status_code}")

    except Exception as e:
        print(f"[STL] Exception: {e}")
        requests.post(callback_url, json={"success": False, "message": str(e)})


# ── API 요청 모델 ───────────────────────────────────────────────
class MeasureRequest(BaseModel):
    userid: str
    session: str
    hand: str
    callbackUrl: str

class StlRequest(BaseModel):
    userid: str
    session: str
    hand: str
    shape: str
    callbackUrl: str


# ── 엔드포인트 ──────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze/measure")
def analyze_measure(request: MeasureRequest):
    print(f"\n[Server] Received measure request: {request}")
    thread = threading.Thread(
        target=run_measure_and_callback,
        args=(request.userid, request.session, request.hand, request.callbackUrl),
        daemon=True,
    )
    thread.start()
    return {"status": "started", "message": "측정 파이프라인이 시작되었습니다."}


@app.post("/analyze/stl")
def analyze_stl(request: StlRequest):
    print(f"\n[Server] Received STL request: {request}")
    thread = threading.Thread(
        target=run_stl_and_callback,
        args=(request.userid, request.session, request.hand, request.shape, request.callbackUrl),
        daemon=True,
    )
    thread.start()
    return {"status": "started", "message": "STL 생성이 시작되었습니다."}