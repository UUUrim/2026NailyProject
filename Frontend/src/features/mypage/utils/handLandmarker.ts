import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
const MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

let landmarker: HandLandmarker | null = null
let landmarkerPromise: Promise<HandLandmarker> | null = null

// The defaults (0.5 each) lose the "claw" pose - palm toward the camera with
// the fingertips curled forward so the nails face it. On a real photo of that pose the palm detector scored only 0.05-0.1 and
// the landmark model's hand presence 0.3-0.5, so the hand was never found
// (and a tracked hand was dropped the moment the fingers curled). A low palm
// threshold only proposes candidates; the presence check still rejects
// non-hands, and HandTracker additionally waits a few frames before trusting
// a brand-new hand.
const DETECTION_OPTIONS = {
  runningMode: 'VIDEO',
  numHands: 2,
  minHandDetectionConfidence: 0.05,
  minHandPresenceConfidence: 0.3,
  minTrackingConfidence: 0.3,
} as const

async function createLandmarker(): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_PATH)

  try {
    return await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_PATH,
        delegate: 'GPU',
      },
      ...DETECTION_OPTIONS,
    })
  } catch {
    return HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_PATH,
        delegate: 'CPU',
      },
      ...DETECTION_OPTIONS,
    })
  }
}

export function getHandLandmarker(): Promise<HandLandmarker> {
  if (landmarker) return Promise.resolve(landmarker)
  if (!landmarkerPromise) {
    landmarkerPromise = createLandmarker()
      .then((instance) => {
        landmarker = instance
        return instance
      })
      .catch((error) => {
        landmarkerPromise = null
        throw error
      })
  }
  return landmarkerPromise
}

export function disposeHandLandmarker() {
  landmarker?.close()
  landmarker = null
  landmarkerPromise = null
}
