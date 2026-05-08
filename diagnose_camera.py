"""
diagnose_camera.py
Quick diagnostic: shows live camera feed and tries ALL ArUco dictionaries.
Run this to check if your webcam + marker are working before nail_capture.py.

Usage:
    python diagnose_camera.py

Press Q to quit.
"""

import cv2
import cv2.aruco as aruco
import time

CAMERA_INDEX = 1   # change to 0 if you see the wrong camera

DICTS = {
    "4x4_50":  aruco.DICT_4X4_50,
    "4x4_100": aruco.DICT_4X4_100,
    "5x5_50":  aruco.DICT_5X5_50,
    "5x5_100": aruco.DICT_5X5_100,
    "6x6_50":  aruco.DICT_6X6_50,
    "6x6_100": aruco.DICT_6X6_100,
}

detectors = {
    name: aruco.ArucoDetector(
        aruco.getPredefinedDictionary(did),
        aruco.DetectorParameters()
    )
    for name, did in DICTS.items()
}

print(f"Opening camera index {CAMERA_INDEX} ...")
cap = cv2.VideoCapture(CAMERA_INDEX, cv2.CAP_DSHOW)
if not cap.isOpened():
    print(f"[Error] Cannot open camera {CAMERA_INDEX}. Try changing CAMERA_INDEX to 0.")
    exit(1)

# Start at lower resolution so autofocus settles faster
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
print(f"Camera resolution: {actual_w} x {actual_h}")
print("Hold the ArUco marker in front of the camera.")
print("Press Q to quit.\n")

start = time.time()

while True:
    ret, frame = cap.read()
    if not ret:
        print("[Error] Cannot read frame.")
        break

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    display = frame.copy()
    h, w = display.shape[:2]

    found_any = False
    found_info = []

    for name, det in detectors.items():
        corners, ids, _ = det.detectMarkers(gray)
        if ids is not None and len(ids) > 0:
            aruco.drawDetectedMarkers(display, corners, ids)
            found_any = True
            found_info.append(f"{name}  id={ids.flatten().tolist()}")

    elapsed = int(time.time() - start)

    if found_any:
        color = (0, 255, 0)
        cv2.rectangle(display, (0, 0), (w - 1, h - 1), color, 8)
        y = 40
        for info in found_info:
            cv2.putText(display, f"DETECTED: {info}",
                        (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.85, color, 2)
            print(f"[{elapsed:3d}s] DETECTED: {info}")
            y += 35
    else:
        color = (0, 0, 255)
        cv2.rectangle(display, (0, 0), (w - 1, h - 1), color, 8)
        cv2.putText(display, f"No marker detected  ({elapsed}s)",
                    (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.85, color, 2)
        cv2.putText(display, "Tried: " + ", ".join(DICTS.keys()),
                    (10, h - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (150, 150, 150), 1)

    cv2.imshow("Diagnose Camera — Q to quit", display)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()
print("\nDone.")
