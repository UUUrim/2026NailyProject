import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

export type Point = { x: number; y: number }

export type FingerConfig = {
  tip: number
  dip: number
  // Per-finger width calibration - multiplies the widthGaps-based measurement
  // below. Thumb and index need a noticeably smaller factor than the other
  // three: their widthGaps includes landmark pair [2,5] (thumb MCP to index
  // MCP), which spans diagonally across the palm since the thumb sits off to
  // the side of the hand, not in the same row as the other knuckles - so it
  // reads much wider than an in-row gap like [5,9]/[9,13]/[13,17] and, since
  // width now also drives length (see computeFingerPlacement), inflates the
  // whole nail rather than just its width. Tuned by eye, not measured.
  scale: number
  nailIndex: number
  // Pairs of landmark indices that bracket this finger at the knuckle row.
  // The distance between each pair is a live, per-frame measurement of how
  // wide the hand actually is in view right now (scales with hand size and
  // distance from the camera), used to size the nail instead of guessing a
  // width from the tip-to-dip length alone.
  widthGaps: Array<[number, number]>
}

export const FINGERS: FingerConfig[] = [
  { tip: 4, dip: 3, scale: 0.65, nailIndex: 0, widthGaps: [[2, 5]] },
  { tip: 8, dip: 7, scale: 0.85, nailIndex: 1, widthGaps: [[2, 5], [5, 9]] },
  { tip: 12, dip: 11, scale: 1, nailIndex: 2, widthGaps: [[5, 9], [9, 13]] },
  { tip: 16, dip: 15, scale: 0.96, nailIndex: 3, widthGaps: [[9, 13], [13, 17]] },
  { tip: 20, dip: 19, scale: 0.9, nailIndex: 4, widthGaps: [[13, 17]] },
]

// The visible cuticle line usually sits a little further toward the
// fingertip than the DIP/IP joint landmark itself (the joint crease is
// inside the finger; the cuticle is on the skin just past it) - nudge the
// anchor that far up the tip-to-dip segment so the design doesn't render
// starting too low. Tuned by eye.
const CUTICLE_ANCHOR_OFFSET = 0.6

// Knuckle-row spacing is inter-finger distance, not the finger's own
// diameter, so it needs converting down to a nail-width scale. Tuned by eye.
export const WIDTH_TO_NAIL_RATIO = 0.62

export function toPixel(landmark: NormalizedLandmark, width: number, height: number, mirror: boolean): Point {
  const x = mirror ? (1 - landmark.x) * width : landmark.x * width
  const y = landmark.y * height
  return { x, y }
}

export function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export type FingerPlacement = {
  /** Cuticle-line anchor (the DIP/IP joint landmark, nudged toward the tip
   *  by CUTICLE_ANCHOR_OFFSET) - the real nail's base, where the rendered
   *  design's own base edge should start. */
  baseX: number
  baseY: number
  /** Unit vector from cuticle toward fingertip, in screen pixels. */
  dirX: number
  dirY: number
  /** radians; rotates a shape whose local +Y axis is "toward the fingertip"
   *  (atan2(dirY,dirX) - PI/2) so it lines up with dirX/dirY on screen. */
  angle: number
  /** Real, per-frame measured nail width (screen pixels) - the single
   *  source of truth for sizing. Renderers derive length from this via the
   *  design's own aspect ratio so it's scaled, never stretched. */
  width: number
  /** -1..1, roughly how far the finger is tilted away from the camera plane
   *  (positive = tip side is farther away than the dip side). */
  tilt: number
}

/**
 * Where to place a shape's geometric center given it's anchored at the
 * cuticle (`placement.baseX/baseY`) and rendered `renderLength` long (screen
 * pixels) along the finger. Both the 2D canvas quad and the 3D mesh put
 * their own local origin at the shape's center and its cuticle edge at
 * -renderLength/2 from that center, so this same offset applies to both.
 */
export function anchorCenter(placement: FingerPlacement, renderLength: number): Point {
  return {
    x: placement.baseX + placement.dirX * renderLength * 0.5,
    y: placement.baseY + placement.dirY * renderLength * 0.5,
  }
}

/**
 * Estimates a finger's on-screen nail placement (cuticle anchor, direction,
 * angle, width, tilt) from the current frame's hand landmarks. Shared by the
 * 2D canvas-warp renderer and the 3D mesh renderer so both stay consistent.
 *
 * `fallbackWidthFromSegment` is used when the width-estimation landmarks are
 * missing for some reason - it receives the raw tip-to-dip pixel distance so
 * the caller can derive a sane fallback (e.g. from a design image's own
 * aspect ratio, or a template mesh's natural aspect ratio).
 */
export function computeFingerPlacement(
  landmarks: NormalizedLandmark[],
  finger: FingerConfig,
  width: number,
  height: number,
  mirror: boolean,
  fallbackWidthFromSegment: (segment: number) => number,
): FingerPlacement | null {
  const tip = landmarks[finger.tip]
  const dip = landmarks[finger.dip]
  if (!tip || !dip) return null

  const tipPx = toPixel(tip, width, height, mirror)
  const dipPx = toPixel(dip, width, height, mirror)

  const segment = distance(tipPx, dipPx)
  if (segment < 6) return null

  const dirX = (tipPx.x - dipPx.x) / segment
  const dirY = (tipPx.y - dipPx.y) / segment
  const angle = Math.atan2(dirY, dirX) - Math.PI / 2

  let sum = 0
  let count = 0
  for (const [a, b] of finger.widthGaps) {
    const la = landmarks[a]
    const lb = landmarks[b]
    if (!la || !lb) continue
    sum += distance(toPixel(la, width, height, mirror), toPixel(lb, width, height, mirror))
    count += 1
  }
  const measuredWidth = count > 0 ? (sum / count) * WIDTH_TO_NAIL_RATIO : fallbackWidthFromSegment(segment)

  // z is a rough relative depth (smaller = closer to camera). A gap between
  // the tip and dip depth means the finger is angled toward/away from the
  // camera.
  const tiltRaw = (tip.z ?? 0) - (dip.z ?? 0)
  const tilt = Math.max(-1, Math.min(1, tiltRaw * 6))

  const baseX = dipPx.x + dirX * segment * CUTICLE_ANCHOR_OFFSET
  const baseY = dipPx.y + dirY * segment * CUTICLE_ANCHOR_OFFSET

  return { baseX, baseY, dirX, dirY, angle, width: measuredWidth * finger.scale, tilt }
}
