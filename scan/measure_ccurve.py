"""
measure_ccurve.py
-----------------
End-on finger photo → accurate C-curve (sagitta) measurement.

Scale reference: known nail WIDTH (mm) from top-photo measurement.
No ArUco marker required.

Algorithm (v2 — adaptive, no hard-coded colour thresholds)
----------------------------------------------------------
1. Background colour from the image border (median b*).  The finger is the
   only warm-ish object, so its b* sits far above a blue/dark background.
   Threshold = centre of the largest empty gap in the b* histogram
   (Otsu fallback).  This survives any white-balance / colour cast.
2. Finger = most central large contour of that mask.
3. Nail vs finger pulp inside the finger: Otsu split on a*
   (nail plate + free edge are neutral/grey, pulp is redder).
4. FREE-EDGE BAND = nail pixels adjacent to the pulp (within ~1.6× the
   nail thickness).  This isolates the tip cross-section and rejects the
   nail-plate dome behind it and shadowed skin wrapping the pulp sides.
5. Robust circle fit (Kåsa, iterative outlier rejection) to the band's
   top boundary.  Hook tips = extreme-x band pixels lying on the fitted
   circle (annulus filter kills stray blobs like box-felt spikes).
6. Chord = Euclidean distance between hook tips (tilt-proof) ≡ the
   top-view width →  scale = W_mm / chord_px.
   Sagitta from the fit:  h = R − sqrt(R² − (chord/2)²)   — this includes
   the curled-down hook portions the per-column trace can miss.
   arc_R  = W_mm² / (8·h_mm) + h_mm / 2   (consistency form)
"""

import argparse, json, os, sys
import cv2
import numpy as np
from scipy.ndimage import median_filter

# Run as a subprocess on Windows, stdout's default encoding is the system
# codepage (cp949 on Korean Windows) regardless of what the parent captures
# with - a print() containing a character outside that codepage (e.g. an
# em-dash) raises UnicodeEncodeError and kills the process mid-measurement,
# silently turning a real reading into "no c-curve" for that finger. Force
# UTF-8 so a stray character degrades to a replacement glyph instead of a
# crash.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")


# De-rotating by the upper/lower centroid offset is OFF: on this rig the silhouette is not
# symmetric (light-leak slivers beside the fingertip, one-sided shoulders), so the centroid
# offset reads 8-12 degrees of 'roll' on fingers that sit square to the camera and the rotation
# then shears the nail arc into a slanted line. The C-curve is a perpendicular-to-chord quantity
# anyway, so a roll does not need undoing.
TILT_CORRECTION = False

# C-curve 높이 / 손톱 폭 의 허용 범위. "물리적으로 불가능한 값"만 거르려는 넓은 범위다: 스캔 211·212·217·218 의 측정은
# 0.15~0.44 에 있었고(212 엄지 0.159, 218 검지 0.146), 서 있는 손가락은 0.79 였다. 하한을 너무 올리면 정상 측정을 거부한다.
SCALE_MM_PER_PX_MAX = 0.024    # 이보다 큰 배율 = 호의 양끝이 잘려 현이 짧게 잡힌 사진 (정상 0.0127~0.022)
C_RATIO_MIN = 0.14
# 상한 0.46 은 반원(0.5)보다 낮아서 곡률이 큰 손톱의 일관된 측정값을 버렸다(승희 약지: 두 번 모두 4.36 / 4.29 로 거의 같았는데
# h/W 0.49·0.47 이라 평균 2.35 로 대체됐다). 호의 높이는 폭의 절반(반원)을 넘기 어렵고, 서 있는 손가락은 0.79 였으므로
# 반원보다 조금 위까지만 허용한다.
C_RATIO_MAX = 0.52

# 사이드 사진 검증(side_photo_check) 기준
SIDE_PHOTO_MAX_H_FRAC = 0.72   # 손가락 덩어리 높이 / 크롭 높이 (정상 최대 0.67, 서 있는 손가락 0.75; 크롭 아래를 0.31 로 바꾼 뒤 값)
SIDE_PHOTO_MIN_TOP    = 0.12   # 덩어리 위끝 / 크롭 높이 (정상 0.13~0.75, 서 있는 손가락 0.04)
# 아래 기준은 측정 영역 안에 손가락 끝이 들어와 있는지 본다. 손가락 없이 손/손목 살색만 잡힌 사진(233 엄지: 높이 0.15, 넓이 0.04)을
# 거른다. 손가락이 프레임 아래쪽에 놓인 세션(224/225, 245/246)의 정상 사진은 높이 0.25~0.38, 위끝 0.62~0.75, 넓이 0.10 이상이다.
# 처음에 높이 하한을 0.30 으로 두었더니 245/246 의 정상 사진이 거의 전부(손가락 끝이 온전히 보이는데도) 거부돼서 곡률이 탑뷰 밝기
# 추정으로 떨어졌다 - 손가락 위치는 세션마다 프레임 안에서 프레임 높이의 5% 정도 달라진다.
SIDE_PHOTO_MIN_H_FRAC = 0.20   # 덩어리 높이 / 크롭 높이 하한
SIDE_PHOTO_MAX_TOP    = 0.82   # 덩어리 위끝 / 크롭 높이 상한
SIDE_PHOTO_MIN_AREA   = 0.05   # 덩어리 넓이 / 크롭 넓이 하한 (정상 최소 0.06, 233 엄지 0.04)


def side_photo_check(img: np.ndarray, top=0.38, bottom=0.31, left=0.25, right=0.30):
    """사이드 사진에 C-curve 를 잴 만한 손가락 끝이 있는가. (ok, 이유) 를 돌려준다.

    손가락이 구멍에 안 들어와 있거나(스캔 217/211 소지: 구멍 너머로 머리카락만 보임) 세로로 서 있으면 측정 영역에서
    손가락 크기의 덩어리가 없거나 이상한 모양으로 잡힌다. 손가락이 측정 영역 아래로 잘렸거나 손만 잡힌 경우도 같이
    거른다. 촬영 직후 이걸 검사해서 다시 찍게 한다. 이유 문자열에는 측정한 값을 넣어 로그만 보고 원인을 알 수 있게 한다.
    """
    sm = cv2.resize(img, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA)
    H, W = sm.shape[:2]
    c = sm[int(H * top):H - int(H * bottom), int(W * left):W - int(W * right)]
    m = _finger_mask_color(c)
    if m is None:
        return False, "no finger found in the measurement area"
    bx, by, bw, bh = cv2.boundingRect((m > 0).astype(np.uint8))
    h = m.shape[0]
    if bh / h > SIDE_PHOTO_MAX_H_FRAC:
        return False, f"finger blob too tall ({bh / h:.2f} of the crop) - finger is upright/tilted"
    if by / h < SIDE_PHOTO_MIN_TOP:
        return False, f"finger blob reaches the top of the crop ({by / h:.2f})"
    if bh / h < SIDE_PHOTO_MIN_H_FRAC:
        return False, (f"finger blob too short ({bh / h:.2f} of the crop, need {SIDE_PHOTO_MIN_H_FRAC}) "
                       f"- no fingertip in the measurement area")
    if by / h > SIDE_PHOTO_MAX_TOP:
        return False, (f"finger blob starts too low ({by / h:.2f} of the crop, max {SIDE_PHOTO_MAX_TOP}) "
                       f"- fingertip is cut off at the bottom of the measurement area")
    area = float(np.count_nonzero(m)) / float(m.shape[0] * m.shape[1])
    if area < SIDE_PHOTO_MIN_AREA:
        return False, f"finger blob too small ({area:.2f} of the crop, need {SIDE_PHOTO_MIN_AREA})"
    return True, "ok"


# Otsu(손톱 vs 손가락 살) 임계값을 구하는 핵심 영역: 크롭 폭 기준, 정점 아래로 이 비율의 행까지 / 정점 좌우 이 비율까지.
OTSU_CORE_ROWS_FRAC = 0.40
OTSU_CORE_HALF_FRAC = 0.25


