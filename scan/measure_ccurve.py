"""
measure_ccurve.py
-----------------
End-on finger photo → accurate C-curve (sagitta) measurement.

Scale reference: known nail WIDTH (mm) from top-photo measurement.
No ArUco marker required.

Algorithm
---------
1. Segment the finger blob (skin vs dark background via LAB threshold)
2. Find the topmost boundary of the finger silhouette (column by column)
3. Identify the nail arc within that boundary by brightness:
   - The nail plate reflects more light → higher L in CLAHE-enhanced LAB
   - A contiguous bright zone near the top boundary = nail arc
4. Three key points on the nail arc:
   - left endpoint  (x_L, y_L)  : leftmost bright boundary column
   - right endpoint (x_R, y_R)  : rightmost bright boundary column
   - peak           (x_P, y_P)  : column with the minimum y (highest pixel)
5. Chord midpoint y = (y_L + y_R) / 2
   Sagitta h_px    = chord_mid_y − peak_y    (pixels, both in image coords)
   arc_width_px    = x_R − x_L
6. Scale = W_mm / arc_width_px
   h_mm   = h_px × scale
   arc_R  = W_mm² / (8·h_mm) + h_mm / 2
"""

import argparse, json, os, sys
import cv2
import numpy as np
from scipy.ndimage import uniform_filter1d


