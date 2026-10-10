import { BASE_URL } from '@/shared/utils/apiClient'

export type FingerNailAsset = {
  canvas: HTMLCanvasElement
  aspectRatio: number
}

export type NailDesignAsset = {
  image: HTMLImageElement
  fingerNails: FingerNailAsset[]
}

const FINGER_COUNT = 5

type ContentBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

type NailBlob = ContentBounds & {
  id: number
  centerX: number
  centerY: number
  pixels: number
}

type PreparedImage = {
  image: HTMLImageElement
  canvas: HTMLCanvasElement
  width: number
  height: number
  data: Uint8ClampedArray | null
}

function loadImageElement(src: string, useCrossOrigin = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (useCrossOrigin) {
      img.crossOrigin = 'anonymous'
    }
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('네일 디자인 이미지를 불러올 수 없습니다.'))
    img.src = src
  })
}

// Design images are served straight from S3, a different origin from the app,
// and the bucket has no CORS rule granting us pixel access. Loading them
// directly always leaves the canvas "tainted" - drawImage still works (the
// picture shows), but getImageData throws, silently degrading nail-tip
// extraction into a blind rectangular 1/5 crop of the whole photo. The
// backend already solves this same problem for downloads via
// /designs/download-proxy (fetches the S3 bytes server-side and returns them
// same-origin) - route pixel-reading through it too instead of hitting S3
// straight from the browser.
function toReadableImageUrl(imageUrl: string): string {
  try {
    const resolved = new URL(imageUrl, window.location.href)
    if (resolved.origin === window.location.origin) return imageUrl
  } catch {
    return imageUrl
  }
  return `${BASE_URL}/designs/download-proxy?url=${encodeURIComponent(imageUrl)}`
}

async function loadPreparedImage(imageUrl: string): Promise<PreparedImage> {
  const readableUrl = toReadableImageUrl(imageUrl)
  const token = localStorage.getItem('token')

  try {
    const response = await fetch(readableUrl, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (response.ok) {
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      try {
        const image = await loadImageElement(objectUrl)
        return rasterizeImage(image)
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    }
  } catch {
    // fall through
  }

  // Best-effort fallback so the AR modal still shows *something* even if the
  // proxy is unreachable - the canvas may end up tainted here (pixel
  // extraction degrades to a plain crop), but the image itself still renders.
  try {
    const image = await loadImageElement(imageUrl, true)
    return rasterizeImage(image)
  } catch {
    const image = await loadImageElement(imageUrl)
    return rasterizeImage(image)
  }
}

function rasterizeImage(image: HTMLImageElement): PreparedImage {
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('캔버스를 초기화할 수 없습니다.')
  }

  ctx.drawImage(image, 0, 0, width, height)

  let data: Uint8ClampedArray | null
  try {
    data = ctx.getImageData(0, 0, width, height).data
  } catch {
    data = null
  }

  return { image, canvas, width, height, data }
}

// A fixed "is this pixel white/black" threshold breaks down on real generated
// photos: soft drop shadows and gradients between adjacent nail tips are
// neither near-white nor near-black, so they were previously misread as nail
// content and bridged separate nails into one blob.
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

type RgbColor = { r: number; g: number; b: number }

// Real studio product shots almost always have a lighting vignette - the
// backdrop is measurably darker/cooler in one corner than another (in one
// real generated image, the top border averaged ~(229,236,245) while the
// bottom border averaged ~(208,215,227): a ~35-unit swing, bigger than any
// single-color tolerance can absorb without either eating pale nails or
// leaving corners misclassified as foreground). Comparing every pixel to one
// flat "the" background color can't handle that: whichever tolerance is
// picked, it either lets the darker corner register as foreground (bridging
// nails through what should be background) or lets a pale nail blend into the
// lighter corner. Instead sample the four corners (trusted to be background -
// nails sit in a horizontal band away from the edges) and bilinearly
// interpolate an expected background color per pixel position, so the
// comparison tracks the actual lighting falloff across the photo.
function medianColorInPatch(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    cx: number,
    cy: number,
    radius: number,
): RgbColor {
  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []

  for (let y = Math.max(0, cy - radius); y <= Math.min(height - 1, cy + radius); y += 1) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(width - 1, cx + radius); x += 1) {
      const i = (y * width + x) * 4
      if (data[i + 3] < 20) continue
      rs.push(data[i])
      gs.push(data[i + 1])
      bs.push(data[i + 2])
    }
  }

  if (rs.length === 0) return { r: 255, g: 255, b: 255 }
  return { r: median(rs), g: median(gs), b: median(bs) }
}