def _adaptive_bg_split(B: np.ndarray, border: np.ndarray):
    """Threshold separating background b* (border median) from the finger.

    Returns the b* value above which a pixel is 'not background'.
    Uses the centre of the largest empty histogram gap; Otsu fallback.
    """
    bg_b = float(np.median(B[border]))
    hi = float(B.max())
    if hi - bg_b < 4:
        raise RuntimeError("No b* contrast between border and image content.")
    edges = np.arange(np.floor(bg_b), np.ceil(hi) + 1, 1.0)
    hist, _ = np.histogram(B, bins=edges)
    # ignore tiny counts (noise) when hunting for the gap
    empty = hist <= max(5, B.size * 2e-6)
    best_len, best_start, run, start = 0, None, 0, 0
    for i, e in enumerate(empty):
        if e:
            if run == 0:
                start = i
            run += 1
            if run > best_len:
                best_len, best_start = run, start
        else:
            run = 0
    if best_len >= 3:
        thr = edges[best_start] + best_len / 2.0
        return thr, bg_b
    # fallback: Otsu on normalised b*
    b8 = np.clip((B - B.min()) / (np.ptp(B) + 1e-6) * 255, 0, 255).astype(np.uint8)
    t, _ = cv2.threshold(b8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return float(B.min() + t / 255.0 * np.ptp(B)), bg_b


def _finger_mask_color(img: np.ndarray, min_frac: float = 0.01, open_frac: float = 0.045):
    """Finger blob by colour: skin (and the nail, which is pale but still warm in
    b*) vs the grey/black box wall and mat.

    The side photo is a fixed rig - black wall with an arch hole, grey mat - so
    "warm and not dark" isolates the fingertip without any hand-tuned geometry.
    Replaces the table-edge column-variance localisation (which found no finger
    on most photos, and on the one it 'found' cropped to mostly wall) and the
    histogram-gap split (which found nothing on some fingers).

    Returns the binary mask (largest warm blob) or None when no plausible
    finger-sized blob exists, so the caller can fall back to the older paths.
    """
    H, W = img.shape[:2]
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2Lab).astype(np.float32)
    L, A, B = lab[:, :, 0], lab[:, :, 1] - 128, lab[:, :, 2] - 128
    m = (((B > 9) | (A > 12)) & (L > 70)).astype(np.uint8) * 255
    ks = max(7, int(0.011 * max(H, W)) | 1)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ks, ks))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, k)
    # The light-leak slivers/triangles behind the finger are warm too and stay glued to
    # the silhouette; they are much narrower than the fingertip, so a wide opening
    # removes them while leaving the round fingertip intact.
    kb = max(15, int(open_frac * max(H, W)) | 1)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kb, kb)))
    n, lbl, st, _ = cv2.connectedComponentsWithStats(m)
    if n <= 1:
        return None
    i = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
    area_frac = st[i, cv2.CC_STAT_AREA] / float(H * W)
    if not (min_frac <= area_frac <= 0.40):
        return None
    return ((lbl == i) * 255).astype(np.uint8)


def side_edge_blur_px(img: np.ndarray, top=0.38, bottom=0.31, left=0.25, right=0.30):
    """How soft the fingertip edge is in a side photo: the median 10%-90% rise distance (px, at the
    photo's own resolution) of the brightness step across the finger's upper silhouette, where it
    borders the dark box wall.

    An in-focus edge rises within a few pixels; a defocused fingertip (autofocus latching onto the
    wall behind the finger) takes 20-60 px, which is as large as the nail arc itself (20-40 px sag)
    and is what makes the nail outline unreadable. Used to give feedback while tuning the phone's
    focus. Returns None if no finger/edge could be measured."""
    H0, W0 = img.shape[:2]
    cr = img[int(top * H0):H0 - int(bottom * H0), int(left * W0):W0 - int(right * W0)]
    m = _finger_mask_color(cr)
    if m is None:
        return None
    g = cv2.GaussianBlur(cv2.cvtColor(cr, cv2.COLOR_BGR2GRAY).astype(np.float32), (0, 0), 1.0)
    xs = np.nonzero(m.any(axis=0))[0]
    x0, x1 = xs.min(), xs.max()
    widths = []
    for x in range(int(x0 + 0.3 * (x1 - x0)), int(x1 - 0.3 * (x1 - x0)), 5):
        col = np.nonzero(m[:, x])[0]
        if col.size == 0:
            continue
        t = int(col.min())
        seg = g[max(0, t - 60):t + 60, x]
        if seg.size < 100:
            continue
        lo, hi = np.percentile(seg[:30], 50), np.percentile(seg[-30:], 50)
        if hi - lo < 40:
            continue
        n = (seg - lo) / (hi - lo)
        i10, i90 = int(np.argmax(n > 0.1)), int(np.argmax(n > 0.9))
        if i90 > i10:
            widths.append(i90 - i10)
    return float(np.median(widths)) if len(widths) >= 5 else None


def find_finger_point(frame: np.ndarray, roi=(0.20, 0.35, 0.80, 0.65), nail_frac=0.35):
    """Where the fingertip/nail is in a side-camera frame, as (x, y) normalised to the frame.

    Used to tell the phone where to focus and meter (instead of making someone tap the phone while
    scanning). The rig is fixed so the finger always lands in the middle band of the frame; searching
    only that ROI keeps the box's coloured light strips and ceiling out of the way. The point returned is
    horizontally centred on the finger blob and `nail_frac` of the way down from its top, i.e. on the nail.
    Checked on 32 real side photos: found in all, within 0.026 (x) / 0.016 (y) of the nail (a nail is
    ~0.08 wide). Returns None if no finger-sized warm blob is in the ROI."""
    h, w = frame.shape[:2]
    x0, y0, x1, y1 = int(roi[0] * w), int(roi[1] * h), int(roi[2] * w), int(roi[3] * h)
    if x1 - x0 < 20 or y1 - y0 < 20:
        return None
    m = _finger_mask_color(frame[y0:y1, x0:x1], min_frac=0.005, open_frac=0.06)
    if m is None:
        return None
    ys, xs = np.nonzero(m)
    cx = x0 + (xs.min() + xs.max()) / 2.0
    cy = y0 + ys.min() + nail_frac * (ys.max() - ys.min())
    return float(cx / w), float(cy / h)


def finger_box_norm(frame: np.ndarray, roi=(0.20, 0.35, 0.80, 0.65), pad=0.01):
    """Bounding box (x0, y0, x1, y1), normalised to the frame, of the fingertip blob in the middle ROI.
    The focus sweep measures every frame inside this one fixed box (the finger does not move during
    the sweep), so a dark or very blurry frame can no longer fail to segment and drop out."""
    h, w = frame.shape[:2]
    x0, y0, x1, y1 = int(roi[0] * w), int(roi[1] * h), int(roi[2] * w), int(roi[3] * h)
    if x1 - x0 < 20 or y1 - y0 < 20:
        return None
    m = _finger_mask_color(frame[y0:y1, x0:x1], min_frac=0.005, open_frac=0.06)
    if m is None:
        return None
    ys, xs = np.nonzero(m)
    return (max(0.0, (x0 + xs.min()) / w - pad), max(0.0, (y0 + ys.min()) / h - pad),
            min(1.0, (x0 + xs.max()) / w + pad), min(1.0, (y0 + ys.max()) / h + pad))


def focus_score(frame: np.ndarray, box=None, roi=(0.20, 0.35, 0.80, 0.65)):
    """Sharpness of the fingertip in a (raw, any-resolution) side frame - higher is sharper.

    Mean squared Sobel gradient divided by the brightness variance inside the box (a contrast-
    normalised Tenengrad), so a frame that is simply darker or brighter - auto-exposure moves between
    focus steps - does not look blurrier or sharper. Only meant for comparing frames of the same
    scene taken at different focus settings. `box` is a normalised (x0, y0, x1, y1) from
    finger_box_norm(); without it the finger is segmented in every frame (None if not found)."""
    h, w = frame.shape[:2]
    if box is None:
        box = finger_box_norm(frame, roi)
        if box is None:
            return None
    x0, y0, x1, y1 = int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)
    if x1 - x0 < 10 or y1 - y0 < 10:
        return None
    g = cv2.cvtColor(frame[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY).astype(np.float32)
    gx, gy = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    var = float(g.var())
    if var < 1.0:
        return None
    return float(np.mean(gx * gx + gy * gy) / var)


def _find_table_edge(img: np.ndarray, margin_frac: float = 0.15):
    """Locate the row where a uniform dark mat/desk-edge begins at the
    bottom of the frame (end-on photo taken with the finger draped over a
    table edge, arm resting on the desk behind it).

    Scans upward from the bottom using the row-median L* (over the central
    columns, avoiding stray objects near the left/right edges) and finds
    where it first departs from the flat mat reference — that's the edge.
    Returns None if no such flat-bottom region is found (e.g. the older
    isolated-background photo style, where this step should be skipped).
    """
    H, W = img.shape[:2]
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2Lab)
    L = lab[:, :, 0].astype(np.float32)
    x0, x1 = int(W * margin_frac), int(W * (1 - margin_frac))
    row_med = np.median(L[:, x0:x1], axis=1)
    ref = row_med[-max(20, int(0.03 * H)):]
    mat_ref, mat_std = float(np.median(ref)), float(np.std(ref))
    if mat_std > 15:
        return None          # bottom strip isn't a flat mat — nothing to find
    thr = max(3.0 * mat_std, 10.0)
    edge_row = 0
    for y in range(H - 1, -1, -1):
        if abs(row_med[y] - mat_ref) > thr:
            edge_row = y + 1
            break
    return edge_row


