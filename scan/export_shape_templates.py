"""
export_shape_templates.py

1회성 스크립트: 6개 네일팁 쉐입(round/oval/almond/square/stiletto/ballerina) 각각에
대해 nail_exact_stl.py의 기존 메시 생성 로직(generate_stl)을 재사용해 지오메트리를
만들고, trimesh로 로드해 평면 투영 UV를 입힌 뒤 GLB로 export한다.

목적: AR 미리보기가 디자인 생성 시 고른 쉐입에 맞는 "공용" 3D 템플릿 메시를 쓰고,
실제 크기는 카메라로 실측한 손톱 크기에 맞춰 프론트에서 스케일링한다(비율은 유지).
그래서 여기서 쓰는 치수는 실제 사용자 손톱 실측값이 아니라 그럴듯한 성인 손톱
평균치 한 세트일 뿐이다 — 절대 크기는 중요하지 않다.

주의 (중요): 이 스크립트는 이번 세션에서 실행/검증되지 않았다. 아래 사용법대로
직접 실행해서 6개 GLB가 watertight/UV가 올바르게 나오는지(블렌더 등으로 열어)
확인할 것.

사용법:
    cd scan
    pip install -r requirements.txt   # trimesh 포함
    python export_shape_templates.py --output ../Frontend/public/models/nail-tips
"""
import argparse
import os

import numpy as np
import trimesh

from nail_exact_stl import (
    CORNER_ROUND_DEFAULT_MM,
    EDGE_ROUND_DEFAULT_MM,
    SHAPES,
    SHOULDER_ROUND_DEFAULT_MM,
    TIP_EXTENSION_DEFAULT_MM,
    generate_stl,
)

# 일반적인 성인 손톱 평균 치수 — 정밀한 인체측정 데이터가 아니라 "그럴듯한 손톱
# 하나" 정도의 자리표시자다. AR 미리보기가 이 메시를 카메라로 실측한 실제 손톱
# 크기에 맞춰 비율을 유지한 채 스케일링하므로, 절대 치수 자체는 중요하지 않다.
GENERIC_WIDTH_MM = 14.0
GENERIC_LENGTH_MM = 16.0
GENERIC_C_CURVE_MM = 2.0
GENERIC_ARC_RADIUS_MM = 8.0


def _build_params(shape: str) -> dict:
    return {
        "width_mm": GENERIC_WIDTH_MM,
        "length_mm": GENERIC_LENGTH_MM,
        "corrected_length_mm": None,
        "c_curve_mm": GENERIC_C_CURVE_MM,
        "arc_radius_mm": GENERIC_ARC_RADIUS_MM,
        "shape": shape,
        "thickness_mm": 0.6,
        "cuticle_depth_mm": 2.7,
        "cuticle_curve_mm": 0.0,
        "cuticle_round_mm": 2.35,
        # nail_exact_stl.py의 CLI(main())가 쓰는 것과 동일한 쉐입별 기본값을
        # 그대로 재사용한다 - dict.get()에 None을 넘기면 기본값 폴백이 아니라
        # float(None)에서 바로 죽으므로, 여기서 직접 해석해서 실수값으로 넣는다.
        "tip_extension_mm": TIP_EXTENSION_DEFAULT_MM.get(shape, 3.0),
        "edge_round_mm": EDGE_ROUND_DEFAULT_MM.get(shape, 0.0),
        "corner_round_mm": CORNER_ROUND_DEFAULT_MM.get(shape, 0.0),
        "shoulder_round_mm": SHOULDER_ROUND_DEFAULT_MM.get(shape, 0.0),
        "taper_mm": 1.0 if shape == "square" else 0.0,
        "exact": False,
    }


def _planar_uv(vertices: np.ndarray) -> np.ndarray:
    """
    바운딩박스 기준 평면 투영 UV. nail_exact_stl.py의 좌표계는 X=폭, Y=길이,
    Z=두께(곡률 — 폭/길이보다 훨씬 얇은 dome 높이)이므로 X/Y를 그대로 U/V로
    쓰면 된다. 카메라에 실제로 보이는 윗면 기준으로는 정확하고, 아랫면/측벽은
    같은 투영을 근사로 재사용한다(착용 시 손가락에 가려 거의 안 보이는 부분).
    """
    mins = vertices.min(axis=0)
    maxs = vertices.max(axis=0)
    span = np.where(maxs - mins > 1e-6, maxs - mins, 1.0)
    u = (vertices[:, 0] - mins[0]) / span[0]
    v = (vertices[:, 1] - mins[1]) / span[1]
    return np.stack([u, v], axis=1)


def export_shape(shape: str, output_dir: str) -> str:
    tmp_stl_path = os.path.join(output_dir, f"_tmp_{shape}.stl")
    params = _build_params(shape)
    generate_stl(params, tmp_stl_path)

    # nail_exact_stl.py가 쓰는 STL은 "triangle soup"(정점 인덱스 공유 없음)이라
    # trimesh로 welding해서 정상적인 인덱스 메시로 재구성한다.
    mesh = trimesh.load(tmp_stl_path, force="mesh", process=False)
    mesh.merge_vertices()

    uv = _planar_uv(mesh.vertices)
    mesh.visual = trimesh.visual.TextureVisuals(uv=uv)

    glb_path = os.path.join(output_dir, f"{shape}.glb")
    mesh.export(glb_path)
    os.remove(tmp_stl_path)

    print(f"  [GLB] {shape:<10} -> {glb_path}  ({len(mesh.vertices)} verts, {len(mesh.faces)} faces)")
    return glb_path


def main():
    parser = argparse.ArgumentParser(description="쉐입별 네일팁 3D 템플릿(GLB) 1회성 생성")
    parser.add_argument(
        "--output",
        default="nail_tip_templates",
        help="GLB 출력 디렉터리 (예: ../Frontend/public/models/nail-tips)",
    )
    args = parser.parse_args()

    os.makedirs(args.output, exist_ok=True)

    print(f"\n{'=' * 55}")
    print("  네일팁 쉐입 템플릿 GLB 생성")
    print(f"{'=' * 55}")

    for shape in SHAPES:
        export_shape(shape, args.output)

    print(f"\n완료: {len(SHAPES)}개 GLB -> {args.output}\n")


if __name__ == "__main__":
    main()
