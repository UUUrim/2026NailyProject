"""
nail_capture.py
Webcam capture → measure → STL generation pipeline.

Usage:
    python nail_capture.py

AUTO-CAPTURE mode (default):
    Place your finger + ArUco marker in view.
    When the marker is detected and stays STILL for ~2 seconds,
    a 3-2-1 countdown appears and the photo is taken automatically.
    No keyboard needed during capture!

Manual override controls:
    SPACE  : Force capture immediately
    R      : Retake (shown after capture for review)
    ENTER  : Confirm captured photo & run pipeline
    Q      : Quit

Live preview:
    GREEN border  : Marker detected + stable (countdown running)
    YELLOW border : Marker detected but still moving
    RED border    : Marker NOT detected
"""

import cv2
import cv2.aruco as aruco
import subprocess
import sys
import os
from collections import deque

# ── Settings ──────────────────────────────────────────────────────────────────
PROJECT_DIR   = r"C:\nail_ArUco"
PHOTOS_DIR    = os.path.join(PROJECT_DIR, "photos")
ARUCO_SIZE    = 20        # real marker size in mm
SHAPES        = ["round", "almond", "square", "stiletto", "ballerina"]
CAMERA_INDEX  = 1         # None = auto-detect; or set to 0 / 1 manually

# Auto-capture tuning
STABLE_FRAMES   = 45      # frames marker must stay still before countdown starts (~1.5s at 30fps)
STABLE_PX_THRESH = 6      # max pixel movement allowed to count as "still"
COUNTDOWN_SEC   = 3       # seconds for the 3-2-1 countdown

# Crop settings (pixels removed from each edge before saving — 0 = disabled)
# Tune CROP_BOTTOM to cut out the open hand-entry side of the box.
# A cyan line in the live preview shows exactly where the crop line falls.
CROP_TOP    = 0
CROP_BOTTOM = 270   # <-- adjust this value; 270px removes ~25% of a 1080p frame
CROP_LEFT   = 0
CROP_RIGHT  = 0
# ─────────────────────────────────────────────────────────────────────────────

FINGERS = ["thumb", "index", "middle", "ring", "pinky"]


def auto_detect_camera():
    """Try camera indices 0–3 and return the first one that opens."""
    for idx in range(4):
        cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
        if cap.isOpened():
            ret, _ = cap.read()
            cap.release()
            if ret:
                print(f"  Camera found at index {idx}")
                return idx
    return None


def select_finger():
    print("\nWhich finger are you measuring?")
    for i, f in enumerate(FINGERS):
        print(f"  {i+1}. {f}")
    while True:
        try:
            choice = int(input("Enter number: "))
            if 1 <= choice <= len(FINGERS):
                return FINGERS[choice - 1]
        except ValueError:
            pass
        print("Please enter a number between 1 and 5.")


def select_shapes():
    print("\nWhich nail shapes do you want? (comma-separated, or ENTER for all)")
    print("  Options:", ", ".join(SHAPES))
    raw = input("Shapes: ").strip()
    if not raw:
        return SHAPES
    chosen = [s.strip().lower() for s in raw.split(",")]
    valid = [s for s in chosen if s in SHAPES]
    if not valid:
        print("  None valid — generating all shapes.")
        return SHAPES
    return valid


def make_aruco_detector():
    """Create an ArUco detector for 4x4_50 dictionary (same as generate_aruco.py)."""
    dictionary = aruco.getPredefinedDictionary(aruco.DICT_4X4_50)
    params = aruco.DetectorParameters()
    detector = aruco.ArucoDetector(dictionary, params)
    return detector