def _locate_finger_by_edge_variance(img: np.ndarray, edge_row: int,
                                    band_h: int = 350, x_margin: int = 60,
                                    below_margin: int = 30):
    """Find the finger's tight bounding crop, anchored on the table edge.

    Replaces the old approach of hunting for "warm" (high a*) pixels across
    the whole frame to guess where the finger is - that heuristic falls
    apart under this rig's lighting, because near-black regions have almost
    random a*/b* (JPEG compression noise), so "warm" pixels turn out to be
    scattered across the entire row rather than sitting where the finger
    actually is (confirmed on real rig photos - a "warm" anchor pick landed
    on plain background texture, nowhere near the finger).

    The backdrop above the table isn't tonally uniform across the frame
    either (a lit wall on one side can be brighter than the finger itself),
    so no single global L*/a*/b* threshold reliably separates "finger" from
    "background" everywhere. But within one column, the backdrop right
    above the table is close to flat top-to-bottom wherever the finger
    ISN'T, while a column that crosses the finger silhouette has a sharp
    brightness transition (wall -> finger surface) partway down - i.e. its
    local variance is much higher. Column-by-column L* variance over a band
    above the (reliably-detected) table edge therefore picks out the
    finger's x-range regardless of how the backdrop's overall brightness
    varies across the frame - verified against hand-marked ground-truth
    nail corners on a real rig photo.

    Returns (crop, x0, y0) - crop is the sub-image and (x0, y0) its offset
    in the original image - or None if no finger-width variance spike is
    found (e.g. nothing in frame, or a reflection/seam elsewhere in the
    shot out-variances the finger - known to still happen under severe
    backlight).
    """
    H, W = img.shape[:2]
    y0 = max(0, edge_row - band_h)
    lab_band = cv2.cvtColor(img[y0:edge_row, :], cv2.COLOR_BGR2Lab)
    col_std = lab_band[:, :, 0].astype(np.float32).std(axis=0)
    bg_floor = float(np.median(col_std))
    thr = max(bg_floor * 2.0, bg_floor + 15.0)
    hot = col_std > thr

    # Largest contiguous run of "finger" columns - rejects narrow noise
    # spikes elsewhere in the row (other fingers/objects caught in frame).
    runs, start = [], None
    for i, v in enumerate(hot):
        if v and start is None:
            start = i
        elif not v and start is not None:
            runs.append((start, i))
            start = None
    if start is not None:
        runs.append((start, len(hot)))
    if not runs:
        return None
    fx0, fx1 = max(runs, key=lambda r: r[1] - r[0])
    if fx1 - fx0 < 20:
        return None

    cx0, cx1 = max(0, fx0 - x_margin), min(W, fx1 + x_margin)
    cy0, cy1 = y0, min(H, edge_row + below_margin)
    return img[cy0:cy1, cx0:cx1], cx0, cy0


def _fit_parabola_robust(xs: np.ndarray, ys: np.ndarray, iters: int = 8):
    """Robust quadratic fit y = A*x^2 + B*x + C, iterative outlier rejection.

    Replaces an earlier algebraic (Kasa) circle fit. A real nail's C-curve
    is always a SHALLOW arc (chord >> sagitta), and a shallow arc is exactly
    what a parabola models directly and stably - whereas the Kasa circle fit
    is well known to be ill-conditioned in this regime: a small amount of
    noise (nail-surface texture, JPEG blocking, a wrinkle/ridge line) is
    enough to flip the fitted centre to the wrong side of the data entirely.
    Confirmed on real end-on photos from the old 1920x1080 box rig: all 5
    fingers of one session fit with the circle's centre on the WRONG side of
    the traced band (2026-09-05) - re-tracing the same boundary from
    higher-resolution photos on the rebuilt rig showed the true trace is a
    clean, low-noise dome shape the whole time; the circle fit's instability
    was amplifying photo noise into a wrong-direction answer even when the
    underlying signal was fine.

    A plain quadratic regression has no such failure mode: a bad fit shows
    up as a small or negative leading coefficient (a mostly-flat or
    wrong-direction curve), never as a wildly relocated vertex - so the
    validity check (see geom_valid below) is just the coefficient's sign
    rather than a derived geometric comparison.

    Returns (A, B, C, x0, y0, inlier_mask) - (A,B,C) are the polynomial
    coefficients, (x0,y0) the vertex in the same pixel coordinates.
    """
    keep = np.ones(len(xs), bool)
    coef = np.polyfit(xs, ys, 2)
    for _ in range(iters):
        coef = np.polyfit(xs[keep], ys[keep], 2)
        res = np.abs(ys - np.polyval(coef, xs))
        s = max(np.median(res[keep]) * 2.5, 1.5)
        new_keep = res < s
        if new_keep.sum() < 8 or (new_keep == keep).all():
            break
        keep = new_keep
    A, B, C = coef
    if abs(A) > 1e-9:
        x0 = -B / (2 * A)
        y0 = C - B ** 2 / (4 * A)
    else:
        x0 = float(np.mean(xs[keep]))
        y0 = float(np.mean(ys[keep]))
    return A, B, C, x0, y0, keep


SAGITTA_SMOOTH_FRAC = 0.06     # 윗경계 중앙값 필터 폭 / 현 길이
NEIGHBOR_RISE_FRAC = 0.12       # 골짜기 뒤 윗경계가 이만큼(밴드 폭 대비) 다시 솟으면 옆 손가락으로 보고 자른다


def _direct_sagitta_px(xs: np.ndarray, ys: np.ndarray,
                       x_L: float, y_L: float, x_R: float, y_R: float, chord_px: float):
    """윗경계에서 호의 높이(sagitta)를 직접 잰다: 현(양끝 점을 이은 선)에서 윗경계 꼭대기까지의 수직 거리(px).

    예전에는 윗경계에 포물선을 맞추고 sagitta = A * (현/2)^2 로 외삽했는데, 계수 A 가 밴드 모양의 작은 차이(울퉁불퉁한
    경계, 한쪽으로 치우친 꼭대기, 어느 열이 이상치로 빠졌는지)에 크게 흔들려서 같은 손가락을 두 번 찍으면 곡률이 25~70% 달랐다
    (도경 중지 A 9.3 vs 15.3, 242/243). 직접 거리는 같은 정의(꼭대기-현 높이)를 모델 없이 읽어서 같은 데이터에서 재촬영 차이가
    평균 23% → 11% 로 줄었고, 값의 평균 수준은 기존과 거의 같다(승희 약지 4.19/4.14 vs 4.36/4.29). 중앙값 필터는 열 하나의
    튐을 지운다. 못 구하면 None (호출한 쪽이 포물선 값을 쓴다).
    """
    if abs(x_R - x_L) < 5 or len(xs) < 10:
        return None
    o = np.argsort(xs)
    x, y = np.asarray(xs, float)[o], np.asarray(ys, float)[o]
    k = max(3, int(SAGITTA_SMOOTH_FRAC * chord_px) | 1)
    ysm = median_filter(y, size=k, mode="nearest")
    m = (y_R - y_L) / (x_R - x_L)
    yline = y_L + m * (x - x_L)
    d = (yline - ysm) / np.sqrt(1.0 + m * m)           # 현 위로 솟은 높이 (위 = y 작음)
    inside = (x >= min(x_L, x_R)) & (x <= max(x_L, x_R))
    if inside.sum() < 10:
        return None
    return float(d[inside].max())


