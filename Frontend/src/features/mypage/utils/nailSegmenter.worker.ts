import * as ort from 'onnxruntime-web/webgpu'
// onnxruntime's runtime (a 27 MB .wasm and its JS loader), served by the app
// itself as build assets - from a CDN it took ~20 s to arrive the first time.
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import ortLoaderUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
// Types only: importing nailSegmenter.ts itself would pull the main-thread
// side (and its `new Worker`) into this worker's bundle.
import type {
  CropRegion,
  NailMask,
  SegmenterBackend,
  SegmenterReply,
  SegmenterRequest,
} from '@/features/mypage/utils/nailSegmenter'

// The nail segmentation model, run off the main thread (see nailSegmenter.ts).

/** The prototype masks come out at a quarter of the input resolution; masks
 *  are upsampled back to the input's. */
const PROTO_STRIDE = 4
const MASK_UPSAMPLE = 4
const MASK_COEFFS = 32
const MIN_SCORE = 0.3
const NMS_IOU = 0.5
const MAX_NAILS = 12

let session: ort.InferenceSession | null = null
/** Model input side, px - SEGMENTER_INPUT, sent with the init message. */
let inputSize = 0
/** The segment request in progress (see onmessage). */
let queue: Promise<unknown> = Promise.resolve()

function reply(message: SegmenterReply, transfer: Transferable[] = []) {
  // (Typed against Window here, but this options form is the worker's too.)
  self.postMessage(message, { transfer })
}

async function createSession(model: Uint8Array, backend: SegmenterBackend) {
  const created = await ort.InferenceSession.create(model, {
    executionProviders: [backend],
    graphOptimizationLevel: 'all',
  })
  // The first run compiles the GPU shaders and can take seconds - do it now,
  // while the rest of the AR view is still loading, rather than on the first
  // camera frame.
  const blank = new ort.Tensor('float32', new Float32Array(3 * inputSize * inputSize), [1, 3, inputSize, inputSize])
  const warmup = await created.run({ [created.inputNames[0]]: blank })
  for (const tensor of Object.values(warmup)) tensor.dispose()
  return created
}

/** Loads the model on WebGPU, or on WASM (the CPU) if that's unavailable or
 *  fails - one at a time rather than letting onnxruntime fall back quietly,
 *  so the page can tell which one it got. */
async function init(modelUrl: string, size: number, forceWasm: boolean): Promise<SegmenterBackend> {
  inputSize = size
  ort.env.wasm.wasmPaths = {
    wasm: new URL(ortWasmUrl, self.location.href).href,
    mjs: new URL(ortLoaderUrl, self.location.href).href,
  }
  const response = await fetch(modelUrl)
  if (!response.ok) throw new Error(`손톱 분할 모델을 받을 수 없습니다 (HTTP ${response.status})`)
  const model = new Uint8Array(await response.arrayBuffer())
  const hasWebGpu = !!(self.navigator as { gpu?: unknown }).gpu
  if (hasWebGpu && !forceWasm) {
    try {
      session = await createSession(model, 'webgpu')
      return 'webgpu'
    } catch (error) {
      console.warn('손톱 분할 모델을 WebGPU로 실행할 수 없어 WASM(CPU)으로 실행합니다:', error)
    }
  }
  session = await createSession(model, 'wasm')
  return 'wasm'
}

async function segment(inputs: Float32Array[], regions: CropRegion[]) {
  if (!session) throw new Error('손톱 분할 모델이 준비되지 않았습니다.')
  const [detectionsName, protosName] = session.outputNames
  const results: NailMask[][] = []
  for (const [index, input] of inputs.entries()) {
    const feeds = {
      [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, inputSize, inputSize]),
    }
    const outputs = await session.run(feeds)
    const detections = outputs[detectionsName]
    const protos = outputs[protosName]
    try {
      results.push(
        decode(
          (await detections.getData()) as Float32Array,
          detections.dims as number[],
          (await protos.getData()) as Float32Array,
          protos.dims as number[],
          regions[index],
        ),
      )
    } finally {
      detections.dispose()
      protos.dispose()
    }
  }
  return results
}

self.onmessage = (event: MessageEvent<SegmenterRequest>) => {
  const request = event.data
  if (request.type === 'init') {
    init(request.modelUrl, request.inputSize, request.forceWasm).then(
      (backend) => reply({ type: 'ready', backend }),
      (error: unknown) => reply({ type: 'failed', message: String(error) }),
    )
    return
  }
  // One run at a time: onnxruntime can't run a session twice at once - a
  // second request arriving mid-run hung forever on WebGPU.
  const run = queue.then(() => segment(request.inputs, request.regions))
  queue = run.catch(() => {})
  run.then(
    (masks) =>
      reply(
        { type: 'masks', id: request.id, masks },
        masks.flat().map((mask) => mask.probs.buffer),
      ),
    (error: unknown) => reply({ type: 'error', id: request.id, message: String(error) }),
  )
}

