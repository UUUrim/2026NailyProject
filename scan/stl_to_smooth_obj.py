"""STL -> OBJ 변환: 정점을 공유(용접)하고 스무스 노멀(vn)을 넣어 뷰어에서 곡면이 매끈하게 보이게 한다.

STL 은 면마다 법선 하나만 담을 수 있어 뷰어가 면 단위(flat)로 음영을 계산한다.  OBJ 는 정점 법선을
담을 수 있으므로, 이웃 면과의 각이 --crease 도 이하인 곳만 평균 법선을 쓰고 그보다 날카로운 모서리
(바깥면과 옆벽의 경계 등)는 그대로 각을 유지한다.  형상(정점 위치)은 STL 과 같다.

사용: python stl_to_smooth_obj.py nail.stl nail_smooth.obj [--crease 35]
"""
import argparse
import numpy as np


def load_stl(path):
    b = open(path, "rb").read()
    n = int.from_bytes(b[80:84], "little")
    a = np.frombuffer(b[84:84 + n * 50],
                      dtype=np.dtype([("n", "<3f4"), ("v", "<9f4"), ("a", "<u2")]))
    return a["v"].reshape(-1, 3, 3).astype(np.float64)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stl")
    ap.add_argument("obj")
    ap.add_argument("--crease", type=float, default=35.0,
                    help="이 각도(deg) 이하로 만나는 면끼리만 법선을 부드럽게 평균 (기본 35)")
    args = ap.parse_args()

    T = load_stl(args.stl)
    # 정점 용접: 같은 위치(0.1um 반올림)의 정점을 하나로
    keys = np.round(T.reshape(-1, 3), 4)
    uniq, inv = np.unique(keys, axis=0, return_inverse=True)
    F = inv.reshape(-1, 3)

    fn = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    area = np.linalg.norm(fn, axis=1)
    ok = area > 1e-12
    F, fn, area = F[ok], fn[ok], area[ok]
    fn = fn / area[:, None]

    # 정점별로 붙은 면 모으기
    inc = [[] for _ in range(len(uniq))]
    for fi, tri in enumerate(F):
        for v in tri:
            inc[v].append(fi)
    cos_c = np.cos(np.radians(args.crease))

    # 면의 모서리(corner)마다 법선: 같은 정점에 붙은 면 중 이 면과 crease 이내인 것의 면적 가중 평균
    corner = np.zeros((len(F), 3, 3))
    for fi, tri in enumerate(F):
        for c, v in enumerate(tri):
            nb = np.array(inc[v])
            sel = nb[(fn[nb] @ fn[fi]) >= cos_c]
            nv = (fn[sel] * area[sel][:, None]).sum(axis=0)
            ln = np.linalg.norm(nv)
            corner[fi, c] = nv / ln if ln > 0 else fn[fi]

    # 법선 중복 제거
    nkeys = np.round(corner.reshape(-1, 3), 4)
    nuniq, ninv = np.unique(nkeys, axis=0, return_inverse=True)
    NI = ninv.reshape(-1, 3)

    with open(args.obj, "w", encoding="utf-8") as f:
        f.write("# smooth-normal OBJ from %s (crease %.0f deg)\n" % (args.stl, args.crease))
        for v in uniq:
            f.write("v %.4f %.4f %.4f\n" % tuple(v))
        for nv in nuniq:
            f.write("vn %.4f %.4f %.4f\n" % tuple(nv))
        for tri, nn in zip(F, NI):
            f.write("f %d//%d %d//%d %d//%d\n" % (tri[0] + 1, nn[0] + 1, tri[1] + 1, nn[1] + 1,
                                                  tri[2] + 1, nn[2] + 1))
    print("vertices %d  normals %d  faces %d -> %s" % (len(uniq), len(nuniq), len(F), args.obj))


if __name__ == "__main__":
    main()