def _neighbor_trim_range(xs: np.ndarray, ys: np.ndarray):
    """윗경계가 옆 손가락 밴드까지 이어졌으면, 주 호의 끝(골짜기)까지만 남기도록 (x_lo, x_hi) 를 돌려준다.

    밴드 열은 옆 손가락과 끊김 없이 이어져서(틈 검출은 안 됨) 현의 끝점이 옆 손가락 손톱에 걸렸다(247 검지: 밴드 817px
    인데 같은 손가락의 정상 촬영은 702px, 현이 길어져 곡률·스케일이 모두 틀어졌다). 주 호는 꼭대기에서 양옆으로 내려가다가
    끝나고, 옆 손가락은 그 뒤에서 다시 솟는다. 꼭대기에서 한쪽으로 가며 가장 낮은 지점(골짜기) 뒤로 윗경계가 밴드 폭의
    NEIGHBOR_RISE_FRAC 이상 다시 올라가면 그 골짜기에서 자른다. 정상 사진 30장 중 오른쪽은 247 검지(157px, 폭의 19%)만
    걸리고 나머지는 모두 0, 왼쪽도 정상 최대 7%(손톱 끝이 말려 내려간 뒤 다시 올라오는 정도)였다.
    """
    o = np.argsort(xs)
    x, y = np.asarray(xs, float)[o], np.asarray(ys, float)[o]
    if len(x) < 40:
        return float(x.min()), float(x.max())
    ysm = median_filter(y, size=max(5, int(0.03 * len(x)) | 1), mode="nearest")
    ia = int(np.argmin(ysm))
    span = float(x.max() - x.min())
    lo, hi = float(x.min()), float(x.max())
    for side in ("R", "L"):
        seg = ysm[ia:] if side == "R" else ysm[:ia + 1][::-1]
        xseg = x[ia:] if side == "R" else x[:ia + 1][::-1]
        if len(seg) < 20:
            continue
        v = int(np.argmax(seg))
        if float(seg[v] - seg[v:].min()) > NEIGHBOR_RISE_FRAC * span:
            if side == "R":
                hi = float(xseg[v])
            else:
                lo = float(xseg[v])
    return lo, hi


EDGE_PCHORD = 46.0          # 정답 라벨의 현 길이 중앙값(px/mm). 맞출 포물선의 구간 길이 = 탑뷰 폭 x 이 값
EDGE_SPAN = 0.9


def _edge_gradient_map(img: np.ndarray) -> np.ndarray:
    """손톱 끝 선(연한 손톱 -> 붉은 살)에서 크게 나오는 신호: a* 와 채도의 '위에서 아래로 증가' 기울기."""
    b = cv2.GaussianBlur(img, (0, 0), 3.0)
    lab = cv2.cvtColor(b, cv2.COLOR_BGR2Lab).astype(np.float32)
    hsv = cv2.cvtColor(b, cv2.COLOR_BGR2HSV).astype(np.float32)

    def gy(a):
        g = np.zeros_like(a)
        g[1:-1] = (a[2:] - a[:-2]) / 2.0
        return np.clip(g, 0, None)
    ga, gs = gy(lab[:, :, 1]), gy(hsv[:, :, 1])
    return ga / (np.percentile(ga, 99) + 1e-6) + gs / (np.percentile(gs, 99) + 1e-6)


def edge_parabola_ratio(img: np.ndarray, fmask: np.ndarray, width_mm: float):
    """손톱 끝 선을 따라가는 포물선을 찾아 호 높이/현 비율을 돌려준다. (ratio, score) 또는 None.

    사람이 사진에서 손톱 호로 찍은 정답 73개를 보니(scan/ccurve_labels.json) 그 호는 a*/채도가 위에서 아래로 가장 급하게 오르는
    선을 따라가고, 기존 밴드 윗선은 손가락 끝의 둥근 윗선이라 정답과 거의 무관했다(상관 0.23). 손가락 한 개만 보면 이 값도
    흔들리지만(정답 상관 0.55) 한 손 손가락들을 평균하면 사람 간 평평함 차이를 잡는다(세션 평균 상관 0.76,
    final_measurements.hand_curve_factor 에서 쓴다). 포물선 y = y0 + A x^2 + B x 의 위치와 곡률을 이 신호의 평균이 가장 큰
    쪽으로 찾고, 비율 = A * 현 / 4 (현 = 폭 x EDGE_PCHORD px/mm) 로 돌려준다.
    """
    fm = fmask > 0
    if width_mm is None or width_mm <= 0 or not fm.any():
        return None
    G = _edge_gradient_map(img)
    H, W = G.shape
    cols = np.where(fm.any(axis=0))[0]
    x0f, x1f = int(cols.min()), int(cols.max())
    fw = x1f - x0f
    if fw < 50:
        return None
    top = np.array([np.argmax(fm[:, x]) if fm[:, x].any() else 0 for x in range(W)])
    c = width_mm * EDGE_PCHORD
    half = EDGE_SPAN * c / 2
    xs_off = np.linspace(-half, half, 41)
    best_sc, best_A = -1.0, None
    for xa in np.linspace(x0f + 0.25 * fw, x1f - 0.25 * fw, 24):
        xs = xa + xs_off
        xi = np.clip(xs.astype(int), 0, W - 1)
        tp = top[xi]
        for dy in np.linspace(0.04 * fw, 0.30 * fw, 27):
            y0 = top[int(xa)] + dy
            for A in np.linspace(2e-4, 5e-3, 24):
                for B in (-0.25, -0.12, 0.0, 0.12, 0.25):
                    yi = (y0 + A * xs_off ** 2 + B * xs_off).astype(int)
                    ok = (yi >= 0) & (yi < H) & (yi > tp + int(0.03 * fw))
                    if ok.sum() < 30:
                        continue
                    sc = float(G[yi[ok], xi[ok]].mean() * ok.mean())
                    if sc > best_sc:
                        best_sc, best_A = sc, A
    if best_A is None:
        return None
    return best_A * c / 4.0, best_sc


def _compute_tilt_angle(mask: np.ndarray) -> float:
    """Angle (degrees) the finger is rolled from upright in this end-on
    crop; positive = tilted right, negative = left.

    Different people rest the fingertip in the rig at a slight roll, which
    rotates the whole nail/pulp cross-section in the frame. Everything
    downstream (the per-column top-boundary trace, and picking hook tips as
    the extreme-x band pixels) implicitly assumes the nail's width axis is
    horizontal - tilted, it silently grabs the wrong "leftmost/rightmost"
    point instead of the true corners, shrinking and skewing the chord (and
    therefore the mm/px scale and everything derived from it).

    Compares the centroid of the mask's upper half (toward the nail) to its
    lower half (toward the table) - the same two-slice technique
    _legacy_hand_measurer.py's _compute_finger_angle uses to de-rotate the
    equivalent top-view tilt, adapted to this view's "up" direction.
    """
    ys, xs = np.where(mask > 0)
    if len(xs) < 100:
        return 0.0
    y_min, y_max = int(ys.min()), int(ys.max())
    if y_max - y_min < 20:
        return 0.0
    y_mid = (y_min + y_max) // 2
    upper, lower = ys <= y_mid, ys > y_mid
    if upper.sum() < 30 or lower.sum() < 30:
        return 0.0
    cx_u, cy_u = float(np.mean(xs[upper])), float(np.mean(ys[upper]))
    cx_l, cy_l = float(np.mean(xs[lower])), float(np.mean(ys[lower]))
    dx, dy = cx_u - cx_l, cy_u - cy_l   # dy negative: upper sits above lower
    return float(np.degrees(np.arctan2(dx, -dy)))


def _rotate_image(img: np.ndarray, angle_deg: float) -> np.ndarray:
    """Rotate *img* by *angle_deg* around its centre, expanding the canvas
    so nothing gets clipped. Nearest-neighbour for single-channel masks (so
    edges stay binary), linear for BGR images.
    """
    h, w = img.shape[:2]
    cx, cy = w / 2.0, h / 2.0
    M = cv2.getRotationMatrix2D((cx, cy), angle_deg, 1.0)
    cos_a, sin_a = abs(M[0, 0]), abs(M[0, 1])
    new_w = int(h * sin_a + w * cos_a)
    new_h = int(h * cos_a + w * sin_a)
    M[0, 2] += (new_w - w) / 2
    M[1, 2] += (new_h - h) / 2
    flags = cv2.INTER_NEAREST if img.ndim == 2 else cv2.INTER_LINEAR
    return cv2.warpAffine(img, M, (new_w, new_h), flags=flags)


