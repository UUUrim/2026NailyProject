import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { NailDesignAsset } from '@/features/mypage/utils/nailDesignAsset'
import { FINGERS, computeFingerPlacement, type Point } from '@/features/mypage/utils/fingerLandmarks'

// How much a fore/aft tilt narrows the far edge of the nail quad, for a basic
// perspective cue when the hand rotates. Bounded so a noisy depth reading
// can't invert or flatten it.
const MAX_TILT_TAPER = 0.32

// Builds the destination quad (tip-left, tip-right, base-right, base-left)
// the nail image gets warped onto: a rectangle anchored at the cuticle point
// (baseX, baseY) and extending nailLength toward the fingertip, rotated by
// angle. Tapered at the tip/base ends by tipTaper/baseTaper to give a
// foreshortening cue when the finger tilts toward or away from the camera.
//
// Local frame: y=0 is the cuticle (anchored at baseX,baseY), y=+nailLength
// is the fingertip - matches computeFingerPlacement()'s angle convention,
// where a local point (0, v) rotates to world offset v*(dirX,dirY), i.e.
// toward the fingertip for v>0.
function getNailQuad(
  baseX: number,
  baseY: number,
  angle: number,
  nailWidth: number,
  nailLength: number,
  tipTaper: number,
  baseTaper: number,
): [Point, Point, Point, Point] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const tipHalfW = (nailWidth / 2) * tipTaper
  const baseHalfW = (nailWidth / 2) * baseTaper

  const local: Point[] = [
    { x: -tipHalfW, y: nailLength },
    { x: tipHalfW, y: nailLength },
    { x: baseHalfW, y: 0 },
    { x: -baseHalfW, y: 0 },
  ]

  return local.map((p) => ({
    x: baseX + p.x * cos - p.y * sin,
    y: baseY + p.x * sin + p.y * cos,
  })) as [Point, Point, Point, Point]
}

// Solves the 2D affine matrix mapping source triangle -> destination
// triangle (the standard 3-point affine solve). Combining two such triangles
// lets a rectangular source image be warped onto an arbitrary quadrilateral
// with plain Canvas 2D transforms - no WebGL needed.
function affineFromTriangles(src: [Point, Point, Point], dst: [Point, Point, Point]) {
  const [s0, s1, s2] = src
  const [d0, d1, d2] = dst

  const denom = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y)
  if (Math.abs(denom) < 1e-6) return null

  const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denom
  const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denom
  const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denom
  const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denom
  const e =
    (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) /
    denom
  const f =
    (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) /
    denom

  return { a, b, c, d, e, f }
}

function drawTriangleWarp(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  srcTri: [Point, Point, Point],
  dstTri: [Point, Point, Point],
) {
  const m = affineFromTriangles(srcTri, dstTri)
  if (!m) return

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(dstTri[0].x, dstTri[0].y)
  ctx.lineTo(dstTri[1].x, dstTri[1].y)
  ctx.lineTo(dstTri[2].x, dstTri[2].y)
  ctx.closePath()
  ctx.clip()
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f)
  ctx.drawImage(image, 0, 0)
  ctx.restore()
}

// Warps the full source canvas onto an arbitrary quad by splitting both into
// two triangles (TL/TR/BL and TR/BR/BL) and affine-mapping each pair - a
// standard piecewise-affine approximation of a perspective warp.
function drawImageWarped(ctx: CanvasRenderingContext2D, source: HTMLCanvasElement, quad: [Point, Point, Point, Point]) {
  const w = source.width
  const h = source.height
  const srcTL: Point = { x: 0, y: 0 }
  const srcTR: Point = { x: w, y: 0 }
  const srcBR: Point = { x: w, y: h }
  const srcBL: Point = { x: 0, y: h }
  const [dstTL, dstTR, dstBR, dstBL] = quad

  drawTriangleWarp(ctx, source, [srcTL, srcTR, srcBL], [dstTL, dstTR, dstBL])
  drawTriangleWarp(ctx, source, [srcTR, srcBR, srcBL], [dstTR, dstBR, dstBL])
}

function drawFingerNail(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  finger: (typeof FINGERS)[number],
  asset: NailDesignAsset,
  width: number,
  height: number,
  mirror: boolean,
) {
  const nailAsset = asset.fingerNails[finger.nailIndex]
  if (!nailAsset) return

  const placement = computeFingerPlacement(landmarks, finger, width, height, mirror, (segment) =>
    segment * nailAsset.aspectRatio * 0.85,
  )
  if (!placement) return

  const { baseX, baseY, angle, width: nailWidth, tilt } = placement
  // Preserve the cutout's own proportions - derive length from the measured
  // width instead of an independent landmark-based length estimate, so the
  // design is scaled, never stretched/squashed.
  const nailLength = nailWidth / nailAsset.aspectRatio
  const tipTaper = 1 - Math.max(0, tilt) * MAX_TILT_TAPER
  const baseTaper = 1 - Math.max(0, -tilt) * MAX_TILT_TAPER

  const quad = getNailQuad(baseX, baseY, angle, nailWidth, nailLength, tipTaper, baseTaper)

  ctx.save()
  ctx.globalAlpha = 0.94
  // Cast against the nail's own alpha shape (a precise cutout, not a bounding
  // box) so the shadow grounds it on the finger instead of floating.
  ctx.shadowColor = 'rgba(10, 8, 12, 0.35)'
  ctx.shadowBlur = Math.max(2, nailLength * 0.05)
  ctx.shadowOffsetY = nailLength * 0.03
  drawImageWarped(ctx, nailAsset.canvas, quad)
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
