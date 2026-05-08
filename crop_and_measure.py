"""
Crop bottom of image to remove open box entry side, then run nail_measurer.
"""
import cv2
import sys
import os
import subprocess

IMAGE_SRC  = r"C:\nail_ArUco\photos\middle2.jpg"
IMAGE_CROP = r"C:\nail_ArUco\photos\middle2_cropped.jpg"
FINGER     = "middle"
ARUCO_SIZE = 20
OUTPUT_DIR = r"C:\nail_ArUco\results\middle"
SHAPES     = ["round", "almond", "square", "stiletto", "ballerina"]
CROP_BOTTOM_FRAC = 0.30   # remove bottom 30% (red fabric + black device)

img = cv2.imread(IMAGE_SRC)
if img is None:
    sys.exit(f"Cannot open: {IMAGE_SRC}")

h, w = img.shape[:2]
cut = int(h * (1.0 - CROP_BOTTOM_FRAC))
cropped = img[:cut, :]
os.makedirs(os.path.dirname(IMAGE_CROP), exist_ok=True)
cv2.imwrite(IMAGE_CROP, cropped)
print(f"Cropped: {h}x{w} -> {cropped.shape[0]}x{cropped.shape[1]}, saved to {IMAGE_CROP}")

# Run measurer
cmd = [
    sys.executable,
    r"C:\nail_ArUco\nail_measurer.py",
    "--top",        IMAGE_CROP,
    "--finger",     FINGER,
    "--aruco-size", str(ARUCO_SIZE),
    "--output",     OUTPUT_DIR,
]
result = subprocess.run(cmd, cwd=r"C:\nail_ArUco")
if result.returncode != 0:
    sys.exit(result.returncode)

# Run STL generator for all shapes
measurements_json = os.path.join(OUTPUT_DIR, "nail_measurements.json")
stl_output_dir    = os.path.join(OUTPUT_DIR, "stl")
os.makedirs(stl_output_dir, exist_ok=True)

print(f"\n{'='*55}")
print("Generating STL files for all shapes...")
print(f"{'='*55}")

for shape in SHAPES:
    cmd = [
        sys.executable,
        r"C:\nail_ArUco\nail_exact_stl.py",
        "--input",  measurements_json,
        "--shape",  shape,
        "--finger", FINGER,
        "--output", stl_output_dir,
    ]
    print(f"\n[STL] Generating '{shape}' ...")
    subprocess.run(cmd, cwd=r"C:\nail_ArUco")

print(f"\n{'='*55}")
print("All done! STL files saved to:", stl_output_dir)
print(f"{'='*55}")
