"""
_legacy_camera_stream.py
------------------------
LEGACY — only used by scan/_legacy_server.py. The active server.py uses
plain cv2.VideoCapture directly instead. Kept for reference only.

Robust USB webcam wrapper around cv2.VideoCapture.

Fixes three symptoms reported on the top/side USB rigs ("자꾸 뚝뚝 끊기거나
렉 걸리거나 이미 지난 프레임을 계속 잡고 있는"):

  1. Stale-frame lag — every caller in this codebase called cap.read() once
     per loop iteration, with real work (ArUco detection, skin masking, or
     the full nail measurement) in between. Whenever that work takes longer
     than one camera frame interval, frames pile up in the driver's internal
     buffer and cap.read() starts returning older and older frames — the
     preview visibly lags behind what the camera sees right now, and the lag
     grows over the session instead of staying constant.

  2. Stutter / brief dropouts — a USB hiccup makes cap.read() return False
     for a frame or two, or the VideoCapture stops responding briefly. Every
     caller here treated a single False read as fatal and aborted whatever
     it was doing (skip the finger, kill the stream) with no retry.

  3. Bandwidth-driven frame drops — none of the VideoCapture opens set a
     FOURCC, so the camera was left on its default (often an uncompressed or
     lightly-compressed format). A 1920x1080 feed in that mode needs far more
     USB bandwidth than most webcam controllers sustain reliably, and dropped
     USB frames are themselves a root cause of (1) and (2). MJPG asks the
     camera to compress on-device, cutting required bandwidth by roughly an
     order of magnitude.

Fix:
  - Open with MJPG FOURCC.
  - A dedicated background thread reads the camera as fast as it will go and
    keeps only the SINGLE newest frame (no queue to fall behind on) — so no
    matter how slow the caller's processing is, the next read() it does gets
    the frame nearest to "now", not something several frames old.
  - read() blocks (with a timeout) until a genuinely NEW frame has arrived,
    using a condition variable rather than polling — this paces the caller to
    the camera's real frame rate for free, and means the caller never
    processes the same frame twice.
  - Consecutive read failures beyond a threshold trigger an automatic
    release()+reopen() with backoff, run entirely inside the background
    thread. From the caller's point of view this just looks like read()
    taking a bit longer during a dropout, instead of returning False
    immediately and aborting.
"""

import sys
import threading
import time

import cv2

_ROTATE_CODES = {
    90:  cv2.ROTATE_90_CLOCKWISE,
    180: cv2.ROTATE_180,
    270: cv2.ROTATE_90_COUNTERCLOCKWISE,
}


class RobustCamera:
    def __init__(self, index, width=None, height=None, rotate=0,
                 backend=None, fourcc="MJPG",
                 reconnect_after=15, max_backoff=5.0):
        """
        index            : camera index (as passed to cv2.VideoCapture)
        width, height    : requested capture resolution (best-effort)
        rotate           : 0/90/180/270, applied to every frame before it's
                            published — same convention as nail_live.py's Camera
        reconnect_after  : consecutive failed reads before the background
                            thread releases and reopens the device
        max_backoff      : cap (seconds) on the reopen retry backoff
        """
        self._index    = index
        self._width    = width
        self._height   = height
        self._fourcc   = fourcc
        self._backend  = backend if backend is not None else \
            (cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY)
        self._reconnect_after = reconnect_after
        self._max_backoff     = max_backoff
        self._rot_code = _ROTATE_CODES.get(rotate)

        self._cond   = threading.Condition()
        self._frame  = None
        self._ok     = False
        self._seq    = 0
        self._stop   = threading.Event()

        self._cap = None
        opened = self._open()

        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

        if not opened:
            # Surfaced immediately so callers keep their existing
            # "raise if camera index is wrong" behaviour; the background
            # thread will keep retrying in case it was a transient failure.
            print(f"[Camera {self._index}] initial open failed, "
                  f"background thread will keep retrying")

    def _open(self):
        cap = cv2.VideoCapture(self._index, self._backend)
        if self._fourcc:
            cap.set(cv2.CAP_PROP_FOURCC,
                    cv2.VideoWriter_fourcc(*self._fourcc))
        if self._width:
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, self._width)
        if self._height:
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self._height)
        # Best-effort: many backends (DSHOW included) ignore this, but the
        # background thread's drain-as-fast-as-possible loop is what
        # actually prevents buffer buildup regardless.
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        self._cap = cap
        return cap.isOpened()

    def isOpened(self):
        return self._cap is not None and self._cap.isOpened()

    def _run(self):
        fails   = 0
        backoff = 0.5
        while not self._stop.is_set():
            ok, frame = (self._cap.read() if self._cap is not None
                         else (False, None))
            if ok:
                fails, backoff = 0, 0.5
                if self._rot_code is not None:
                    frame = cv2.rotate(frame, self._rot_code)
                with self._cond:
                    self._frame = frame
                    self._ok    = True
                    self._seq  += 1
                    self._cond.notify_all()
                continue

            fails += 1
            with self._cond:
                self._ok = False
            if fails >= self._reconnect_after:
                print(f"[Camera {self._index}] {fails} consecutive read "
                      f"failures - reopening (backoff {backoff:.1f}s)")
                if self._cap is not None:
                    self._cap.release()
                time.sleep(backoff)
                self._open()
                fails   = 0
                backoff = min(backoff * 2, self._max_backoff)
            else:
                time.sleep(0.01)

    def read(self, timeout=5.0):
        """(ok, frame) — same shape as cv2.VideoCapture.read().

        Blocks until a NEW frame has landed since the last call (or until
        *timeout*), then returns it. This both paces the caller to the
        camera's actual frame rate and guarantees the frame handed back is
        never one already consumed - the two things a plain buffered
        cap.read() cannot promise once the caller falls behind.

        A transient USB dropout is absorbed here: the background thread
        keeps retrying (and reconnecting) underneath, so read() simply takes
        longer to return during the outage. Only an outage that outlasts
        *timeout* is reported to the caller as ok=False, matching what
        existing callers already do with a single failed cv2 read.
        """
        with self._cond:
            start_seq = self._seq
            got = self._cond.wait_for(
                lambda: self._seq != start_seq or self._stop.is_set(),
                timeout=timeout)
            if self._stop.is_set() or not got or self._frame is None:
                return False, None
            return self._ok, self._frame

    def release(self):
        self._stop.set()
        with self._cond:
            self._cond.notify_all()
        self._thread.join(timeout=2.0)
        if self._cap is not None:
            self._cap.release()