function lerpColor(a: RgbColor, b: RgbColor, t: number): RgbColor {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  }
}

// Deliberately NOT a connectivity/flood-fill test. An earlier version bridged
// background outward from the image border, allowing gradual per-pixel color
// steps so soft drop-shadows between nails would count as background too.
// That broke on real curved edges: canvas antialiasing spreads a nail's edge
// color transition over 2-3 pixels, which is gradual enough to sneak under
// almost any per-step tolerance - so the flood fill quietly walked straight
// through the antialiased rim and swallowed entire pale/pastel nail bodies as
// background (each step small, but connectivity has no memory of the total
// distance travelled). A plain per-pixel distance test has no such failure
// mode: every pixel is judged independently, so a uniform nail interior can
// never be consumed just because one neighboring pixel looked background-ish.
const BG_COLOR_TOLERANCE = 26

// Soft drop shadows are the one thing that per-pixel test can't call
// background: they're the backdrop's own color, just darker - and darker than
// the corner-interpolated estimate predicts, so they stayed foreground and
// every cutout carried a grey rim (very visible once it's on a finger). They
// get a second, much narrower pass that a pale nail can't slip through the
// way it did through the old flood fill: a pixel only qualifies if it IS a
// darkened copy of the expected backdrop color (same hue/tint, 40-99% of its
// brightness - pastel or white nails are tinted or brighter and never match),
// and it's only absorbed when reached from known background through a gentle
// brightness ramp. Shadows fall off a few levels per pixel; a nail edge, even
// antialiased, jumps well past SHADOW_MAX_STEP.
const SHADOW_MIN_RATIO = 0.4
const SHADOW_MAX_RATIO = 0.99
const SHADOW_TINT_TOLERANCE = 12
const SHADOW_MAX_STEP = 9

function isShadowOf(r: number, g: number, b: number, expected: RgbColor): boolean {
  const ratio = (r + g + b) / Math.max(1, expected.r + expected.g + expected.b)
  if (ratio < SHADOW_MIN_RATIO || ratio > SHADOW_MAX_RATIO) return false
  const dr = r - expected.r * ratio
  const dg = g - expected.g * ratio
  const db = b - expected.b * ratio
  return Math.sqrt(dr * dr + dg * dg + db * db) < SHADOW_TINT_TOLERANCE
}

function absorbShadows(width: number, height: number, data: Uint8ClampedArray, mask: Uint8Array, shadowLike: Uint8Array) {
  const luminance = (i: number) => (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3
  const queue = new Int32Array(width * height)
  let head = 0
  let tail = 0
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i]) queue[tail++] = i
  }
  while (head < tail) {
    const i = queue[head++]
    const x = i % width
    const lum = luminance(i)
    const visit = (n: number) => {
      if (mask[n] || !shadowLike[n] || Math.abs(luminance(n) - lum) > SHADOW_MAX_STEP) return
      mask[n] = 1
      queue[tail++] = n
    }
    if (x > 0) visit(i - 1)
    if (x < width - 1) visit(i + 1)
    if (i >= width) visit(i - width)
    if (i < width * (height - 1)) visit(i + width)
  }
}

