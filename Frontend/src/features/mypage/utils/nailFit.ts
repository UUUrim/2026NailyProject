import {
  FINGERS,
  computeNailPoses,
  type NailFit,
  type NailPose,
  type Point,
  type TrackedHand,
} from '@/features/mypage/utils/fingerLandmarks'
import {
  NailSegmenter,
  preloadNailSegmenter,
  type CropRegion,
  type NailMask,
  type SegmenterBackend,
} from '@/features/mypage/utils/nailSegmenter'

// Landmarks alone can't say where a nail's cuticle is. They mark joint
// centers, and in poses MediaPipe finds hard - most of all the "claw", palm
// to the camera with the fingertips curled forward so the nails face it -
// they slide a whole phalanx: on a real claw photo the TIP landmark sat at
// the cuticle, putting every landmark-placed tip 45-80 px short of it, and the
// pinky's landmarks ran half a nail off to the side. So each frame this looks
// for the nail itself in the camera image, in a window around the finger's
// landmarks, and reports where its cuticle really is.
//
// What it looks for: on a bare nail the nail bed shows through the plate, so
// the plate is pinker (higher a*, lower b*) and a little brighter than the
// skin around it - on that photo a* - b* was ~8 higher than the skin just
// proximal of the cuticle, against ~3 for the palm and fingertip pads.
// Nail-ness is a* - b* + 0.6 L* relative to the skin over the DIP joint,
// which is skin in every pose where the nail is visible. The nail is then the
// box-shaped region that's most nail-like inside while the skin above it
// (the proximal nail fold) and beside it (the lateral folds) isn't; the
// cuticle is the steepest rise of nail-ness at the top of that box.
//
// How far to trust it depends on the pose. Along the finger, the cuticle is
// the strongest edge around (nail vs. proximal fold) and landed within a few
// percent of the nail width everywhere it was tried. Sideways and in angle
// the image is weaker - next to a nail lying flat to the camera the skin of
// the lateral folds is nearly as pink as the nail, which pulled the box 15-30%
// of a nail width off center. So with the back of the hand to the camera,
// where MediaPipe's landmarks are good, they keep the center line and angle;
// with the palm to the camera (the claw), where they aren't, the image does.
//
// That color search is the fallback. Once the nail segmentation model (see
// nailSegmenter.ts) has loaded, its masks replace it: run on a crop around
// the fingertips at whatever rate the device manages, each mask is matched to
// a finger and gives that nail's cuticle, direction and width, trusted in
// every pose.
//
// A nail just seen is held where the image put it - moved along with the
// hand until the next detection, not with that finger's own landmarks, which
// in the claw pose drift several pixels from frame to frame. How the hand
// moved is a robust fit to the joints of all five fingers together, so the
// few that are wandering don't count. The wrist and palm are left out: right
// after a hand is found MediaPipe takes a dozen frames to settle, and on a
// still claw photo its wrist and palm landmarks slid ~240 px meanwhile while
// the fingers' stayed put - the mean of all 21 dragged every tip 11-16 px off
// its nail. Even the fingers' joints shift against each other for those first
// frames, so the more they disagree, the more a new detection is believed
// over where the nail was being held. One not seen for a while follows its
// finger's landmarks instead,
// keeping the offset it last had from them. The final pose is smoothed
// adaptively - held steady while the hand is still, following immediately
// when it moves.

/** Search-grid resolution: cells across one expected nail width. */
const CELLS_PER_NAIL = 18
/** Search window, in expected nail widths: either side of the DIP->TIP line,
 *  before the DIP landmark, and past the TIP landmark (the claw pose puts the
 *  nail itself past TIP). */
const HALF_WIDTH = 1.3
const BEFORE_DIP = 0.3
const PAST_TIP = 1.6
/** The window follows the on-screen DIP->TIP length up to this many nail
 *  widths - beyond that the landmarks are badly off anyway. */
const MAX_SEGMENT = 2.2

const GRID_COLS = Math.ceil(2 * HALF_WIDTH * CELLS_PER_NAIL)
const GRID_MAX_ROWS = Math.ceil((BEFORE_DIP + MAX_SEGMENT + PAST_TIP) * CELLS_PER_NAIL)
const MAX_HANDS = 2

/** The frame is read once per frame, downscaled (filtered) so the smallest
 *  grid cell spans about this many pixels; each cell is then one bilinear
 *  sample of it. */
const PX_PER_CELL = 1.5

const LIGHTNESS_WEIGHT = 0.6

/** Box sizes tried, as fractions of the expected nail width (width) and of the
 *  box width (height). */
const BOX_WIDTHS = [0.8, 0.95, 1.1]
const BOX_HEIGHTS = [0.8, 1.0, 1.2]
/** Proximal skin band above the box / lateral bands beside it, as fractions of
 *  the box width, and how much each counts against the box. */
const ABOVE_BAND = 0.3
const SIDE_BAND = 0.15
const ABOVE_WEIGHT = 0.6
const SIDE_WEIGHT = 0.4
/** Penalty for sitting off the DIP->TIP line, per (offset / nail width)^2 -
 *  enough to keep a neighboring finger's nail from winning, not enough to
 *  stop a nail the landmarks missed by half a width. */
const LATERAL_PENALTY = 2
/** Penalty per (distance from the tracked cuticle / nail width)^2, so the
 *  search keeps the same nail instead of hopping between two near-equal
 *  candidates from frame to frame. */
const TRACKING_PENALTY = 2
/** Minimum nail-vs-proximal-skin contrast to trust a detection: absolute, and
 *  relative to the skin's own pixel noise. */
const MIN_CONTRAST = 3
const MIN_CONTRAST_TO_NOISE = 2.5
/** How far along the finger the cuticle is looked for, in nail widths either
 *  way from the top of the box. */
const CUTICLE_SEARCH = 0.45

/** The nail blob's own direction (from the cuticle to its centroid) put the
 *  claw-pose thumb within 5 degrees where the landmarks were 20 off, but a
 *  pinkish neighbor can drag it too, so it only gets half a say. */
const ROTATION_BLEND = 0.5
const MAX_ROTATION = (35 * Math.PI) / 180
/** With the back of the hand to the camera the landmarks keep the center
 *  line, unless the image puts the nail further off it than this (nail
 *  widths) - then only the excess counts. */
const BACK_LATERAL_SLACK = 0.25

/** On-screen width: the landmarks' estimate, foreshortened by their guess at
 *  how far the nail is rolled away - but never below this fraction, since
 *  that guess is often wrong - and a little wider so the tip covers the
 *  nail's edges. */
const MIN_ROLL_FORESHORTENING = 0.85
const NAIL_COVER = 1.06

/** Mask cells at or above this probability are nail. */
const MASK_THRESHOLD = 0.5
/** Masks come at 4x the prototype grid, so this is ~6 prototype cells. */
const MIN_MASK_CELLS = 100
/** Cells used per direction tried while finding a mask's direction. */
const MASK_SEARCH_SAMPLES = 400
/** A mask's direction is the one, within this of the landmarks' DIP->TIP,
 *  across which it is narrowest - with a weak pull toward DIP->TIP, per
 *  radian^2, for nails about as long as they are wide. */
