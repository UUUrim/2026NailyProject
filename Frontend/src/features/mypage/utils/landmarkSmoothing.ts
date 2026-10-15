import type { HandLandmarkerResult, Landmark, NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { TrackedHand } from '@/features/mypage/utils/fingerLandmarks'

// Detected landmarks jitter frame to frame, which makes an overlaid nail
// visibly shake - and now that the nail's 3D tilt comes from landmark depth
// (noisier than x/y), a fixed blend would have to be either laggy or shaky.
// A One Euro filter adapts instead: heavy smoothing while the hand holds
// still, almost none while it moves fast, so the nail neither trembles nor
// trails behind the finger.
type OneEuroParams = { minCutoff: number; beta: number; dCutoff: number }

// Image landmarks are normalized to [0, 1]; world landmarks are meters
// (a whole hand is ~0.1), so world speeds are ~10x smaller and need a larger
// beta to open the filter up at the same physical speed.
const IMAGE_FILTER: OneEuroParams = { minCutoff: 0.8, beta: 20, dCutoff: 1 }
const WORLD_FILTER: OneEuroParams = { minCutoff: 1, beta: 60, dCutoff: 1 }

// Handedness is a per-frame classification that can flicker; an exponential
// average keeps one wrong frame from flipping which side of the hand counts
// as the back (which would blink every nail off).
const HANDEDNESS_BLEND = 0.15

// A detection further than this (normalized image units) from every hand
// tracked last frame is treated as a new hand rather than a moved one.
const MATCH_DISTANCE = 0.25
// Forget a hand that hasn't been seen for this long (ms).
const TRACK_TIMEOUT_MS = 500
// HandLandmarker runs with low detection thresholds (see handLandmarker.ts) so
// it can find curled-finger poses; a brand-new hand must show up in this many
// frames before it's drawn, so a one-frame false detection never flashes nails.
const CONFIRM_FRAMES = 3
// It also loses curled-finger hands now and then - on a still claw photo,
// every other frame whatever its thresholds - and a frame without the hand
// blinks every nail off. A confirmed hand missing for up to this long (ms) is
// still output, where it was last seen.
const HOLD_MS = 250

function smoothingAlpha(cutoff: number, dt: number) {
  const tau = 1 / (2 * Math.PI * cutoff)
  return 1 / (1 + tau / dt)
}

class OneEuroFilter {
  private x: Float64Array
  private dx: Float64Array
  private readonly params: OneEuroParams

  constructor(initial: ArrayLike<number>, params: OneEuroParams) {
    this.x = Float64Array.from(initial)
    this.dx = new Float64Array(initial.length)
    this.params = params
  }

  filter(values: ArrayLike<number>, dt: number): Float64Array {
    const { minCutoff, beta, dCutoff } = this.params
    const aD = smoothingAlpha(dCutoff, dt)
    for (let i = 0; i < values.length; i += 1) {
      const rawDx = (values[i] - this.x[i]) / dt
      this.dx[i] += aD * (rawDx - this.dx[i])
      const a = smoothingAlpha(minCutoff + beta * Math.abs(this.dx[i]), dt)
      this.x[i] += a * (values[i] - this.x[i])
    }
    return this.x
  }
}

function flatten(points: Array<{ x: number; y: number; z: number }>): number[] {
  const out: number[] = []
  for (const p of points) out.push(p.x, p.y, p.z)
  return out
}

function unflatten<T extends NormalizedLandmark | Landmark>(values: ArrayLike<number>, template: T[]): T[] {
  return template.map((p, i) => ({ ...p, x: values[i * 3], y: values[i * 3 + 1], z: values[i * 3 + 2] }))
}

function handednessValue(categories: HandLandmarkerResult['handedness'][number] | undefined) {
  const top = categories?.[0]
  if (!top) return 0
  if (top.categoryName === 'Right') return top.score
  if (top.categoryName === 'Left') return -top.score
  return 0
}

// Wrist + middle knuckle midpoint: stable, and always detected.
function anchorOf(landmarks: NormalizedLandmark[]) {
  const a = landmarks[0]
  const b = landmarks[9] ?? a
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

type Track = {
  id: number
  frames: number
  image: OneEuroFilter
  world: OneEuroFilter | null
  handedness: number
  lastSeen: number
  anchor: { x: number; y: number }
  /** What was output for this hand the last time it was detected. */
  last: TrackedHand | null
}

/**
 * Smooths HandLandmarker results over time, keeping each physical hand on its
 * own filter. MediaPipe's per-frame hand order isn't stable when two hands
 * are in view, and blending landmarks by array index would morph one hand
 * into the other - so detections are matched to last frame's hands by
 * position first.
 */
export class HandTracker {
  private tracks: Track[] = []
  private nextId = 1

  update(result: HandLandmarkerResult, timestampMs: number): TrackedHand[] {
    this.tracks = this.tracks.filter((t) => timestampMs - t.lastSeen <= TRACK_TIMEOUT_MS)

    const available = new Set(this.tracks)
    const output: TrackedHand[] = []

    result.landmarks.forEach((landmarks, i) => {
      const worldLandmarks = result.worldLandmarks?.[i]?.length === landmarks.length ? result.worldLandmarks[i] : null
      const handedness = handednessValue(result.handedness?.[i])
      const anchor = anchorOf(landmarks)

      let track: Track | null = null
      let best = MATCH_DISTANCE
      for (const candidate of available) {
        const d = Math.hypot(candidate.anchor.x - anchor.x, candidate.anchor.y - anchor.y)
        if (d < best) {
          best = d
          track = candidate
        }
      }

      let smoothedImage: ArrayLike<number>
      let smoothedWorld: ArrayLike<number> | null = null
      if (track) {
        available.delete(track)
        // Time since this hand's own last detection - more than a frame when
        // it was missed in between.
        const dt = Math.min(0.25, Math.max(1e-3, (timestampMs - track.lastSeen) / 1000))
        smoothedImage = track.image.filter(flatten(landmarks), dt)
        if (worldLandmarks) {
          if (!track.world) track.world = new OneEuroFilter(flatten(worldLandmarks), WORLD_FILTER)
          smoothedWorld = track.world.filter(flatten(worldLandmarks), dt)
        }
        track.handedness += HANDEDNESS_BLEND * (handedness - track.handedness)
      } else {
        track = {
          id: this.nextId++,
          frames: 0,
          image: new OneEuroFilter(flatten(landmarks), IMAGE_FILTER),
          world: worldLandmarks ? new OneEuroFilter(flatten(worldLandmarks), WORLD_FILTER) : null,
          handedness,
          lastSeen: timestampMs,
          anchor,
          last: null,
        }
        this.tracks.push(track)
        smoothedImage = flatten(landmarks)
        smoothedWorld = worldLandmarks ? flatten(worldLandmarks) : null
      }
      track.lastSeen = timestampMs
      track.anchor = anchor
      track.frames += 1
      if (track.frames < CONFIRM_FRAMES) return

      track.last = {
        id: track.id,
        landmarks: unflatten(smoothedImage, landmarks),
        worldLandmarks: worldLandmarks && smoothedWorld ? unflatten(smoothedWorld, worldLandmarks) : null,
        handedness: track.handedness,
      }
      output.push(track.last)
    })

    for (const track of available) {
      if (track.last && timestampMs - track.lastSeen <= HOLD_MS) output.push(track.last)
    }

    return output
  }

  reset() {
    this.tracks = []
  }
}
