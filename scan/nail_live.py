"""
nail_live.py
------------
Live-camera nail measurement with human confirmation.

The difference from nail_capture.py:
    nail_capture.py  → you confirm the PHOTO, then measurement runs blind.
    nail_live.py     → measurement runs continuously on the live feed and the
                       annotated result is what you see on screen. You press
                       OK to accept the MEASUREMENT you are looking at.

That is the whole point: a bad measurement is obvious in the annotated
overlay, so if the human only ever accepts good overlays, bad measurements
can never reach the STL stage.

Usage:
    python nail_live.py --finger index --output out_live
    python nail_live.py --finger index --output out_live --ccurve
    python nail_live.py --finger index --output out_live --shape round almond

Controls:
    ENTER / SPACE : accept now, without waiting for the auto-capture
    R             : clear the measurement history and keep scanning
    Q / ESC       : quit without saving

Hold still — do not roll:
    The reading scatters frame to frame even on a motionless finger (measured:
    the same nail read 10.55mm and 7.47mm 0.8s apart, both frames reporting
    status ok and both overlays looking correct). So a single frame is a draw
    from a noisy distribution, and WHICH frame you accept decides the answer.

    The fix is to hold the finger still and let the tool capture a MEDIAN over
    several consecutive readings. Median, not mean, because the error is
    bistable — it flips between two discrete values rather than wobbling — so a
    minority of bad frames is discarded outright instead of dragging an average.

    Note what is deliberately NOT done: picking the frame with the largest W.
    On a motionless finger the frame-to-frame spread is noise, so selecting the
    "best" frame just selects the most flattering noise draw. An earlier version
    tracked peak W while you rolled the finger, which was sound for rolling
    (foreshortening only ever shrinks W) but is exactly backwards once the
    finger is held still.

    This buys repeatability, not accuracy: a finger held at a consistent tilt
    gives a consistently wrong answer. Pose bias has to be measured separately.

Display:
    Main image    : the latest completed measurement overlay (~1 fps).
                    This is what gets accepted — what you see is what you get.
    Top-right PiP : the raw live feed (30 fps) for positioning your finger.
"""

import argparse
import csv
import json
import math
import os
import contextlib
import subprocess
import sys
import threading
import time
from collections import deque

import cv2
import numpy as np

import nail_measurer as nm

BASE   = os.path.dirname(os.path.abspath(__file__))
SHAPES = ("round", "oval", "almond", "square", "stiletto", "ballerina")

# Measurement is resolution-sensitive (width shifted ~2.5mm between 1920 and
# 640 on the same photo), so the live loop must measure at exactly the
# resolution that gets accepted. No downscaling for speed.
CAM_WIDTH  = 1920
CAM_HEIGHT = 1080

# Median window. ODD on purpose: for an odd count the median width is itself
# one of the observed widths, so the run can be represented by the REAL frame
# that produced it. That keeps the saved PNG, the overlay and the stored numbers
# perfectly consistent — re-measuring the PNG reproduces the stored width
# exactly — instead of pairing a synthetic average with an arbitrary frame.
MEDIAN_N       = 5      # consecutive readings the median is taken over
STABLE_TOL_MM  = 0.3    # max width/length spread across the window to auto-fire

# Kept as an alias: the display's stability line predates the median window.
STABLE_N       = MEDIAN_N

DISPLAY_H = 820         # window height; the full-res frame is what gets saved

# Per-finger offset from the ArUco marker's bottom edge, tuned by testing
# each finger against where its real cuticle actually lands (larger =
# further from the fingertip, toward the marker/hand). Index/middle need
# none - the marker's own edge already lines up with their cuticle.
GUIDE_LINE_OFFSET_DEFAULT_MM = 0.0
GUIDE_LINE_OFFSET_THUMB_MM   = 10.0
GUIDE_LINE_OFFSET_RING_MM    = 6.0
GUIDE_LINE_OFFSET_PINKY_MM   = 14.0

_GUIDE_LINE_OFFSET_MM = {
    "thumb": GUIDE_LINE_OFFSET_THUMB_MM,
    "ring":  GUIDE_LINE_OFFSET_RING_MM,
    "pinky": GUIDE_LINE_OFFSET_PINKY_MM,
}


def guide_line_offset_mm(finger: str) -> float:
    return _GUIDE_LINE_OFFSET_MM.get(finger, GUIDE_LINE_OFFSET_DEFAULT_MM)


# ─────────────────────────────────────────────────────────────
# Per-thread stdout muting
# ─────────────────────────────────────────────────────────────

class _ThreadQuietStdout:
    """sys.stdout replacement that drops writes from threads marked quiet.

    nail_measurer prints a block of diagnostics per measurement, and the
    measurement runs on a background thread ~1x/second. contextlib.
    redirect_stdout cannot be used to silence it: that swaps the *global*
    sys.stdout, so when the worker and the main thread enter/leave their
    contexts in an interleaved order, the wrong stream gets restored and the
    console goes silent for the rest of the run. Muting per thread has no
    such race.
    """

    def __init__(self, real):
        self._real  = real
        self._local = threading.local()

    def set_quiet(self, value):
        prev = getattr(self._local, "quiet", False)
        self._local.quiet = value
        return prev

    def write(self, s):
        if getattr(self._local, "quiet", False):
            return len(s)
        return self._real.write(s)

    def flush(self):
        self._real.flush()

    def __getattr__(self, name):
        return getattr(self._real, name)