const MAX_MASK_TILT = (40 * Math.PI) / 180
const MASK_TILT_STEP = Math.PI / 180
const MASK_TILT_PRIOR = 1.6
/** A mask is matched to the finger whose expected nail zone - from just past
 *  DIP to well past TIP, on the DIP->TIP line - it's closest to, if within
 *  this many nail widths. */
const MASK_MATCH_DISTANCE = 1
/** The crop around a hand's fingertips is this much bigger than the box
 *  around their search windows. */
const CROP_MARGIN = 1.1
/** A tip drawn this much wider than the measured mask covers its edge. */
const MASK_COVER = 1.03
/** A mask's proximal edge is the line under its proximal-most cell in each
 *  of this many bins across the middle of the nail (this fraction of its
 *  width); steeper than MAX_EDGE_SLOPE (along per across) is noise. */
const EDGE_BINS = 6
const EDGE_SPAN = 0.8
const MAX_EDGE_SLOPE = 3

/** Nails narrower than this (expected width, px) have too few pixels. */
const MIN_NAIL_PX = 14
/** Nails turned this far from the camera (pose facing) aren't searched. */
const MIN_FACING = 0.15
/** Found (non-thumb) nails on a hand needed before the others borrow their
 *  offset from the landmarks. */
const MIN_LENDERS = 2

const POSITION_GAIN = 0.35
const ROTATION_GAIN = 0.3
const WIDTH_GAIN = 0.2
/** A settled track ignores a detection this far off (nail widths / radians) -
 *  unless the next few agree with each other, in which case the nail really
 *  is somewhere else now and the track restarts there. */
const SETTLED_AFTER = 3
const OUTLIER_POSITION = 0.3
const OUTLIER_ROTATION = (15 * Math.PI) / 180
const OUTLIER_WIDTH = 0.3
const OUTLIER_CONFIRM = 4
/** How far a held track can be trusted shrinks with how badly the hand's
 *  landmarks disagree about how it moved (see handMotion) - right after a
 *  hand is found they move every which way for a dozen frames. That
 *  disagreement (px) times this widens the outlier bounds, and against a
 *  detection's own scatter (nail widths, ~1 sigma) it decides how far a new
 *  detection pulls the track. */
const HOLD_SLACK = 3
const DETECTION_SCATTER = 0.05
/** Keep using a track this long after its nail was last found, instead of
 *  snapping back to the landmark estimate on a few missed frames - held in
 *  place with its hand for the first TRACK_FRESH_MS, then following its
 *  finger's landmarks. */
const TRACK_HOLD_MS = 2500
const TRACK_FRESH_MS = 600
/** A nail the model finds is shown whatever the landmarks say about which
 *  way it faces - until more than this many of its runs in a row miss it,
 *  so a missed run or two doesn't blink it off. */
const MAX_MODEL_MISSES = 2
/** The landmarks the hand's motion is fitted to: every finger's PIP, DIP and
 *  TIP, and the thumb's IP and TIP. */
const HAND_MOTION_LANDMARKS = [3, 4, 6, 7, 8, 10, 11, 12, 14, 15, 16, 18, 19, 20]
/** Fitting the hand's motion: refinement passes; how far (in robust spreads
 *  of the residuals) a landmark can stray before it stops counting; a floor
 *  on that spread, as a fraction of the hand's size, so landmarks that agree
 *  to a pixel don't make it hair-trigger; and the most zoom accepted between
 *  two frames. */
const HAND_FIT_PASSES = 4
const HAND_FIT_TOLERANCE = 2
const HAND_FIT_MIN_TOLERANCE = 0.01
const HAND_FIT_MAX_ZOOM = 1.5

/** Output smoothing, a One Euro filter over the whole nail pose with speeds
 *  in nail widths per second: nearly frozen while the hand holds still, so
 *  neither landmark jitter nor detection noise makes a tip wobble, and
 *  following with little lag once it moves. */
const SMOOTH_MIN_CUTOFF = 0.45
const SMOOTH_BETA = 1.5
const SMOOTH_D_CUTOFF = 1
/** Start over instead of smoothing across a gap this long. */
const SMOOTH_RESET_MS = 300

type Job = {
  key: string
  handId: number
  fingerIdx: number
  /** The landmark-only pose, in raw camera space. */
  pose: NailPose
  dip: Point
  /** Unit, DIP -> TIP on screen (grid rows). */
  axis: Point
  /** Unit, axis turned +90 degrees (grid columns). */
  across: Point
  /** Expected nail width, px - the grid's unit. */
  nailWidth: number
  /** DIP -> TIP on-screen length, px. */
  segment: number
  /** The hand's HAND_MOTION_LANDMARKS on this frame, px. */
  hand: Point[]
  rows: number
  /** Look for the nail this frame (else only reuse an earlier detection). */
  search: boolean
}

/** A nail's proximal edge as a line on screen (see NailFit.cuticleEdge):
 *  its slope, and its offset from the cuticle - in nail widths in a
 *  Detection, px in a ScreenNail. */
type Edge = { slope: number; offset: number }

/** A nail found in one frame: its cuticle in nail widths from the DIP
 *  landmark, across / along the finger, its direction relative to DIP -> TIP
 *  on screen, and its on-screen width and length (cuticle to free edge) in
 *  nail widths and proximal edge (null if unmeasured). */
type Detection = {
  across: number
  along: number
  rotation: number
  width: number | null
  length: number | null
  edge: Edge | null
}

/** A nail's on-screen pose in raw camera pixels: cuticle, direction
 *  (radians), width, length and proximal edge (null if unmeasured). */
type ScreenNail = {
  x: number
  y: number
  angle: number
  width: number | null
  length: number | null
  edge: Edge | null
}

type Track = {
  /** Where the nail was last seen, and where its hand's landmarks were then. */
  seen: ScreenNail
  hand: Point[]
  /** The same relative to its finger's landmarks. */
  relative: Detection
  accepted: number
  seenAt: number
  /** Detections turned away as outliers since the last accepted one, with
   *  their hands' landmarks. */
  rejected: Array<{ nail: ScreenNail; hand: Point[] }>
  /** Model runs in a row that didn't find this nail since one last did, or
   *  null if the model never has (see MAX_MODEL_MISSES). */
  misses: number | null
}

type Smoothed = {
  x: number
  y: number
  angle: number
  width: number
  length: number | null
  edge: Edge | null
  speed: number
  at: number
}

type Frame = { data: Uint8ClampedArray; width: number; height: number; x: number; y: number; scale: number }

