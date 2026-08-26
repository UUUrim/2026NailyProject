"""
s3_helper.py
------------
Download 5개 손가락 STL 파일을 naily-scans S3 버킷에서 로컬로 받아온다.
scan/s3_upload.py와 짝을 이루는 다운로드 전용 헬퍼. (같은 .env / 버킷 설정 방식 사용)
"""

import os
import boto3
from pathlib import Path

BUCKET = "naily-scans"
BASE = os.path.dirname(os.path.abspath(__file__))


def _load_env():
    """.env 파일을 os.environ에 로드 (이미 설정된 키는 건드리지 않음)."""
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


def download_finger_stls(userid: str, session: str, hand: str, shapes: dict, local_dir: str) -> dict:
    """
    한 손(최대 5손가락)의 STL 파일들을 S3에서 다운로드한다.
    측정 실패 등으로 일부 손가락 STL이 아예 없을 수 있으므로, 없는 건 건너뛰고
    실제로 다운로드된 것만 반환한다 (스캔 자체 문제라 조용히 무시하면 안 되고,
    호출하는 쪽에서 "몇 개가 빠졌는지"를 반드시 사용자에게 알려줘야 함).

    shapes: {"thumb": "round", "index": "round", ...}
    S3 경로: results/{userid}/{session}/{hand}/stl/nail_{finger}_{shape}.stl

    반환값: {
        "paths": {"thumb": "로컬경로", ...},   # 실제로 다운로드된 것만
        "missing": ["ring", "middle"],          # S3에 아예 없던 손가락들
    }
    """
    client = _s3_client()
    os.makedirs(local_dir, exist_ok=True)

    finger_order = ["thumb", "index", "middle", "ring", "pinky"]
    paths = {}
    missing = []

    for finger in finger_order:
        shape = shapes.get(finger)
        if not shape:
            raise ValueError(f"'{finger}'의 shape가 지정되지 않았습니다. shapes 딕셔너리를 확인하세요.")

        s3_key = f"results/{userid}/{session}/{hand}/stl/nail_{finger}_{shape}.stl"
        local_path = os.path.join(local_dir, f"nail_{finger}_{shape}.stl")

        try:
            print(f"  Downloading s3://{BUCKET}/{s3_key} -> {local_path}")
            client.download_file(BUCKET, s3_key, local_path)
            paths[finger] = local_path
        except client.exceptions.ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")
            if error_code in ("404", "NoSuchKey"):
                print(f"  [건너뜀] {finger}의 STL이 S3에 없음 (STL 생성이 아직 안 끝났거나 실패): {s3_key}")
                missing.append(finger)
            else:
                raise  # 404가 아닌 다른 에러(권한 문제 등)는 그대로 올려서 확실히 드러나게 함

    return {"paths": paths, "missing": missing}