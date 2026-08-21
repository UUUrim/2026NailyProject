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


def _fit_circle_robust(xs: np.ndarray, ys: np.ndarray, iters: int = 8):
    """Kåsa circle fit with iterative outlier rejection.

    Returns (cx, cy, r, inlier_mask).
    """
    keep = np.ones(len(xs), bool)
    cx = cy = r = None
    for _ in range(iters):
        x, y = xs[keep], ys[keep]
        M = np.column_stack([x, y, np.ones(len(x))])
        b = x ** 2 + y ** 2
        sol, *_ = np.linalg.lstsq(M, b, rcond=None)
        cx, cy = sol[0] / 2, sol[1] / 2
        r = np.sqrt(sol[2] + cx ** 2 + cy ** 2)
        res = np.abs(np.hypot(xs - cx, ys - cy) - r)
        s = max(np.median(res[keep]) * 2.5, 1.5)
        new_keep = res < s
        if new_keep.sum() < 8 or (new_keep == keep).all():
            break
        keep = new_keep
    return cx, cy, r, keep


def measure_ccurve(image_path: str, width_mm: float,
                   debug_out: str = None,
                   thickness_mm: float = 0.85,
                   table_edge: bool = False,
                   edge_margin_px: int = 220) -> dict:

    img = cv2.imread(image_path)
    if img is None:
        raise FileNotFoundError(f"Cannot open: {image_path}")

    if table_edge:
        edge_row = _find_table_edge(img)
        if edge_row is None:
            print("  [Edge] no flat table-edge mat found at the bottom — "
                  "skipping crop.")
        else:
            crop_top = max(0, edge_row - edge_margin_px)
            print(f"  [Edge] table edge at row {edge_row}  →  cropping to "
                  f"[{crop_top}:] ({edge_margin_px}px margin above it)")
            img = img[crop_top:, :]

            # Other fingers/knuckles caught in the margin above are still
            # fused to the target nail in one connected skin blob. The
            # target is whichever part dips lowest below the table edge —
            # anchor there and trim to just that finger's local width
            # before the main pipeline (which can't tell fingers apart)
            # ever sees the rest of the hand.
            lab0 = cv2.cvtColor(img, cv2.COLOR_BGR2Lab)
            warm0 = (lab0[:, :, 1].astype(np.float32) - 128) > 5
            ys, xs = np.nonzero(warm0)
            if len(ys):
                ay = int(ys.max())
                ax = int(np.median(xs[ys > ay - 5]))
                # A single-row scan for the blob's local width is too
                # fragile (shadows/antialiasing can pinch it to ~0px).
                # Instead size the window from the known nail width and a
                # nominal scale for this rig — generous enough to hold the
                # whole nail, tight enough to exclude the next finger over.
                # The real scale is computed precisely afterwards from the
                # fitted chord.
                nominal_mm_per_px = 0.048
                half_w = int(0.9 * width_mm / nominal_mm_per_px)
                x0 = max(0, ax - half_w)
                x1 = min(img.shape[1], ax + half_w)
                y0 = max(0, ay - int(1.8 * width_mm / nominal_mm_per_px))
                y1 = min(img.shape[0], ay + 15)
                print(f"  [Edge] anchor=({ax},{ay})  →  tight crop "
                      f"x[{x0}:{x1}] y[{y0}:{y1}]")
                img = img[y0:y1, x0:x1]

    H, W_img = img.shape[:2]
    scale_factor = max(H, W_img) / 2000.0          # for adaptive kernel sizes
    print(f"  [Image] {W_img}×{H}  scale_factor={scale_factor:.2f}")

    lab = cv2.cvtColor(img, cv2.COLOR_BGR2Lab)
    A = lab[:, :, 1].astype(np.float32) - 128
    B = lab[:, :, 2].astype(np.float32) - 128

    # ── 1. Background split on b* (adaptive) ─────────────────
    bw = max(20, int(0.02 * max(H, W_img)))
    border = np.zeros((H, W_img), bool)
    border[:bw, :] = border[-bw:, :] = True
    border[:, :bw] = border[:, -bw:] = True
    thr_b, bg_b = _adaptive_bg_split(B, border)
    print(f"  [BG] border b*={bg_b:.1f}  →  finger threshold b*>{thr_b:.1f}")

    mask = (B > thr_b).astype(np.uint8) * 255
    ks = max(5, int(9 * scale_factor) | 1)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ks, ks))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=3)

    # ── 2. Finger = most central large contour ───────────────
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    min_area = max(1500, H * W_img * 1e-4)
    big = [c for c in cnts if cv2.contourArea(c) > min_area]
    if not big:
        raise RuntimeError("No finger-sized warm region found — "
                           "check that the fingertip is in frame.")

    if table_edge:
        # The target nail is whichever warm blob hangs deepest into the mat
        # below the table edge — other fingers/knuckles caught in the crop
        # stay above it, even if they're more "central" in the frame.
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

    # ── 3. Nail vs pulp: Otsu on a* inside the finger ────────
    vals = A[fmask > 0]
    a8 = np.clip((A - vals.min()) / (np.ptp(vals) + 1e-6) * 255,
                 0, 255).astype(np.uint8)
    t, _ = cv2.threshold(a8[fmask > 0], 0, 255,
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
    kd = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (rad, rad))
    band = cv2.bitwise_and(cv2.dilate(pulp_mask, kd), nail_bin)

    # The isotropic dilation above is meant to reach a little way UP from
    # the pulp into the nail's dome, but it just as happily reaches
    # SIDEWAYS from the pulp's leftmost/rightmost corners — straight into
    # the lateral nail-fold skin, which often shares the nail's a* tone.
    # That flattens the fitted arc (wider chord than the real nail, biased
    # toward the flatter skin at the edges). Cap the lateral reach to the
    # pulp's own width plus one nail-thickness of slack, since the nail
    # can't be meaningfully wider than the finger flesh directly under it.
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

    xs, ys = cols.astype(float), top_y
    cx, cy, r_px, keep = _fit_circle_robust(xs, ys)
    res_med = float(np.median(np.abs(
        np.hypot(xs[keep] - cx, ys[keep] - cy) - r_px)))
    print(f"  [Circle fit] centre=({cx:.0f},{cy:.0f})  R={r_px:.1f}px  "
          f"inliers={keep.sum()}/{len(xs)}  med.res={res_med:.1f}px")

    # hook tips: extreme-x band pixels lying on the fitted circle
    bys, bxs = np.nonzero(band_mask)
    on_circle = np.abs(np.hypot(bxs - cx, bys - cy) - r_px) < \
        max(3.0, 2.5 * res_med)
    if on_circle.sum() < 8:
        raise RuntimeError("Fitted circle does not match the band.")
    obx, oby = bxs[on_circle], bys[on_circle]
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
    if r_px <= half_c:
        sagitta_px = r_px          # ≥ half circle; clamp
    else:
        sagitta_px = r_px - np.sqrt(r_px ** 2 - half_c ** 2)
    h_mm = round(sagitta_px * scale_mm_per_px, 2)
    arc_R = round(width_mm ** 2 / (8 * h_mm) + h_mm / 2, 2)
    fit_R_mm = round(r_px * scale_mm_per_px, 2)
    # arc length over the curve (what a flexible ruler measures)
    half = min(1.0, chord_px_full / (2 * r_px))
    arc_len_mm = round(2 * r_px * np.arcsin(half) * scale_mm_per_px, 2)

    print(f"  [Nail arc]  L=({x_L:.0f},{y_L:.0f})  R=({x_R:.0f},{y_R:.0f})  "
          f"peak=({x_P:.0f},{y_P:.0f})")
    print(f"  [Scale]  {int(INSET_FRAC*100)}%-inset chord={chord80_px:.1f}px "
          f"(full~{chord_px_full:.1f}px vs raw hook-tip {chord_px:.1f}px)  "
          f"W_mm={width_mm}mm  →  {scale_mm_per_px:.5f} mm/px")
    print(f"  [C-curve]  sagitta={sagitta_px:.1f}px  →  h={h_mm}mm")
    print(f"  [Arc R]  chord formula R={arc_R}mm   circle-fit R={fit_R_mm}mm")
    print(f"  [Arc length] over-the-curve width ~ {arc_len_mm}mm")

    # ── 7. Debug visualisation ────────────────────────────────
    if debug_out:
        vis = img.copy()
        ov = vis.copy()
        ov[pulp_mask > 0] = (200, 0, 200)
        ov[band_mask > 0] = (0, 200, 255)
        cv2.addWeighted(ov, 0.35, vis, 0.65, 0, vis)
        cv2.drawContours(vis, [finger_cnt], -1, (0, 255, 0), 2)

        for xa, ya, kp in zip(xs, ys, keep):
            cv2.circle(vis, (int(xa), int(ya)), 2,
                       (0, 255, 255) if kp else (0, 0, 255), -1)
        # fitted circle arc
        th = np.linspace(0, 2 * np.pi, 720)
        for t_ in th:
            px_, py_ = int(cx + r_px * np.cos(t_)), int(cy + r_px * np.sin(t_))
            if 0 <= px_ < W_img and 0 <= py_ < H:
                vis[py_, px_] = (255, 0, 255)

        cv2.circle(vis, (int(x_L), int(y_L)), 6, (0, 200, 0), 2)
        cv2.circle(vis, (int(x_R), int(y_R)), 6, (0, 200, 0), 2)
        cv2.circle(vis, (int(x_P), int(y_P)), 6, (0, 0, 255), -1)
        cv2.line(vis, (int(x_L), int(y_L)), (int(x_R), int(y_R)),
                 (255, 200, 0), 2)

        # zoomed crop around the fingertip with labels
        m = 80
        x0, y0 = max(fx - m, 0), max(fy - m, 0)
        x1, y1 = min(fx + fw + m, W_img), min(fy + fh + m, H)
        crop = vis[y0:y1, x0:x1]
        zoom = max(1, int(900 / max(crop.shape[:2])))
        crop = cv2.resize(crop, None, fx=zoom, fy=zoom,
                          interpolation=cv2.INTER_NEAREST)
        pad = np.zeros((crop.shape[0] + 160, crop.shape[1], 3), np.uint8)
        pad[:crop.shape[0]] = crop
        for i, txt in enumerate([
                f"W={width_mm}mm  chord={chord_px:.0f}px  "
                f"scale={scale_mm_per_px:.4f}mm/px",
                f"C-curve h={h_mm}mm   R={arc_R}mm (fit {fit_R_mm}mm)",
                f"over-the-curve width={arc_len_mm}mm"]):
            cv2.putText(pad, txt, (12, crop.shape[0] + 40 + 45 * i),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)
        cv2.imwrite(debug_out, pad)
        print(f"  [Debug] saved → {debug_out}")

    return {
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
    p.add_argument("--edge-margin-px", type=int, default=220,
                   help="Pixels to keep above the detected table edge "
                        "(default 220)")
    args = p.parse_args()

    print(f"\nC-curve measurement: {args.image}")
    print(f"  Known nail width: {args.width_mm}mm\n")

    result = measure_ccurve(args.image, args.width_mm, args.debug_out,
                             table_edge=args.table_edge,
                             edge_margin_px=args.edge_margin_px)

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
