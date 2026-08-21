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
from slice_and_print import slice_and_send_to_printer, PRINTER_IP, PRINTER_ACCESS_CODE, PRINTER_SERIAL

BASE = os.path.dirname(os.path.abspath(__file__))
BUCKET = "naily-scans"

app = FastAPI()


@app.on_event("startup")
def _connect_printer_on_startup():
    """서버가 뜨자마자 프린터에 미리 연결해둔다. 첫 폴링 요청 때 연결을 새로 맺느라
    지연되는 것을 방지 (연결 자체가 실패해도 서버는 정상적으로 뜨게, 에러는 로그만 남김)."""
    try:
        _get_printer()
        print("[Startup] 프린터 연결 완료")
    except Exception as e:
        print(f"[Startup] 프린터 연결 실패 (나중에 /print/status 호출 시 재시도됨): {e}")


# ── 요청 모델 ────────────────────────────────────────────────────
class MergeOneHandRequest(BaseModel):
    userid: str
    session: str          # 그 손의 scanId
    hand: str              # "left" | "right"
    shapes: dict[str, str]  # {"thumb": "round", ...} — 손가락별 쉐입
    callbackUrl: str
    printCallbackUrl: str | None = None  # 있으면 병합 성공 즉시 슬라이싱+출력까지 자동 진행


class MergeBothHandsRequest(BaseModel):
    userid: str
    leftSession: str
    rightSession: str
    leftShapes: dict[str, str]
    rightShapes: dict[str, str]
    callbackUrl: str
    printCallbackUrl: str | None = None  # 있으면 병합 성공 즉시 슬라이싱+출력까지 자동 진행


class StartPrintRequest(BaseModel):
    mergedModelUrl: str   # /print/merge(-both)가 콜백으로 준 S3 URL
    outputDir: str        # 슬라이싱 결과를 저장할 로컬 폴더 (예: printer/output/{userid}/{session})
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
def _run_merge_one_hand(userid: str, session: str, hand: str, shapes: dict,
                         callback_url: str, print_callback_url: str | None = None):
    try:
        result = merge_hand(userid, session, hand, shapes)
        s3_key = f"print/{userid}/{session}/{hand}/hand_merged.3mf"
        merged_url = _upload_3mf(result["path"], s3_key)

        print(f"[Callback] POST {callback_url}")
        response = requests.post(callback_url, json={
            "success": True,
            "mergedModelUrl": merged_url,
            "missing": result["missing"],  # 측정 실패 등으로 빠진 손가락들 (없으면 빈 배열)
        })
        print(f"[Callback] Response: {response.status_code}")

        # 확인 단계 없이 바로 이어서 슬라이싱+출력까지 진행 (print_callback_url이 왔을 때만)
        if print_callback_url:
            output_dir = os.path.dirname(result["path"])
            _slice_and_print_local(result["path"], output_dir, print_callback_url)
    except Exception as e:
        print(f"[Merge] Exception: {e}")
        try:
            requests.post(callback_url, json={"success": False, "message": str(e)})
        except Exception:
            pass


def _run_merge_both_hands(userid: str, left_session: str, right_session: str,
                           left_shapes: dict, right_shapes: dict,
                           callback_url: str, print_callback_url: str | None = None):
    try:
        result = merge_both_hands(userid, left_session, right_session, left_shapes, right_shapes)
        s3_key = f"print/{userid}/{left_session}_{right_session}/both/both_hands_merged.3mf"
        merged_url = _upload_3mf(result["path"], s3_key)

        print(f"[Callback] POST {callback_url}")
        response = requests.post(callback_url, json={
            "success": True,
            "mergedModelUrl": merged_url,
            "missingLeft": result["missingLeft"],
            "missingRight": result["missingRight"],
        })
        print(f"[Callback] Response: {response.status_code}")

        # 확인 단계 없이 바로 이어서 슬라이싱+출력까지 진행 (print_callback_url이 왔을 때만)
        if print_callback_url:
            output_dir = os.path.dirname(result["path"])
            _slice_and_print_local(result["path"], output_dir, print_callback_url)
    except Exception as e:
        print(f"[Merge] Exception: {e}")
        try:
            requests.post(callback_url, json={"success": False, "message": str(e)})
        except Exception:
            pass


def _slice_and_print_local(local_3mf: str, output_dir: str, callback_url: str):
    """이미 로컬에 있는 병합된 3MF를 바로 슬라이싱+프린터 출력까지 진행.
    (병합 직후 같은 프로세스 안에서 이어지는 경우 -- S3에서 다시 받아올 필요 없음)"""
    try:
        gcode_path = slice_and_send_to_printer(local_3mf, output_dir)
        print(f"[Callback] POST {callback_url}")
        response = requests.post(callback_url, json={"success": True, "status": "PRINTING", "gcodePath": gcode_path})
        print(f"[Callback] Response: {response.status_code}")
    except Exception as e:
        print(f"[Print] Exception: {e}")
        try:
            requests.post(callback_url, json={"success": False, "message": str(e)})
        except Exception:
            pass


def _download_3mf_from_url(url: str, local_path: str):
    """S3 https URL에서 3MF를 다시 로컬로 받아온다 (병합 시점과 슬라이싱 시점이 서로 다른
    요청/시간일 수 있으므로, 로컬에 그대로 남아있다고 가정하지 않고 매번 새로 받는다)."""
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    resp = requests.get(url)
    resp.raise_for_status()
    with open(local_path, "wb") as f:
        f.write(resp.content)


