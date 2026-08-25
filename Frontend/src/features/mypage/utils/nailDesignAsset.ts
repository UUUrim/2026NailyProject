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

function isContentPixel(r: number, g: number, b: number, a: number) {
  if (a < 20) return false
  const isNearWhite = r > 235 && g > 235 && b > 235
  const isNearBlack = r < 15 && g < 15 && b < 15
  return !isNearWhite && !isNearBlack
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

async function loadPreparedImage(imageUrl: string): Promise<PreparedImage> {
  try {
    const response = await fetch(imageUrl, { credentials: 'include' })
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

  let data: Uint8ClampedArray | null = null
  try {
    data = ctx.getImageData(0, 0, width, height).data
  } catch {
    data = null
  }

  return { image, canvas, width, height, data }
}

function getContentBounds(
  width: number,
  height: number,
  data: Uint8ClampedArray | null,
): ContentBounds {
  if (!data) {
    return { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 }
  }

  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0
  let found = false

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      if (!isContentPixel(data[i], data[i + 1], data[i + 2], data[i + 3])) continue
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
  height: number,
  data: Uint8ClampedArray,
  bounds: ContentBounds,
): NailBlob[] {
  const visited = new Uint8Array(width * height)
  const blobs: NailBlob[] = []
  const minBlobPixels = Math.max(
    40,
    Math.floor((bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1) * 0.008),
  )

  const idx = (x: number, y: number) => y * width + x
  const isFilled = (x: number, y: number) => {
    if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) return false
    const i = idx(x, y) * 4
    return isContentPixel(data[i], data[i + 1], data[i + 2], data[i + 3])
  }

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const flat = idx(x, y)
      if (visited[flat] || !isFilled(x, y)) continue

      const queue: Array<[number, number]> = [[x, y]]
      visited[flat] = 1

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
          queue.push([nx, ny])
        }
      }

      if (pixels < minBlobPixels) continue

      blobs.push({
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

  return blobs.sort((a, b) => a.centerX - b.centerX)
}

function createFingerCanvas(
  sourceCanvas: HTMLCanvasElement,
  bounds: ContentBounds,
): FingerNailAsset {
  const w = Math.max(1, bounds.maxX - bounds.minX + 1)
  const h = Math.max(1, bounds.maxY - bounds.minY + 1)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('손가락별 네일 캔버스를 초기화할 수 없습니다.')
  }
  ctx.drawImage(
    sourceCanvas,
    bounds.minX,
    bounds.minY,
    w,
    h,
    0,
    0,
    w,
    h,
  )
  return { canvas, aspectRatio: w / h }
}

function findVerticalSplitLines(
  width: number,
  data: Uint8ClampedArray,
  bounds: ContentBounds,
): number[] {
  const cropW = bounds.maxX - bounds.minX + 1
  const densities = new Array<number>(cropW).fill(0)

  for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
    let count = 0
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      const i = (y * width + x) * 4
      if (isContentPixel(data[i], data[i + 1], data[i + 2], data[i + 3])) {
        count += 1
      }
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
  sourceCanvas: HTMLCanvasElement,
  width: number,
  height: number,
  data: Uint8ClampedArray,
  bounds: ContentBounds,
): FingerNailAsset[] {
  const splitLines = findVerticalSplitLines(width, data, bounds)
  const xStarts = [bounds.minX, ...splitLines]
  const xEnds = [...splitLines, bounds.maxX + 1]
  const nails: FingerNailAsset[] = []

  for (let i = 0; i < FINGER_COUNT; i += 1) {
    const x0 = xStarts[i]
    const x1 = xEnds[i]
    let segMinY = bounds.maxY
    let segMaxY = bounds.minY

    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const pixel = (y * width + x) * 4
        if (!isContentPixel(data[pixel], data[pixel + 1], data[pixel + 2], data[pixel + 3])) continue
        segMinY = Math.min(segMinY, y)
        segMaxY = Math.max(segMaxY, y)
      }
    }

    if (segMaxY < segMinY) {
      segMinY = bounds.minY
      segMaxY = bounds.maxY
    }

    nails.push(
      createFingerCanvas(sourceCanvas, {
        minX: x0,
        minY: segMinY,
        maxX: x1 - 1,
        maxY: segMaxY,
      }),
    )
  }

  return nails
}

function splitRowIntoFive(
  sourceCanvas: HTMLCanvasElement,
  width: number,
  height: number,
  data: Uint8ClampedArray | null,
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

    if (data) {
      for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const pixel = (y * width + x) * 4
          if (!isContentPixel(data[pixel], data[pixel + 1], data[pixel + 2], data[pixel + 3])) continue
          segMinY = Math.min(segMinY, y)
          segMaxY = Math.max(segMaxY, y)
        }
      }
    }

    if (segMaxY < segMinY) {
      segMinY = bounds.minY
      segMaxY = bounds.minY + cropH - 1
    }

    nails.push(
      createFingerCanvas(sourceCanvas, {
        minX: x0,
        minY: segMinY,
        maxX: x1 - 1,
        maxY: segMaxY,
      }),
    )
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
  const bounds = getContentBounds(width, height, data)

  if (data) {
    const blobs = findNailBlobs(width, height, data, bounds)

    if (blobs.length === FINGER_COUNT) {
      return blobs.map((blob) => createFingerCanvas(canvas, blob))
    }

    if (blobs.length > FINGER_COUNT) {
      return pickFingerBlobs(blobs).map((blob) => createFingerCanvas(canvas, blob))
    }

    return splitByProjection(canvas, width, height, data, bounds)
  }

  return splitRowIntoFive(canvas, width, height, data, bounds)
}

export async function prepareNailDesignAsset(imageUrl: string): Promise<NailDesignAsset> {
  const prepared = await loadPreparedImage(imageUrl)
  const fingerNails = extractFingerNails(prepared)

  return {
    image: prepared.image,
    fingerNails,
  }
}