// sRGB 8-bit -> linear, for the Lab conversion.
const SRGB_TO_LINEAR = new Float32Array(256)
for (let i = 0; i < 256; i += 1) {
  const c = i / 255
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function labF(t: number) {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116
}

/** a* - b* + LIGHTNESS_WEIGHT * L* (CIE Lab, D65) of an 8-bit sRGB color. */
function nailness(r: number, g: number, b: number) {
  const R = SRGB_TO_LINEAR[Math.round(r)]
  const G = SRGB_TO_LINEAR[Math.round(g)]
  const B = SRGB_TO_LINEAR[Math.round(b)]
  const fx = labF((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047)
  const fy = labF(0.2126 * R + 0.7152 * G + 0.0722 * B)
  const fz = labF((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883)
  return 500 * (fx - fy) - 200 * (fy - fz) + LIGHTNESS_WEIGHT * (116 * fy - 16)
}

function medianOf(values: number[]) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function wrapAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

function smoothingAlpha(cutoff: number, dt: number) {
  const tau = 1 / (2 * Math.PI * cutoff)
  return 1 / (1 + tau / dt)
}

/**
 * Samples one finger's search window into a grid of nail-ness values. Grid
 * coordinates are continuous, in cells: x across the finger, y along it, cell
 * (i, j) centered at (i + 0.5, j + 0.5), the DIP landmark at
 * (HALF_WIDTH, BEFORE_DIP) * CELLS_PER_NAIL. Cells outside the camera frame
 * are marked invalid.
 */
function sampleGrid(job: Job, frame: Frame, frameWidth: number, frameHeight: number) {
  const cols = GRID_COLS
  const values = new Float32Array(cols * job.rows)
  const valid = new Uint8Array(cols * job.rows)
  const cell = job.nailWidth / CELLS_PER_NAIL
  const { data, width, height, scale } = frame
  const maxX = width - 1.001
  const maxY = height - 1.001

  for (let j = 0; j < job.rows; j += 1) {
    const v = (j + 0.5 - BEFORE_DIP * CELLS_PER_NAIL) * cell
    for (let i = 0; i < cols; i += 1) {
      const u = (i + 0.5 - HALF_WIDTH * CELLS_PER_NAIL) * cell
      const px = job.dip.x + job.across.x * u + job.axis.x * v
      const py = job.dip.y + job.across.y * u + job.axis.y * v
      if (px < 0 || py < 0 || px > frameWidth || py > frameHeight) continue
      const x = Math.min(maxX, Math.max(0, (px - frame.x) * scale - 0.5))
      const y = Math.min(maxY, Math.max(0, (py - frame.y) * scale - 0.5))
      const x0 = Math.floor(x)
      const y0 = Math.floor(y)
      const fx = x - x0
      const fy = y - y0
      const w00 = (1 - fx) * (1 - fy)
      const w10 = fx * (1 - fy)
      const w01 = (1 - fx) * fy
      const w11 = fx * fy
      const i00 = (y0 * width + x0) * 4
      const i10 = i00 + 4
      const i01 = i00 + width * 4
      const i11 = i01 + 4
      values[j * cols + i] = nailness(
        data[i00] * w00 + data[i10] * w10 + data[i01] * w01 + data[i11] * w11,
        data[i00 + 1] * w00 + data[i10 + 1] * w10 + data[i01 + 1] * w01 + data[i11 + 1] * w11,
        data[i00 + 2] * w00 + data[i10 + 2] * w10 + data[i01 + 2] * w01 + data[i11 + 2] * w11,
      )
      valid[j * cols + i] = 1
    }
  }
  return { values, valid }
}

/** Nail-ness relative to the skin over the DIP joint, plus that skin's noise. */
function relativeToSkin(values: Float32Array, valid: Uint8Array, rows: number) {
  const cols = GRID_COLS
  const dipI = Math.round(HALF_WIDTH * CELLS_PER_NAIL)
  const dipJ = Math.round(BEFORE_DIP * CELLS_PER_NAIL)
  const radius = Math.max(1, Math.round(0.3 * CELLS_PER_NAIL))
  const skinSamples: number[] = []
  for (let j = Math.max(0, dipJ - radius); j < Math.min(rows, dipJ + radius); j += 1) {
    for (let i = Math.max(0, dipI - radius); i < Math.min(cols, dipI + radius); i += 1) {
      if (valid[j * cols + i]) skinSamples.push(values[j * cols + i])
    }
  }
  if (skinSamples.length < radius * radius) return null
  const skin = medianOf(skinSamples)
  const noise = 1.4826 * medianOf(skinSamples.map((s) => Math.abs(s - skin)))
  // Cells outside the frame count as skin (neutral).
  const S = new Float32Array(cols * rows)
  for (let k = 0; k < S.length; k += 1) S[k] = valid[k] ? values[k] - skin : 0
  return { S, noise }
}

type Box = { score: number; x: number; y: number; w: number; h: number; inside: number; above: number }

/** The most nail-like box with skin above and beside it; `predicted` is the
 *  tracked cuticle, in grid cells, if any. */
function findNailBox(S: Float32Array, rows: number, noise: number, predicted: Point | null): Box | null {
  const cols = GRID_COLS
  const C = CELLS_PER_NAIL
  const stride = cols + 1
  const integral = new Float64Array(stride * (rows + 1))
  for (let j = 0; j < rows; j += 1) {
    let rowSum = 0
    for (let i = 0; i < cols; i += 1) {
      rowSum += S[j * cols + i]
      integral[(j + 1) * stride + i + 1] = integral[j * stride + i + 1] + rowSum
    }
  }
  const sum = (x0: number, y0: number, x1: number, y1: number) =>
    integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0]

  let best: Box | null = null
  const evaluate = (x: number, y: number, w: number, h: number) => {
    const band = Math.max(2, Math.round(w * ABOVE_BAND))
    const side = Math.max(1, Math.round(w * SIDE_BAND))
    const sideH = Math.max(1, Math.round(h * 0.7))
    if (y < band || y + h > rows || x < side || x + w + side > cols) return
    const inside = sum(x, y, x + w, y + h) / (w * h)
    const above = sum(x, y - band, x + w, y) / (w * band)
    const sides = (sum(x - side, y, x, y + sideH) + sum(x + w, y, x + w + side, y + sideH)) / (2 * side * sideH)
    const lateral = (x + w / 2) / C - HALF_WIDTH
    let score = inside - ABOVE_WEIGHT * above - SIDE_WEIGHT * sides - LATERAL_PENALTY * lateral * lateral
    if (predicted) {
      const dx = (x + w / 2 - predicted.x) / C
      const dy = (y - predicted.y) / C
      score -= TRACKING_PENALTY * (dx * dx + dy * dy)
    }
    if (!best || score > best.score) best = { score, x, y, w, h, inside, above }
  }
  // Coarse pass every other cell, then the best box's neighborhood.
  for (const widthFactor of BOX_WIDTHS) {
    const w = Math.round(C * widthFactor)
    for (const heightFactor of BOX_HEIGHTS) {
      const h = Math.round(w * heightFactor)
      for (let y = 0; y + h <= rows; y += 2) {
        for (let x = 0; x + w <= cols; x += 2) evaluate(x, y, w, h)
      }
    }
  }
  const coarse = best as Box | null
  if (!coarse) return null
  for (let y = coarse.y - 1; y <= coarse.y + 1; y += 1) {
    for (let x = coarse.x - 1; x <= coarse.x + 1; x += 1) evaluate(x, y, coarse.w, coarse.h)
  }
  const box = best as Box | null
  if (!box) return null
  const contrast = box.inside - box.above
  if (contrast < MIN_CONTRAST || contrast < MIN_CONTRAST_TO_NOISE * noise) return null
  return box
}

/** The cuticle row: steepest rise of the box's center band along the finger,
 *  within CUTICLE_SEARCH of the box top. */
function findCuticleRow(S: Float32Array, rows: number, box: Box) {
  const cols = GRID_COLS
  const cx = box.x + box.w / 2
  const c0 = Math.max(0, Math.floor(cx - box.w * 0.25))
  const c1 = Math.min(cols - 1, Math.ceil(cx + box.w * 0.25))
  const profile = new Float32Array(rows)
  for (let j = 0; j < rows; j += 1) {
    let total = 0
    for (let i = c0; i <= c1; i += 1) total += S[j * cols + i]
    profile[j] = total / (c1 - c0 + 1)
  }
  const at = (j: number) => profile[Math.max(0, Math.min(rows - 1, j))]
  const smooth = (j: number) => (at(j - 1) + at(j) + at(j + 1)) / 3
  const slope = (j: number) => (smooth(j + 1) - smooth(j - 1)) / 2
  const span = CUTICLE_SEARCH * CELLS_PER_NAIL
  const lo = Math.max(1, Math.floor(box.y - span))
  const hi = Math.min(rows - 2, Math.ceil(box.y + span))
  let peak = box.y
  let peakSlope = -Infinity
  for (let j = lo; j <= hi; j += 1) {
    const s = slope(j)
    if (s > peakSlope) {
      peakSlope = s
      peak = j
    }
  }
  const s0 = slope(peak - 1)
  const s2 = slope(peak + 1)
  const curvature = s0 - 2 * peakSlope + s2
  const subCell = Math.abs(curvature) > 1e-6 ? Math.max(-0.5, Math.min(0.5, (0.5 * (s0 - s2)) / curvature)) : 0
  // Row j's samples sit at j + 0.5 in the grid's continuous coordinates.
  return peak + subCell + 0.5
}

/** The nail blob's direction: from the cuticle to its nail-like centroid,
 *  radians from the grid's rows toward +x. */
function blobRotation(S: Float32Array, rows: number, box: Box, cuticleRow: number) {
  const cols = GRID_COLS
  const cx = box.x + box.w / 2
  const level = (box.inside + Math.max(box.above, 0)) / 2
  let mass = 0
  let mx = 0
  let my = 0
  const rowEnd = Math.min(rows, Math.ceil(cuticleRow + box.h * 1.3))
  const colStart = Math.max(0, Math.floor(cx - box.w * 0.75))
  const colEnd = Math.min(cols - 1, Math.ceil(cx + box.w * 0.75))
  for (let j = Math.max(0, Math.floor(cuticleRow)); j < rowEnd; j += 1) {
    for (let i = colStart; i <= colEnd; i += 1) {
      const weight = S[j * cols + i] - level
      if (weight <= 0) continue
      mass += weight
      mx += weight * (i + 0.5)
      my += weight * (j + 0.5)
    }
  }
  if (mass <= 0) return 0
  const raw = Math.atan2(mx / mass - cx, my / mass - cuticleRow)
  return Math.max(-MAX_ROTATION, Math.min(MAX_ROTATION, raw))
}

/** Finds the nail in one finger's sampled grid; `predicted` is its track. */
function detectNail(values: Float32Array, valid: Uint8Array, rows: number, predicted: Detection | null): Detection | null {
  const C = CELLS_PER_NAIL
  const skinRelative = relativeToSkin(values, valid, rows)
  if (!skinRelative) return null
  const { S, noise } = skinRelative
  const predictedCells = predicted
    ? { x: (predicted.across + HALF_WIDTH) * C, y: (predicted.along + BEFORE_DIP) * C }
    : null
  const box = findNailBox(S, rows, noise, predictedCells)
  if (!box) return null
  const cuticleRow = findCuticleRow(S, rows, box)
  return {
    across: (box.x + box.w / 2) / C - HALF_WIDTH,
    along: cuticleRow / C - BEFORE_DIP,
    rotation: ROTATION_BLEND * blobRotation(S, rows, box, cuticleRow),
    width: null,
    length: null,
    edge: null,
  }
}

function percentile(sorted: Float64Array, q: number) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]
}