def detect_aruco(frame, detector):
    """Return (corners, ids) from frame. ids is None if nothing detected."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    corners, ids, _ = detector.detectMarkers(gray)
    return corners, ids


def marker_center(corners):
    """Return (cx, cy) of the first detected marker."""
    pts = corners[0][0]  # shape (4, 2)
    return pts.mean(axis=0)


def draw_preview(frame, corners, ids, stable_frames, countdown_val):
    """
    Draw ArUco overlay + status border + countdown.
    stable_frames : how many consecutive still frames so far
    countdown_val : None = not counting, else int seconds remaining
    Returns annotated frame.
    """
    out = frame.copy()
    h, w = out.shape[:2]
    detected = ids is not None and len(ids) > 0

    if detected:
        aruco.drawDetectedMarkers(out, corners, ids)

    if not detected:
        # Red border
        color = (0, 0, 255)
        cv2.rectangle(out, (0, 0), (w - 1, h - 1), color, 8)
        cv2.putText(out, "No marker — place ArUco marker in view",
                    (10, h - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.75, color, 2)
        cv2.putText(out, "SPACE: force capture  |  Q: quit",
                    (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 0), 2)

    elif countdown_val is not None:
        # Green border + large countdown number
        color = (0, 255, 0)
        cv2.rectangle(out, (0, 0), (w - 1, h - 1), color, 12)
        cv2.putText(out, str(countdown_val),
                    (w // 2 - 60, h // 2 + 80),
                    cv2.FONT_HERSHEY_SIMPLEX, 10, (0, 255, 0), 20, cv2.LINE_AA)
        cv2.putText(out, "Hold still!",
                    (10, h - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.9, color, 2)

    else:
        # Marker detected, not yet stable enough
        ratio = min(stable_frames / STABLE_FRAMES, 1.0)
        # Border fades yellow → green as stability grows
        b = int(0)
        g = int(180 + 75 * ratio)
        r = int(255 * (1 - ratio))
        color = (b, g, r)
        cv2.rectangle(out, (0, 0), (w - 1, h - 1), color, 8)

        # Progress bar at bottom
        bar_w = int((w - 20) * ratio)
        cv2.rectangle(out, (10, h - 25), (10 + bar_w, h - 10), color, -1)
        cv2.rectangle(out, (10, h - 25), (w - 10, h - 10), (180, 180, 180), 1)

        cv2.putText(out, "Marker detected — hold still...",
                    (10, h - 35), cv2.FONT_HERSHEY_SIMPLEX, 0.75, color, 2)
        cv2.putText(out, "SPACE: force capture  |  Q: quit",
                    (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 0), 2)

    # Draw crop boundary lines so the user knows what will be saved
    if CROP_BOTTOM > 0:
        cv2.line(out, (0, h - CROP_BOTTOM), (w, h - CROP_BOTTOM), (255, 255, 0), 2)
        cv2.putText(out, "crop", (8, h - CROP_BOTTOM - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 0), 1)
    if CROP_TOP > 0:
        cv2.line(out, (0, CROP_TOP), (w, CROP_TOP), (255, 255, 0), 2)
    if CROP_LEFT > 0:
        cv2.line(out, (CROP_LEFT, 0), (CROP_LEFT, h), (255, 255, 0), 2)
    if CROP_RIGHT > 0:
        cv2.line(out, (w - CROP_RIGHT, 0), (w - CROP_RIGHT, h), (255, 255, 0), 2)

    return out


def capture_photo(finger, camera_idx):
    """
    Open webcam. Auto-captures when ArUco marker is stable for STABLE_FRAMES,
    then runs a 3-2-1 countdown. Manual: SPACE to force capture.
    After capture: ENTER to confirm, R to retake, Q to quit.
    """
    cap = cv2.VideoCapture(camera_idx, cv2.CAP_DSHOW)
    if not cap.isOpened():
        print(f"[Error] Cannot open camera at index {camera_idx}.")
        sys.exit(1)

    # Logitech C920 max resolution
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)

    save_path = os.path.join(PHOTOS_DIR, f"{finger}.jpg")
    window_name = f"Nail Capture — {finger}"
    detector = make_aruco_detector()

    print(f"\n[Camera] Auto-capture mode for '{finger}'")
    print("  Place finger + ArUco marker in view and HOLD STILL.")
    print("  Auto-captures after ~2s of stability.")
    print("  SPACE: force capture immediately  |  Q: quit\n")

    # State
    captured_frame = None
    recent_centers = deque(maxlen=STABLE_FRAMES)
    countdown_start = None   # time.time() when countdown began

    import time

    while True:
        ret, frame = cap.read()
        if not ret:
            print("[Error] Cannot read frame.")
            break

        key = cv2.waitKey(1) & 0xFF

        if key == ord('q'):
            print("Quitting.")
            cap.release()
            cv2.destroyAllWindows()
            sys.exit(0)

        # ── Review mode (photo already taken) ────────────────────────────────
        if captured_frame is not None:
            corners, ids = detect_aruco(captured_frame, detector)
            display = captured_frame.copy()
            if ids is not None:
                aruco.drawDetectedMarkers(display, corners, ids)
            h, w = display.shape[:2]
            cv2.putText(display, "ENTER: accept & run pipeline  |  R: retake  |  Q: quit",
                        (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.85, (0, 200, 255), 2)
            cv2.rectangle(display, (0, 0), (w - 1, h - 1), (0, 200, 255), 8)
            cv2.imshow(window_name, display)

            if key == 13:  # ENTER
                os.makedirs(PHOTOS_DIR, exist_ok=True)
                h_f, w_f = captured_frame.shape[:2]
                y1 = CROP_TOP
                y2 = h_f - CROP_BOTTOM if CROP_BOTTOM > 0 else h_f
                x1 = CROP_LEFT
                x2 = w_f - CROP_RIGHT  if CROP_RIGHT  > 0 else w_f
                cv2.imwrite(save_path, captured_frame[y1:y2, x1:x2])
                print(f"  Saved (cropped {CROP_TOP}+{CROP_BOTTOM}px top/bottom, "
                      f"{CROP_LEFT}+{CROP_RIGHT}px left/right): {save_path}")
                break
            elif key == ord('r'):
                captured_frame = None
                recent_centers.clear()
                countdown_start = None
                print("  Retaking...")
            continue

        # ── Live preview ──────────────────────────────────────────────────────
        corners, ids = detect_aruco(frame, detector)
        detected = ids is not None and len(ids) > 0

        if not detected:
            recent_centers.clear()
            countdown_start = None

        else:
            cx, cy = marker_center(corners)
            recent_centers.append((cx, cy))

            # Check stability: max distance from mean over recent frames
            if len(recent_centers) == STABLE_FRAMES:
                xs = [p[0] for p in recent_centers]
                ys = [p[1] for p in recent_centers]
                spread = max(max(xs) - min(xs), max(ys) - min(ys))
                if spread > STABLE_PX_THRESH:
                    # Still moving — reset
                    recent_centers.clear()
                    countdown_start = None
                elif countdown_start is None:
                    # Just became stable — start countdown
                    countdown_start = time.time()

            elif countdown_start is not None:
                # Buffer not full yet but countdown was running — reset
                countdown_start = None

        # Countdown logic
        countdown_val = None
        if countdown_start is not None:
            elapsed = time.time() - countdown_start
            remaining = COUNTDOWN_SEC - elapsed
            if remaining <= 0:
                # AUTO-CAPTURE
                captured_frame = frame.copy()
                print("  [Auto-capture] Photo taken!")
                countdown_start = None
                recent_centers.clear()
                continue
            countdown_val = int(remaining) + 1  # shows 3, 2, 1

        # Force capture with SPACE
        if key == ord(' '):
            captured_frame = frame.copy()
            countdown_start = None
            recent_centers.clear()
            print("  [Manual capture] Photo taken! Press ENTER to confirm or R to retake.")
            continue

        display = draw_preview(frame, corners, ids,
                               len(recent_centers), countdown_val)
        cv2.imshow(window_name, display)

    cap.release()
    cv2.destroyAllWindows()
    return save_path


def run_measurer(finger, photo_path):
    """Run nail_measurer.py."""
    output_dir = os.path.join(PROJECT_DIR, "results", finger)
    os.makedirs(output_dir, exist_ok=True)

    cmd = [
        sys.executable,
        os.path.join(PROJECT_DIR, "nail_measurer.py"),
        "--top", photo_path,
        "--finger", finger,
        "--aruco-size", str(ARUCO_SIZE),
        "--output", output_dir,
    ]

    print(f"\n[Measure] Running nail_measurer.py ...")
    result = subprocess.run(cmd, cwd=PROJECT_DIR)

    if result.returncode != 0:
        print("[Error] Measurement failed. Is the ArUco marker clearly visible in the photo?")
        sys.exit(1)

    print("  Measurement done.")
    return output_dir


def run_stl_generator(finger, output_dir, shapes):
    """Run nail_exact_stl.py for each requested shape."""
    measurements_json = os.path.join(output_dir, "nail_measurements.json")
    stl_output_dir    = os.path.join(output_dir, "stl")
    os.makedirs(stl_output_dir, exist_ok=True)

    generated = []
    for shape in shapes:
        cmd = [
            sys.executable,
            os.path.join(PROJECT_DIR, "nail_exact_stl.py"),
            "--input",  measurements_json,
            "--shape",  shape,
            "--finger", finger,
            "--output", stl_output_dir,
        ]
        print(f"\n[STL] Generating '{shape}' ...")
        result = subprocess.run(cmd, cwd=PROJECT_DIR)
        if result.returncode != 0:
            print(f"  [Warning] STL generation failed for shape '{shape}', skipping.")
            continue
        stl_file = os.path.join(stl_output_dir, f"nail_{finger}_{shape}.stl")
        generated.append(stl_file)
        print(f"  -> {stl_file}")

    return generated


def main():
    print("=" * 55)
    print("   Nail ArUco — Automated Capture & STL Pipeline")
    print("=" * 55)

    # 1. Select finger
    finger = select_finger()
    print(f"  Selected: {finger}")

    # 2. Select shapes
    shapes = select_shapes()
    print(f"  Shapes: {', '.join(shapes)}")

    # 3. Detect camera
    cam_idx = CAMERA_INDEX
    if cam_idx is None:
        print("\n[Camera] Auto-detecting webcam ...")
        cam_idx = auto_detect_camera()
        if cam_idx is None:
            print("[Error] No camera found. Connect your webcam and try again.")
            sys.exit(1)

    # 4. Capture photo
    photo_path = capture_photo(finger, cam_idx)

    # 5. Measure
    output_dir = run_measurer(finger, photo_path)

    # 6. Generate STL files
    stl_files = run_stl_generator(finger, output_dir, shapes)

    print("\n" + "=" * 55)
    print("  Done!")
    print(f"  Finger  : {finger}")
    print(f"  Photo   : {photo_path}")
    print(f"  Results : {output_dir}")
    print(f"  STL files ({len(stl_files)}):")
    for f in stl_files:
        print(f"    {f}")
    print("=" * 55)


if __name__ == "__main__":
    main()
