"""
s3_upload.py
------------
Upload photos and results to the naily-scans S3 bucket.
Called automatically at the end of run_pipeline.py.
"""

import os
import boto3
from pathlib import Path

BUCKET = "naily-scans"
BASE   = os.path.dirname(os.path.abspath(__file__))


def _load_env():
    """Load .env file into os.environ (only sets keys not already set)."""
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


def upload_folder(local_dir: str, s3_prefix: str) -> int:
    """Upload every file under local_dir to s3://naily-scans/{s3_prefix}/."""
    client     = _s3_client()
    local_path = Path(local_dir)
    uploaded   = 0
    for file_path in sorted(local_path.rglob("*")):
        if not file_path.is_file():
            continue
        relative = file_path.relative_to(local_path)
        s3_key   = f"{s3_prefix}/{relative}".replace("\\", "/")
        print(f"  -> s3://{BUCKET}/{s3_key}")
        client.upload_file(str(file_path), BUCKET, s3_key)
        uploaded += 1
    return uploaded


def upload_session(userid: str, session: str, hand: str, base_dir: str):
    """Upload one session's photos and results to S3."""
    photos_dir  = os.path.join(base_dir, "photos",  userid, session, hand)
    results_dir = os.path.join(base_dir, "results", userid, session, hand)

    s3_photos_prefix  = f"photos/{userid}/{session}/{hand}"
    s3_results_prefix = f"results/{userid}/{session}/{hand}"

    print(f"\n{'='*60}")
    print(f"  Uploading session to S3 ...")
    print(f"  User: {userid}  Session: {session}  Hand: {hand}")
    print(f"{'='*60}")
    total = 0

    if os.path.isdir(photos_dir):
        print(f"\n[photos/{userid}/{session}/{hand}/]")
        total += upload_folder(photos_dir, s3_photos_prefix)
    else:
        print(f"[S3] photos/{userid}/{session}/{hand}/ not found, skipping.")

    if os.path.isdir(results_dir):
        print(f"\n[results/{userid}/{session}/{hand}/]")
        total += upload_folder(results_dir, s3_results_prefix)
    else:
        print(f"[S3] results/{userid}/{session}/{hand}/ not found, skipping.")

    print(f"\n[S3] Done - {total} file(s) uploaded to s3://{BUCKET}/")


def upload_all(photos_dir: str, results_dir: str):
    """Upload entire photos/ and results/ folders. Useful for manual bulk upload."""
    print(f"\n{'='*60}")
    print("  Uploading all to S3 ...")
    print(f"{'='*60}")
    total = 0

    if os.path.isdir(photos_dir):
        print(f"\n[photos/]")
        total += upload_folder(photos_dir, "photos")
    else:
        print(f"[S3] photos/ not found, skipping.")

    if os.path.isdir(results_dir):
        print(f"\n[results/]")
        total += upload_folder(results_dir, "results")
    else:
        print(f"[S3] results/ not found, skipping.")

    print(f"\n[S3] Done - {total} file(s) uploaded to s3://{BUCKET}/")
