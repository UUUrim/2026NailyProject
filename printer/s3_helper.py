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


def download_finger_stls(userid: str, session: str, hand: str, shapes: dict, local_dir: str) -> list[str]:
    """
    한 손(5손가락)의 STL 파일들을 S3에서 다운로드한다.

    shapes: {"thumb": "round", "index": "round", ...} 손가락별로 다른 쉐입을 고를 수 있으므로
            dict로 받는다 (전부 같은 쉐입이면 다섯 손가락 모두 같은 값을 넣으면 됨).
    S3 경로: results/{userid}/{session}/{hand}/stl/nail_{finger}_{shape}.stl
             (server.py의 generate_stl()이 저장하는 경로와 동일)

    반환값: 다운로드된 로컬 파일 경로 리스트 (thumb -> pinky 순서 고정)
    """
    client = _s3_client()
    os.makedirs(local_dir, exist_ok=True)

    finger_order = ["thumb", "index", "middle", "ring", "pinky"]
    local_paths = []

    for finger in finger_order:
        shape = shapes.get(finger)
        if not shape:
            raise ValueError(f"'{finger}'의 shape가 지정되지 않았습니다. shapes 딕셔너리를 확인하세요.")

        s3_key = f"results/{userid}/{session}/{hand}/stl/nail_{finger}_{shape}.stl"
        local_path = os.path.join(local_dir, f"nail_{finger}_{shape}.stl")

        print(f"  Downloading s3://{BUCKET}/{s3_key} -> {local_path}")
        client.download_file(BUCKET, s3_key, local_path)
        local_paths.append(local_path)

    return local_paths