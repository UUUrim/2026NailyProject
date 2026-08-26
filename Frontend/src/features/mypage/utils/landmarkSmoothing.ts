import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

// Lower = smoother but laggier, higher = snappier but more jittery.
const SMOOTHING_FACTOR = 0.45

let previousHands: NormalizedLandmark[][] = []

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function cloneHands(hands: NormalizedLandmark[][]): NormalizedLandmark[][] {
  return hands.map((landmarks) => landmarks.map((point) => ({ ...point })))
}

// Detected hand landmarks jitter frame-to-frame, which makes an overlaid nail
// shape visibly shake. Blending each landmark toward its previous-frame
// position keeps the AR overlay steady without adding noticeable lag.
export function smoothLandmarks(hands: NormalizedLandmark[][]): NormalizedLandmark[][] {
  if (hands.length === 0) {
    previousHands = []
    return hands
  }

  if (hands.length !== previousHands.length) {
    previousHands = cloneHands(hands)
    return hands
  }

  const smoothed = hands.map((landmarks, handIndex) => {
    const previous = previousHands[handIndex]
    if (!previous || previous.length !== landmarks.length) {
      return landmarks
    }
    return landmarks.map((point, i) => ({
      ...point,
      x: lerp(previous[i].x, point.x, SMOOTHING_FACTOR),
      y: lerp(previous[i].y, point.y, SMOOTHING_FACTOR),
      z: lerp(previous[i].z, point.z, SMOOTHING_FACTOR),
    }))
  })

  previousHands = cloneHands(smoothed)
  return smoothed
}

export function resetLandmarkSmoothing() {
  previousHands = []
}
