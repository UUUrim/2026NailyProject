"""
run_pipeline.py
---------------
End-to-end nail pipeline: crop → measure → generate STL (round)

Usage:
    python run_pipeline.py --photos photos/thumb4.jpg photos/index4.jpg \
                                    photos/middle4.jpg photos/ring4.jpg \
                                    photos/pinky4.jpg
    python run_pipeline.py --photos photos/thumb4.jpg photos/index4.jpg \
                                    photos/middle4.jpg photos/ring4.jpg \
                                    photos/pinky4.jpg \
                           --aruco-size 20 \
                           --crop-fraction 0.30 \
                           --output results/
"""

import argparse
import os
import sys
import subprocess

import cv2

FINGER_ORDER = ["thumb", "index", "middle", "ring", "pinky"]
SHAPE        = "round"
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
    print(f"  Cropped: {h}x{w} → {cut}x{w}  →  {out_path}")
    return out_path


def run(cmd: list):
    result = subprocess.run(cmd, cwd=BASE)
    if result.returncode != 0:
        sys.exit(f"ERROR: command failed: {' '.join(cmd)}")


def main():
    p = argparse.ArgumentParser(description="Nail pipeline: crop → measure → STL")
    p.add_argument("--photos", nargs=5, required=True,
                   metavar=("THUMB", "INDEX", "MIDDLE", "RING", "PINKY"),
                   help="Photos in order: thumb index middle ring pinky")
    p.add_argument("--aruco-size",     type=float, default=20.0,
                   help="Physical ArUco marker side length in mm (default: 20)")
    p.add_argument("--crop-fraction",  type=float, default=0.30,
                   help="Fraction of image height to remove from bottom (default: 0.30)")
    p.add_argument("--output",         default="results",
                   help="Root output folder (default: results/)")
    args = p.parse_args()

    for i, (finger, photo) in enumerate(zip(FINGER_ORDER, args.photos)):
        print(f"\n{'='*60}")
        print(f"  [{i+1}/5] {finger.upper()}")
        print(f"{'='*60}")

        # ── Step 1: Crop ──────────────────────────────────────────
        print("\n[Step 1] Crop")
        cropped_path = crop_image(photo, args.crop_fraction)

        # ── Step 2: Measure ───────────────────────────────────────
        print("\n[Step 2] Measure")
        finger_out = os.path.join(args.output, finger)
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
        print(f"\n[Step 3] Generate STL ({SHAPE})")
        stl_dir   = os.path.join(finger_out, "stl")
        json_path = os.path.join(finger_out, "nail_measurements.json")
        os.makedirs(stl_dir, exist_ok=True)
        run([
            sys.executable,
            os.path.join(BASE, "nail_exact_stl.py"),
            "--input",  json_path,
            "--shape",  SHAPE,
            "--finger", finger,
            "--output", stl_dir,
        ])

    print(f"\n{'='*60}")
    print("All done!")
    print(f"Results saved to: {os.path.abspath(args.output)}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