_filter      = None
_filter_lock = threading.Lock()


def _ensure_filter():
    global _filter
    with _filter_lock:
        if _filter is None:
            _filter = _ThreadQuietStdout(sys.stdout)
            sys.stdout = _filter
        return _filter


@contextlib.contextmanager
def quiet():
    """Silence prints made by the calling thread only."""
    f    = _ensure_filter()
    prev = f.set_quiet(True)
    try:
        yield
    finally:
        f.set_quiet(prev)


# ─────────────────────────────────────────────────────────────
# Measurement worker
# ─────────────────────────────────────────────────────────────

def clipped_fraction(frame, data):
    """Fraction of the brighter skin band beside the nail that is blown out.

    Sampled from the two bands 1.2-2.4 nail-half-widths either side of the nail
    axis, over the nail's own rows, and reported for whichever side is brighter
    — that is the lit side, and the one whose groove the measurement needs.
    """
    try:
        cx   = int(data["_tip_x"])
        half = float(data["_nail_half"])
        y0   = int(data["_tip_y"])
        y1   = int(data["_cuticle_y"])
    except (KeyError, TypeError, ValueError):
        return None
    if y1 <= y0 or half <= 0:
        return None

    lo, hi = int(half * 1.2), int(half * 2.4)
    H, W   = frame.shape[:2]
    y0, y1 = max(0, y0), min(H, y1)
    worst  = None
    for x0, x1 in ((cx - hi, cx - lo), (cx + lo, cx + hi)):
        x0, x1 = max(0, x0), min(W, x1)
        if x1 - x0 < 3 or y1 - y0 < 3:
            continue
        band = frame[y0:y1, x0:x1]
        if band.size == 0:
            continue
        # brightest side wins: compare means, keep that side's clipped fraction
        clipped = float(np.mean(band.max(axis=2) >= 250)) * 100.0
        if worst is None or band.mean() > worst[1]:
            worst = (clipped, band.mean())
    return None if worst is None else worst[0]


def unusable_values(data):
    """Names of measurements that came out None or non-finite.

    A failed c-curve still renders as a perfectly plausible overlay - it just
    prints "C: nanmm" among four good-looking numbers - so an operator watching
    W and L can accept it and push NaN into the JSON and on into the STL stage.
    These frames must be unacceptable, not merely ugly.
    """
    bad = []
    for key in ("width_mm", "length_mm", "corrected_length_mm",
                "c_curve_mm", "arc_radius_mm", "thickness_mm"):
        v = data.get(key)
        if v is None:
            bad.append(f"{key}=None")
            continue
        try:
            f = float(v)
        except (TypeError, ValueError):
            bad.append(f"{key}={v!r}")
            continue
        if not math.isfinite(f) or f <= 0:
            bad.append(f"{key}={v}")
    return bad


def draw_width_marker(overlay, data, mpp):
    """Mark the span that width_mm actually measures.

    The green polygon comes from the lateral-edge fit and can be much narrower
    than the reported width (50px vs 69px on one real frame), so an operator
    checking only the outline is not checking W at all.

    The span is derived from width_mm itself rather than from _nail_half: those
    two agree on some frames but not all (sh_middle.jpg reports width_mm 9.52mm
    while 2*_nail_half is 7.74mm), and a bracket that disagrees with its own
    label is worse than no bracket.
    """
    try:
        cx   = int(data["_tip_x"])
        half = int(round(float(data["width_mm"]) / mpp / 2.0))
        y    = int((float(data["_tip_y"]) + float(data["_cuticle_y"])) / 2)
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        return overlay

    x1, x2 = cx - half, cx + half
    cv2.line(overlay, (x1, y), (x2, y), (255, 0, 255), 3)
    for x in (x1, x2):
        cv2.line(overlay, (x, y - 18), (x, y + 18), (255, 0, 255), 3)
    put(overlay, f"W {data['width_mm']}mm", (x1, y - 28), (255, 0, 255), 1.0, 2)
    return overlay


def guide_line_row(corners, x, offset_px=0.0):
    """Row (y, sub-pixel) of the marker's BOTTOM edge, evaluated at column x,
    plus *offset_px* (positive = toward the hand / larger y — see
    GUIDE_LINE_OFFSET_THUMB_PINKY_MM). Used once, at the finger's own centre
    column, to pick the single y-value that both the measurement and the
    on-screen line use — see draw_guide_line for why the line itself no
    longer extends this as a slope across the frame.

    The bottom two corners are picked by actual pixel position (largest y),
    not by a fixed cv2.aruco TL,TR,BR,BL index assumption: that ordering is
    relative to the marker's OWN rotation, which shifts with how the marker
    is physically mounted. On one rig corners[3]/corners[2] really were the
    bottom two and this worked; on another (same code, marker mounted at a
    different rotation) they turned out to be two corners on the same short
    edge, nearly stacked vertically — extrapolating that near-vertical
    "edge" out to a finger 300+px away sent the guide row thousands of
    pixels off-screen, which fed a garbage cuticle_y into every measurement
    (length_mm computed as 900+ instead of ~15) while leaving the on-screen
    guide line invisible, since it was drawn far outside the visible frame.
    That same slope, even when it stayed on-screen, is what made the drawn
    line look tilted relative to the marker whenever ArUco corner detection
    jittered a few pixels — the line only needs one y-value, not a slope.
    """
    order = sorted(range(4), key=lambda i: corners[i][1], reverse=True)
    bl, br = sorted((corners[order[0]], corners[order[1]]), key=lambda p: p[0])
    if abs(br[0] - bl[0]) < 1e-6:
        return float(bl[1]) + offset_px
    slope = (br[1] - bl[1]) / (br[0] - bl[0])
    return float(bl[1] + slope * (x - bl[0])) + offset_px


