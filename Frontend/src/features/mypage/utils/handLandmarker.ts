import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
const MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

let landmarker: HandLandmarker | null = null
let landmarkerPromise: Promise<HandLandmarker> | null = null

async function createLandmarker(): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_PATH)

  try {
    return await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_PATH,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 2,
    })
  } catch {
    return HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_PATH,
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      numHands: 2,
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