function computeBackgroundMask(width: number, height: number, data: Uint8ClampedArray): Uint8Array {
  const patch = Math.max(6, Math.floor(Math.min(width, height) * 0.03))
  const topLeft = medianColorInPatch(data, width, height, patch, patch, patch)
  const topRight = medianColorInPatch(data, width, height, width - 1 - patch, patch, patch)
  const bottomLeft = medianColorInPatch(data, width, height, patch, height - 1 - patch, patch)
  const bottomRight = medianColorInPatch(data, width, height, width - 1 - patch, height - 1 - patch, patch)

  const mask = new Uint8Array(width * height)
  const shadowLike = new Uint8Array(width * height)

  for (let y = 0; y < height; y += 1) {
    const v = height <= 1 ? 0 : y / (height - 1)
    const left = lerpColor(topLeft, bottomLeft, v)
    const right = lerpColor(topRight, bottomRight, v)

    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      const p = i * 4
      if (data[p + 3] < 20) {
        mask[i] = 1
        continue
      }
      const u = width <= 1 ? 0 : x / (width - 1)
      const expected = lerpColor(left, right, u)
      const dr = data[p] - expected.r
      const dg = data[p + 1] - expected.g
      const db = data[p + 2] - expected.b
      mask[i] = Math.sqrt(dr * dr + dg * dg + db * db) < BG_COLOR_TOLERANCE ? 1 : 0
      if (!mask[i] && isShadowOf(data[p], data[p + 1], data[p + 2], expected)) shadowLike[i] = 1
    }
  }

  absorbShadows(width, height, data, mask, shadowLike)
  return mask
}

function getContentBounds(width: number, height: number, backgroundMask: Uint8Array | null): ContentBounds {
  if (!backgroundMask) {
    return { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 }
  }

  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0
  let found = false

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (backgroundMask[y * width + x]) continue
      found = true
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  if (!found) {
    return { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 }
  }

  return { minX, minY, maxX, maxY }
}

function findNailBlobs(
    width: number,
    backgroundMask: Uint8Array,
    bounds: ContentBounds,
): { blobs: NailBlob[]; blobIdMap: Int32Array } {
  const visited = new Uint8Array(width * (bounds.maxY + 1))
  const blobIdMap = new Int32Array(width * (bounds.maxY + 1)).fill(-1)
  const blobs: NailBlob[] = []
  const minBlobPixels = Math.max(
      40,
      Math.floor((bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1) * 0.008),
  )

  const idx = (x: number, y: number) => y * width + x
  const isFilled = (x: number, y: number) => {
    if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) return false
    return backgroundMask[idx(x, y)] === 0
  }

  let nextId = 0

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const flat = idx(x, y)
      if (visited[flat] || !isFilled(x, y)) continue

      const queue: Array<[number, number]> = [[x, y]]
      visited[flat] = 1
      const collectedFlats: number[] = [flat]

      let minX = x
      let minY = y
      let maxX = x
      let maxY = y
      let pixels = 0
      let sumX = 0
      let sumY = 0

      while (queue.length > 0) {
        const [cx, cy] = queue.pop()!
        pixels += 1
        sumX += cx
        sumY += cy
        minX = Math.min(minX, cx)
        minY = Math.min(minY, cy)
        maxX = Math.max(maxX, cx)
        maxY = Math.max(maxY, cy)

        const neighbors: Array<[number, number]> = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ]

        for (const [nx, ny] of neighbors) {
          if (nx < bounds.minX || nx > bounds.maxX || ny < bounds.minY || ny > bounds.maxY) continue
          const nFlat = idx(nx, ny)
          if (visited[nFlat] || !isFilled(nx, ny)) continue
          visited[nFlat] = 1
          collectedFlats.push(nFlat)
          queue.push([nx, ny])
        }
      }

      if (pixels < minBlobPixels) continue

      const id = nextId
      nextId += 1
      for (const flatIndex of collectedFlats) {
        blobIdMap[flatIndex] = id
      }

      blobs.push({
        id,
        minX,
        minY,
        maxX,
        maxY,
        centerX: sumX / pixels,
        centerY: sumY / pixels,
        pixels,
      })
    }
  }

  return { blobs: blobs.sort((a, b) => a.centerX - b.centerX), blobIdMap }
}

function createFingerCanvas(sourceCanvas: HTMLCanvasElement, bounds: ContentBounds): FingerNailAsset {
  const w = Math.max(1, bounds.maxX - bounds.minX + 1)
  const h = Math.max(1, bounds.maxY - bounds.minY + 1)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('손가락별 네일 캔버스를 초기화할 수 없습니다.')
  }
  ctx.drawImage(sourceCanvas, bounds.minX, bounds.minY, w, h, 0, 0, w, h)
  return { canvas, aspectRatio: w / h }
}