/** A segmented nail's cuticle, direction, width and length, in `job`'s
 *  frame. */
function measureMask(mask: NailMask, job: Job): Detection | null {
  const xs: number[] = []
  const ys: number[] = []
  for (let j = 0; j < mask.rows; j += 1) {
    for (let i = 0; i < mask.cols; i += 1) {
      if (mask.probs[j * mask.cols + i] < MASK_THRESHOLD) continue
      xs.push(mask.originX + (i + 0.5) * mask.cell)
      ys.push(mask.originY + (j + 0.5) * mask.cell)
    }
  }
  const n = xs.length
  if (n < MIN_MASK_CELLS) return null
  let cx = 0
  let cy = 0
  for (let k = 0; k < n; k += 1) {
    cx += xs[k]
    cy += ys[k]
  }
  cx /= n
  cy /= n

  // Spread across a direction: the 2nd-98th percentile band of the cells'
  // offsets from the centroid - from every `stride`th cell while trying
  // directions, from all of them for the final measurement.
  const spread = (dx: number, dy: number, stride = 1) => {
    const offsets = new Float64Array(Math.ceil(n / stride))
    for (let k = 0; k < offsets.length; k += 1) {
      offsets[k] = (xs[k * stride] - cx) * dx + (ys[k * stride] - cy) * dy
    }
    offsets.sort()
    return { lo: percentile(offsets, 0.02), hi: percentile(offsets, 0.98) }
  }
  const searchStride = Math.max(1, Math.floor(n / MASK_SEARCH_SAMPLES))
  let bestTilt = 0
  let bestCost = Infinity
  for (let tilt = -MAX_MASK_TILT; tilt <= MAX_MASK_TILT + 1e-9; tilt += MASK_TILT_STEP) {
    const c = Math.cos(tilt)
    const s = Math.sin(tilt)
    const ax = job.axis.x * c - job.axis.y * s
    const ay = job.axis.x * s + job.axis.y * c
    const { lo, hi } = spread(-ay, ax, searchStride)
    const cost = (hi - lo) * (1 + MASK_TILT_PRIOR * tilt * tilt)
    if (cost < bestCost) {
      bestCost = cost
      bestTilt = tilt
    }
  }
  const c = Math.cos(bestTilt)
  const s = Math.sin(bestTilt)
  const axis = { x: job.axis.x * c - job.axis.y * s, y: job.axis.x * s + job.axis.y * c }
  const across = { x: -axis.y, y: axis.x }
  const sideways = spread(across.x, across.y)
  const width = sideways.hi - sideways.lo + mask.cell
  const center = (sideways.hi + sideways.lo) / 2

  // Cuticle: where the mask starts along the nail, on its center line; the
  // free edge, where it ends.
  let proximal = Infinity
  let distal = -Infinity
  for (let k = 0; k < n; k += 1) {
    const dx = xs[k] - cx
    const dy = ys[k] - cy
    if (Math.abs(dx * across.x + dy * across.y - center) > 0.25 * width) continue
    const along = dx * axis.x + dy * axis.y
    proximal = Math.min(proximal, along)
    distal = Math.max(distal, along)
  }
  if (!Number.isFinite(proximal)) return null
  proximal -= mask.cell / 2
  distal += mask.cell / 2
  const cuticleX = cx + across.x * center + axis.x * proximal - job.dip.x
  const cuticleY = cy + across.y * center + axis.y * proximal - job.dip.y
  const edge = measureEdge(xs, ys, cx, cy, axis, across, center, width)
  return {
    across: (cuticleX * job.across.x + cuticleY * job.across.y) / job.nailWidth,
    along: (cuticleX * job.axis.x + cuticleY * job.axis.y) / job.nailWidth,
    rotation: bestTilt,
    width: width / job.nailWidth,
    length: (distal - proximal) / job.nailWidth,
    edge: edge && { slope: edge.slope, offset: (edge.offset - mask.cell / 2 - proximal) / job.nailWidth },
  }
}

