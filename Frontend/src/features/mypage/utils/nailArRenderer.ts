import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { NailDesignAsset } from '@/features/mypage/utils/nailDesignAsset'

type FingerConfig = {
  tip: number
  dip: number
  scale: number
  nailIndex: number
}

const FINGERS: FingerConfig[] = [
  { tip: 4, dip: 3, scale: 1.05, nailIndex: 0 },
  { tip: 8, dip: 7, scale: 1, nailIndex: 1 },
  { tip: 12, dip: 11, scale: 1, nailIndex: 2 },
  { tip: 16, dip: 15, scale: 0.96, nailIndex: 3 },
  { tip: 20, dip: 19, scale: 0.9, nailIndex: 4 },
]

function toPixel(
  landmark: NormalizedLandmark,
  width: number,
  height: number,
  mirror: boolean,
) {
  const x = mirror ? (1 - landmark.x) * width : landmark.x * width
  const y = landmark.y * height
  return { x, y }
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function drawFingerNail(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  finger: FingerConfig,
  asset: NailDesignAsset,
  width: number,
  height: number,
  mirror: boolean,
) {
  const tip = landmarks[finger.tip]
  const dip = landmarks[finger.dip]
  const nailAsset = asset.fingerNails[finger.nailIndex]
  if (!tip || !dip || !nailAsset) return

  const tipPx = toPixel(tip, width, height, mirror)
  const dipPx = toPixel(dip, width, height, mirror)

  const segment = distance(tipPx, dipPx)
  if (segment < 6) return

  const centerX = dipPx.x + (tipPx.x - dipPx.x) * 0.72
  const centerY = dipPx.y + (tipPx.y - dipPx.y) * 0.72
  const angle = Math.atan2(tipPx.y - dipPx.y, tipPx.x - dipPx.x) - Math.PI / 2

  const nailLength = segment * 1.05 * finger.scale
  const nailWidth = nailLength * nailAsset.aspectRatio * 0.78

  ctx.save()
  ctx.translate(centerX, centerY)
  ctx.rotate(angle)
  ctx.globalAlpha = 0.94
  ctx.drawImage(
    nailAsset.canvas,
    -nailWidth / 2,
    -nailLength * 0.12,
    nailWidth,
    nailLength,
  )
  ctx.restore()
}

export function drawNailOverlays(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  asset: NailDesignAsset,
  width: number,
  height: number,
  mirror: boolean,
) {
  for (const finger of FINGERS) {
    drawFingerNail(ctx, landmarks, finger, asset, width, height, mirror)
  }
}