function buildAlphaMaskedCanvas(
    sourceWidth: number,
    data: Uint8ClampedArray,
    bounds: ContentBounds,
    isMember: (x: number, y: number) => boolean,
): FingerNailAsset {
  const w = Math.max(1, bounds.maxX - bounds.minX + 1)
  const h = Math.max(1, bounds.maxY - bounds.minY + 1)

  // Trim the anti-aliased/background-bleed rim the source image may carry
  // around each nail tip, so the cutout doesn't keep a faint white halo. This
  // must be a SOFT trim, not a hard 4-neighbor erosion: real nail art often
  // has thin single-pixel-wide details (a fine rhinestone chain, a line-art
  // stroke), and requiring every neighbor to also be foreground erodes those
  // clean through, leaving the design in disconnected floating fragments. Only
  // drop a pixel when a clear MAJORITY of its neighbors are background - an
  // actual bleed rim satisfies that, a thin foreground line doesn't.
  const core = new Uint8Array(w * h)
  for (let ly = 0; ly < h; ly += 1) {
    const y = bounds.minY + ly
    for (let lx = 0; lx < w; lx += 1) {
      const x = bounds.minX + lx
      if (!isMember(x, y)) continue
      const neighborMemberCount =
          (isMember(x - 1, y) ? 1 : 0) +
          (isMember(x + 1, y) ? 1 : 0) +
          (isMember(x, y - 1) ? 1 : 0) +
          (isMember(x, y + 1) ? 1 : 0)
      if (neighborMemberCount < 1) continue
      core[ly * w + lx] = 255
    }
  }

  // Feather the trimmed mask with a small box blur so the edge fades smoothly
  // instead of showing a jagged binary cutoff when composited on camera video.
  const feathered = new Uint8ClampedArray(w * h)
  const radius = 1
  for (let ly = 0; ly < h; ly += 1) {
    for (let lx = 0; lx < w; lx += 1) {
      let sum = 0
      let count = 0
      for (let dy = -radius; dy <= radius; dy += 1) {
        const ny = ly + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = lx + dx
          if (nx < 0 || nx >= w) continue
          sum += core[ny * w + nx]
          count += 1
        }
      }
      feathered[ly * w + lx] = count ? sum / count : 0
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('손가락별 네일 캔버스를 초기화할 수 없습니다.')
  }

  const imageData = ctx.createImageData(w, h)
  for (let ly = 0; ly < h; ly += 1) {
    const y = bounds.minY + ly
    for (let lx = 0; lx < w; lx += 1) {
      const x = bounds.minX + lx
      const srcI = (y * sourceWidth + x) * 4
      const dstI = (ly * w + lx) * 4
      const alpha = feathered[ly * w + lx]
      imageData.data[dstI] = data[srcI]
      imageData.data[dstI + 1] = data[srcI + 1]
      imageData.data[dstI + 2] = data[srcI + 2]
      imageData.data[dstI + 3] = Math.round((alpha / 255) * data[srcI + 3])
    }
  }
  ctx.putImageData(imageData, 0, 0)

  return { canvas, aspectRatio: w / h }
}

function findVerticalSplitLines(width: number, backgroundMask: Uint8Array, bounds: ContentBounds): number[] {
  const cropW = bounds.maxX - bounds.minX + 1
  const densities = new Array<number>(cropW).fill(0)

  for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
    let count = 0
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      if (backgroundMask[y * width + x] === 0) count += 1
    }
    densities[x - bounds.minX] = count
  }

  const segmentW = cropW / FINGER_COUNT
  const lines: number[] = []

  for (let i = 1; i < FINGER_COUNT; i += 1) {
    const searchStart = Math.floor(i * segmentW - segmentW * 0.25)
    const searchEnd = Math.floor(i * segmentW + segmentW * 0.25)
    let bestX = Math.floor(i * segmentW)
    let bestScore = Number.POSITIVE_INFINITY

    for (let localX = Math.max(1, searchStart); localX < Math.min(cropW - 1, searchEnd); localX += 1) {
      const score = densities[localX - 1] + densities[localX] + densities[localX + 1]
      if (score < bestScore) {
        bestScore = score
        bestX = localX
      }
    }

    lines.push(bounds.minX + bestX)
  }

  return lines
}

