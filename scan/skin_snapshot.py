"""
skin_snapshot.py
================
피부색 확인용 사진을 찍는다 (두 장: 피부용 + 흰색 기준용).

손톱 측정/실시간 영상은 카메라 원래(자동 노출) 설정으로 찍어야 하는데, 그 설정에서는 박스 안이
과노출이라 마커 흰색이 날아가고 피부색(톤)이 노랗게 치우친다. 그래서 촬영이 확정되는 순간(손가락이
확실히 그 자리에 있다) 노출만 잠깐 수동으로 낮춰서 사진을 더 찍고, 곧바로 자동으로 되돌린다.
측정은 원래 자동 사진으로 하고, 피부색만 이 사진들에서 잰다 (nail_measurer.measure_top의 skin_image).

두 장을 찍는 이유 (이 PC의 C920 실측):
  - 노출 -8: 마커 흰색이 안 날아가서(약 186,212,216) 조명 색 쏠림을 잴 수 있다. 하지만 어두워서
    카메라의 톤 곡선 때문에 피부가 실제보다 진하고 채도가 과하게 나온다 (연한 손이 황갈색 #C48767로).
  - 노출 -7: 마커 흰색은 날아가지만(246,255,255) 피부는 자연스러운 밝기/채도로 찍힌다.
  그래서 피부색은 -7 사진에서, 색 쏠림(흰색)은 -8 사진에서 가져온다.
  (이 카메라의 노출은 정수 단계로만 움직인다: -7.5는 -7과 같은 결과.)

  - 노출만 자동 <-> 수동으로 오가도 매번 카메라가 따라온다. (색온도/AUTO_WB는 건드리지 않는다:
    예전에 AUTO_WB까지 오가다가 수동 노출이 안 먹는 상태로 꼬인 적이 있다.)
  - 수동으로 바꾼 뒤 약 6프레임(0.2초)이면 값이 안정된다. 자동으로 돌아와 완전히 원래 밝기가 되는 데는
    약 1초 걸린다(그동안 영상이 조금 어둡다) - 다음 손가락을 올리는 시간 안에 끝난다.
"""

from __future__ import annotations

import os

import cv2
import numpy as np

SKIN_SNAPSHOT_EXPOSURE = -7      # 피부색을 잴 사진의 수동 노출 (log2 초)
WHITE_REF_EXPOSURE = -8          # 마커 흰색(조명 색 쏠림) 기준 사진의 수동 노출
SETTLE_FRAMES = 8                # 노출이 바뀐 뒤 버리는 프레임 (6프레임이면 안정)
SNAPSHOT_FRAMES = 3              # 이 장수의 중앙값으로 한 장을 만든다 (노이즈 감소)


def ref_path_for(skin_path: str) -> str:
    """피부 사진 경로에 대응하는 흰색 기준 사진 경로 (<이름>_ref.jpg)."""
    return os.path.splitext(skin_path)[0] + "_ref.jpg"


def _remove(path: str) -> None:
    try:
        if os.path.isfile(path):
            os.remove(path)
    except OSError:
        pass


def _grab(cap, exposure, crop_top_px: int):
    """노출을 exposure(수동)로 맞추고 안정될 때까지 기다린 뒤 SNAPSHOT_FRAMES장의 중앙값 사진을 돌려준다."""
    cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 0.25)          # DirectShow: 0.25 = 수동, 0.75 = 자동
    cap.set(cv2.CAP_PROP_EXPOSURE, exposure)
    for _ in range(SETTLE_FRAMES):
        cap.read()
    frames = []
    for _ in range(SNAPSHOT_FRAMES):
        ok, frame = cap.read()
        if ok and frame is not None:
            frames.append(frame[crop_top_px:, :] if crop_top_px > 0 else frame)
    if not frames:
        return None
    return frames[0] if len(frames) == 1 else np.median(np.stack(frames), axis=0).astype(np.uint8)


def capture_skin_snapshot(cap, save_path: str, crop_top_px: int = 0, exposure: int = SKIN_SNAPSHOT_EXPOSURE,
                          ref_exposure=WHITE_REF_EXPOSURE) -> bool:
    """cap(OpenCV VideoCapture)으로 피부 확인용 사진을 save_path에, 흰색 기준 사진을 ref_path_for(save_path)에 저장한다.
    피부 사진이 저장되면 True (기준 사진은 없어도 된다 - 없으면 피부 사진 자체의 마커 흰색을 쓴다).

    - 이미 있던 같은 이름의 파일은 먼저 지운다(이번에 실패했는데 옛 사진이 남아 섞이지 않게).
    - 어떤 오류가 나도 예외를 던지지 않고 False를 돌려준다 (촬영 흐름을 막지 않는다).
    - 끝나면 반드시 노출을 자동으로 되돌린다.
    - cap.read()를 호출하므로, 다른 스레드가 같은 cap을 읽고 있지 않을 때만 불러야 한다.
    - ref_exposure=None 이면 기준 사진을 찍지 않는다.
    """
    ref_path = ref_path_for(save_path)
    _remove(save_path)
    _remove(ref_path)

    try:
        # 피부 사진을 먼저 찍는다: 촬영 확정 직후라 손가락이 아직 그 자리에 있다. (두 장 다 찍는 데 1초쯤 걸려서
        # 순서를 반대로 하면 피부 사진을 찍을 때쯤 손이 빠져 있어 손가락 자리에 까만 바닥이 찍혔다.)
        # 흰색 기준 사진은 마커만 보면 되니 손이 빠져도 상관없다.
        snap = _grab(cap, exposure, crop_top_px)
        if snap is None:
            return False
        saved = bool(cv2.imwrite(save_path, snap, [cv2.IMWRITE_JPEG_QUALITY, 95]))
        if saved and ref_exposure is not None and ref_exposure != exposure:
            ref = _grab(cap, ref_exposure, crop_top_px)
            if ref is not None:
                cv2.imwrite(ref_path, ref, [cv2.IMWRITE_JPEG_QUALITY, 95])
        return saved
    except Exception as e:                              # noqa: BLE001 - 촬영을 막지 않는다
        print(f"  [SkinSnapshot] 피부 확인용 사진 실패: {e}")
        return False
    finally:
        try:
            cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 0.75)
        except Exception:                               # noqa: BLE001
            pass