/**
 * A mask's proximal edge (see EDGE_BINS): fitted to the proximal-most cell
 * of each bin, then lowered until none is before it, so it never cuts into
 * the nail. Straight across a nail facing the camera; seen from the side, as
 * the thumbnail is with the back of the hand to the camera, it slants
 * steeply - the cuticle curves around the nail and only one side shows.
 * Offset along `axis` from the centroid, at `center` across; null if too
 * few bins have cells.
 */
function measureEdge(
  xs: number[],
  ys: number[],
  cx: number,
  cy: number,
  axis: Point,
  across: Point,
  center: number,
  width: number,
): Edge | null {
  const first = new Array<number>(EDGE_BINS).fill(Infinity)
  const at = new Array<number>(EDGE_BINS).fill(0)
  for (let k = 0; k < xs.length; k += 1) {
    const dx = xs[k] - cx
    const dy = ys[k] - cy
    const sideways = dx * across.x + dy * across.y - center
    const bin = Math.floor((sideways / (EDGE_SPAN * width) + 0.5) * EDGE_BINS)
    if (bin < 0 || bin >= EDGE_BINS) continue
    const along = dx * axis.x + dy * axis.y
    if (along < first[bin]) {
      first[bin] = along
      at[bin] = sideways
    }
  }
  const bins = first.flatMap((along, bin) => (Number.isFinite(along) ? [{ along, sideways: at[bin] }] : []))
  if (bins.length < 3) return null
  const meanSideways = bins.reduce((total, b) => total + b.sideways, 0) / bins.length
  const meanAlong = bins.reduce((total, b) => total + b.along, 0) / bins.length
  let covariance = 0
  let variance = 0
  for (const b of bins) {
    covariance += (b.sideways - meanSideways) * (b.along - meanAlong)
    variance += (b.sideways - meanSideways) ** 2
  }
  if (!(variance > 0)) return null
  const slope = Math.max(-MAX_EDGE_SLOPE, Math.min(MAX_EDGE_SLOPE, covariance / variance))
  return { slope, offset: Math.min(...bins.map((b) => b.along - slope * b.sideways)) }
}

/** Matches one hand's masks to its fingers (each mask to at most one). */
function matchMasks(masks: NailMask[], jobs: Job[]) {
  const centroids = masks.map((mask) => {
    let x = 0
    let y = 0
    let count = 0
    for (let j = 0; j < mask.rows; j += 1) {
      for (let i = 0; i < mask.cols; i += 1) {
        if (mask.probs[j * mask.cols + i] < MASK_THRESHOLD) continue
        x += mask.originX + (i + 0.5) * mask.cell
        y += mask.originY + (j + 0.5) * mask.cell
        count += 1
      }
    }
    return count ? { x: x / count, y: y / count } : null
  })
  const pairs: Array<{ distance: number; job: Job; mask: NailMask; index: number }> = []
  for (const job of jobs) {
    // Zone along DIP->TIP where this finger's nail can be: just past DIP to
    // well past TIP (the claw puts it there).
    const zoneEnd = job.segment / job.nailWidth + 1.4
    centroids.forEach((centroid, index) => {
      if (!centroid) return
      const dx = centroid.x - job.dip.x
      const dy = centroid.y - job.dip.y
      const along = (dx * job.axis.x + dy * job.axis.y) / job.nailWidth
      const lateral = Math.abs(dx * job.across.x + dy * job.across.y) / job.nailWidth
      const distance = Math.max(0, 0.3 - along, along - zoneEnd) + lateral
      if (distance < MASK_MATCH_DISTANCE) pairs.push({ distance, job, mask: masks[index], index })
    })
  }
  pairs.sort((a, b) => a.distance - b.distance)
  const usedJobs = new Set<Job>()
  const usedMasks = new Set<number>()
  const matched: Array<{ job: Job; mask: NailMask }> = []
  for (const pair of pairs) {
    if (usedJobs.has(pair.job) || usedMasks.has(pair.index)) continue
    usedJobs.add(pair.job)
    usedMasks.add(pair.index)
    matched.push(pair)
  }
  return matched
}

/** How nails are being found: by the segmentation model, on the GPU or the
 *  CPU, or by color - while the model is still loading (the first time, its
 *  runtime alone is a 27 MB download), or for good if it failed. */
export type NailDetector = 'loading' | SegmenterBackend | 'failed'

/**
 * Per-frame image-based nail placement (see the top of this file). Feed it
 * the raw (unmirrored) camera frame and the tracked hands; it returns, per
 * hand id, a NailFit for each visible finger in FINGERS order, ready for
 * computeNailPoses.
 */
export class NailFitter {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private tracks = new Map<string, Track>()
  private smoothed = new Map<string, Smoothed>()
  private segmenter = new NailSegmenter()
  private model: NailDetector = 'loading'
  private segmenting = false

  constructor() {
    preloadNailSegmenter().then(
      (backend) => {
        this.model = backend
      },
      (error: unknown) => {
        this.model = 'failed'
        console.error('손톱 분할 모델 로드 실패, 색 기반 탐지로 대체:', error)
      },
    )
  }

  update(
    source: CanvasImageSource,
    hands: TrackedHand[],
    width: number,
    height: number,
    now: number,
  ): Map<number, Array<NailFit | null>> {
    const jobs = this.planJobs(hands, width, height)
    const searches = jobs.filter((job) => job.search)
    if (this.model === 'webgpu' || this.model === 'wasm') {
      if (!this.segmenting && searches.length > 0) this.segment(source, searches, width, height, now)
    } else {
      const frame = searches.length > 0 ? this.readFrame(source, searches, width, height) : null
      if (frame) {
        for (const job of searches) {
          const { values, valid } = sampleGrid(job, frame, width, height)
          const track = this.liveTrack(job.key, now)
          const found = detectNail(values, valid, job.rows, track ? toRelative(job, holdTrack(track, job).nail) : null)
          if (found) this.record(job, found, now, false)
        }
      }
    }
    return this.output(jobs, now)
  }

  /** How nails are being found right now (see NailDetector). */
  get detector(): NailDetector {
    return this.model
  }

  reset() {
    this.tracks.clear()
    this.smoothed.clear()
  }

  private liveTrack(key: string, now: number) {
    const track = this.tracks.get(key)
    return track && now - track.seenAt <= TRACK_HOLD_MS ? track : null
  }