def draw_guide_line(img, guide_y):
    """Dashed, perfectly horizontal guide line at row *guide_y* — the same
    row measure_top actually used as the cuticle line — the operator aligns
    their cuticle to. Display only; drawn on the overlay copy, never on the
    saved raw frame.

    Deliberately flat (not sloped to match the marker's on-screen tilt, as
    an earlier version did): the marker is rarely perfectly square to the
    camera, and a few pixels of ArUco corner jitter turns into a visibly
    diagonal line once that slope is extended across the full frame width.
    guide_y is still computed from the real marker edge (see guide_line_row)
    — only the drawn line stops extending it as a slope.
    """
    h, w = img.shape[:2]
    y = int(round(guide_y))
    color = (255, 255, 0)   # BGR cyan/"sky blue" — distinct from other overlay colours
    n = 40
    for i in range(0, n, 2):
        xa, xb = int(w * i / n), int(w * (i + 1) / n)
        cv2.line(img, (xa, y), (xb, y), color, 2, cv2.LINE_AA)
    put(img, "ALIGN CUTICLE TO LINE", (10, max(20, y - 12)), color, 0.6, 2)
    return img


def detect_marker_only(frame, aruco_size_mm):
    """ArUco corners only, independent of finger presence — or None.

    measure_frame (below) also detects the marker, but bundles it into a
    single measurement that requires a finger too and returns None on ANY
    failure, marker included. That's fine for the actual measurement, but a
    caller that only wants to know where the marker is on screen (e.g. to
    crop it out of a web preview) would then see it appear to "come and go"
    with the finger, when in practice the marker — glued to the mat — is
    visible long before any finger is ever placed. Detecting it on its own
    here means it's known as soon as it's in frame.
    """
    try:
        with quiet():
            _, corners, _ = nm.detect_aruco(frame, aruco_size_mm)
        return corners
    except Exception:
        return None


GUIDE_Y_SMOOTHING = 0.7  # weight kept from the previous frame's guide_y (EMA)


