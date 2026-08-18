"""
merge_fingers.py
-----------------
5개 손가락 STL 파일을 S3에서 받아와서, 기울기와 손가락간 간격을 적용한 뒤
하나의 3MF 파일로 병합한다 (Bambu Studio / Orca Slicer가 여전히 손가락별로
개별 오브젝트로 인식할 수 있도록 오브젝트는 개별로 유지).

Usage (CLI 직접 실행):
    python merge_fingers.py --userid 3 --session 25 --hand left --shape round

    # 손가락마다 쉐입이 다르면:
    python merge_fingers.py --userid 3 --session 25 --hand left \
        --thumb-shape almond --index-shape round --middle-shape round \
        --ring-shape oval --pinky-shape round

    # 양손:
    python merge_fingers.py --userid 3 --left-session 25 --right-session 26 --both --shape round

프로그램에서 직접 호출할 때는 merge_hand() / merge_both_hands()를 임포트해서 쓰면 된다
(server.py 같은 FastAPI 래퍼에서 이 함수를 그대로 호출한다).
"""

import argparse
import os
import trimesh
import numpy as np

from s3_helper import download_finger_stls

BASE = os.path.dirname(os.path.abspath(__file__))

FINGER_ORDER = ["thumb", "index", "middle", "ring", "pinky"]

SPACING_MM = 10.0       # 손가락 사이 간격 (mm)
TILT_DEG = -40.0         # 음수 = 반대 방향으로 기울임
TILT_AXIS = [1, 0, 0]    # X축 기준 회전 (앞뒤로 기울이고 싶으면 [0,1,0]으로 변경)

ROW_SPACING_MM = 40.0   # 왼손 줄과 오른손 줄 사이 Y축 간격 (손가락 두께+여유를 감안한 값)


def _load_finger(path: str) -> trimesh.Trimesh:
    mesh = trimesh.load(path, force="mesh")
    if mesh.is_empty:
        raise ValueError(f"불러온 메쉬가 비어있습니다: {path}")
    return mesh


def _build_scene(finger_paths: dict, hand_label: str = "", y_offset: float = 0.0,
                  scene: trimesh.Scene | None = None) -> trimesh.Scene:
    """
    {손가락이름: STL경로} 형태로 받아서, thumb -> pinky 순서를 지키며 있는 것만
    기울이고 정렬해서 하나의 Scene으로 합친다. 손가락 하나가 없어도(측정 실패 등)
    나머지만으로 병합이 가능하다.

    hand_label: 오브젝트 이름 접두사 (양손을 한 3MF에 합칠 때 "left_thumb"/"right_thumb"처럼
                이름이 겹치지 않게 하기 위함). 한 손만 병합할 땐 빈 문자열로 둬도 됨.
    y_offset:   Y축으로 얼마나 밀어서 배치할지 (양손을 나란히 두 줄로 배치할 때 사용).
    scene:      이미 만들어진 Scene에 이어서 추가하고 싶을 때 넘긴다 (양손 병합용).
    """
    if scene is None:
        scene = trimesh.Scene()
    cursor_x = 0.0
    is_first = True

    for finger in FINGER_ORDER:
        if finger not in finger_paths:
            continue  # 이 손가락은 측정 실패 등으로 STL이 없음 — 건너뜀

        mesh = _load_finger(finger_paths[finger])

        # 자기 중심으로 먼저 이동시킨 후에 기울여야 원점 기준으로 안 날아감
        mesh.apply_translation(-mesh.centroid)

        tilt_matrix = trimesh.transformations.rotation_matrix(
            angle=np.radians(TILT_DEG),
            direction=TILT_AXIS,
            point=[0, 0, 0],
        )
        mesh.apply_transform(tilt_matrix)

        # 기울인 뒤 빌드 플레이트(Z=0)에 다시 붙이기
        mesh.apply_translation([0, 0, -mesh.bounds[0][2]])

        min_x = mesh.bounds[0][0]
        max_x = mesh.bounds[1][0]

        x_offset = -min_x if is_first else cursor_x - min_x
        is_first = False

        mesh.apply_translation([x_offset, y_offset, 0])
        cursor_x = x_offset + max_x + SPACING_MM

        node_name = f"{hand_label}_{finger}" if hand_label else finger
        scene.add_geometry(mesh, node_name=node_name, geom_name=node_name)

    return scene