function splitByProjection(
    width: number,
    _height: number,
    data: Uint8ClampedArray,
    backgroundMask: Uint8Array,
    bounds: ContentBounds,
): FingerNailAsset[] {
  const splitLines = findVerticalSplitLines(width, backgroundMask, bounds)
  const xStarts = [bounds.minX, ...splitLines]
  const xEnds = [...splitLines, bounds.maxX + 1]
  const nails: FingerNailAsset[] = []
  const isMember = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= bounds.maxY + 1) return false
    return backgroundMask[y * width + x] === 0
  }

  for (let i = 0; i < FINGER_COUNT; i += 1) {
    const x0 = xStarts[i]
    const x1 = xEnds[i]
    let segMinY = bounds.maxY
    let segMaxY = bounds.minY

    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        if (backgroundMask[y * width + x] !== 0) continue
        segMinY = Math.min(segMinY, y)
        segMaxY = Math.max(segMaxY, y)
      }
    }

    if (segMaxY < segMinY) {
      segMinY = bounds.minY
      segMaxY = bounds.maxY
    }

    nails.push(
        buildAlphaMaskedCanvas(width, data, { minX: x0, minY: segMinY, maxX: x1 - 1, maxY: segMaxY }, isMember),
    )
  }

  return nails
}

function splitRowIntoFive(
    sourceCanvas: HTMLCanvasElement,
    width: number,
    _height: number,
    data: Uint8ClampedArray | null,
    backgroundMask: Uint8Array | null,
    bounds: ContentBounds,
): FingerNailAsset[] {
  const cropW = bounds.maxX - bounds.minX + 1
  const cropH = bounds.maxY - bounds.minY + 1
  const segmentW = cropW / FINGER_COUNT
  const nails: FingerNailAsset[] = []

  for (let i = 0; i < FINGER_COUNT; i += 1) {
    const x0 = Math.floor(bounds.minX + i * segmentW)
    const x1 = Math.floor(bounds.minX + (i + 1) * segmentW)
    let segMinY = bounds.maxY
    let segMaxY = bounds.minY

    if (data && backgroundMask) {
      for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          if (backgroundMask[y * width + x] !== 0) continue
          segMinY = Math.min(segMinY, y)
          segMaxY = Math.max(segMaxY, y)
        }
      }
    }

    if (segMaxY < segMinY) {
      segMinY = bounds.minY
      segMaxY = bounds.minY + cropH - 1
    }

    if (data && backgroundMask) {
      nails.push(
          buildAlphaMaskedCanvas(
              width,
              data,
              { minX: x0, minY: segMinY, maxX: x1 - 1, maxY: segMaxY },
              (x, y) => backgroundMask[y * width + x] === 0,
          ),
      )
    } else {
      nails.push(
          createFingerCanvas(sourceCanvas, {
            minX: x0,
            minY: segMinY,
            maxX: x1 - 1,
            maxY: segMaxY,
          }),
      )
    }
  }

  return nails
}

function pickFingerBlobs(blobs: NailBlob[]): NailBlob[] {
  if (blobs.length === FINGER_COUNT) return blobs

  if (blobs.length > FINGER_COUNT) {
    return [...blobs]
        .sort((a, b) => b.pixels - a.pixels)
        .slice(0, FINGER_COUNT)
        .sort((a, b) => a.centerX - b.centerX)
  }

  return blobs
}

function extractFingerNails(prepared: PreparedImage): FingerNailAsset[] {
  const { canvas, width, height, data } = prepared

  if (data) {
    const backgroundMask = computeBackgroundMask(width, height, data)
    const bounds = getContentBounds(width, height, backgroundMask)
    const { blobs, blobIdMap } = findNailBlobs(width, backgroundMask, bounds)

    if (blobs.length >= FINGER_COUNT) {
      return pickFingerBlobs(blobs).map((blob) =>
          buildAlphaMaskedCanvas(width, data, blob, (x, y) => blobIdMap[y * width + x] === blob.id),
      )
    }

    return splitByProjection(width, height, data, backgroundMask, bounds)
  }

  const bounds = getContentBounds(width, height, null)
  return splitRowIntoFive(canvas, width, height, null, null, bounds)
}

