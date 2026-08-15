"""
server.py (printer)
--------------------
Spring Boot로부터 3D 프린트용 병합 요청을 받는 FastAPI 서버.
scan/server.py와 동일한 패턴: 무거운 작업(STL 다운로드+병합)은 백그라운드
스레드에서 처리하고, 끝나면 콜백 URL로 결과를 POST한다.

Usage:
    uvicorn server:app --host 0.0.0.0 --port 8100 --reload

[중요] 지금은 "병합"까지만 한다. 슬라이싱(OrcaSlicer CLI)과 프린터 업로드/출력
트리거(bambulabs_api)는 다음 단계에서 이 서버에 이어붙일 예정 — 아직 없음.
"""

import os
import threading

import boto3
import requests
from fastapi import FastAPI
from pydantic import BaseModel

from merge_fingers import merge_hand, merge_both_hands

BASE = os.path.dirname(os.path.abspath(__file__))
BUCKET = "naily-scans"

app = FastAPI()


# ── 요청 모델 ────────────────────────────────────────────────────
class MergeOneHandRequest(BaseModel):
    userid: str
    session: str          # 그 손의 scanId
    hand: str              # "left" | "right"
    shapes: dict[str, str]  # {"thumb": "round", ...} — 손가락별 쉐입
    callbackUrl: str


class MergeBothHandsRequest(BaseModel):
    userid: str
    leftSession: str
    rightSession: str
    leftShapes: dict[str, str]
    rightShapes: dict[str, str]
    callbackUrl: str


# ── S3 업로드 (병합 결과 3MF) ────────────────────────────────────
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


def _s3_client():
    _load_env()
    return boto3.client(
        "s3",
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
        region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1"),
    )


def _upload_3mf(local_path: str, s3_key: str) -> str:
    client = _s3_client()
    print(f"  Uploading {local_path} -> s3://{BUCKET}/{s3_key}")
    client.upload_file(local_path, BUCKET, s3_key)
    return f"https://{BUCKET}.s3.amazonaws.com/{s3_key}"


# ── 백그라운드 작업 ──────────────────────────────────────────────
def _run_merge_one_hand(userid: str, session: str, hand: str, shapes: dict, callback_url: str):
    try:
        local_path = merge_hand(userid, session, hand, shapes)
        s3_key = f"print/{userid}/{session}/{hand}/hand_merged.3mf"
        merged_url = _upload_3mf(local_path, s3_key)

        print(f"[Callback] POST {callback_url}")
        response = requests.post(callback_url, json={"success": True, "mergedModelUrl": merged_url})
        print(f"[Callback] Response: {response.status_code}")
    except Exception as e:
        print(f"[Merge] Exception: {e}")
        try:
            requests.post(callback_url, json={"success": False, "message": str(e)})
        except Exception:
            pass


def _run_merge_both_hands(userid: str, left_session: str, right_session: str,
                           left_shapes: dict, right_shapes: dict, callback_url: str):
    try:
        local_path = merge_both_hands(userid, left_session, right_session, left_shapes, right_shapes)
        s3_key = f"print/{userid}/{left_session}_{right_session}/both/both_hands_merged.3mf"
        merged_url = _upload_3mf(local_path, s3_key)

        print(f"[Callback] POST {callback_url}")
        response = requests.post(callback_url, json={"success": True, "mergedModelUrl": merged_url})
        print(f"[Callback] Response: {response.status_code}")
    except Exception as e:
        print(f"[Merge] Exception: {e}")
        try:
            requests.post(callback_url, json={"success": False, "message": str(e)})
        except Exception:
            pass


# ── 엔드포인트 ──────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/print/merge")
def merge_one_hand(request: MergeOneHandRequest):
    """한 손(5손가락) STL 병합 요청."""
    print(f"\n[Server] Merge request: {request.userid}/{request.session}/{request.hand}")
    thread = threading.Thread(
        target=_run_merge_one_hand,
        args=(request.userid, request.session, request.hand, request.shapes, request.callbackUrl),
        daemon=True,
    )
    thread.start()
    return {"status": "started", "message": "병합이 시작되었습니다."}


@app.post("/print/merge-both")
def merge_both(request: MergeBothHandsRequest):
    """양손(10손가락) STL 병합 요청."""
    print(f"\n[Server] Merge-both request: {request.userid} left={request.leftSession} right={request.rightSession}")
    thread = threading.Thread(
        target=_run_merge_both_hands,
        args=(request.userid, request.leftSession, request.rightSession,
              request.leftShapes, request.rightShapes, request.callbackUrl),
        daemon=True,
    )
    thread.start()
    return {"status": "started", "message": "양손 병합이 시작되었습니다."}