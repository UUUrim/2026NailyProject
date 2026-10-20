"""
guide_capture.py
----------------
큐티클 가이드선이 보이는 임시 촬영 화면. 측정은 하지 않고, 가이드선에 손가락을 맞춰서
사진만 여러 장 찍어 저장한다 (저장된 사진은 나중에 측정 코드 테스트에 쓴다).

사용:
    python scan/guide_capture.py                       # 카메라 0, 사진은 new_box_photos/ 에 저장
    python scan/guide_capture.py --camera 1            # 카메라 번호가 다를 때
    python scan/guide_capture.py --out some_folder     # 저장 폴더 바꾸기
    python scan/guide_capture.py --image 사진.jpg --preview out.jpg   # 카메라 없이 화면 모양만 확인

조작:
    SPACE / ENTER : 지금 화면을 저장 (가이드선 없는 원본 프레임이 저장된다)
    Q / ESC       : 종료

맞추는 법:
    손가락을 검정 막대 위에 올리고, 하늘색 점선(ALIGN CUTICLE TO LINE)에 큐티클(손톱 아래 반달/
    살이 시작되는 곳)을 맞춘다. 선 위치는 nail_live.py 와 같은 값(마커 아래 끝 + GUIDE_LINE_OFFSET_MM)이라
    측정할 때 보게 될 선과 똑같다. 마커가 안 보이면 선이 안 나오므로 마커가 가려지지 않게 한다.
"""
import argparse
import os
import sys
import time

import cv2
import numpy as np

import nail_live as nl
import nail_measurer as nm

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, "..", "new_box_photos")
DISPLAY_H = 820
STRIP_COLOR = (0, 200, 255)      # BGR 노랑: 검정 띠 양끝 표시


def build_view(frame, aruco_size_mm=20.0, saved=0):
    """프레임 복사본 위에 가이드선, 띠 범위, 안내문을 그려서 돌려준다."""
    view = frame.copy()
    corners = nl.detect_marker_only(frame, aruco_size_mm)
    if corners is None:
        nl.put(view, "MARKER NOT FOUND - uncover the marker", (20, 50), (0, 0, 255), 1.0, 3)
    else:
        mpp = nl.marker_mm_per_px(corners, aruco_size_mm)
        strip = nm.find_finger_strip(frame, corners, mpp)
        if strip is not None:
            for x in strip:
                cv2.line(view, (x, 0), (x, view.shape[0]), STRIP_COLOR, 1, cv2.LINE_AA)
            cx = (strip[0] + strip[1]) // 2
        else:
            nl.put(view, "black strip not found", (20, 50), (0, 165, 255), 0.9, 2)
            cx = int(corners[:, 0].max() + 55.0 / mpp)       # server.py FINGER_SLOT_FROM_MARKER_MM
        guide_y = nl.guide_line_row(corners, cx, nl.guide_line_offset_mm("") / mpp)
        nl.draw_guide_line(view, guide_y)
    nl.put(view, f"SPACE: save   Q: quit   saved: {saved}", (20, view.shape[0] - 24),
           (255, 255, 255), 0.9, 2)
    return view


def save_frame(frame, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "guided_" + time.strftime("%Y%m%d_%H%M%S") + ".jpg")
    n = 1
    while os.path.exists(path):
        path = os.path.join(out_dir, f"guided_{time.strftime('%Y%m%d_%H%M%S')}_{n}.jpg")
        n += 1
    cv2.imwrite(path, frame, [cv2.IMWRITE_JPEG_QUALITY, 95])
    return path


def main():
    p = argparse.ArgumentParser(description="Live view with cuticle guide line; saves photos only")
    p.add_argument("--camera", type=int, default=0, help="camera index (server.py CAMERA_TOP = 0)")
    p.add_argument("--rotate", type=int, default=0, choices=[0, 90, 180, 270])
    p.add_argument("--aruco-size", type=float, default=20.0)
    p.add_argument("--out", default=DEFAULT_OUT, help="folder the photos are saved into")
    p.add_argument("--image", help="use this photo instead of the camera (to check the view)")
    p.add_argument("--preview", help="with --image: write the rendered view here and exit")
    args = p.parse_args()

    if args.image:
        frame = cv2.imread(args.image)
        if frame is None:
            sys.exit(f"cannot read {args.image}")
        view = build_view(frame, args.aruco_size)
        if args.preview:
            cv2.imwrite(args.preview, view)
            print(f"wrote {args.preview}")
            return
        cv2.imshow("guide_capture", view)
        cv2.waitKey(0)
        return

    cap = nl.open_camera(args.camera, args.rotate)
    for _ in range(5):          # 자동 노출이 자리 잡을 때까지 몇 장 버린다
        cap.read()
    saved = 0
    flash_until = 0.0
    scale = DISPLAY_H / nl.CAM_HEIGHT
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                continue
            view = build_view(frame, args.aruco_size, saved)
            view = cv2.resize(view, None, fx=scale, fy=scale)
            if time.time() < flash_until:
                cv2.rectangle(view, (0, 0), (view.shape[1] - 1, view.shape[0] - 1), (0, 255, 0), 12)
            cv2.imshow("guide_capture", view)
            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), ord("Q"), 27):
                break
            if key in (32, 13):
                path = save_frame(frame, args.out)
                saved += 1
                flash_until = time.time() + 0.4
                print(f"[Saved {saved}] {os.path.abspath(path)}")
    finally:
        cap.release()
        cv2.destroyAllWindows()
    print(f"Done. {saved} photo(s) saved to {os.path.abspath(args.out)}")


if __name__ == "__main__":
    main()