// ---------------------------------------------------------------------------
// Cutout cleanup
// ---------------------------------------------------------------------------

// Generated tips sit in a "perfectly straight horizontal line", but in
// practice each one can still lean a few degrees - and a leaning cutout lands
// on the finger leaning by the same amount. Straighten each tip by its own
// principal axis, within limits: a near-round cutout has no reliable axis,
// and a large angle is more likely a bad mask than a tilted tip.
const STRAIGHTEN_MIN_ANGLE = (1.5 * Math.PI) / 180
const STRAIGHTEN_MAX_ANGLE = (30 * Math.PI) / 180
const STRAIGHTEN_MIN_ELONGATION = 1.2
const TRIM_ALPHA = 8

function readCanvasPixels(canvas: HTMLCanvasElement): Uint8ClampedArray | null {
  try {
    return canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data ?? null
  } catch {
    return null
  }
}

function trimToAlpha(canvas: HTMLCanvasElement, pixels: Uint8ClampedArray): HTMLCanvasElement {
  const { width, height } = canvas
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] <= TRIM_ALPHA) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < minX) return canvas
  if (minX === 0 && minY === 0 && maxX === width - 1 && maxY === height - 1) return canvas

  const w = maxX - minX + 1
  const h = maxY - minY + 1
  const trimmed = document.createElement('canvas')
  trimmed.width = w
  trimmed.height = h
  trimmed.getContext('2d')?.drawImage(canvas, minX, minY, w, h, 0, 0, w, h)
  return trimmed
}

// The renderers size a nail as "measured width x (width / aspectRatio)" and
// pin the cutout's top edge to the cuticle, so the cutout must be exactly
// the nail: no transparent margin (detect-server crops can carry some, and it
// would both shrink the design and lift it off the cuticle) and upright.
function normalizeNailCutout(asset: FingerNailAsset): FingerNailAsset {
  const { canvas } = asset
  const pixels = readCanvasPixels(canvas)
  if (!pixels) return asset

  const { width, height } = canvas
  let mass = 0
  let sumX = 0
  let sumY = 0
  let transparent = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const a = pixels[(y * width + x) * 4 + 3] / 255
      if (a < 0.1) {
        transparent += 1
        continue
      }
      mass += a
      sumX += a * x
      sumY += a * y
    }
  }
  // Fully opaque = a plain rectangular crop (pixel access failed upstream);
  // there's no nail shape in it to straighten or trim against.
  if (mass < 30 || transparent === 0) return asset

  const cx = sumX / mass
  const cy = sumY / mass
  let mu20 = 0
  let mu02 = 0
  let mu11 = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const a = pixels[(y * width + x) * 4 + 3] / 255
      if (a < 0.1) continue
      const dx = x - cx
      const dy = y - cy
      mu20 += a * dx * dx
      mu02 += a * dy * dy
      mu11 += a * dx * dy
    }
  }

  const spread = Math.sqrt(((mu20 - mu02) / 2) ** 2 + mu11 * mu11)
  const major = (mu20 + mu02) / 2 + spread
  const minor = (mu20 + mu02) / 2 - spread
  const elongation = minor > 0 ? Math.sqrt(major / minor) : 0
  // Major-axis angle from +x (y down); rotating by PI/2 - theta makes it
  // vertical. The axis has no direction, so fold into (-PI/2, PI/2].
  const theta = 0.5 * Math.atan2(2 * mu11, mu20 - mu02)
  let rotation = Math.PI / 2 - theta
  while (rotation > Math.PI / 2) rotation -= Math.PI
  while (rotation <= -Math.PI / 2) rotation += Math.PI

  let source = canvas
  let sourcePixels = pixels
  if (
    elongation >= STRAIGHTEN_MIN_ELONGATION &&
    Math.abs(rotation) >= STRAIGHTEN_MIN_ANGLE &&
    Math.abs(rotation) <= STRAIGHTEN_MAX_ANGLE
  ) {
    const size = Math.ceil(Math.hypot(width, height)) + 2
    const rotated = document.createElement('canvas')
    rotated.width = size
    rotated.height = size
    const ctx = rotated.getContext('2d')
    if (ctx) {
      ctx.translate(size / 2, size / 2)
      ctx.rotate(rotation)
      ctx.drawImage(canvas, -cx, -cy)
      const rotatedPixels = readCanvasPixels(rotated)
      if (rotatedPixels) {
        source = rotated
        sourcePixels = rotatedPixels
      }
    }
  }

  const trimmed = trimToAlpha(source, sourcePixels)
  return { canvas: trimmed, aspectRatio: trimmed.width / trimmed.height }
}