  /**
   * Segments the searched nails off the current frame in the background; the
   * masks land in the tracks when the model is done, a few frames later, in
   * the landmark frames of the frame they came from.
   */
  private segment(source: CanvasImageSource, jobs: Job[], width: number, height: number, now: number) {
    const byHand = new Map<number, Job[]>()
    for (const job of jobs) byHand.set(job.handId, [...(byHand.get(job.handId) ?? []), job])
    const hands = [...byHand.values()]
    const regions = hands.map((handJobs) => fingertipRegion(handJobs, width, height))
    this.segmenting = true
    this.segmenter
      .segment(source, regions)
      .then((results) => {
        const foundKeys = new Set<string>()
        results.forEach((masks, index) => {
          for (const { job, mask } of matchMasks(masks, hands[index])) {
            const found = measureMask(mask, job)
            if (!found) continue
            this.record(job, found, now, true)
            foundKeys.add(job.key)
          }
        })
        for (const job of jobs) {
          const track = this.tracks.get(job.key)
          if (track && track.misses !== null && !foundKeys.has(job.key)) track.misses += 1
        }
      })
      .catch((error: unknown) => {
        this.model = 'failed'
        console.error('손톱 분할 실패, 색 기반 탐지로 대체:', error)
      })
      .finally(() => {
        this.segmenting = false
      })
  }

  /** A nail just found - or found somewhere new - snaps there: the output
   *  smoothing is for holding it steady afterwards, not for gliding over from
   *  wherever the landmarks had put it. */
  private startTrack(job: Job, seen: ScreenNail, relative: Detection, now: number, trusted: boolean) {
    this.tracks.set(job.key, {
      seen,
      hand: job.hand,
      relative,
      accepted: 1,
      seenAt: now,
      rejected: [],
      misses: trusted ? 0 : null,
    })
    this.smoothed.delete(job.key)
  }

  /** `trusted`: a model mask, good for the center line and angle in any
   *  pose; otherwise a color detection (see the top of this file). `job` is
   *  the frame the detection came from. */
  private record(job: Job, raw: Detection, now: number, trusted: boolean) {
    // With the back of the hand to the camera the landmarks hold the center
    // line and angle of a color detection.
    const found =
      trusted || job.pose.palmTowardCamera
        ? raw
        : {
            across: Math.sign(raw.across) * Math.max(0, Math.abs(raw.across) - BACK_LATERAL_SLACK),
            along: raw.along,
            rotation: 0,
            width: raw.width,
            length: raw.length,
            edge: raw.edge,
          }
    const seen = toScreen(job, found)
    const track = this.liveTrack(job.key, now)
    if (!track) {
      this.startTrack(job, seen, found, now, trusted)
      return
    }
    // The model found the nail, so it's in view - even if this detection
    // turns out to be an outlier.
    if (trusted) track.misses = 0

    // The track as it should look in this detection's frame, and how sure
    // that is (in nail widths).
    const { nail: held, uncertainty } = holdTrack(track, job)
    const doubt = uncertainty / job.nailWidth
    const jump = Math.hypot(seen.x - held.x, seen.y - held.y) / job.nailWidth
    const turn = Math.abs(wrapAngle(seen.angle - held.angle))
    const resize = seen.width !== null && held.width !== null ? Math.abs(seen.width / held.width - 1) : 0
    if (
      track.accepted >= SETTLED_AFTER &&
      (jump > OUTLIER_POSITION + HOLD_SLACK * doubt ||
        turn > OUTLIER_ROTATION + HOLD_SLACK * doubt ||
        resize > OUTLIER_WIDTH)
    ) {
      // An outlier - unless it keeps happening the same way (compared with
      // the hand's motion since taken out).
      const last = track.rejected[track.rejected.length - 1]
      const lastNow = last ? applyMotion(handMotion(last.hand, job.hand).motion, last.nail) : null
      const consistent =
        !lastNow || Math.hypot(seen.x - lastNow.x, seen.y - lastNow.y) / job.nailWidth <= OUTLIER_POSITION / 2
      const rejected = { nail: seen, hand: job.hand }
      track.rejected = consistent ? [...track.rejected, rejected] : [rejected]
      if (track.rejected.length >= OUTLIER_CONFIRM) this.startTrack(job, seen, found, now, trusted)
      return
    }

    // A detection pulls the track as far as the held pose is in doubt
    // compared with the detection's own scatter - all the way while the
    // landmarks are in disarray, by the usual gains once they agree.
    const trust = (doubt * doubt) / (doubt * doubt + DETECTION_SCATTER * DETECTION_SCATTER)
    const positionGain = Math.max(POSITION_GAIN, trust)
    const rotationGain = Math.max(ROTATION_GAIN, trust)
    track.rejected = []
    track.seen = {
      x: held.x + positionGain * (seen.x - held.x),
      y: held.y + positionGain * (seen.y - held.y),
      angle: held.angle + rotationGain * wrapAngle(seen.angle - held.angle),
      width: blendSize(held.width, seen.width),
      length: blendSize(held.length, seen.length),
      edge: blendEdge(held.edge, seen.edge),
    }
    track.hand = job.hand
    const relative = track.relative
    relative.across += positionGain * (found.across - relative.across)
    relative.along += positionGain * (found.along - relative.along)
    relative.rotation += rotationGain * (found.rotation - relative.rotation)
    relative.width = blendSize(relative.width, found.width)
    relative.length = blendSize(relative.length, found.length)
    relative.edge = blendEdge(relative.edge, found.edge)
    track.accepted += 1
    track.seenAt = Math.max(track.seenAt, now)
  }

  private output(jobs: Job[], now: number) {
    // Where each tracked nail is on this frame.
    const placed = new Map<Job, ScreenNail>()
    for (const job of jobs) {
      const track = this.liveTrack(job.key, now)
      if (!track) continue
      placed.set(job, now - track.seenAt <= TRACK_FRESH_MS ? holdTrack(track, job).nail : toScreen(job, track.relative))
    }

    // A finger whose nail wasn't found borrows how far the found ones sat
    // from where the landmarks put them: in the claw pose the landmarks slide
    // the same way on every finger. The thumb's landmarks behave differently,
    // so it neither lends nor borrows.
    const lent = new Map<number, number[]>()
    for (const [job, nail] of placed) {
      if (FINGERS[job.fingerIdx].name === 'thumb') continue
      const shift =
        ((nail.x - job.pose.origin.x) * job.axis.x + (nail.y - job.pose.origin.y) * job.axis.y) / job.nailWidth
      lent.set(job.handId, [...(lent.get(job.handId) ?? []), shift])
    }

    const fits = new Map<number, Array<NailFit | null>>()
    for (const job of jobs) {
      const landmarkAngle = Math.atan2(job.axis.y, job.axis.x)
      const roll = Math.max(MIN_ROLL_FORESHORTENING, Math.hypot(job.pose.across.x, job.pose.across.y))
      const priorWidth = job.nailWidth * roll * NAIL_COVER
      let target = placed.get(job)
      if (!target) {
        const shifts = lent.get(job.handId)
        const borrowed =
          shifts && shifts.length >= MIN_LENDERS && FINGERS[job.fingerIdx].name !== 'thumb' ? medianOf(shifts) : 0
        target = {
          x: job.pose.origin.x + job.axis.x * borrowed * job.nailWidth,
          y: job.pose.origin.y + job.axis.y * borrowed * job.nailWidth,
          angle: landmarkAngle,
          width: null,
          length: null,
          edge: null,
        }
      }
      const smoothed = this.smooth(
        job.key,
        { ...target, width: target.width !== null ? target.width * MASK_COVER : priorWidth },
        job.nailWidth,
        now,
      )

      let handFits = fits.get(job.handId)
      if (!handFits) {
        handFits = FINGERS.map(() => null)
        fits.set(job.handId, handFits)
      }
      const track = this.liveTrack(job.key, now)
      handFits[job.fingerIdx] = {
        cuticle: { x: smoothed.x, y: smoothed.y },
        rotation: wrapAngle(smoothed.angle - landmarkAngle),
        width: smoothed.width,
        ...(smoothed.length !== null && { length: smoothed.length }),
        ...(smoothed.edge !== null && { cuticleEdge: smoothed.edge }),
        seen: !!track && track.misses !== null && track.misses <= MAX_MODEL_MISSES,
      }
    }

    for (const [key, track] of this.tracks) {
      if (now - track.seenAt > TRACK_HOLD_MS) this.tracks.delete(key)
    }
    for (const [key, state] of this.smoothed) {
      if (now - state.at > SMOOTH_RESET_MS) this.smoothed.delete(key)
    }
    return fits
  }