def measure_ccurve(image_path: str, width_mm: float,
                   debug_out: str = None,
                   thickness_mm: float = 0.85,
                   table_edge: bool = False,
                   edge_margin_px: int = 350,
                   top_crop_frac: float = 0.0,
                   bottom_crop_frac: float = 0.0,
                   left_crop_frac: float = 0.0,
                   right_crop_frac: float = 0.0,
                   gates: bool = True,
                   edge_out: dict = None) -> dict:
    """gates=False 는 실험용: 값이 비정상이어도 예외 대신 결과를 돌려주고 결과의 "gate_reason" 에 이유를 넣는다.

    edge_out 에 dict 를 주면 손가락 마스크가 정해진 직후 edge_parabola_ratio 를 계산해 edge_out["edge_ratio"] 에 넣는다 - 곡률
    측정이 거부돼(예외) 값이 안 나와도 이 값은 남는다.
    """

    img = cv2.imread(image_path)
    if img is None:
        raise FileNotFoundError(f"Cannot open: {image_path}")

    # ── 0. Fixed-rig crop ──────────────────────────────────────
    # Box-style rigs shoot the end-on photo through a hole in a far wall,
    # with the camera framing enough of the box to also catch its ceiling
    # (bright strip light + blue alignment LEDs), a long stretch of the
    # near-camera mat, an ID/ArUco tag glued to the mat, and a foil seam
    # strip on the box wall. None of that is background in the "isolated
    # finger on a dark backdrop" sense the mask/split logic below assumes:
    # the ceiling is brighter and more textured than the finger itself, the
    # tag and foil seam are themselves warm/high-contrast blobs, and the mat
    # can end up merged into the same contour as the finger — confirmed on
    # real rig photos where the "finger" contour it picked actually traced
    # the ceiling light housing or the ID tag instead of the fingertip.
    #
    # The rig is fixed-mounted (camera and hole never move), so the
    # fingertip lands in almost the same place on every capture — measured
    # across 20 real captures (4 sessions x 5 fingers) at x=0.37-0.54,
    # y=0.48-0.53 of the frame. Cropping to a fixed box around that region
    # (with generous margin) removes all of the confusing content outright,
    # rather than trying to out-threshold it in a full, cluttered frame.
    if top_crop_frac > 0 or bottom_crop_frac > 0 or left_crop_frac > 0 or right_crop_frac > 0:
        H0, W0 = img.shape[:2]
        y0 = int(H0 * top_crop_frac)
        y1 = H0 - int(H0 * bottom_crop_frac)
        x0 = int(W0 * left_crop_frac)
        x1 = W0 - int(W0 * right_crop_frac)
        if y1 - y0 < 50 or x1 - x0 < 50:
            raise RuntimeError(
                f"crop fractions leave almost nothing "
                f"({x1-x0}x{y1-y0}px) — top={top_crop_frac} "
                f"bottom={bottom_crop_frac} left={left_crop_frac} "
                f"right={right_crop_frac}; check the fractions.")
        img = img[y0:y1, x0:x1]
        print(f"  [Crop] top={top_crop_frac:.2f} bottom={bottom_crop_frac:.2f} "
              f"left={left_crop_frac:.2f} right={right_crop_frac:.2f} "
              f"→ {img.shape[1]}×{img.shape[0]} "
              f"(rows {y0}:{y1}, cols {x0}:{x1} of {W0}x{H0})")

    located = False
    color_mask = _finger_mask_color(img)
    if color_mask is not None:
        print("  [Finger] colour mask (warm, non-dark blob) - skipping table-edge search")
    if table_edge and color_mask is None:
        edge_row = _find_table_edge(img)
        if edge_row is None:
            print("  [Edge] no flat table-edge mat found at the bottom — "
                  "falling back to whole-frame background split.")
        else:
            print(f"  [Edge] table edge at row {edge_row}")
            found = _locate_finger_by_edge_variance(
                img, edge_row, band_h=edge_margin_px)
            if found is None:
                print("  [Edge] no finger-width variance spike found above "
                      "the edge — falling back to whole-frame background split.")
            else:
                img, crop_x0, crop_y0 = found
                located = True
                print(f"  [Edge] finger localised → crop "
                      f"{img.shape[1]}×{img.shape[0]} at offset "
                      f"({crop_x0},{crop_y0})")

    H, W_img = img.shape[:2]
    scale_factor = max(H, W_img) / 2000.0          # for adaptive kernel sizes
    print(f"  [Image] {W_img}×{H}  scale_factor={scale_factor:.2f}")

    lab = cv2.cvtColor(img, cv2.COLOR_BGR2Lab)
    A = lab[:, :, 1].astype(np.float32) - 128
    B = lab[:, :, 2].astype(np.float32) - 128

    ks = max(5, int(9 * scale_factor) | 1)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ks, ks))

    if color_mask is not None:
        mask = color_mask
    elif located:
        # Already a tight, finger-only crop (see
        # _locate_finger_by_edge_variance's docstring for why) - a plain
        # Otsu split on L* cleanly separates the finger from the table/
        # backdrop here, without the whole-frame colour-histogram machinery
        # below (which is what breaks under this rig's uneven lighting).
        L8 = lab[:, :, 0].astype(np.uint8)
        _, mask = cv2.threshold(L8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    else:
        # ── 1. Background split on b* (adaptive) ─────────────────
        bw = max(20, int(0.02 * max(H, W_img)))
        border = np.zeros((H, W_img), bool)
        border[:bw, :] = border[-bw:, :] = True
        border[:, :bw] = border[:, -bw:] = True
        thr_b, bg_b = _adaptive_bg_split(B, border)
        print(f"  [BG] border b*={bg_b:.1f}  →  finger threshold b*>{thr_b:.1f}")
        mask = (B > thr_b).astype(np.uint8) * 255

    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=3)

    # ── 2. Finger = most central large contour ───────────────
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    min_area = max(1500, H * W_img * 1e-4)
    big = [c for c in cnts if cv2.contourArea(c) > min_area]
    if not big:
        raise RuntimeError("No finger-sized warm region found — "
                           "check that the fingertip is in frame.")

    if located or color_mask is not None:
        # Crop is already tight around just the finger (or the colour mask
        # already picked the one warm blob) - take the largest blob, no need
        # to guess which one is "the" finger among several.
        finger_cnt = max(big, key=cv2.contourArea)
    elif table_edge:
        # Whole-frame fallback: the target nail is whichever warm blob
        # hangs deepest into the mat below the table edge — other fingers/
        # knuckles caught in the crop stay above it, even if more "central".
        finger_cnt = max(big, key=lambda c: cv2.boundingRect(c)[1] + cv2.boundingRect(c)[3])
    else:
        def centrality(c):
            x, y, w, h = cv2.boundingRect(c)
            return np.hypot(x + w / 2 - W_img / 2, y + h / 2 - H / 2)
        finger_cnt = min(big, key=centrality)
    fmask = np.zeros((H, W_img), np.uint8)
    cv2.drawContours(fmask, [finger_cnt], -1, 255, -1)
    fx, fy, fw, fh = cv2.boundingRect(finger_cnt)
    print(f"  [Finger] bbox x={fx} y={fy} w={fw} h={fh}")

    # ── 2b. De-rotate: correct for the finger being rolled left/right ────
    # See _compute_tilt_angle's docstring for why this matters. Straighten
    # the crop now, before any of the angle-sensitive steps below, so
    # everything downstream (nail/pulp split, band, per-column trace,
    # circle fit, hook-tip pick) just runs on an already-corrected frame
    # without needing to know tilt ever happened.
    tilt_deg = _compute_tilt_angle(fmask)
    if TILT_CORRECTION and abs(tilt_deg) > 1.5:
        print(f"  [Tilt] finger rolled {tilt_deg:+.1f}°  →  de-rotating crop")
        img = _rotate_image(img, tilt_deg)
        fmask = _rotate_image(fmask, tilt_deg)
        H, W_img = img.shape[:2]
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2Lab)
        A = lab[:, :, 1].astype(np.float32) - 128
        B = lab[:, :, 2].astype(np.float32) - 128
        fx, fy, fw, fh = cv2.boundingRect(fmask)
        print(f"  [Tilt] new bbox x={fx} y={fy} w={fw} h={fh}")

    if edge_out is not None:
        try:
            _er = edge_parabola_ratio(img, fmask, width_mm)
            if _er is not None:
                edge_out["edge_ratio"], edge_out["edge_score"] = _er
        except Exception as _e:
            print(f"  [Edge] 손톱 끝 선 맞춤 실패: {_e}")

    # ── 3. Nail vs pulp: Otsu on a* inside the finger ────────
    # 임계값은 손가락 마스크 전체가 아니라 정점 주변 핵심 영역(위쪽 OTSU_CORE_ROWS_FRAC, 가운데 좌우
    # OTSU_CORE_HALF_FRAC)에서만 구한다. 구멍 뒤의 팔·손 피부가 마스크에 붙어 있으면 그만큼 a* 분포가 바뀌어
    # 같은 손가락 사진인데도 임계값이 달라지고(스캔 211/212 엄지: h 2.37 vs 4.11mm), 손톱 띠가 다르게 잡혔다.
    # 임계값은 핵심 영역에서 구하되, 적용은 예전처럼 마스크 전체에 한다.
    _top_rows = max(3, int(0.03 * fh))
    _xs_top = np.nonzero(fmask[fy:fy + _top_rows])[1]
    _cx = float(np.median(_xs_top)) if len(_xs_top) else fx + fw / 2.0
    core = np.zeros(fmask.shape, bool)
    core[fy:int(fy + OTSU_CORE_ROWS_FRAC * W_img),
         max(0, int(_cx - OTSU_CORE_HALF_FRAC * W_img)):int(_cx + OTSU_CORE_HALF_FRAC * W_img)] = True
    core &= (fmask > 0)
    if int(core.sum()) < 500:        # 핵심 영역이 너무 작으면 예전처럼 마스크 전체
        core = fmask > 0
    vals = A[core]
    a8 = np.clip((A - vals.min()) / (np.ptp(vals) + 1e-6) * 255,
                 0, 255).astype(np.uint8)
    t, _ = cv2.threshold(a8[core], 0, 255,
                         cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    thr_a = vals.min() + t / 255.0 * np.ptp(vals)
    print(f"  [Nail/pulp] a* Otsu split at {thr_a:.1f}")

    kn = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (max(3, ks // 2), max(3, ks // 2)))
    nail_bin = ((A < thr_a) & (fmask > 0)).astype(np.uint8) * 255
    pulp_bin = ((A >= thr_a) & (fmask > 0)).astype(np.uint8) * 255
    for m in (nail_bin, pulp_bin):
        tmp = cv2.morphologyEx(m, cv2.MORPH_OPEN, kn)
        m[:] = cv2.morphologyEx(tmp, cv2.MORPH_CLOSE, kn, iterations=2)

    pcnts, _ = cv2.findContours(pulp_bin, cv2.RETR_EXTERNAL,
                                cv2.CHAIN_APPROX_NONE)
    if not pcnts:
        raise RuntimeError("Could not find the finger pulp below the nail.")
    pulp_cnt = max(pcnts, key=cv2.contourArea)
    pulp_mask = np.zeros((H, W_img), np.uint8)
    cv2.drawContours(pulp_mask, [pulp_cnt], -1, 255, -1)

    # ── 4. Free-edge band: nail pixels hugging the pulp ──────
    ncols = np.where(nail_bin.any(axis=0))[0]
    if len(ncols) < 10:
        raise RuntimeError("Nail region too small.")
    rough_scale = width_mm / float(ncols[-1] - ncols[0])
    thick_px = thickness_mm / rough_scale
    rad = max(5, int(1.6 * thick_px)) | 1
    # Vertical-only reach, not a circular dilation: this is meant to grow
    # UP from the pulp into the nail's dome, one column at a time. An
    # isotropic (circular) kernel grows sideways just as readily, which
    # bleeds into the lateral nail-fold skin next to the pulp's own
    # left/right edges (that skin often shares the nail's neutral a* tone).
    # Verified against hand-marked ground-truth nail corners: switching to
    # a 3px-wide vertical kernel measurably tightened the corner pick
    # without changing anything else about how the band is built.
    kd = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, rad))
    band = cv2.bitwise_and(cv2.dilate(pulp_mask, kd), nail_bin)

    # Even with vertical-only dilation, pulp_mask's own left/right extent
    # can already reach past the true nail corner (the pulp genuinely is
    # redder there too - it's the lateral nail-fold skin, not a dilation
    # artifact). Cap the lateral reach to the pulp's own width plus one
    # nail-thickness of slack, since the nail can't be meaningfully wider
    # than the finger flesh directly under it. This does NOT fully close
    # the gap - see dev notes below - but bounds the worst case.
    pbx, pby, pbw, pbh = cv2.boundingRect(pulp_cnt)
    lat_pad = max(3, int(thick_px))
    band[:, :max(0, pbx - lat_pad)] = 0
    band[:, min(W_img, pbx + pbw + lat_pad):] = 0

    bcnts, _ = cv2.findContours(band, cv2.RETR_EXTERNAL,
                                cv2.CHAIN_APPROX_NONE)
    if not bcnts:
        raise RuntimeError("Could not isolate the free-edge band.")
    band_cnt = max(bcnts, key=cv2.contourArea)
    band_mask = np.zeros((H, W_img), np.uint8)
    cv2.drawContours(band_mask, [band_cnt], -1, 255, -1)
    print(f"  [Band] thickness~{thick_px:.0f}px  dilate r={rad}px  "
          f"bbox={cv2.boundingRect(band_cnt)}")

    # ── 5. Circle fit to band top boundary, hook-tip chord ───
    # KNOWN REMAINING LIMITATION (as of the ground-truth check below): on
    # at least one real rig photo with hand-marked true nail corners, the
    # hook tip on one side still landed ~20px past the true corner even
    # after the fixes above. Isolated the cause: at that column, the pulp/
    # nail boundary is a genuinely smooth, continuous curve - the fitted
    # circle's residual there was tiny (well inside the inlier band), so no
    # geometric test (tighter residual threshold, dilation shape) can tell
    # "true corner" from "lateral fold" from shape alone. The only signal
    # that looked promising was a local dip in L* (a shadowed groove) right
    # at the true corner - untested against more photos, so not wired in
    # yet. If this needs to improve further, that's the next thing to try,
    # with a few more hand-marked ground-truth photos to confirm the dip is
    # reliably there and not a one-photo coincidence.
    #
    # The dilated pulp mask rounds off at its own corners, and nail_bin can
    # pick up the shadowed lateral side of the finger there — together they
    # let the "topmost band pixel" trace climb up the SIDE of the finger
    # near the hook tips instead of stopping at the nail's true corner
    # (verified visually: the raw trace follows the finger's silhouette
    # edge, not the nail, right where the hook tips are picked). Bound how
    # far above the pulp's own local top boundary the trace may go, using
    # the band's typical (median) thickness — where pulp doesn't reach
    # (a few columns at the very edge), reuse the nearest pulp column.
    cols = np.where(band_mask.any(axis=0))[0]
    raw_top = np.array([np.argmax(band_mask[:, c] > 0) for c in cols], float)

    pcols = np.where(pulp_mask.any(axis=0))[0]
    ptop = np.array([np.argmax(pulp_mask[:, c] > 0) for c in pcols], float)
    nn = np.searchsorted(pcols, cols).clip(0, len(pcols) - 1)
    nn_lo = (nn - 1).clip(0, len(pcols) - 1)
    use_lo = np.abs(pcols[nn_lo] - cols) < np.abs(pcols[nn] - cols)
    pulp_top_for_col = np.where(use_lo, ptop[nn_lo], ptop[nn])

    thickness = pulp_top_for_col - raw_top
    ref_thick = float(np.median(thickness[thickness > 0])) \
        if (thickness > 0).any() else thick_px
    cap_top = pulp_top_for_col - 2.2 * ref_thick
    top_y = np.maximum(raw_top, cap_top)

    # Apply the same cap to the mask itself, so the hook-tip search below
    # (which scans band_mask directly, not just the per-column trace) can't
    # pick a point from the trimmed-off vertical tail either.
    cap_full = np.full(W_img, -1e9)
    cap_full[cols] = cap_top
    byy, bxx = np.nonzero(band_mask)
    keep_px = byy >= cap_full[bxx]
    band_mask = np.zeros_like(band_mask)
    band_mask[byy[keep_px], bxx[keep_px]] = 255

    # 옆 손가락 밴드가 이어져 붙었으면 주 호 끝(골짜기)에서 자른다 (_neighbor_trim_range 설명 참고)
    _lo, _hi = _neighbor_trim_range(cols.astype(float), top_y)
    if _lo > cols.min() or _hi < cols.max():
        print(f"  [Band] trimmed a neighbouring finger's band: columns {int(cols.min())}..{int(cols.max())} -> {int(_lo)}..{int(_hi)}")
        _sel = (cols >= _lo) & (cols <= _hi)
        cols, top_y = cols[_sel], top_y[_sel]
        band_mask[:, :int(_lo)] = 0
        band_mask[:, int(_hi) + 1:] = 0

    xs, ys = cols.astype(float), top_y
    A_fit, B_fit, C_fit, vx, vy, keep = _fit_parabola_robust(xs, ys)
    res_med = float(np.median(np.abs(
        ys[keep] - np.polyval((A_fit, B_fit, C_fit), xs[keep]))))
    print(f"  [Parabola fit] vertex=({vx:.0f},{vy:.1f})  A={A_fit:.6f}  "
          f"inliers={keep.sum()}/{len(xs)}  med.res={res_med:.1f}px")

    # ── Geometry sanity check: curvature must open the physically correct way ──
    # A real nail cross-section is a shallow, convex-up arc: highest (closest
    # to camera, furthest from the pulp) at the width centre, curving down
    # toward the pulp at the lateral edges - i.e. the vertex is a MINIMUM,
    # which for y=A*x^2+... means A must be positive. A<=0 means the fit
    # found the wrong curvature direction (or the data is too flat/noisy to
    # show any), and the reading must not be trusted even when the residual
    # above looks small.
    geom_valid = A_fit > 1e-6
    geom_reason = (None if geom_valid else
                   f"parabola coefficient A={A_fit:.6f} is not positive "
                   f"(wrong curvature direction)")
    print(f"  [Geometry] curvature {'valid' if geom_valid else 'INVALID'} "
          f"(A={A_fit:.6f})" + ("" if geom_valid else "  -> INVALID FIT"))

    # hook tips: extreme-x band pixels lying on the fitted parabola
    bys, bxs = np.nonzero(band_mask)
    pred_at_bxs = np.polyval((A_fit, B_fit, C_fit), bxs.astype(float))
    on_curve = np.abs(bys - pred_at_bxs) < max(3.0, 2.5 * res_med)
    if on_curve.sum() < 8:
        raise RuntimeError("Fitted parabola does not match the band.")
    obx, oby = bxs[on_curve], bys[on_curve]
    iL, iR = np.argmin(obx), np.argmax(obx)
    x_L, y_L = float(obx[iL]), float(oby[iL])
    x_R, y_R = float(obx[iR]), float(oby[iR])
    chord_px = float(np.hypot(x_R - x_L, y_R - y_L))
    x_P, y_P = float(xs[keep][np.argmin(ys[keep])]), float(ys[keep].min())

    if chord_px < 10:
        raise RuntimeError(
            f"Degenerate arc: chord={chord_px:.0f}px — "
            "check that the nail is clearly visible in the photo.")

    # ── 6. Scale & final values ───────────────────────────────
    # The hook tips (x_L/x_R, 100% out to the visible edge) are the least
    # reliable points on the trace — exactly where corner/shadow ambiguity
    # concentrates (see measure_ccurve dev notes). Anchor the mm/px scale
    # on a point INSET_FRAC of the way out from centre instead, well clear
    # of that noise, and extrapolate to the known full width_mm linearly —
    # width_mm itself is trusted ground truth (top-view measurement), not
    # something this photo needs to re-detect at 100%.
    INSET_FRAC = 0.8
    x_c = (x_L + x_R) / 2.0
    x_L80 = x_c - INSET_FRAC * (x_c - x_L)
    x_R80 = x_c + INSET_FRAC * (x_R - x_c)
    iL80 = int(np.argmin(np.abs(cols - x_L80)))
    iR80 = int(np.argmin(np.abs(cols - x_R80)))
    xL80, yL80 = float(cols[iL80]), float(top_y[iL80])
    xR80, yR80 = float(cols[iR80]), float(top_y[iR80])
    chord80_px = float(np.hypot(xR80 - xL80, yR80 - yL80))
    if chord80_px < 8:
        raise RuntimeError(
            f"Degenerate inset chord={chord80_px:.0f}px — "
            "check that the nail is clearly visible in the photo.")

    scale_mm_per_px = (INSET_FRAC * width_mm) / chord80_px
    chord_px_full = chord80_px / INSET_FRAC   # extrapolated to full width
    half_c = chord_px_full / 2.0
    # Sagitta: 현에서 윗경계 꼭대기까지 직접 잰 높이 (_direct_sagitta_px 설명 참고). 포물선 외삽(A * half_c^2)은 못 구했을
    # 때만 쓴다. 포물선 계수 A 는 아래 방향 검증과 보고용 반지름에는 계속 쓴다.
    sagitta_parab_px = A_fit * half_c ** 2
    sagitta_px = _direct_sagitta_px(xs, top_y, x_L, y_L, x_R, y_R, chord_px_full)
    if sagitta_px is None:
        sagitta_px = sagitta_parab_px
    h_mm = round(sagitta_px * scale_mm_per_px, 2)
    # Circle-equivalent radius (osculating circle at the vertex, R=1/(2A)) -
    # kept only for reporting/consistency with the arc_radius_mm field
    # downstream code already expects; the measurement itself no longer
    # depends on it.
    if A_fit > 1e-9:
        r_px_equiv = 1.0 / (2 * A_fit)
        fit_R_mm  = round(r_px_equiv * scale_mm_per_px, 2)
        half      = min(1.0, chord_px_full / (2 * r_px_equiv))
        arc_len_mm = round(2 * r_px_equiv * np.arcsin(half) * scale_mm_per_px, 2)
    else:
        r_px_equiv = fit_R_mm = arc_len_mm = None
    arc_R = (round(width_mm ** 2 / (8 * h_mm) + h_mm / 2, 2)
             if h_mm and h_mm > 0 else None)

    print(f"  [Nail arc]  L=({x_L:.0f},{y_L:.0f})  R=({x_R:.0f},{y_R:.0f})  "
          f"peak=({x_P:.0f},{y_P:.0f})")
    print(f"  [Scale]  {int(INSET_FRAC*100)}%-inset chord={chord80_px:.1f}px "
          f"(full~{chord_px_full:.1f}px vs raw hook-tip {chord_px:.1f}px)  "
          f"W_mm={width_mm}mm  →  {scale_mm_per_px:.5f} mm/px")
    print(f"  [C-curve]  sagitta={sagitta_px:.1f}px  →  h={h_mm}mm")
    print(f"  [Arc R]  chord formula R={arc_R}mm   parabola-fit R={fit_R_mm}mm")
    print(f"  [Arc length] over-the-curve width ~ {arc_len_mm}mm")

    # ── 7. Debug visualisation ────────────────────────────────
    if debug_out:
        vis = img.copy()
        ov = vis.copy()
        ov[pulp_mask > 0] = (200, 0, 200)
        ov[band_mask > 0] = (0, 200, 255)
        cv2.addWeighted(ov, 0.35, vis, 0.65, 0, vis)
        # fmask is already de-rotated with img; finger_cnt (taken before the
        # rotation) would be drawn at the wrong place whenever tilt was corrected.
        fcnts, _ = cv2.findContours(fmask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        cv2.drawContours(vis, fcnts, -1, (0, 255, 0), 2)

        for xa, ya, kp in zip(xs, ys, keep):
            cv2.circle(vis, (int(xa), int(ya)), 2,
                       (0, 255, 255) if kp else (0, 0, 255), -1)
        # Fitted parabola, drawn only across the traced band's own width (plus
        # a small margin) - unlike the old full-circle overlay (which forced
        # the reader to reason about major/minor arcs and a centre point off
        # in the background), this directly shows the fitted curve sitting
        # over the data: valid = it caps/roofs the yellow band from above.
        px_lo = max(0, int(cols.min()) - 15)
        px_hi = min(W_img, int(cols.max()) + 16)
        pts = np.array([[px_, int(round(np.polyval((A_fit, B_fit, C_fit), px_)))]
                        for px_ in range(px_lo, px_hi)], np.int32)
        cv2.polylines(vis, [pts.reshape(-1, 1, 2)], False, (255, 0, 255), 2)

        cv2.circle(vis, (int(x_L), int(y_L)), 6, (0, 200, 0), 2)
        cv2.circle(vis, (int(x_R), int(y_R)), 6, (0, 200, 0), 2)
        cv2.circle(vis, (int(x_P), int(y_P)), 6, (0, 0, 255), -1)
        cv2.line(vis, (int(x_L), int(y_L)), (int(x_R), int(y_R)),
                 (255, 200, 0), 2)
        # Vertex of the fitted parabola - the point the geometry check's
        # curvature sign is anchored to.
        if 0 <= int(vx) < W_img and 0 <= int(vy) < H:
            cv2.drawMarker(vis, (int(vx), int(vy)), (255, 255, 255),
                           markerType=cv2.MARKER_CROSS, markerSize=16, thickness=2)

        # zoomed crop around the fingertip with labels
        m = 80
        x0, y0 = max(fx - m, 0), max(fy - m, 0)
        x1, y1 = min(fx + fw + m, W_img), min(fy + fh + m, H)
        crop = vis[y0:y1, x0:x1]
        zoom = max(1, int(900 / max(crop.shape[:2])))
        crop = cv2.resize(crop, None, fx=zoom, fy=zoom,
                          interpolation=cv2.INTER_NEAREST)
        pad = np.zeros((crop.shape[0] + 200, crop.shape[1], 3), np.uint8)
        pad[:crop.shape[0]] = crop
        geom_txt   = "geometry: OK (curvature opens correctly)" if geom_valid \
            else f"geometry: INVALID ({geom_reason})"
        geom_color = (0, 220, 0) if geom_valid else (0, 0, 255)
        for i, txt in enumerate([
                f"W={width_mm}mm  chord={chord_px:.0f}px  "
                f"scale={scale_mm_per_px:.4f}mm/px",
                f"C-curve h={h_mm}mm   R={arc_R}mm (fit {fit_R_mm}mm)",
                f"over-the-curve width={arc_len_mm}mm"]):
            cv2.putText(pad, txt, (12, crop.shape[0] + 40 + 45 * i),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)
        cv2.putText(pad, geom_txt, (12, crop.shape[0] + 40 + 45 * 3),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, geom_color, 2)
        cv2.imwrite(debug_out, pad)
        print(f"  [Debug] saved → {debug_out}")

    gate_reason = None
    if not geom_valid:
        gate_reason = f"Invalid arc geometry: {geom_reason}"
        if gates:
            raise RuntimeError(gate_reason)

    # 사람 손톱의 C-curve 높이는 폭의 약 0.2~0.45배다. 이 범위 밖이면 손가락이 서 있거나 기울어서 호가 손톱 단면이
    # 아닌 것이다(스캔 218 소지: 폭 7.04mm 에 h 5.59mm = 0.79배 - 같은 손의 다른 스캔에서는 1.7mm). 그런 값을 쓰면 같은
    # 손인데 곡률이 들쭉날쭉해지므로 측정 실패로 돌려서 호출한 쪽이 다른 사진/대체값을 쓰게 한다.
    # 사진 한 장의 배율(mm/px)은 폰 줌을 고정해서 0.0127~0.022 로 모여 있다. 이보다 크면 손톱 띠가 양끝이 잘려 현이
    # 실제보다 짧게 잡힌 것이다(스캔 222 검지: 현 327px, 배율 0.0278 - 같은 손가락 221 은 현 596px, 배율 0.0154). 현이 짧으면
    # 같은 호도 곡률이 작게 나와서(h 1.49 vs 2.17mm) 같은 손인데 곡률이 들쭉날쭉해진다. 이런 사진은 측정 실패로 돌려서
    # 호출한 쪽이 손가락별 평균 곡률로 대체하게 한다.
    if scale_mm_per_px > SCALE_MM_PER_PX_MAX:
        gate_reason = gate_reason or (f"Nail arc too narrow: chord {chord_px_full:.0f}px gives {scale_mm_per_px:.4f} mm/px "
                                      f"(> {SCALE_MM_PER_PX_MAX}); the nail band is cut off at the sides")
        if gates:
            raise RuntimeError(gate_reason)

    _c_ratio = (h_mm / width_mm) if (h_mm and width_mm) else 0.0
    if not (C_RATIO_MIN <= _c_ratio <= C_RATIO_MAX):
        gate_reason = gate_reason or (f"Implausible C-curve: h/W = {_c_ratio:.2f} "
                                      f"(h={h_mm}mm, W={width_mm}mm; expected {C_RATIO_MIN}-{C_RATIO_MAX})")
        if gates:
            raise RuntimeError(gate_reason)

    result = {
        "gate_reason":   gate_reason,
        "c_curve_mm":    h_mm,
        "arc_radius_mm": arc_R,
        "arc_radius_fit_mm": fit_R_mm,
        "arc_length_mm": arc_len_mm,
        "arc_width_px":  round(chord_px_full, 1),
        "sagitta_px":    round(sagitta_px, 1),
        "scale_mm_per_px": round(scale_mm_per_px, 5),
        "nail_endpoints": {
            "left":  [int(x_L), int(y_L)],
            "right": [int(x_R), int(y_R)],
            "peak":  [int(x_P), int(y_P)],
        },
    }
    if not gates:      # 실험용: 윗경계 점과 현 끝점을 그대로 돌려준다 (JSON 저장 대상이 아니다)
        result["_trace"] = {"xs": xs, "ys": top_y, "keep": keep, "hooks": (x_L, y_L, x_R, y_R),
                            "chord_full": chord_px_full, "apex": (x_P, y_P)}
    return result


def main():
    p = argparse.ArgumentParser(
        description="C-curve from end-on finger photo (no ArUco needed)")
    p.add_argument("--image",     required=True, help="End-on photo path")
    p.add_argument("--width-mm",  type=float, required=True,
                   help="Known nail width in mm (from top-photo measurement)")
    p.add_argument("--debug-out", default=None,
                   help="Path to save annotated debug image")
    p.add_argument("--json-out",  default=None,
                   help="Path to save result JSON")
    p.add_argument("--table-edge", action="store_true",
                   help="Photo is finger draped over a table/mat edge "
                        "(arm resting on the desk behind it) — crop out "
                        "everything above the mat edge before measuring")
    p.add_argument("--edge-margin-px", type=int, default=350,
                   help="How tall a band above the detected table edge to "
                        "scan when localising the finger (default 350). "
                        "Needs enough height that the band's top is mostly "
                        "background, not finger, or the Otsu split below "
                        "loses its background reference and picks the "
                        "wrong split point - confirmed failing at 220, "
                        "clean at 300-400 on real rig photos.")
    p.add_argument("--top-crop-frac", type=float, default=0.0,
                   help="Fraction of image height to cut off the top "
                        "before measuring (e.g. 0.28 to remove a box rig's "
                        "ceiling/light fixture from the frame).")
    p.add_argument("--bottom-crop-frac", type=float, default=0.0,
                   help="Fraction of image height to cut off the bottom "
                        "before measuring (e.g. 0.12 to remove excess "
                        "near-camera mat).")
    p.add_argument("--left-crop-frac", type=float, default=0.0,
                   help="Fraction of image width to cut off the left "
                        "before measuring (e.g. 0.25 to remove a box rig's "
                        "wall seam / off-centre clutter).")
    p.add_argument("--right-crop-frac", type=float, default=0.0,
                   help="Fraction of image width to cut off the right "
                        "before measuring (e.g. 0.30 to remove a box rig's "
                        "ID/ArUco tag).")
    args = p.parse_args()

    print(f"\nC-curve measurement: {args.image}")
    print(f"  Known nail width: {args.width_mm}mm\n")

    result = measure_ccurve(args.image, args.width_mm, args.debug_out,
                             table_edge=args.table_edge,
                             edge_margin_px=args.edge_margin_px,
                             top_crop_frac=args.top_crop_frac,
                             bottom_crop_frac=args.bottom_crop_frac,
                             left_crop_frac=args.left_crop_frac,
                             right_crop_frac=args.right_crop_frac)

    print(f"\n  ┌─ C-CURVE RESULT ─────────────────────────────")
    print(f"  │  Sagitta (C-curve)  : {result['c_curve_mm']} mm")
    print(f"  │  Arc radius (R)     : {result['arc_radius_mm']} mm")
    print(f"  │  Scale used         : {result['scale_mm_per_px']} mm/px")
    print(f"  └───────────────────────────────────────────────")

    if args.json_out:
        with open(args.json_out, "w") as f:
            json.dump(result, f, indent=2)
        print(f"  [JSON] saved → {args.json_out}")


if __name__ == "__main__":
    main()