// ---------------------------------------------------------------------------
// Detect-server crops
// ---------------------------------------------------------------------------

// The detect server returns its nail-tip crops in detection order (whatever
// order its detector ranked the boxes in), not left to right - so they can't
// simply be assigned thumb..pinky by index. Each crop is a straight cut-out
// of the composite image, though, so its position can be recovered by
// finding where its pixels match the composite, then sorted left to right.
// Matching runs on downscaled copies; it's a one-off cost when the modal
// opens.
const MATCH_MAX_DIM = 200
const MATCH_MAX_SAMPLES = 320
const MATCH_MAX_RMS = 30

type PixelGrid = { data: Uint8ClampedArray; width: number; height: number }

function downscalePixels(source: CanvasImageSource, width: number, height: number): Uint8ClampedArray | null {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(source, 0, 0, width, height)
  try {
    return ctx.getImageData(0, 0, width, height).data
  } catch {
    return null
  }
}

function locateCrop(composite: PixelGrid, scale: number, crop: PreparedImage): ContentBounds | null {
  if (!crop.data) return null
  const tw = Math.max(4, Math.round(crop.width * scale))
  const th = Math.max(4, Math.round(crop.height * scale))
  if (tw > composite.width || th > composite.height) return null
  const template = downscalePixels(crop.canvas, tw, th)
  if (!template) return null

  // Compare only the crop's own (opaque) nail pixels - its matted-out
  // background says nothing about where it came from.
  const collect = (minAlpha: number) => {
    const picked: number[] = []
    for (let i = 0; i < tw * th; i += 1) {
      if (template[i * 4 + 3] >= minAlpha) picked.push(i)
    }
    return picked
  }
  let picked = collect(200)
  if (picked.length < 16) picked = collect(64)
  if (picked.length < 16) return null

  const stride = Math.ceil(picked.length / MATCH_MAX_SAMPLES)
  const count = Math.ceil(picked.length / stride)
  const offsets = new Int32Array(count)
  const colors = new Int16Array(count * 3)
  for (let k = 0; k < count; k += 1) {
    const i = picked[k * stride]
    offsets[k] = (Math.floor(i / tw) * composite.width + (i % tw)) * 4
    colors[k * 3] = template[i * 4]
    colors[k * 3 + 1] = template[i * 4 + 1]
    colors[k * 3 + 2] = template[i * 4 + 2]
  }

  const { data } = composite
  const errorAt = (x: number, y: number, limit: number) => {
    const base = (y * composite.width + x) * 4
    let error = 0
    for (let k = 0; k < count; k += 1) {
      const p = base + offsets[k]
      const dr = data[p] - colors[k * 3]
      const dg = data[p + 1] - colors[k * 3 + 1]
      const db = data[p + 2] - colors[k * 3 + 2]
      error += dr * dr + dg * dg + db * db
      if (error >= limit) return limit
    }
    return error
  }

  // Coarse pass on every other position, then refine around the best hit.
  const maxX = composite.width - tw
  const maxY = composite.height - th
  let best = Number.POSITIVE_INFINITY
  let bestX = 0
  let bestY = 0
  const search = (x0: number, x1: number, y0: number, y1: number, step: number) => {
    for (let y = Math.max(0, y0); y <= Math.min(maxY, y1); y += step) {
      for (let x = Math.max(0, x0); x <= Math.min(maxX, x1); x += step) {
        const error = errorAt(x, y, best)
        if (error < best) {
          best = error
          bestX = x
          bestY = y
        }
      }
    }
  }
  search(0, maxX, 0, maxY, 2)
  search(bestX - 2, bestX + 2, bestY - 2, bestY + 2, 1)

  if (Math.sqrt(best / (count * 3)) > MATCH_MAX_RMS) return null
  return {
    minX: bestX / scale,
    minY: bestY / scale,
    maxX: (bestX + tw) / scale,
    maxY: (bestY + th) / scale,
  }
}