  private smooth(key: string, target: Omit<Smoothed, 'speed' | 'at'>, unit: number, now: number): Smoothed {
    const previous = this.smoothed.get(key)
    let next: Smoothed
    if (!previous || now - previous.at > SMOOTH_RESET_MS) {
      next = { ...target, speed: 0, at: now }
    } else {
      const dt = Math.max(1 / 120, (now - previous.at) / 1000)
      const rawSpeed = Math.hypot(target.x - previous.x, target.y - previous.y) / unit / dt
      const speed = previous.speed + smoothingAlpha(SMOOTH_D_CUTOFF, dt) * (rawSpeed - previous.speed)
      const a = smoothingAlpha(SMOOTH_MIN_CUTOFF + SMOOTH_BETA * speed, dt)
      next = {
        x: previous.x + a * (target.x - previous.x),
        y: previous.y + a * (target.y - previous.y),
        angle: previous.angle + a * wrapAngle(target.angle - previous.angle),
        width: previous.width + a * (target.width - previous.width),
        length:
          previous.length === null || target.length === null
            ? target.length
            : previous.length + a * (target.length - previous.length),
        edge:
          previous.edge === null || target.edge === null
            ? target.edge
            : {
                slope: previous.edge.slope + a * (target.edge.slope - previous.edge.slope),
                offset: previous.edge.offset + a * (target.edge.offset - previous.edge.offset),
              },
        speed,
        at: now,
      }
    }
    this.smoothed.set(key, next)
    return next
  }

  private planJobs(hands: TrackedHand[], width: number, height: number): Job[] {
    const jobs: Job[] = []
    // The landmarks' guess at which nails face away is wrong often enough
    // with the fingers curled (it hid nails in plain view) that, once the
    // model is looking, every finger is looked for - a nail shows if found.
    const modelReady = this.model === 'webgpu' || this.model === 'wasm'
    for (const hand of hands.slice(0, MAX_HANDS)) {
      if (hand.landmarks.length < 21) continue
      const handPoints = HAND_MOTION_LANDMARKS.map((index) => ({
        x: hand.landmarks[index].x * width,
        y: hand.landmarks[index].y * height,
      }))
      for (const pose of computeNailPoses(hand, width, height, false)) {
        // Nails turned too far away to search still fade out where they were
        // last found, rather than jumping back to the landmark estimate.
        if (pose.facing <= 0 && !modelReady) continue
        const dipLm = hand.landmarks[pose.finger.dip]
        const tipLm = hand.landmarks[pose.finger.tip]
        const dip = { x: dipLm.x * width, y: dipLm.y * height }
        const dx = tipLm.x * width - dip.x
        const dy = tipLm.y * height - dip.y
        const segment = Math.hypot(dx, dy)
        if (segment < 1) continue
        const axis = { x: dx / segment, y: dy / segment }
        const reach = BEFORE_DIP + Math.min(segment / pose.width, MAX_SEGMENT) + PAST_TIP
        const fingerIdx = FINGERS.indexOf(pose.finger)
        jobs.push({
          key: `${hand.id}:${fingerIdx}`,
          handId: hand.id,
          fingerIdx,
          pose,
          dip,
          axis,
          across: { x: -axis.y, y: axis.x },
          nailWidth: pose.width,
          segment,
          hand: handPoints,
          rows: Math.min(GRID_MAX_ROWS, Math.round(reach * CELLS_PER_NAIL)),
          search: (modelReady || pose.facing >= MIN_FACING) && pose.width >= MIN_NAIL_PX,
        })
      }
    }
    return jobs
  }

  /** Reads the part of the frame all search windows cover, once, at just
   *  enough resolution for the finest grid. */
  private readFrame(source: CanvasImageSource, jobs: Job[], width: number, height: number): Frame | null {
    if (!this.canvas) {
      this.canvas = document.createElement('canvas')
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })
    }
    const ctx = this.ctx
    if (!ctx) return null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let finestCell = Infinity
    for (const job of jobs) {
      const cell = job.nailWidth / CELLS_PER_NAIL
      finestCell = Math.min(finestCell, cell)
      const u0 = -HALF_WIDTH * job.nailWidth
      const u1 = u0 + GRID_COLS * cell
      const v0 = -BEFORE_DIP * job.nailWidth
      const v1 = v0 + job.rows * cell
      for (const u of [u0, u1]) {
        for (const v of [v0, v1]) {
          const x = job.dip.x + job.across.x * u + job.axis.x * v
          const y = job.dip.y + job.across.y * u + job.axis.y * v
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
        }
      }
    }
    const x0 = Math.max(0, Math.floor(minX))
    const y0 = Math.max(0, Math.floor(minY))
    const x1 = Math.min(width, Math.ceil(maxX))
    const y1 = Math.min(height, Math.ceil(maxY))
    if (x1 - x0 < 2 || y1 - y0 < 2) return null

    const scale = Math.min(1, PX_PER_CELL / finestCell)
    const w = Math.max(2, Math.ceil((x1 - x0) * scale))
    const h = Math.max(2, Math.ceil((y1 - y0) * scale))
    if (this.canvas.width < w) this.canvas.width = w
    if (this.canvas.height < h) this.canvas.height = h
    ctx.clearRect(0, 0, w, h)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'medium'
    ctx.drawImage(source, x0, y0, x1 - x0, y1 - y0, 0, 0, (x1 - x0) * scale, (y1 - y0) * scale)
    try {
      const data = ctx.getImageData(0, 0, w, h).data
      return { data, width: w, height: h, x: x0, y: y0, scale }
    } catch {
      return null
    }
  }
}