def measure_frame(frame, finger, aruco_size_mm, prev_guide_y=None):
    """Run the full measurement on one frame.

    Returns a result dict. Never raises: a failed frame (no marker, no finger)
    is a normal event when the user is still positioning their hand.

    marker_ok / finger_ok are set as each stage clears, independent of
    whether the frame ends up "ok" overall — so a caller (e.g. the web
    stream's per-second console log) can tell "no marker", "marker but no
    finger", and "both found but the measurement itself came out unusable"
    apart, instead of one opaque failure for all three.

    prev_guide_y : the previous frame's (smoothed) guide row, if the caller
    is tracking one (see MeasureWorker). guide_y is recomputed from live
    ArUco corners + the current finger bbox every single frame, and both of
    those jitter a few pixels frame to frame from ordinary detection noise
    - with no temporal smoothing that jitter showed up as the on-screen
    guide line visibly jumping around even while measurement kept
    succeeding (unlike the flicker fix for ok/fail flapping, this is noise
    within otherwise-successful frames). An EMA against the previous
    frame's value damps that out while still tracking a real, sustained
    change (e.g. a different finger placed) within a few frames. Affects
    the actual cuticle_y fed into measure_top too, not just the drawn line
    - the two must never diverge, or the line would stop showing what's
    actually being measured.
    """
    result = {"ok": False, "marker_ok": False, "finger_ok": False,
              "t": time.time()}

    try:
        with quiet():
            mpp, corners, marker_id = nm.detect_aruco(frame, aruco_size_mm)
    except Exception as e:
        result["err"] = str(e).split("\n")[0]
        return result
    result["marker_ok"] = True

    try:
        with quiet():
            finger_mask, _, bbox = nm.segment_finger(frame, corners)
    except Exception as e:
        result["err"] = str(e).split("\n")[0]
        return result
    result["finger_ok"] = True

    try:
        with quiet():
            fbx, fby, fbw, fbh = bbox
            guide_offset_px = guide_line_offset_mm(finger) / mpp
            guide_y_raw = guide_line_row(corners, fbx + fbw // 2, guide_offset_px)
            guide_y = (int(round(GUIDE_Y_SMOOTHING * prev_guide_y +
                                 (1 - GUIDE_Y_SMOOTHING) * guide_y_raw))
                       if prev_guide_y is not None else int(round(guide_y_raw)))
            result["guide_y"] = guide_y
            data = nm.measure_top(frame, mpp, finger_mask, bbox,
                                  aruco_corners=corners, finger=finger,
                                  guide_y=guide_y)

            data.update(nm.apply_wl_correction(finger,
                                               data["width_mm"],
                                               data["length_mm"]))
            data["aspect_ratio"] = round(
                data["width_mm"] / data["length_mm"], 3
            ) if data["length_mm"] else 0.0
            data["_ccurve_method"] = "brightness fallback"

            # Exposure of the lit side. A clipped highlight has no texture left
            # in it, so the groove shadow the width measurement depends on is
            # simply gone: at 77% clipped the fold coverage was 21%, while the
            # sh reference photos clip 0% and reach 58-84%. Coverage alone tells
            # the operator something is wrong; this tells them what to change.
            data["_clip_pct"] = clipped_fraction(frame, data)

            bad = unusable_values(data)
            if bad:
                result["err"] = "UNUSABLE " + ", ".join(bad)
                return result

            # Stashed for the accept path, which redraws the overlay after the
            # c-curve stage. Leading underscore keeps it out of the JSON.
            data["_mpp"] = mpp

            overlay = draw_guide_line(draw_width_marker(
                nm.draw_annotated(frame, data, corners, finger), data, mpp),
                guide_y)
    except Exception as e:
        result["err"] = str(e).split("\n")[0]
        return result

    result.update({"ok": True, "frame": frame, "data": data,
                   "corners": corners, "overlay": overlay})
    return result


class MeasureWorker(threading.Thread):
    """Measures the most recent frame, over and over, in the background."""

    def __init__(self, finger, aruco_size_mm):
        super().__init__(daemon=True)
        self.finger     = finger
        self.aruco_size = aruco_size_mm
        self._lock      = threading.Lock()
        self._pending   = None      # newest frame waiting to be measured
        self._result    = None      # newest completed result
        self._stop      = threading.Event()

    def submit(self, frame):
        with self._lock:
            self._pending = frame

    def latest(self):
        with self._lock:
            return self._result

    def stop(self):
        self._stop.set()

    def run(self):
        prev_guide_y = None   # carries the EMA across frames - see measure_frame
        while not self._stop.is_set():
            with self._lock:
                frame, self._pending = self._pending, None
            if frame is None:
                time.sleep(0.01)
                continue
            result = measure_frame(frame, self.finger, self.aruco_size,
                                   prev_guide_y=prev_guide_y)
            if result.get("guide_y") is not None:
                prev_guide_y = result["guide_y"]
            with self._lock:
                self._result = result


# ─────────────────────────────────────────────────────────────
# Display
# ─────────────────────────────────────────────────────────────

def stability(history):
    """(is_stable, width_spread, length_spread) over the recent results.

    `history` holds full result dicts so the window can be reduced to the actual
    frame that produced the median (see median_result).
    """
    if len(history) < MEDIAN_N:
        return False, None, None
    ws = [h["data"]["width_mm"] for h in history]
    ls = [h["data"]["length_mm"] for h in history]
    dw, dl = max(ws) - min(ws), max(ls) - min(ls)
    return (dw <= STABLE_TOL_MM and dl <= STABLE_TOL_MM), dw, dl


def median_result(history):
    """The result whose width is the median of the window.

    With MEDIAN_N odd this is an exact median, and because it is a real frame
    the saved PNG re-measures to the stored number rather than to something
    near it.
    """
    ordered = sorted(history, key=lambda h: h["data"]["width_mm"])
    return ordered[len(ordered) // 2]


def put(img, text, xy, color, scale=0.62, thick=2):
    cv2.putText(img, text, xy, cv2.FONT_HERSHEY_SIMPLEX, scale, (0, 0, 0),
                thick + 3, cv2.LINE_AA)
    cv2.putText(img, text, xy, cv2.FONT_HERSHEY_SIMPLEX, scale, color,
                thick, cv2.LINE_AA)


def hint_bar(view, text):
    """Append a hint strip below the image instead of drawing over it."""
    bar = np.zeros((34, view.shape[1], 3), np.uint8)
    put(bar, text, (14, 24), (0, 220, 255), 0.6)
    return np.vstack([view, bar])


def compose(result, live_frame, history, finger, n_measured,
           crop_left_px: int = 0, show_pip: bool = True):
    """Build the window image: measured overlay + live PiP + status bar.

    crop_left_px : cuts this many columns off the left of both the main
        image and the PiP source before anything else runs — used by the
        web stream to keep the physical ArUco marker (glued to the mat at
        a fixed spot, always left of the finger) out of the customer-facing
        view. The local CLI tool leaves this at 0.
    show_pip : the local CLI tool wants the live PiP (main image can be up
        to a second behind); the web stream turns it off since it isn't a
        second measurement view an operator needs, just a second copy of
        the same marker-adjacent scene.
    """
    have = result is not None and result.get("ok")
    base = result["overlay"] if have else live_frame
    if crop_left_px > 0:
        base = base[:, crop_left_px:]

    scale = DISPLAY_H / base.shape[0]
    view  = cv2.resize(base, (int(base.shape[1] * scale), DISPLAY_H))
    h, w  = view.shape[:2]

    if show_pip:
        # Live picture-in-picture so the user can position the finger while
        # the main image is up to a second behind.
        pip_src = live_frame[:, crop_left_px:] if crop_left_px > 0 else live_frame
        pip_w   = w // 4
        pip     = cv2.resize(pip_src, (pip_w, int(pip_src.shape[0] * pip_w /
                                                  pip_src.shape[1])))
        ph, pw = pip.shape[:2]
        view[10:10 + ph, w - pw - 10:w - 10] = pip
        cv2.rectangle(view, (w - pw - 10, 10), (w - 10, 10 + ph), (200, 200, 200), 2)
        put(view, "LIVE", (w - pw - 4, 30), (200, 200, 200), 0.5, 1)

    # No status text block any more (top-left/bottom-left) - only the
    # coloured border (red = no reading, orange = collecting, green =
    # stable) plus whatever draw_annotated/draw_width_marker/draw_guide_line
    # already drew directly near the nail in result["overlay"]. All the
    # per-frame diagnostics (cuticle-unverified, fold coverage/lighting
    # meter, stability detail, keyboard hints) still get logged to the
    # console/CSV (see _log_row) for anyone who needs them - just not
    # burned into the operator-facing frame any more.
    if not have:
        cv2.rectangle(view, (0, 0), (w - 1, h - 1), (0, 0, 255), 8)
        return view

    d = result["data"]
    is_stable, dw, dl = stability(history)

    border = (0, 220, 0) if is_stable else (0, 200, 255)
    cv2.rectangle(view, (0, 0), (w - 1, h - 1), border, 8)
    return view


# ─────────────────────────────────────────────────────────────
# Live stages
# ─────────────────────────────────────────────────────────────

def _log_row(result, finger, elapsed):
    """One CSV line for a completed measurement, good or rejected.

    fold_cov and width_source are logged per FRAME, not just per run, because
    the open question is whether fold coverage tracks the finger's roll. Across
    three runs of the same hand under identical lighting, coverage moved
    27/31/0% (index) and 80/0/0% (pinky) while nail_half — a proxy for roll —
    shrank monotonically. Three points per finger cannot settle that; a rolled
    finger logged frame by frame can.
    """
    if not result["ok"]:
        reason = result.get("err", "?").replace(",", ";")
        return f"{elapsed:.2f},{finger},,,,,,,,,{reason}\n"
    d = result["data"]
    poly = d.get("nail_polygon_px") or []
    poly_px = (max(p[0] for p in poly) - min(p[0] for p in poly)) if poly else ""
    scan_px = round(2 * float(d["_nail_half"]), 1) if "_nail_half" in d else ""
    found, span = d.get("_lateral_rows"), d.get("_lateral_span")
    cov = round(100.0 * found / span, 1) if found is not None and span else ""
    return (f"{elapsed:.2f},{finger},{d['width_mm']},{d['length_mm']},"
            f"{d['c_curve_mm']},{d['arc_radius_mm']},{scan_px},{poly_px},"
            f"{cov},{d.get('width_source','')},ok\n")


def live_top_stage(cap, finger, aruco_size_mm, log_path=None, auto=True):
    """Live measure loop. Returns the accepted result dict, or None if quit.

    log_path : optional CSV to append every completed measurement to. The
        per-frame scatter is the thing worth measuring right now (pixel-level
        noise alone moves W by up to 0.8mm), and a log removes the need to read
        it off the screen and remember it.
    """
    worker = MeasureWorker(finger, aruco_size_mm)
    worker.start()

    window  = f"nail_live - {finger}"
    cv2.namedWindow(window, cv2.WINDOW_NORMAL)
    history = deque(maxlen=MEDIAN_N)
    last_t  = 0.0
    accepted = None

    print(f"\n[Live] Measuring '{finger}' - hold the finger STILL. "
          f"Captures automatically once {MEDIAN_N} readings agree"
          f"{' (auto-capture off)' if not auto else ''}.")

    log = None
    if log_path:
        # One file per run. Appending to a shared file silently interleaved six
        # sessions of different fingers into one CSV, which made the scatter
        # statistics meaningless until they were split apart again.
        stamp     = time.strftime("%Y%m%d_%H%M%S")
        root, ext = os.path.splitext(log_path)
        log_path  = f"{root}_{stamp}{ext}"
        log = open(log_path, "w", buffering=1)
        log.write("time_s,finger,width_mm,length_mm,c_curve_mm,"
                  "arc_radius_mm,scan_px,poly_px,fold_cov_pct,width_source,"
                  "status\n")
        print(f"  [Log] writing every measurement to {log_path}")
    t0 = time.time()

    while True:
        ok, frame = cap.read()
        if not ok:
            print("[Error] Cannot read from camera.")
            break

        worker.submit(frame)
        result = worker.latest()

        # Record each newly completed result for the stability check. A failed
        # frame clears the window: the readings either side of it are not
        # consecutive, and a median over a discontinuity means nothing.
        if result is not None and result["t"] != last_t:
            last_t = result["t"]
            if result["ok"]:
                history.append(result)
            else:
                history.clear()

            if log is not None:
                log.write(_log_row(result, finger, time.time() - t0))

        cv2.imshow(window, compose(result, frame, history, finger, 0))
        key = cv2.waitKey(1) & 0xFF

        is_stable, dw, _ = stability(history)

        # Auto-capture: fires on AGREEMENT, never on "best reading". Selecting
        # the largest W from a motionless finger would just pick the most
        # flattering noise draw — see the module docstring.
        if auto and is_stable:
            accepted = median_result(history)
            print(f"  [Auto-captured] median of {MEDIAN_N} readings: "
                  f"W={accepted['data']['width_mm']}mm  "
                  f"L={accepted['data']['length_mm']}mm  (spread dW={dw:.2f}mm)")
            break

        if key in (ord('q'), 27):
            break
        if key == ord('r'):
            history.clear()
            print("  [Reset] measurement history cleared.")
        if key in (13, 10, ord(' ')):
            # Manual accept still prefers the median when a full window exists;
            # only falls back to the on-screen frame when it does not.
            if len(history) == MEDIAN_N:
                accepted = median_result(history)
                print(f"  [Accepted] median of {MEDIAN_N}: "
                      f"W={accepted['data']['width_mm']}mm  "
                      f"L={accepted['data']['length_mm']}mm")
                break
            if result is not None and result["ok"]:
                accepted = result
                print(f"  [Accepted] SINGLE frame (only {len(history)}/"
                      f"{MEDIAN_N} readings) - less repeatable: "
                      f"W={result['data']['width_mm']}mm  "
                      f"L={result['data']['length_mm']}mm")
                break
            print("  [Ignored] no valid measurement on screen yet.")

    worker.stop()
    if log is not None:
        log.close()
    cv2.destroyWindow(window)
    return accepted


def live_ccurve_stage(cap, finger, width_mm, output_dir):
    """End-on C-curve stage. Returns the accepted ccurve dict, or None."""
    try:
        from measure_ccurve import measure_ccurve
    except ImportError:
        print("  [C-curve] measure_ccurve.py unavailable, skipping.")
        return None

    window = f"nail_live c-curve - {finger}"
    cv2.namedWindow(window, cv2.WINDOW_NORMAL)
    # PNG, not JPEG: measure_ccurve reads from disk, and a lossy re-encode of
    # the frame shifts the sagitta by ~0.03mm for no reason.
    tmp_img   = os.path.join(output_dir, f"_{finger}_ccurve_live.png")
    debug_img = os.path.join(output_dir, f"{finger}_ccurve_debug.jpg")

    print(f"\n[Live] C-curve stage - point the fingertip AT the camera.")
    print("  ENTER: accept   |   S: skip (brightness fallback)   |   Q: quit")

    last_try  = 0.0
    cc, shown = None, None
    accepted  = None

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        # ~1 measurement per second; measure_ccurve reads from disk.
        if time.time() - last_try > 1.0:
            last_try = time.time()
            cv2.imwrite(tmp_img, frame)
            try:
                with quiet():
                    cc = measure_ccurve(tmp_img, width_mm=width_mm,
                                        debug_out=debug_img)
                dbg = cv2.imread(debug_img)
                shown = (cc, dbg, frame.copy()) if dbg is not None else None
            except Exception as e:
                cc, shown = None, None
                print(f"  [C-curve] {str(e).split(chr(10))[0]}")

        if shown is not None:
            cc_d, dbg, src = shown
            scale = DISPLAY_H / dbg.shape[0]
            view  = cv2.resize(dbg, (int(dbg.shape[1] * scale), DISPLAY_H))
            cv2.rectangle(view, (0, 0), (view.shape[1] - 1, view.shape[0] - 1),
                          (0, 220, 0), 8)
            put(view, f"C-curve {cc_d['c_curve_mm']}mm   "
                      f"R {cc_d['arc_radius_mm']}mm", (14, 38), (255, 255, 255), 0.75)
            view = hint_bar(view, "ENTER: accept   |   S: skip   |   Q: quit")
        else:
            scale = DISPLAY_H / frame.shape[0]
            view  = cv2.resize(frame, (int(frame.shape[1] * scale), DISPLAY_H))
            cv2.rectangle(view, (0, 0), (view.shape[1] - 1, view.shape[0] - 1),
                          (0, 0, 255), 8)
            put(view, "No C-curve reading - show the fingertip end-on",
                (14, 38), (0, 80, 255), 0.7)
            view = hint_bar(view, "S: skip   |   Q: quit")

        cv2.imshow(window, view)
        key = cv2.waitKey(1) & 0xFF

        if key in (ord('q'), 27, ord('s')):
            break
        if key in (13, 10, ord(' ')) and shown is not None:
            accepted = shown[0]
            print(f"  [Accepted] C-curve h={accepted['c_curve_mm']}mm  "
                  f"R={accepted['arc_radius_mm']}mm")
            break

    cv2.destroyWindow(window)
    if os.path.isfile(tmp_img):
        os.remove(tmp_img)
    return accepted


# ─────────────────────────────────────────────────────────────
# Save + STL
# ─────────────────────────────────────────────────────────────

def save_results(results, aruco_size_mm, output_dir):
    payload   = nm.build_payload(results, aruco_size_mm)
    json_path = os.path.join(output_dir, "nail_measurements.json")
    with open(json_path, "w") as f:
        json.dump(payload, f, indent=2)

    profiles     = nm.build_profile(results)
    profile_path = os.path.join(output_dir, "profile.json")
    with open(profile_path, "w") as f:
        json.dump(profiles[0] if len(profiles) == 1 else profiles, f, indent=2)

    print(f"\n[Saved] {json_path}")
    print(f"[Saved] {profile_path}")
    return json_path


def append_run_index(results, run_dir, base_dir, note):
    """
    One row per finger per run in {base}/runs.csv, so runs can be compared
    without opening each JSON.  This is the whole point of keeping every run:
    change one thing (a light, the marker, the finger angle), re-run, and diff.
    """
    index_path = os.path.join(base_dir, "runs.csv")
    new = not os.path.isfile(index_path)
    with open(index_path, "a", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["run", "note", "finger", "width_mm", "length_mm",
                        "width_source", "fold_coverage_pct", "c_curve_mm",
                        "arc_radius_mm"])
        run = os.path.basename(run_dir.rstrip(os.sep))
        for r in results:
            found, span = r.get("_lateral_rows"), r.get("_lateral_span")
            cov = round(100.0 * found / span, 1) if found is not None and span else ""
            w.writerow([run, note, r["finger"], r["width_mm"], r["length_mm"],
                        r.get("width_source", ""), cov, r.get("c_curve_mm", ""),
                        r.get("arc_radius_mm", "")])
    print(f"[Saved] {index_path}  (one row per finger, appended)")


def generate_stl(json_path, finger, shapes, output_dir):
    stl_dir = os.path.join(output_dir, "stl")
    os.makedirs(stl_dir, exist_ok=True)
    made = []
    for shape in shapes:
        print(f"\n[STL] {shape} ...")
        r = subprocess.run([sys.executable,
                            os.path.join(BASE, "nail_exact_stl.py"),
                            "--input",  json_path,
                            "--shape",  shape,
                            "--finger", finger,
                            "--output", stl_dir], cwd=BASE)
        if r.returncode == 0:
            made.append(os.path.join(stl_dir, f"nail_{finger}_{shape}.stl"))
        else:
            print(f"  [Warning] STL failed for '{shape}', skipping.")
    return made


# ─────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────

class Camera:
    """VideoCapture wrapper that applies a fixed rotation to every frame.

    The measurement pipeline assumes the finger points UP: the free edge is
    found above the cuticle and length is cuticle_y - tip_y. Feed it an
    upside-down frame and it does not fail, it silently returns nonsense
    (measured 13.94mm x 28.62mm on a nail that is really 10.07 x 13.85).

    Rotating at the single point of entry means the preview, the measurement,
    the accepted frame and the saved JPEG all see the same upright image, so
    nothing downstream needs to know how the camera is mounted.
    """

    _MODES = {90:  cv2.ROTATE_90_CLOCKWISE,
              180: cv2.ROTATE_180,
              270: cv2.ROTATE_90_COUNTERCLOCKWISE}

    def __init__(self, cap, rotate=0):
        self._cap = cap
        self._rot = self._MODES.get(rotate)

    def read(self):
        ok, frame = self._cap.read()
        if ok and self._rot is not None:
            frame = cv2.rotate(frame, self._rot)
        return ok, frame

    def release(self):
        self._cap.release()


def open_camera(index, rotate=0):
    backend = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY
    cap = cv2.VideoCapture(index, backend)
    if not cap.isOpened():
        sys.exit(f"ERROR: cannot open camera index {index}")
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  CAM_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAM_HEIGHT)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"[Camera] index {index}  {w}x{h}"
          f"{f'  rotate {rotate} deg' if rotate else ''}")
    if (w, h) != (CAM_WIDTH, CAM_HEIGHT):
        print(f"  [Warning] camera gave {w}x{h}, not {CAM_WIDTH}x{CAM_HEIGHT}. "
              f"Measurements are resolution-sensitive - results will differ "
              f"from photos taken at {CAM_WIDTH}x{CAM_HEIGHT}.")
    return Camera(cap, rotate)