def _run_slice_and_print(merged_model_url: str, output_dir: str, callback_url: str):
    try:
        local_3mf = os.path.join(output_dir, "input_for_slicing.3mf")
        print(f"[Print] 병합 모델 다운로드 중: {merged_model_url}")
        _download_3mf_from_url(merged_model_url, local_3mf)

        gcode_path = slice_and_send_to_printer(local_3mf, output_dir)

        print(f"[Callback] POST {callback_url}")
        response = requests.post(callback_url, json={"success": True, "status": "PRINTING", "gcodePath": gcode_path})
        print(f"[Callback] Response: {response.status_code}")
    except Exception as e:
        print(f"[Print] Exception: {e}")
        try:
            requests.post(callback_url, json={"success": False, "message": str(e)})
        except Exception:
            pass


# ── 프린터 상태 조회 ─────────────────────────────────────────────
def _fetch_printer_status() -> dict:
    """프린터에 잠깐 연결해서 지금 진행 상황만 읽어오고 바로 끊는다.
    (연결을 계속 물고 있지 않고, 상태를 물어볼 때마다 짧게 연결 -> 조회 -> 해제하는 방식.
    프론트가 몇 초 간격으로 폴링하는 걸 전제로 한 설계.)"""
# ── 프린터 상태 조회 (연결을 계속 유지, 매번 새로 안 만듦) ──────────────
_printer_singleton = None


def _get_printer():
    """프린터 연결을 앱 전체에서 하나만 유지한다. 매번 connect/disconnect를 반복하면
    MQTT가 매번 새로 핸드셰이크하느라 'Not connected to the MQTT server' 상태에
    계속 걸려서 진행률이 안 올라오는 문제가 있었다."""
    global _printer_singleton
    if _printer_singleton is None:
        from bambulabs_api import Printer
        _printer_singleton = Printer(PRINTER_IP, PRINTER_ACCESS_CODE, PRINTER_SERIAL)
        _printer_singleton.connect()
    return _printer_singleton


def _fetch_printer_status() -> dict:
    printer = _get_printer()
    return {
        "state": str(printer.get_current_state()),
        "percentage": printer.get_percentage(),
        "currentLayer": printer.current_layer_num,
        "totalLayer": printer.total_layer_num,
        "remainingTimeMin": printer.get_time(),
        "nozzleTemp": printer.get_nozzle_temperature(),
        "bedTemp": printer.get_bed_temperature(),
    }


# ── 엔드포인트 ──────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/print/status")
def print_status():
    """지금 프린터가 뭘 하고 있는지(상태, 진행률, 남은 시간 등) 조회.
    Spring Boot가 몇 초 간격으로 이 엔드포인트를 폴링해서 마이페이지/출력 화면에
    진행률을 보여주는 용도."""
    try:
        return {"success": True, **_fetch_printer_status()}
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.post("/print/merge")
def merge_one_hand(request: MergeOneHandRequest):
    """한 손(5손가락) STL 병합 요청. printCallbackUrl이 있으면 병합 성공 즉시
    확인 단계 없이 슬라이싱+출력까지 자동으로 이어진다."""
    print(f"\n[Server] Merge request: {request.userid}/{request.session}/{request.hand}")
    thread = threading.Thread(
        target=_run_merge_one_hand,
        args=(request.userid, request.session, request.hand, request.shapes,
              request.callbackUrl, request.printCallbackUrl),
        daemon=True,
    )
    thread.start()
    return {"status": "started", "message": "병합이 시작되었습니다."}


@app.post("/print/merge-both")
def merge_both(request: MergeBothHandsRequest):
    """양손(10손가락) STL 병합 요청. printCallbackUrl이 있으면 병합 성공 즉시
    확인 단계 없이 슬라이싱+출력까지 자동으로 이어진다."""
    print(f"\n[Server] Merge-both request: {request.userid} left={request.leftSession} right={request.rightSession}")
    thread = threading.Thread(
        target=_run_merge_both_hands,
        args=(request.userid, request.leftSession, request.rightSession,
              request.leftShapes, request.rightShapes,
              request.callbackUrl, request.printCallbackUrl),
        daemon=True,
    )
    thread.start()
    return {"status": "started", "message": "양손 병합이 시작되었습니다."}


@app.post("/print/start")
def start_print(request: StartPrintRequest):
    """
    이미 병합된 3MF(merge 단계 콜백으로 받은 mergedModelUrl)를 슬라이싱하고
    프린터에 업로드해서 실제 출력을 시작한다. merge와 별도 요청으로 분리해둔 이유:
    사용자가 병합 결과를 미리 확인하고 "진짜 출력할지" 확정하는 단계를 두기 위함
    (필라멘트/시간을 실제로 소모하는 작업이라 자동 연결 대신 명시적 확인을 거침).
    """
    print(f"\n[Server] Start-print request: {request.mergedModelUrl}")
    thread = threading.Thread(
        target=_run_slice_and_print,
        args=(request.mergedModelUrl, request.outputDir, request.callbackUrl),
        daemon=True,
    )
    thread.start()
    return {"status": "started", "message": "슬라이싱 및 출력이 시작되었습니다."}