/** A square region around one hand's fingertips (their search windows). */
function fingertipRegion(jobs: Job[], width: number, height: number): CropRegion {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const job of jobs) {
    const reach = job.segment + 0.8 * job.nailWidth
    for (const [along, across] of [
      [0, 0],
      [reach, -job.nailWidth],
      [reach, job.nailWidth],
      [job.segment + PAST_TIP * job.nailWidth, 0],
    ]) {
      const x = job.dip.x + job.axis.x * along + job.across.x * across
      const y = job.dip.y + job.axis.y * along + job.across.y * across
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  const size = Math.min(Math.max(width, height), Math.max(maxX - minX, maxY - minY) * CROP_MARGIN)
  return { x: (minX + maxX) / 2 - size / 2, y: (minY + maxY) / 2 - size / 2, size }
}

/** A detection in `job`'s landmark frame, on screen. */
function toScreen(job: Job, nail: Detection): ScreenNail {
  const along = nail.along * job.nailWidth
  const across = nail.across * job.nailWidth
  return {
    x: job.dip.x + job.axis.x * along + job.across.x * across,
    y: job.dip.y + job.axis.y * along + job.across.y * across,
    angle: Math.atan2(job.axis.y, job.axis.x) + nail.rotation,
    width: nail.width === null ? null : nail.width * job.nailWidth,
    length: nail.length === null ? null : nail.length * job.nailWidth,
    edge: nail.edge && { slope: nail.edge.slope, offset: nail.edge.offset * job.nailWidth },
  }
}

/** An on-screen nail in `job`'s landmark frame. */
function toRelative(job: Job, nail: ScreenNail): Detection {
  const dx = nail.x - job.dip.x
  const dy = nail.y - job.dip.y
  return {
    across: (dx * job.across.x + dy * job.across.y) / job.nailWidth,
    along: (dx * job.axis.x + dy * job.axis.y) / job.nailWidth,
    rotation: wrapAngle(nail.angle - Math.atan2(job.axis.y, job.axis.x)),
    width: nail.width === null ? null : nail.width / job.nailWidth,
    length: nail.length === null ? null : nail.length / job.nailWidth,
    edge: nail.edge && { slope: nail.edge.slope, offset: nail.edge.offset / job.nailWidth },
  }
}

/** A tracked size (width or length) moved toward a new measurement, either
 *  of which may be missing. */
function blendSize(held: number | null, seen: number | null) {
  if (seen === null) return held
  if (held === null) return seen
  return held + WIDTH_GAIN * (seen - held)
}

/** A tracked proximal edge moved toward a new measurement, likewise. */
function blendEdge(held: Edge | null, seen: Edge | null): Edge | null {
  if (seen === null) return held
  if (held === null) return seen
  return {
    slope: held.slope + WIDTH_GAIN * (seen.slope - held.slope),
    offset: held.offset + WIDTH_GAIN * (seen.offset - held.offset),
  }
}

type HandMotion = { cos: number; sin: number; scale: number; from: Point; to: Point }

/**
 * How a hand moved between two frames' landmarks: the shift, turn and zoom
 * most of them agree on. Each pass refits with the landmarks that moved
 * differently from that consensus down-weighted (Cauchy weights on the
 * residual, relative to the median residual). Also returns each landmark's
 * residual (px) from that consensus.
 */
function handMotion(from: Point[], to: Point[]): { motion: HandMotion; residuals: number[] } {
  const n = Math.min(from.length, to.length)
  let weights = new Array<number>(n).fill(1)
  let motion: HandMotion = { cos: 1, sin: 0, scale: 1, from: { x: 0, y: 0 }, to: { x: 0, y: 0 } }
  let residuals = new Array<number>(n).fill(0)
  for (let pass = 0; pass < HAND_FIT_PASSES; pass += 1) {
    let total = 0
    const fromCenter = { x: 0, y: 0 }
    const toCenter = { x: 0, y: 0 }
    for (let i = 0; i < n; i += 1) {
      total += weights[i]
      fromCenter.x += weights[i] * from[i].x
      fromCenter.y += weights[i] * from[i].y
      toCenter.x += weights[i] * to[i].x
      toCenter.y += weights[i] * to[i].y
    }
    if (!(total > 0)) break
    fromCenter.x /= total
    fromCenter.y /= total
    toCenter.x /= total
    toCenter.y /= total
    let dotSum = 0
    let crossSum = 0
    let spread = 0
    for (let i = 0; i < n; i += 1) {
      const ax = from[i].x - fromCenter.x
      const ay = from[i].y - fromCenter.y
      const bx = to[i].x - toCenter.x
      const by = to[i].y - toCenter.y
      dotSum += weights[i] * (ax * bx + ay * by)
      crossSum += weights[i] * (ax * by - ay * bx)
      spread += weights[i] * (ax * ax + ay * ay)
    }
    if (!(spread > 0)) break
    const turn = Math.atan2(crossSum, dotSum)
    motion = {
      cos: Math.cos(turn),
      sin: Math.sin(turn),
      scale: Math.min(HAND_FIT_MAX_ZOOM, Math.max(1 / HAND_FIT_MAX_ZOOM, Math.hypot(dotSum, crossSum) / spread)),
      from: fromCenter,
      to: toCenter,
    }
    residuals = from.slice(0, n).map((p, i) => {
      const moved = applyMotion(motion, p)
      return Math.hypot(moved.x - to[i].x, moved.y - to[i].y)
    })
    const tolerance = Math.max(HAND_FIT_MIN_TOLERANCE * Math.sqrt(spread / total), 1.4826 * medianOf(residuals)) * HAND_FIT_TOLERANCE
    weights = residuals.map((r) => 1 / (1 + (r / tolerance) ** 2))
  }
  return { motion, residuals }
}

function applyMotion(motion: HandMotion, p: Point): Point {
  const dx = p.x - motion.from.x
  const dy = p.y - motion.from.y
  return {
    x: motion.to.x + motion.scale * (dx * motion.cos - dy * motion.sin),
    y: motion.to.y + motion.scale * (dx * motion.sin + dy * motion.cos),
  }
}

/**
 * Where a track's last sighting is on `job`'s frame, its hand having moved
 * since - and how uncertain that is (px): how far the landmarks strayed from
 * the hand's consensus motion, overall or on this finger's own DIP and TIP.
 */
function holdTrack(track: Track, job: Job): { nail: ScreenNail; uncertainty: number } {
  const { motion, residuals } = handMotion(track.hand, job.hand)
  const finger = FINGERS[job.fingerIdx]
  const own = [finger.dip, finger.tip].map((landmark) => residuals[HAND_MOTION_LANDMARKS.indexOf(landmark)] ?? 0)
  return {
    nail: {
      ...applyMotion(motion, track.seen),
      angle: track.seen.angle + Math.atan2(motion.sin, motion.cos),
      width: track.seen.width === null ? null : track.seen.width * motion.scale,
      length: track.seen.length === null ? null : track.seen.length * motion.scale,
      edge: track.seen.edge && { slope: track.seen.edge.slope, offset: track.seen.edge.offset * motion.scale },
    },
    uncertainty: Math.max(1.4826 * medianOf(residuals), Math.hypot(own[0], own[1]) / Math.SQRT2),
  }
}