def measure_ccurve(image_path: str, width_mm: float,
                   debug_out: str = None) -> dict:

    img = cv2.imread(image_path)
    if img is None:
        raise FileNotFoundError(f"Cannot open: {image_path}")

    H, W_img = img.shape[:2]
    scale_factor = max(H, W_img) / 2000.0          # for adaptive kernel sizes
    print(f"  [Image] {W_img}×{H}  scale_factor={scale_factor:.2f}")

    # ── 1. Segment finger ─────────────────────────────────────
    lab   = cv2.cvtColor(img, cv2.COLOR_BGR2Lab)
    L_raw = lab[:, :, 0]
    # a* channel: skin is reddish (+a), gray/dark backgrounds are near 0
    A_ch  = lab[:, :, 1].astype(np.int16) - 128   # centre at 0

    # Skin = sufficiently bright AND reddish (a* > 8)
    # This cleanly rejects gray paper backgrounds even when they share similar L
    skin_bright = (L_raw > 100).astype(np.uint8) * 255
    skin_red    = (A_ch   >   8).astype(np.uint8) * 255
    skin_mask   = cv2.bitwise_and(skin_bright, skin_red)

    ks_close = max(15, int(15 * scale_factor) | 1)
    ks_open  = max(9,  int(9  * scale_factor) | 1)
    kC = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ks_close, ks_close))
    kO = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ks_open,  ks_open))
    skin_mask = cv2.morphologyEx(skin_mask, cv2.MORPH_CLOSE, kC, iterations=3)
    skin_mask = cv2.morphologyEx(skin_mask, cv2.MORPH_OPEN,  kO, iterations=2)

    cnts, _ = cv2.findContours(skin_mask, cv2.RETR_EXTERNAL,
                                cv2.CHAIN_APPROX_NONE)
    if not cnts:
        raise RuntimeError("No finger detected — check background / lighting.")

    # Prefer the contour with the highest top point (smallest y_min)
    min_area = H * W_img * 0.001
    valid = [c for c in cnts if cv2.contourArea(c) > min_area] or cnts
    finger_cnt = min(valid, key=lambda c: cv2.boundingRect(c)[1])

    finger_mask = np.zeros((H, W_img), np.uint8)
    cv2.drawContours(finger_mask, [finger_cnt], -1, 255, -1)
    fx, fy, fw, fh = cv2.boundingRect(finger_cnt)
    print(f"  [Finger] bbox x={fx} y={fy} w={fw} h={fh}")

    # ── 2. Find nail plate inside the finger (surface detection) ─
    # In an end-on photo the nail is NOT on the finger silhouette boundary —
    # it appears as a bright crescent on the TOP SURFACE of the finger.
    # We detect it as the brightest connected region in the upper portion.
    clahe = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(8, 8))
    L_enh = clahe.apply(L_raw)

    # Restrict search to the upper 65 % of the finger bounding box
    upper_h    = int(fh * 0.65)
    search_roi = np.zeros((H, W_img), np.uint8)
    search_roi[fy : fy + upper_h, fx : fx + fw] = 255
    search_roi = cv2.bitwise_and(search_roi, finger_mask)

    # Within that ROI, keep only pixels brighter than the 70th percentile
    roi_vals = L_enh[search_roi > 0]
    if len(roi_vals) == 0:
        raise RuntimeError("No finger pixels found in upper search region.")
    bright_thresh = float(np.percentile(roi_vals, 70))
    nail_bin = ((L_enh > bright_thresh) & (search_roi > 0)).astype(np.uint8) * 255

    # Morphological cleanup
    kN = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,
                                   (max(5, int(8*scale_factor)),
                                    max(5, int(8*scale_factor))))
    nail_bin = cv2.morphologyEx(nail_bin, cv2.MORPH_CLOSE, kN, iterations=2)
    nail_bin = cv2.morphologyEx(nail_bin, cv2.MORPH_OPEN,  kN, iterations=1)

    nail_cnts, _ = cv2.findContours(nail_bin, cv2.RETR_EXTERNAL,
                                     cv2.CHAIN_APPROX_NONE)
    if not nail_cnts:
        raise RuntimeError("Could not find nail plate region in upper finger.")

    # Largest connected bright region = nail plate
    nail_cnt = max(nail_cnts, key=cv2.contourArea)
    nail_mask_solo = np.zeros((H, W_img), np.uint8)
    cv2.drawContours(nail_mask_solo, [nail_cnt], -1, 255, -1)

    # ── 3. Three key arc points from the nail contour ─────────
    pts = nail_cnt.reshape(-1, 2)          # shape (N, 2): columns = [x, y]

    # Leftmost & rightmost points on the nail contour
    x_L = int(pts[:, 0].min())
    x_R = int(pts[:, 0].max())
    # For each endpoint x, pick the topmost (minimum y) contour pixel at that x
    y_L = int(pts[pts[:, 0] == x_L, 1].min())
    y_R = int(pts[pts[:, 0] == x_R, 1].min())

    # Peak = topmost pixel in the nail contour (minimum y overall)
    peak_idx = int(np.argmin(pts[:, 1]))
    x_P = int(pts[peak_idx, 0])
    y_P = int(pts[peak_idx, 1])

    arc_width_px = x_R - x_L
    chord_mid_y  = (y_L + y_R) / 2.0
    sagitta_px   = chord_mid_y - y_P          # positive: peak is above chord

    if arc_width_px < 10 or sagitta_px <= 0:
        raise RuntimeError(
            f"Degenerate arc: width={arc_width_px}px sagitta={sagitta_px:.1f}px\n"
            "Check that the nail plate is clearly visible in the photo.")

    # ── 5. Scale & final values ────────────────────────────────
    scale_mm_per_px = width_mm / arc_width_px    # ArUco-free scale!
    h_mm   = round(sagitta_px * scale_mm_per_px, 2)
    arc_R  = round(width_mm**2 / (8 * h_mm) + h_mm / 2, 2)

    print(f"  [Nail arc]  x_L={x_L} y_L={y_L}  x_R={x_R} y_R={y_R}  "
          f"x_P={x_P} y_P={y_P}")
    print(f"  [Scale]  arc_width={arc_width_px}px  W_mm={width_mm}mm  "
          f"→  {scale_mm_per_px:.5f} mm/px")
    print(f"  [C-curve]  chord_mid_y={chord_mid_y:.1f}  peak_y={y_P}  "
          f"sagitta={sagitta_px:.1f}px  →  h={h_mm}mm")
    print(f"  [Arc R]  R = {width_mm}² / (8×{h_mm}) + {h_mm}/2 = {arc_R}mm")

    # ── 6. Debug visualisation ────────────────────────────────
    if debug_out:
        vis = img.copy()

        # Overlay nail mask
        ov = vis.copy()
        ov[nail_mask_solo > 0] = (0, 200, 255)
        cv2.addWeighted(ov, 0.35, vis, 0.65, 0, vis)

        # Nail contour
        cv2.drawContours(vis, [nail_cnt], -1, (0, 255, 255), 3)

        # Left / right endpoints
        cv2.circle(vis, (x_L, y_L), int(20*scale_factor), (0, 200, 0), 3)
        cv2.circle(vis, (x_R, y_R), int(20*scale_factor), (0, 200, 0), 3)

        # Peak
        cv2.circle(vis, (x_P, y_P), int(20*scale_factor), (0, 0, 255), -1)

        # Chord line
        cv2.line(vis, (x_L, y_L), (x_R, y_R), (255, 200, 0), 3)

        # Sagitta arrow (chord midpoint → peak)
        chord_x = (x_L + x_R) // 2
        cv2.arrowedLine(vis, (chord_x, int(chord_mid_y)),
                        (x_P, y_P), (255, 80, 80), 4,
                        tipLength=0.03)

        # Labels
        lx = min(fx + fw + 30, W_img - 300)
        ly = fy + 80
        fs = max(1.2, scale_factor * 0.9)
        for txt, dy, col in [
            (f"W  = {width_mm}mm (from top photo)", 0,   (200, 255, 200)),
            (f"arc_width = {arc_width_px}px",       80,  (0,   255, 255)),
            (f"sagitta   = {sagitta_px:.1f}px",     160, (80,  80,  255)),
            (f"scale = {scale_mm_per_px:.4f}mm/px", 240, (200, 200, 200)),
            (f"C-curve  h = {h_mm}mm",              340, (0,   80,  255)),
            (f"Arc radius R = {arc_R}mm",            420, (0,   80,  255)),
        ]:
            cv2.putText(vis, txt, (lx, ly + dy),
                        cv2.FONT_HERSHEY_SIMPLEX, fs, (0, 0, 0), 6)
            cv2.putText(vis, txt, (lx, ly + dy),
                        cv2.FONT_HERSHEY_SIMPLEX, fs, col, 2)

        out_h = 1200
        sc    = out_h / vis.shape[0]
        vis_s = cv2.resize(vis, (int(vis.shape[1] * sc), out_h))
        cv2.imwrite(debug_out, vis_s)
        print(f"  [Debug] saved → {debug_out}")

    return {
        "c_curve_mm":    h_mm,
        "arc_radius_mm": arc_R,
        "arc_width_px":  arc_width_px,
        "sagitta_px":    round(sagitta_px, 1),
        "scale_mm_per_px": round(scale_mm_per_px, 5),
        "nail_endpoints": {
            "left":  [x_L, y_L],
            "right": [x_R, y_R],
            "peak":  [x_P, y_P],
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
    args = p.parse_args()

    print(f"\nC-curve measurement: {args.image}")
    print(f"  Known nail width: {args.width_mm}mm\n")

    result = measure_ccurve(args.image, args.width_mm, args.debug_out)

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