def main():
    global MEDIAN_N, STABLE_N
    p = argparse.ArgumentParser(
        description="Live camera nail measurement with human confirmation")
    p.add_argument("--finger", default="index", choices=nm.FINGER_NAMES,
                   help="single finger to measure")
    p.add_argument("--fingers", nargs="+", default=None,
                   help="measure several fingers in one run, in this order")
    p.add_argument("--camera", type=int, default=0, help="camera index")
    p.add_argument("--rotate", type=int, default=0, choices=[0, 90, 180, 270],
                   help="rotate every frame by this many degrees clockwise. "
                        "Use 180 for an upside-down camera: the pipeline "
                        "assumes the finger points UP and returns silent "
                        "nonsense otherwise")
    p.add_argument("--aruco-size", type=float, default=20.0,
                   help="physical ArUco side length in mm")
    p.add_argument("--ccurve", action="store_true",
                   help="add the end-on C-curve stage after each finger")
    p.add_argument("--shape", nargs="*", default=[], choices=SHAPES,
                   help="also generate STL(s) for these shapes")
    p.add_argument("--output", default="out_live",
                   help="output ROOT; each run gets its own timestamped "
                        "subdirectory inside it, so nothing is ever overwritten")
    p.add_argument("--note", default="",
                   help="short label for this run, e.g. 'two-lights' or "
                        "'thumb-rotated'. Goes into the run directory name and "
                        "into runs.csv so you can tell runs apart later")
    p.add_argument("--no-auto", action="store_true",
                   help="do not capture automatically; wait for ENTER (which "
                        "still stores the median once enough readings agree)")
    p.add_argument("--median-n", type=int, default=MEDIAN_N,
                   help=f"readings the median is taken over, odd "
                        f"(default {MEDIAN_N})")
    p.add_argument("--flat", action="store_true",
                   help="write straight into --output with fixed filenames, "
                        "overwriting any previous run (the old behaviour)")
    p.add_argument("--log-frames", action="store_true",
                   help="append every completed measurement to "
                        "{output}/{finger}_frames.csv, for measuring how much "
                        "the reading scatters frame to frame")
    p.add_argument("--debug", action="store_true",
                   help="verbose detector diagnostics (read by nail_measurer)")
    p.add_argument("--no-lateral", action="store_true",
                   help="disable side-lit lateral fold-edge detection")
    args = p.parse_args()

    if args.median_n % 2 == 0:
        sys.exit(f"ERROR: --median-n must be odd (got {args.median_n}); an even "
                 f"window has no single observed frame at the median.")
    if args.median_n < 1:
        sys.exit("ERROR: --median-n must be >= 1")
    MEDIAN_N = STABLE_N = args.median_n

    _ensure_filter()   # install before any worker thread starts

    fingers = args.fingers if args.fingers else [args.finger]
    bad = [f for f in fingers if f not in nm.FINGER_NAMES]
    if bad:
        sys.exit(f"ERROR: unknown finger(s): {bad}")

    base_dir = args.output if os.path.isabs(args.output) \
        else os.path.join(BASE, args.output)

    # Every run gets its own directory.  The accepted PNG is the only artefact
    # that can be re-measured when the detector changes, and the old fixed
    # filenames destroyed it on every re-run — losing exactly the evidence
    # needed to tell whether a change to the rig or the code helped.
    if args.flat:
        output_dir = base_dir
    else:
        stamp = time.strftime("%Y%m%d_%H%M%S")
        slug  = "".join(c if c.isalnum() or c in "-_" else "-"
                        for c in args.note).strip("-")
        output_dir = os.path.join(base_dir, f"{stamp}_{slug}" if slug else stamp)
    os.makedirs(output_dir, exist_ok=True)
    print(f"[Output] {output_dir}")

    cap = open_camera(args.camera, args.rotate)
    results = []

    try:
        for i, finger in enumerate(fingers):
            print(f"\n{'='*55}\n  [{i+1}/{len(fingers)}] {finger.upper()}\n{'='*55}")

            log_path = os.path.join(output_dir, f"{finger}_frames.csv") \
                if args.log_frames else None
            accepted = live_top_stage(cap, finger, args.aruco_size, log_path,
                                      auto=not args.no_auto)
            if accepted is None:
                print(f"  [Skipped] {finger} - no measurement accepted.")
                continue

            data = accepted["data"]

            if args.ccurve:
                cc = live_ccurve_stage(cap, finger,
                                       data["width_mm"], output_dir)
                if cc:
                    data["c_curve_mm"]     = cc["c_curve_mm"]
                    data["arc_radius_mm"]  = cc["arc_radius_mm"]
                    data["_ccurve_method"] = "end-on photo (live)"

            # Save the exact frame that was accepted, and its overlay, so the
            # saved annotated JPG matches what the human approved.
            # PNG, not JPEG: the measurement is chaotically sensitive to
            # pixel-level noise. Re-encoding ys_index.jpg moved W by -0.06mm at
            # q95 and -0.79mm at q100, while a PNG round-trip reproduced 10.07mm
            # exactly. A JPEG archive would not re-measure to the value that was
            # actually approved.
            raw_path = os.path.join(output_dir, f"{finger}.png")
            cv2.imwrite(raw_path, accepted["frame"])

            # Width marker included, so reviewing the JPEG later shows exactly
            # what was approved on screen — the green outline alone is ~28%
            # narrower than the span width_mm reports.
            _mpp = data.get("_mpp")
            vis   = draw_guide_line(draw_width_marker(
                nm.draw_annotated(accepted["frame"], data,
                                  accepted["corners"], finger),
                data, _mpp), data["_cuticle_y"])
            scale = 900 / vis.shape[0]
            ann_path = os.path.join(output_dir, f"{finger}_annotated.jpg")
            cv2.imwrite(ann_path,
                        cv2.resize(vis, (int(vis.shape[1] * scale), 900)))
            print(f"  [Saved] {raw_path}")
            print(f"  [Saved] {ann_path}")

            results.append({"finger": finger, **data})
    finally:
        cap.release()
        cv2.destroyAllWindows()

    if not results:
        sys.exit("\nNothing accepted - no output written.")

    json_path = save_results(results, args.aruco_size, output_dir)
    if not args.flat:
        append_run_index(results, output_dir, base_dir, args.note)

    if args.shape:
        for r in results:
            generate_stl(json_path, r["finger"], args.shape, output_dir)

    print(f"\n{'='*55}")
    print(f"  Done. Accepted: {[r['finger'] for r in results]}")
    print(f"  Results: {output_dir}")
    print(f"{'='*55}")


if __name__ == "__main__":
    main()