def merge_hand(userid: str, session: str, hand: str, shapes: dict, output_dir: str | None = None) -> dict:
    """
    한 손(최대 5손가락) STL을 S3에서 받아와 병합한 3MF를 만든다.
    측정 실패 등으로 일부 손가락이 없어도, 있는 것만으로 병합을 진행한다.

    shapes: {"thumb": "round", "index": "round", ...} — 손가락별 쉐입.
    output_dir: 결과 3MF를 저장할 폴더. 안 주면 printer/output/{userid}/{session}/{hand}/ 사용.

    반환값: {
        "path": "생성된 3MF 파일의 로컬 경로",
        "missing": ["빠진 손가락 이름들"],  # 측정 실패 등으로 S3에 아예 없던 것들
    }
    """
    if output_dir is None:
        output_dir = os.path.join(BASE, "output", userid, session, hand)
    os.makedirs(output_dir, exist_ok=True)

    stl_download_dir = os.path.join(BASE, "stl", userid, session, hand)
    print(f"\n[Merge] {userid}/{session}/{hand} 의 STL 다운로드 중...")
    download_result = download_finger_stls(userid, session, hand, shapes, stl_download_dir)
    finger_paths = download_result["paths"]
    missing = download_result["missing"]

    if not finger_paths:
        raise RuntimeError(f"{userid}/{session}/{hand}: STL이 하나도 없어서 병합할 수 없습니다.")
    if missing:
        print(f"[Merge] 주의: {missing} 손가락 STL이 없어서 나머지 {len(finger_paths)}개만으로 병합합니다.")

    print(f"[Merge] 병합 중 (기울기 {TILT_DEG}°, 간격 {SPACING_MM}mm)...")
    scene = _build_scene(finger_paths)

    output_path = os.path.join(output_dir, "hand_merged.3mf")
    scene.export(output_path)

    print(f"[Merge] 완료: {output_path}")
    print(f"[Merge] 오브젝트: {list(scene.geometry.keys())}")
    return {"path": output_path, "missing": missing}


