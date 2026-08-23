"""
test_realtime_session.py
=========================
"사진 찍히면 바로 seg 서버로 넘어가는" 실시간 플로우를 로컬에서 테스트하는 스크립트.

전제:
- seg 검출 서버가 떠 있어야 함 (naily_pipeline.py의 NAILY_DETECT_URL)
- skin_tone_api_v2.py (세션 API)가 떠 있어야 함
    uvicorn skin_tone_api_v2:app --reload --port 8002

두 가지 모드:

1) webcam 모드 - 진짜 웹캠으로 스페이스바 누를 때마다 캡처해서 즉시 전송
    python test_realtime_session.py --mode webcam --api http://localhost:8002

2) simulate 모드 - 카메라 없이 finger/ 폴더 사진들을 "찍히는 것처럼" 한 장씩
   지연시간 두고 순서대로 전송 (실제 촬영 타이밍 흉내)
    python test_realtime_session.py --mode simulate --folder finger/w --api http://localhost:8002 --delay 1.5
"""

from __future__ import annotations
import argparse
import io
import sys
import time
from pathlib import Path

import requests


# =============================================================================
# 공통: 세션 API 호출 래퍼
# =============================================================================

def start_session(api: str, person_name: str) -> str:
    resp = requests.post(f"{api}/session/start", params={"person_name": person_name}, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    print(f"[세션 시작] sessionId={data['sessionId']}  person={data['personName']}")
    return data["sessionId"]


def send_finger(api: str, session_id: str, image_bytes: bytes,
                 finger_name: str | None, filename: str = "capture.jpg") -> dict:
    files = {"file": (filename, image_bytes, "image/jpeg")}
    params = {}
    if finger_name:
        params["finger_name"] = finger_name

    t0 = time.time()
    resp = requests.post(
        f"{api}/session/{session_id}/finger",
        files=files, params=params, timeout=60,
    )
    elapsed = time.time() - t0

    if not resp.ok:
        print(f"  [실패] {finger_name or '?'}: {resp.status_code} {resp.text}")
        return None

    data = resp.json()
    print(f"  [{data['count']:2d}/10] {data['fingerName']:10s} "
          f"L={data['L']:.1f}  warm={data['warmness']:.2f}  hex={data['skinHex']}  "
          f"({elapsed:.1f}s)")
    return data


def finalize_session(api: str, session_id: str, n_best: int = 30) -> dict:
    resp = requests.post(
        f"{api}/session/{session_id}/finalize",
        params={"n_best": n_best},
        timeout=60,
    )
    if not resp.ok:
        print(f"[finalize 실패] {resp.status_code} {resp.text}")
        sys.exit(1)
    return resp.json()


def print_final_result(result: dict):
    agg = result["aggregated"]
    summary = result["skinSummary"]
    print(f"\n{'='*60}")
    print(f"[최종 집계] {result['personName']}")
    print(f"{'='*60}")
    print(f"  L={agg['L']}  a={agg['a']}  b={agg['b']}  skinHex={agg['skin_hex']}")
    print(f"  warmness={agg['warmness']}  saturation={agg['saturation']}")
    print(f"  undertone={agg['undertone']}")
    print(f"  유효손가락={agg['valid_fingers']}/{agg['total_fingers']}  "
          f"이상치={agg['outlier_count']}개  신뢰도={agg['reliability']}")
    print(f"  tone={summary['tone']}  brightness={summary['brightness']}  chroma={summary['chroma']}")

    print(f"\n  BEST {len(result['bestColors'])}색:")
    for c in result["bestColors"]:
        print(f"    {c['hex']}  {c['name_ko']:8s}  score={c['score']}")

    print(f"\n  WORST {len(result['worstColors'])}색:")
    for c in result["worstColors"]:
        print(f"    {c['hex']}  {c['name_ko']:8s}  score={c['score']}")


# =============================================================================
# 카메라 목록 찾기 (외장 웹캠이 index 0이 아닌 경우가 많음)
# =============================================================================

def list_cameras(max_index: int = 8):
    """
    index 0~max_index-1까지 순서대로 열어봐서 실제로 프레임이 나오는 카메라만 출력.
    맥/리눅스: 보통 컴퓨터 기본캠=0, 외장캠=1 이상
    윈도우: 연결 순서/드라이버에 따라 순서가 섞일 수 있어서 DSHOW 백엔드로 시도
    """
    import cv2

    print("카메라 스캔 중...\n")
    found = []
    for idx in range(max_index):
        backend = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY
        cap = cv2.VideoCapture(idx, backend)
        if not cap.isOpened():
            cap.release()
            continue
        ok, frame = cap.read()
        if ok and frame is not None:
            h, w = frame.shape[:2]
            print(f"  [index {idx}] 사용 가능  해상도={w}x{h}")
            found.append(idx)
        cap.release()

    if not found:
        print("  카메라를 하나도 못 찾음. 케이블/드라이버/권한(카메라 접근 허용) 확인 필요.")
    else:
        print(f"\n찾은 index: {found}")
        print("컴퓨터 기본캠이 보통 0번이니, 그 외 index가 외장 웹캠일 가능성이 높습니다.")
        print(f"예: python {Path(__file__).name} --mode webcam --cam {found[-1]}")
    return found


# =============================================================================
# 모드 1: 웹캠으로 실시간 캡처
# =============================================================================

def run_webcam(api: str, person_name: str, total: int, cam_index: int):
    import cv2

    session_id = start_session(api, person_name)

    backend = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY
    cap = cv2.VideoCapture(cam_index, backend)
    if not cap.isOpened():
        print(f"[오류] 카메라(index={cam_index})를 열 수 없습니다.")
        print(f"       사용 가능한 카메라를 먼저 확인하세요: python {Path(__file__).name} --list-cameras")
        sys.exit(1)

    print(f"\n스페이스바: 촬영+즉시전송 / q: 중단 / 총 {total}장 채우면 자동 종료\n")

    count = 0
    while count < total:
        ok, frame = cap.read()
        if not ok:
            print("[오류] 프레임 읽기 실패")
            break

        preview = frame.copy()
        cv2.putText(preview, f"{count}/{total}  SPACE=capture  q=quit",
                    (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
        cv2.imshow("naily realtime capture", preview)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            print("[중단] 사용자 종료")
            break
        elif key == ord(" "):
            ok, jpg = cv2.imencode(".jpg", frame)
            if not ok:
                print("  [실패] 인코딩 오류")
                continue
            result = send_finger(api, session_id, jpg.tobytes(), finger_name=None)
            if result:
                count += 1

    cap.release()
    cv2.destroyAllWindows()

    if count < 2:
        print(f"[중단] 유효 캡처가 {count}장뿐이라 finalize 생략 (최소 2장 필요)")
        return

    result = finalize_session(api, session_id)
    print_final_result(result)


# =============================================================================
# 모드 2: 기존 사진으로 실시간 흐름 시뮬레이션 (카메라 없이)
# =============================================================================

def run_simulate(api: str, person_name: str, folder: str, delay: float):
    exts = (".jpg", ".jpeg", ".png", ".JPG", ".JPEG", ".PNG")
    image_paths = sorted(p for p in Path(folder).iterdir() if p.suffix in exts)
    if not image_paths:
        print(f"[오류] {folder}에 이미지가 없습니다.")
        sys.exit(1)

    print(f"[시뮬레이션] {folder}에서 {len(image_paths)}장 발견, {delay}초 간격으로 전송\n")

    session_id = start_session(api, person_name)
    sent = 0
    for i, path in enumerate(image_paths):
        image_bytes = path.read_bytes()
        result = send_finger(api, session_id, image_bytes,
                              finger_name=None, filename=path.name)
        if result:
            sent += 1
        if i < len(image_paths) - 1:
            time.sleep(delay)  # 실제 촬영 사이 텀 흉내

    if sent < 2:
        print(f"[중단] 유효 전송이 {sent}장뿐이라 finalize 생략 (최소 2장 필요)")
        return

    result = finalize_session(api, session_id)
    print_final_result(result)


# =============================================================================
# CLI
# =============================================================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Naily 실시간 세션 플로우 테스트")
    parser.add_argument("--mode", choices=["webcam", "simulate"], default="simulate")
    parser.add_argument("--api", default="http://localhost:8002", help="세션 API 서버 주소")
    parser.add_argument("--person", default="test_user")
    parser.add_argument("--total", type=int, default=10, help="webcam 모드: 캡처할 장수")
    parser.add_argument("--cam", type=int, default=0, help="webcam 모드: 카메라 index (--list-cameras로 확인)")
    parser.add_argument("--list-cameras", action="store_true", help="사용 가능한 카메라 index만 스캔해서 보여주고 종료")
    parser.add_argument("--folder", default="finger/w", help="simulate 모드: 사진 폴더")
    parser.add_argument("--delay", type=float, default=1.5, help="simulate 모드: 전송 간 지연(초)")
    args = parser.parse_args()

    if args.list_cameras:
        list_cameras()
        sys.exit(0)

    if args.mode == "webcam":
        run_webcam(args.api, args.person, args.total, args.cam)
    else:
        run_simulate(args.api, args.person, args.folder, args.delay)