function sigmoid(x: number) {
  return 1 / (1 + Math.exp(-x))
}

type Candidate = { score: number; x0: number; y0: number; x1: number; y1: number; anchor: number }

function iou(a: Candidate, b: Candidate) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  if (w <= 0 || h <= 0) return 0
  const inter = w * h
  return inter / ((a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter)
}

/**
 * YOLOv8-seg outputs: detections [1, 4 + 1 + 32, anchors] - box center/size
 * in input pixels, the (already sigmoided) nail score, then mask
 * coefficients - and prototypes [1, 32, input/4, input/4]. A nail's mask is
 * sigmoid(coefficients . prototypes), kept inside its box.
 */
function decode(out: Float32Array, dims: number[], protos: Float32Array, protoDims: number[], region: CropRegion) {
  const anchors = dims[2]
  const channels = dims[1]
  if (channels < 5 + MASK_COEFFS) return []
  const candidates: Candidate[] = []
  for (let a = 0; a < anchors; a += 1) {
    const score = out[4 * anchors + a]
    if (score < MIN_SCORE) continue
    const cx = out[a]
    const cy = out[anchors + a]
    const w = out[2 * anchors + a]
    const h = out[3 * anchors + a]
    candidates.push({ score, x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2, anchor: a })
  }
  candidates.sort((p, q) => q.score - p.score)
  const kept: Candidate[] = []
  for (const candidate of candidates) {
    if (kept.length >= MAX_NAILS) break
    if (kept.every((k) => iou(k, candidate) < NMS_IOU)) kept.push(candidate)
  }

  const protoH = protoDims[2]
  const protoW = protoDims[3]
  const plane = protoW * protoH
  const toFrame = region.size / inputSize
  const coeffs = new Float32Array(MASK_COEFFS)
  return kept.map((nail) => {
    for (let k = 0; k < MASK_COEFFS; k += 1) coeffs[k] = out[(5 + k) * anchors + nail.anchor]
    // Mask logits on the prototype grid over the box, one cell of margin...
    const i0 = Math.max(0, Math.floor(nail.x0 / PROTO_STRIDE) - 1)
    const j0 = Math.max(0, Math.floor(nail.y0 / PROTO_STRIDE) - 1)
    const i1 = Math.min(protoW, Math.ceil(nail.x1 / PROTO_STRIDE) + 1)
    const j1 = Math.min(protoH, Math.ceil(nail.y1 / PROTO_STRIDE) + 1)
    const coarseCols = Math.max(1, i1 - i0)
    const coarseRows = Math.max(1, j1 - j0)
    const logits = new Float32Array(coarseCols * coarseRows)
    for (let j = 0; j < coarseRows; j += 1) {
      for (let i = 0; i < coarseCols; i += 1) {
        const p = (j0 + j) * protoW + i0 + i
        let sum = 0
        for (let k = 0; k < MASK_COEFFS; k += 1) sum += coeffs[k] * protos[k * plane + p]
        logits[j * coarseCols + i] = sum
      }
    }
    // ...then upsampled (bilinear in logit space, where the edge is smooth)
    // so a nail's outline isn't stuck to 4-input-pixel steps.
    const cols = coarseCols * MASK_UPSAMPLE
    const rows = coarseRows * MASK_UPSAMPLE
    const step = PROTO_STRIDE / MASK_UPSAMPLE
    const probs = new Float32Array(cols * rows)
    for (let j = 0; j < rows; j += 1) {
      const py = j0 * PROTO_STRIDE + (j + 0.5) * step
      if (py < nail.y0 || py > nail.y1) continue
      const v = Math.min(coarseRows - 1, Math.max(0, py / PROTO_STRIDE - 0.5 - j0))
      const v0 = Math.floor(v)
      const v1 = Math.min(coarseRows - 1, v0 + 1)
      const fv = v - v0
      for (let i = 0; i < cols; i += 1) {
        const px = i0 * PROTO_STRIDE + (i + 0.5) * step
        if (px < nail.x0 || px > nail.x1) continue
        const u = Math.min(coarseCols - 1, Math.max(0, px / PROTO_STRIDE - 0.5 - i0))
        const u0 = Math.floor(u)
        const u1 = Math.min(coarseCols - 1, u0 + 1)
        const fu = u - u0
        const top = logits[v0 * coarseCols + u0] + (logits[v0 * coarseCols + u1] - logits[v0 * coarseCols + u0]) * fu
        const bottom = logits[v1 * coarseCols + u0] + (logits[v1 * coarseCols + u1] - logits[v1 * coarseCols + u0]) * fu
        probs[j * cols + i] = sigmoid(top + (bottom - top) * fv)
      }
    }
    return {
      score: nail.score,
      probs,
      cols,
      rows,
      originX: region.x + i0 * PROTO_STRIDE * toFrame,
      originY: region.y + j0 * PROTO_STRIDE * toFrame,
      cell: step * toFrame,
    }
  })
}
