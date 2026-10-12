// Instance segmentation of fingernails with a YOLOv8s-seg model trained on
// nail photos ("Nail" is its only class). Weights: nails_seg_s_yolov8_v1 by
// mnemic (https://huggingface.co/mnemic/nails_seg_yolov8), CC BY 4.0, exported
// to ONNX - see public/models/nail-seg/README.md. It runs on a square crop
// around the hand, on WebGPU where the browser has it and WASM otherwise, in
// a worker (nailSegmenter.worker.ts): on the CPU one run takes a few hundred
// ms, which on the main thread would freeze the camera view every time.

const MODEL_URL = '/models/nail-seg/nail-seg-s.onnx'

/** Model input side, px (the ONNX graph is exported at this fixed size). */
export const SEGMENTER_INPUT = 320
/** Gray the model was trained to see in letterbox padding. */
const PAD_GRAY = 114

/** A square region of the camera frame, raw pixels. */
export type CropRegion = { x: number; y: number; size: number }

/** One nail's soft mask on a grid in raw camera pixels: cell (i, j) is
 *  centered at (originX + (i + 0.5) * cell, originY + (j + 0.5) * cell). */
export type NailMask = {
  score: number
  probs: Float32Array
  cols: number
  rows: number
  originX: number
  originY: number
  cell: number
}

/** Where the model runs: the GPU (WebGPU) or the CPU (WASM). */
export type SegmenterBackend = 'webgpu' | 'wasm'

/** Messages to the worker... */
export type SegmenterRequest =
  | { type: 'init'; modelUrl: string; inputSize: number; forceWasm: boolean }
  | { type: 'segment'; id: number; inputs: Float32Array[]; regions: CropRegion[] }
/** ...and back. */
export type SegmenterReply =
  | { type: 'ready'; backend: SegmenterBackend }
  | { type: 'failed'; message: string }
  | { type: 'masks'; id: number; masks: NailMask[][] }
  | { type: 'error'; id: number; message: string }

type Pending = { resolve: (masks: NailMask[][]) => void; reject: (error: Error) => void }

let workerPromise: Promise<{ worker: Worker; backend: SegmenterBackend }> | null = null
const pending = new Map<number, Pending>()
let nextRequestId = 1

/** Starts the worker and loads the model in it, once. */
function getWorker(): Promise<{ worker: Worker; backend: SegmenterBackend }> {
  if (!workerPromise) {
    const started = performance.now()
    workerPromise = new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./nailSegmenter.worker.ts', import.meta.url), { type: 'module' })
      let ready = false
      const fail = (error: Error) => {
        for (const request of pending.values()) request.reject(error)
        pending.clear()
        worker.terminate()
        workerPromise = null
        reject(error)
      }
      worker.onmessage = (event: MessageEvent<SegmenterReply>) => {
        const message = event.data
        if (message.type === 'ready') {
          ready = true
          console.info(
            `손톱 분할 모델 준비 완료: ${message.backend === 'webgpu' ? 'GPU(WebGPU)' : 'CPU(WASM)'}, ` +
              `${((performance.now() - started) / 1000).toFixed(1)}초`,
          )
          resolve({ worker, backend: message.backend })
        } else if (message.type === 'failed') {
          fail(new Error(message.message))
        } else {
          const request = pending.get(message.id)
          pending.delete(message.id)
          if (message.type === 'masks') request?.resolve(message.masks)
          else request?.reject(new Error(message.message))
        }
      }
      worker.onerror = (event) => {
        event.preventDefault()
        fail(new Error(ready ? `손톱 분할 워커 오류: ${event.message}` : `손톱 분할 워커를 시작할 수 없습니다: ${event.message}`))
      }
      // WebGPU unless the page asks for WASM (?nailSegmenter=wasm, for testing).
      const forceWasm =
        typeof location !== 'undefined' && new URLSearchParams(location.search).get('nailSegmenter') === 'wasm'
      const init: SegmenterRequest = {
        type: 'init',
        modelUrl: new URL(MODEL_URL, location.href).href,
        inputSize: SEGMENTER_INPUT,
        forceWasm,
      }
      worker.postMessage(init)
    })
  }
  return workerPromise
}

/** Starts loading the model ahead of the first frame; resolves to where it
 *  runs once it's ready. */
export async function preloadNailSegmenter(): Promise<SegmenterBackend> {
  return (await getWorker()).backend
}

export class NailSegmenter {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null

  /**
   * Segments the nails in each region of `source`. Every region is read from
   * the frame up front, before the first await, so all results belong to the
   * frame `source` showed when this was called.
   */
  async segment(source: CanvasImageSource, regions: CropRegion[]): Promise<NailMask[][]> {
    const inputs = regions.map((region) => this.preprocess(source, region))
    const { worker } = await getWorker()
    const id = nextRequestId
    nextRequestId += 1
    return new Promise<NailMask[][]>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      const request: SegmenterRequest = { type: 'segment', id, inputs, regions }
      worker.postMessage(
        request,
        inputs.map((input) => input.buffer),
      )
    })
  }

  private preprocess(source: CanvasImageSource, region: CropRegion) {
    if (!this.canvas) {
      this.canvas = document.createElement('canvas')
      this.canvas.width = SEGMENTER_INPUT
      this.canvas.height = SEGMENTER_INPUT
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })
    }
    const ctx = this.ctx
    if (!ctx) throw new Error('캔버스를 초기화할 수 없습니다.')
    ctx.fillStyle = `rgb(${PAD_GRAY}, ${PAD_GRAY}, ${PAD_GRAY})`
    ctx.fillRect(0, 0, SEGMENTER_INPUT, SEGMENTER_INPUT)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'medium'
    // Parts of the region off the frame stay padding gray.
    ctx.drawImage(source, region.x, region.y, region.size, region.size, 0, 0, SEGMENTER_INPUT, SEGMENTER_INPUT)
    const { data } = ctx.getImageData(0, 0, SEGMENTER_INPUT, SEGMENTER_INPUT)
    const plane = SEGMENTER_INPUT * SEGMENTER_INPUT
    const input = new Float32Array(3 * plane)
    for (let p = 0; p < plane; p += 1) {
      input[p] = data[p * 4] / 255
      input[plane + p] = data[p * 4 + 1] / 255
      input[2 * plane + p] = data[p * 4 + 2] / 255
    }
    return input
  }
}
