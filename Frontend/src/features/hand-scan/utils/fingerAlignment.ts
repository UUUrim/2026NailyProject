function isSkinTone(r: number, g: number, b: number): boolean {
  if (r < 55 || g < 35 || b < 25) return false
  if (r <= g || g <= b) return false
  if (r - g < 12) return false
  if (Math.max(r, g, b) - Math.min(r, g, b) < 18) return false
  return true
}

function isNailTone(r: number, g: number, b: number): boolean {
  if (r < 140 || g < 110 || b < 100) return false
  const brightness = (r + g + b) / 3
  if (brightness < 150 || brightness > 245) return false
  if (Math.abs(r - g) > 35) return false
  return r >= g && g >= b
}

/** 중앙 영역에 손가락/손톱이 들어왔는지 0~1 점수로 반환 */
export function scoreVideoAlignment(video: HTMLVideoElement): number {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return 0
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return 0

  const canvas = document.createElement('canvas')
  const size = 72
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return 0

  const cropW = vw * 0.42
  const cropH = vh * 0.42
  const sx = (vw - cropW) / 2
  const sy = (vh - cropH) / 2
  ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, size, size)

  const { data } = ctx.getImageData(0, 0, size, size)
  const total = size * size
  let skinCount = 0
  let nailCount = 0

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]

      if (isSkinTone(r, g, b)) skinCount++
      if (y < size * 0.45 && isNailTone(r, g, b)) nailCount++
    }
  }

  const skinRatio = skinCount / total
  const nailRatio = nailCount / (total * 0.45)
  return Math.min(1, skinRatio * 1.6 + nailRatio * 0.8)
}

export function isDualFeedAligned(
  leftVideo: HTMLVideoElement | null,
  rightVideo: HTMLVideoElement | null,
  threshold = 0.22,
): boolean {
  if (!leftVideo || !rightVideo) return false
  const left = scoreVideoAlignment(leftVideo)
  const right = scoreVideoAlignment(rightVideo)
  return left >= threshold && right >= threshold
}
