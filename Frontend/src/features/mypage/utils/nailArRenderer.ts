import type { NailDesignAsset } from '@/features/mypage/utils/nailDesignAsset'
import {
  clampDesignAspect,
  computeNailPoses,
  tipFrame,
  tipOutline,
  type NailFit,
  type NailPose,
  type Point,
  type TipFrame,
  type TrackedHand,
} from '@/features/mypage/utils/fingerLandmarks'

// The destination quad the nail image gets warped onto, in the source image's
// corner order (top-left, top-right, bottom-right, bottom-left): over the
// outline the 3D tip would have (see tipOutline) - its cuticle edge there,
// extending frame.length along frame.axis projected onto the screen by
// dropping depth, so the quad gets the right foreshortening for free when the
// finger tilts toward the camera. The image's top edge is the tip's cuticle
// end, so it goes on the cuticle edge; its left edge goes on the -across side
// (see NailPose.across).
function getNailQuad(pose: NailPose, frame: TipFrame): [Point, Point, Point, Point] | null {
  const outline = tipOutline(pose.origin, frame, pose.width)
  if (!outline) return null
  const { cuticle, across } = outline
  const { axis, length } = frame
  const halfW = outline.width / 2
  const corner = (side: number, along: number): Point => ({
    x: cuticle.x + across.x * halfW * side + axis.x * along,
    y: cuticle.y + across.y * halfW * side + axis.y * along,
  })
  return [corner(-1, 0), corner(1, 0), corner(1, length), corner(-1, length)]
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

function drawFingerNail(ctx: CanvasRenderingContext2D, pose: NailPose, asset: NailDesignAsset) {
  const nailAsset = asset.fingerNails[pose.finger.nailIndex]
  if (!nailAsset) return

  const opacity = pose.opacity
  if (opacity <= 0) return

  // Preserve the cutout's own proportions - derive length from the measured
  // width, so the design is scaled, not stretched/squashed (unless it's too
  // short to cover the nail at all - see tipFrame).
  const frame = tipFrame(pose, pose.width / clampDesignAspect(nailAsset.aspectRatio))
  const nailLength = frame.length
  const quad = getNailQuad(pose, frame)
  if (!quad) return

  ctx.save()
  ctx.globalAlpha = 0.94 * opacity
  // Cast against the nail's own alpha shape (a precise cutout, not a bounding
  // box) so the shadow grounds it on the finger instead of floating.
  ctx.shadowColor = 'rgba(10, 8, 12, 0.35)'
  ctx.shadowBlur = Math.max(2, nailLength * 0.05)
  ctx.shadowOffsetY = nailLength * 0.03
  if (pose.cutoff) {
    // Only the side of the cutoff line the free edge is on.
    const { point, normal } = pose.cutoff
    const reach = nailLength * 4
    const side = { x: -normal.y * reach, y: normal.x * reach }
    ctx.beginPath()
    ctx.moveTo(point.x - side.x, point.y - side.y)
    ctx.lineTo(point.x + side.x, point.y + side.y)
    ctx.lineTo(point.x + side.x + normal.x * reach, point.y + side.y + normal.y * reach)
    ctx.lineTo(point.x - side.x + normal.x * reach, point.y - side.y + normal.y * reach)
    ctx.closePath()
    ctx.clip()
  }
  drawImageWarped(ctx, nailAsset.canvas, quad)
  ctx.restore()
}

export function drawNailOverlays(
  ctx: CanvasRenderingContext2D,
  hand: TrackedHand,
  asset: NailDesignAsset,
  width: number,
  height: number,
  mirror: boolean,
  fits?: ReadonlyArray<NailFit | null>,
) {
  for (const pose of computeNailPoses(hand, width, height, mirror, fits)) {
    drawFingerNail(ctx, pose, asset)
  }
}