/** The crops as thumb..pinky (left to right in the composite), or null if
 *  that can't be established. */
function orderCropsLeftToRight(composite: PreparedImage, crops: PreparedImage[]): PreparedImage[] | null {
  if (!composite.data) return null
  const scale = Math.min(1, MATCH_MAX_DIM / Math.max(composite.width, composite.height))
  const width = Math.max(1, Math.round(composite.width * scale))
  const height = Math.max(1, Math.round(composite.height * scale))
  const data = downscalePixels(composite.canvas, width, height)
  if (!data) return null
  const grid: PixelGrid = { data, width, height }

  type Located = { crop: PreparedImage; box: ContentBounds; cx: number; cy: number; area: number }
  const located: Located[] = []
  for (const crop of crops) {
    const box = locateCrop(grid, scale, crop)
    if (!box) continue
    located.push({
      crop,
      box,
      cx: (box.minX + box.maxX) / 2,
      cy: (box.minY + box.maxY) / 2,
      area: (box.maxX - box.minX) * (box.maxY - box.minY),
    })
  }

  const containsCenter = (outer: Located, inner: Located) =>
    inner.cx >= outer.box.minX && inner.cx <= outer.box.maxX && inner.cy >= outer.box.minY && inner.cy <= outer.box.maxY

  // A box holding the centers of two or more other boxes is one detection
  // that swallowed several tips; a box whose center falls inside a bigger
  // one is the same tip detected twice.
  const unique: Located[] = []
  located
    .filter((a) => located.filter((b) => b !== a && containsCenter(a, b)).length < 2)
    .sort((a, b) => b.area - a.area)
    .forEach((candidate) => {
      if (!unique.some((kept) => containsCenter(kept, candidate))) unique.push(candidate)
    })

  if (unique.length < FINGER_COUNT) return null
  return unique
    .slice(0, FINGER_COUNT)
    .sort((a, b) => a.cx - b.cx)
    .map((entry) => entry.crop)
}

// nailTipCropUrls (when the backend's detect-server segmentation succeeded at
// generation time, see NailDesignService.generateDesign) are individually
// matted nail-tip images. Prefer these over local segmentation: they come
// from the model actually trained to isolate nail tips, so they hold up on
// backgrounds/shadows/overlaps that the client-side color-distance heuristic
// above cannot. They're only usable once each one is known to belong to a
// specific finger, though (see orderCropsLeftToRight) - a crop on the wrong
// finger is worse than a slightly rougher local cutout on the right one.
// Older designs (generated before crops existed) simply won't have them.
export async function prepareNailDesignAsset(
    imageUrl: string,
    nailTipCropUrls?: string[] | null,
): Promise<NailDesignAsset> {
  const prepared = await loadPreparedImage(imageUrl)

  if (nailTipCropUrls && nailTipCropUrls.length >= FINGER_COUNT) {
    try {
      const crops = await Promise.all(nailTipCropUrls.map(loadPreparedImage))
      // With the composite's pixels unreadable there's no way to check the
      // crops' positions - and local segmentation needs those same pixels -
      // so exactly five crops keep their given order as the best available.
      const ordered =
        orderCropsLeftToRight(prepared, crops) ?? (crops.length === FINGER_COUNT && !prepared.data ? crops : null)
      if (ordered) {
        return {
          image: prepared.image,
          fingerNails: ordered.map((crop) =>
              normalizeNailCutout({ canvas: crop.canvas, aspectRatio: crop.width / crop.height }),
          ),
        }
      }
    } catch {
      // fall through to local segmentation of the composite image
    }
  }

  return {
    image: prepared.image,
    fingerNails: extractFingerNails(prepared).map(normalizeNailCutout),
  }
}