def merge_both_hands(userid: str, left_session: str, right_session: str,
                      left_shapes: dict, right_shapes: dict,
                      output_dir: str | None = None) -> dict:
    """
    양손(최대 10손가락) STL을 S3에서 받아와 하나의 3MF로 병합한다.
    왼손은 Y=0 줄에, 오른손은 그보다 ROW_SPACING_MM만큼 떨어진 줄에 배치해서
    두 손이 겹치지 않게 한다.

    [중요] 왼손/오른손은 서로 다른 스캔 세션(scanId)을 갖는다. 그래서 session을
    하나만 받지 않고 left_session/right_session을 따로 받는다.

    left_shapes / right_shapes: {"thumb": "round", ...} 형식, 손별로 따로 지정.

    반환값: {
        "path": "생성된 3MF 파일의 로컬 경로",
        "missingLeft": ["왼손에서 빠진 손가락들"],
        "missingRight": ["오른손에서 빠진 손가락들"],
    }
    """
    if output_dir is None:
        output_dir = os.path.join(BASE, "output", userid, f"{left_session}_{right_session}", "both")
    os.makedirs(output_dir, exist_ok=True)

    left_dir = os.path.join(BASE, "stl", userid, left_session, "left")
    right_dir = os.path.join(BASE, "stl", userid, right_session, "right")

    print(f"\n[Merge] {userid}/{left_session} 왼손 STL 다운로드 중...")
    left_result = download_finger_stls(userid, left_session, "left", left_shapes, left_dir)
    left_paths, missing_left = left_result["paths"], left_result["missing"]
    if missing_left:
        print(f"[Merge] 주의: 왼손 {missing_left} 손가락 STL이 없어서 제외됩니다.")

    print(f"[Merge] {userid}/{right_session} 오른손 STL 다운로드 중...")
    right_result = download_finger_stls(userid, right_session, "right", right_shapes, right_dir)
    right_paths, missing_right = right_result["paths"], right_result["missing"]
    if missing_right:
        print(f"[Merge] 주의: 오른손 {missing_right} 손가락 STL이 없어서 제외됩니다.")

    if not left_paths and not right_paths:
        raise RuntimeError(f"{userid}: 양손 모두 STL이 하나도 없어서 병합할 수 없습니다.")

    print(f"[Merge] 양손 병합 중 (기울기 {TILT_DEG}°, 손가락 간격 {SPACING_MM}mm, 손 간격 {ROW_SPACING_MM}mm)...")
    scene = trimesh.Scene()
    scene = _build_scene(left_paths, hand_label="left", y_offset=0.0, scene=scene)
    scene = _build_scene(right_paths, hand_label="right", y_offset=ROW_SPACING_MM, scene=scene)

    output_path = os.path.join(output_dir, "both_hands_merged.3mf")
    scene.export(output_path)

    print(f"[Merge] 완료: {output_path}")
    print(f"[Merge] 오브젝트: {list(scene.geometry.keys())}")
    return {"path": output_path, "missingLeft": missing_left, "missingRight": missing_right}


def _parse_args():
    p = argparse.ArgumentParser(description="손가락 STL을 하나의 3MF로 병합 (또는 --both로 양손)")
    p.add_argument("--userid", required=True)
    p.add_argument("--session", default=None, help="한 손만 병합할 때 그 손의 scanId")
    p.add_argument("--left-session", default=None, help="--both일 때 왼손 scanId")
    p.add_argument("--right-session", default=None, help="--both일 때 오른손 scanId")
    p.add_argument("--hand", choices=["left", "right"], help="한 손만 병합할 때 지정")
    p.add_argument("--both", action="store_true", help="양손을 한 3MF로 병합")
    p.add_argument("--shape", default=None,
                    help="다섯 손가락 모두 같은 쉐입을 쓸 때. 손가락별로 다르게 주려면 --{finger}-shape")
    for finger in FINGER_ORDER:
        p.add_argument(f"--{finger}-shape", default=None,
                        help=f"{finger} 손가락만 다른 쉐입을 쓰고 싶을 때 (--shape보다 우선)")
    return p.parse_args()


def _resolve_shapes(args) -> dict:
    shapes = {}
    for finger in FINGER_ORDER:
        per_finger = getattr(args, f"{finger}_shape")
        shapes[finger] = per_finger or args.shape
        if not shapes[finger]:
            raise SystemExit(f"'{finger}'의 쉐입이 지정되지 않았습니다.")
    return shapes


def main():
    args = _parse_args()

    if not args.both and not args.hand:
        raise SystemExit("--hand (한 손) 또는 --both (양손) 중 하나는 반드시 지정해야 합니다.")
    if args.both and (not args.left_session or not args.right_session):
        raise SystemExit("--both를 쓸 땐 --left-session과 --right-session을 모두 지정해야 합니다.")
    if not args.both and not args.session:
        raise SystemExit("한 손만 병합할 땐 --session을 지정해야 합니다.")
    if not args.shape and not any(getattr(args, f"{f}_shape") for f in FINGER_ORDER):
        raise SystemExit("--shape (공통) 또는 손가락별 --{finger}-shape 중 하나는 반드시 지정해야 합니다.")

    shapes = _resolve_shapes(args)

    if args.both:
        merge_both_hands(args.userid, args.left_session, args.right_session, shapes, shapes)
    else:
        merge_hand(args.userid, args.session, args.hand, shapes)


if __name__ == "__main__":
    main()