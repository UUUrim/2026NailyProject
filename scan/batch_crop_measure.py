"""
Crop bottom 30% of each photo, then run nail_measurer for all 5 fingers.
Outputs: nail_measurements.json, profile.json, {finger}_annotated.jpg
"""
import cv2
import sys
import os
import subprocess

ARUCO_SIZE = 20
CROP_BOTTOM_FRAC = 0.30
BASE = r"C:\nail_ArUco\scan"

FINGERS = [
    ("thumb",  r"C:\nail_ArUco\scan\photos\thumb4.jpg",  r"C:\nail_ArUco\scan\results\thumb"),
    ("index",  r"C:\nail_ArUco\scan\photos\index4.jpg",  r"C:\nail_ArUco\scan\results\index"),
    ("middle", r"C:\nail_ArUco\scan\photos\middle4.jpg", r"C:\nail_ArUco\scan\results\middle"),
    ("ring",   r"C:\nail_ArUco\scan\photos\ring4.jpg",   r"C:\nail_ArUco\scan\results\ring"),
    ("pinky",  r"C:\nail_ArUco\scan\photos\pinky4.jpg",  r"C:\nail_ArUco\scan\results\pinky"),
]

for finger, src, out_dir in FINGERS:
    print(f"\n{'='*55}")
    print(f"Processing: {finger}")
    print(f"{'='*55}")

    img = cv2.imread(src)
    if img is None:
        print(f"  ERROR: Cannot open {src}, skipping.")
        continue

    h, w = img.shape[:2]
    cut = int(h * (1.0 - CROP_BOTTOM_FRAC))
    cropped = img[:cut, :]

    crop_path = src.replace(".jpg", "_cropped.jpg")
    cv2.imwrite(crop_path, cropped)
    print(f"  Cropped: {h}x{w} -> {cropped.shape[0]}x{cropped.shape[1]}")

    os.makedirs(out_dir, exist_ok=True)

    cmd = [
        sys.executable,
        os.path.join(BASE, "nail_measurer.py"),
        "--top",        crop_path,
        "--finger",     finger,
        "--aruco-size", str(ARUCO_SIZE),
        "--output",     out_dir,
    ]
    result = subprocess.run(cmd, cwd=BASE)
    if result.returncode != 0:
        print(f"  ERROR: nail_measurer failed for {finger}")
    else:
        print(f"  Done -> {out_dir}")

print(f"\n{'='*55}")
print("All fingers processed.")
print(f"{'='*55}")
