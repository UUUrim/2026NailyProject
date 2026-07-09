"""
run_pipeline.py
---------------
End-to-end nail pipeline: crop -> measure -> generate STL -> upload to S3

Usage:
    python run_pipeline.py --userid u001 --session 1 --hand right --shape round

Photos must be placed in:
    photos/{userid}/{session}/{hand}/thumb.jpg
    photos/{userid}/{session}/{hand}/index.jpg
    photos/{userid}/{session}/{hand}/middle.jpg
    photos/{userid}/{session}/{hand}/ring.jpg
    photos/{userid}/{session}/{hand}/pinky.jpg

Output structure:
    results/{userid}/{session}/{hand}/thumb/
        nail_measurements.json
        profile.json
        thumb_annotated.jpg
    results/{userid}/{session}/{hand}/index/  ...
    results/{userid}/{session}/{hand}/stl/
        nail_thumb_{shape}.stl
        nail_index_{shape}.stl
        nail_middle_{shape}.stl
        nail_ring_{shape}.stl
        nail_pinky_{shape}.stl
"""

import argparse
import os
import sys
import subprocess

import cv2

from s3_upload import upload_session

FINGER_ORDER = ["thumb", "index", "middle", "ring", "pinky"]
SHAPES       = ("round", "oval", "almond", "square", "stiletto", "ballerina")
BASE         = os.path.dirname(os.path.abspath(__file__))


def crop_image(src_path: str, crop_fraction: float) -> str:
    img = cv2.imread(src_path)
    if img is None:
        raise FileNotFoundError(f"Cannot open: {src_path}")
    h, w = img.shape[:2]
    cut  = int(h * (1.0 - crop_fraction))
    cropped = img[:cut, :]
    out_path = src_path.replace(".jpg", "_cropped.jpg")
    cv2.imwrite(out_path, cropped)
    print(f"  Cropped: {h}x{w} -> {cut}x{w}  ->  {out_path}")
    return out_path


def run(cmd: list):
    result = subprocess.run(cmd, cwd=BASE)
    if result.returncode != 0:
        sys.exit(f"ERROR: command failed: {' '.join(cmd)}")


def main():
    p = argparse.ArgumentParser(description="Nail pipeline: crop -> measure -> STL -> S3")
    p.add_argument("--userid",        required=True,
                   help="User ID (provided by Seha's backend)")
    p.add_argument("--session",       required=True,
                   help="Session number (provided by Seha's backend)")
    p.add_argument("--hand",          default="right", choices=["right", "left"],
                   help="Which hand: right or left (default: right)")
    p.add_argument("--shape",         default="round", choices=SHAPES,
                   help="Nail tip shape (default: round)")
    p.add_argument("--aruco-size",    type=float, default=20.0,
                   help="Physical ArUco marker side length in mm (default: 20)")
    p.add_argument("--crop-fraction", type=float, default=0.30,
                   help="Fraction of image height to remove from bottom (default: 0.30)")
    args = p.parse_args()

    # ── Resolve folder paths ──────────────────────────────────────
    photos_root  = os.path.join(BASE, "photos",  args.userid, args.session, args.hand)
    results_root = os.path.join(BASE, "results", args.userid, args.session, args.hand)

    # ── Verify all five photos exist before starting ──────────────
    photo_paths = {}
    missing = []
    for finger in FINGER_ORDER:
        path = os.path.join(photos_root, f"{finger}.jpg")
        if not os.path.isfile(path):
            missing.append(path)
        else:
            photo_paths[finger] = path
    if missing:
        sys.exit(
            "ERROR: Missing photo(s):\n" +
            "\n".join(f"  {p}" for p in missing) +
            f"\n\nExpected folder: photos/{args.userid}/{args.session}/{args.hand}/"
        )

    # STL folder is shared across all five fingers (one shape per session)
    stl_dir = os.path.join(results_root, "stl")
    os.makedirs(stl_dir, exist_ok=True)

    for i, finger in enumerate(FINGER_ORDER):
        photo = photo_paths[finger]
        print(f"\n{'='*60}")
        print(f"  [{i+1}/5] {finger.upper()}")
        print(f"{'='*60}")

        # ── Step 1: Crop ──────────────────────────────────────────
        print("\n[Step 1] Crop")
        cropped_path = crop_image(photo, args.crop_fraction)

        # ── Step 2: Measure ───────────────────────────────────────
        print("\n[Step 2] Measure")
        finger_out = os.path.join(results_root, finger)
        os.makedirs(finger_out, exist_ok=True)
        run([
            sys.executable,
            os.path.join(BASE, "nail_measurer.py"),
            "--top",        cropped_path,
            "--finger",     finger,
            "--aruco-size", str(args.aruco_size),
            "--output",     finger_out,
        ])

        # ── Step 3: Generate STL ──────────────────────────────────
        print(f"\n[Step 3] Generate STL ({args.shape})")
        json_path = os.path.join(finger_out, "nail_measurements.json")
        run([
            sys.executable,
            os.path.join(BASE, "nail_exact_stl.py"),
            "--input",  json_path,
            "--shape",  args.shape,
            "--finger", finger,
            "--output", stl_dir,
        ])

    print(f"\n{'='*60}")
    print("All done!")
    print(f"Results: results/{args.userid}/{args.session}/{args.hand}/")
    print(f"{'='*60}")

    # ── Upload this session to S3 ─────────────────────────────────
    upload_session(args.userid, args.session, args.hand, BASE)


if __name__ == "__main__":
    main()