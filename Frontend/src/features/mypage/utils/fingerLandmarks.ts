import type { Landmark, NormalizedLandmark } from '@mediapipe/tasks-vision'

export type Point = { x: number; y: number }
export type Vec3 = { x: number; y: number; z: number }

/** One tracked hand as the AR renderers consume it (see landmarkSmoothing.ts). */
export type TrackedHand = {
  /** Stable for as long as HandTracker keeps following the same hand. */
  id: number
  landmarks: NormalizedLandmark[]
  /** MediaPipe's metric 3D landmarks (meters, camera-aligned axes, origin at
   *  the hand's center) - used for hand scale and as a depth hint. */
  worldLandmarks: Landmark[] | null
  /** Smoothed handedness in [-1, 1]: +1 = confidently a physical right hand,
   *  -1 = left, ~0 = unknown. Measured on the raw (unmirrored) camera frame -
   *  MediaPipe Tasks labels the physical hand correctly there (checked on a
   *  real right-hand photo: palm and back view both come back "Right"). */
  handedness: number
}

export type FingerConfig = {
  name: 'thumb' | 'index' | 'middle' | 'ring' | 'pinky'
  tip: number
  dip: number
  /** Which cutout of the design image goes on this finger - the design image
   *  lays its five tips out left to right as thumb, index, middle, ring,
   *  pinky, so this is simply the finger's position in that row. */
  nailIndex: number
  /** Nail width as a fraction of the hand's palm length (wrist landmark to
   *  middle-finger knuckle) - measured off the real nails in a back-of-hand
   *  photo (index/middle/ring ~0.14, pinky ~0.11), in line with average adult
   *  proportions. */
  widthRatio: number
  /** Where the cuticle sits along the DIP->TIP segment. The joint landmark is
   *  inside the finger and the nail plate only starts past it - on a real
   *  back-of-hand photo the cuticle line lands just over halfway to the tip
   *  landmark. */
  cuticleT: number
  /** DIP->TIP length as a fraction of palm length, i.e. how long the
   *  fingertip segment looks on screen while it lies flat to the camera -
   *  shorter than that means it's pointing toward/away from the camera. */
  distalRatio: number
}

export const FINGERS: FingerConfig[] = [
  { name: 'thumb', tip: 4, dip: 3, nailIndex: 0, widthRatio: 0.165, cuticleT: 0.5, distalRatio: 0.26 },
  { name: 'index', tip: 8, dip: 7, nailIndex: 1, widthRatio: 0.138, cuticleT: 0.52, distalRatio: 0.24 },
  { name: 'middle', tip: 12, dip: 11, nailIndex: 2, widthRatio: 0.142, cuticleT: 0.52, distalRatio: 0.26 },
  { name: 'ring', tip: 16, dip: 15, nailIndex: 3, widthRatio: 0.135, cuticleT: 0.52, distalRatio: 0.25 },
  { name: 'pinky', tip: 20, dip: 19, nailIndex: 4, widthRatio: 0.11, cuticleT: 0.52, distalRatio: 0.21 },
]

const WRIST = 0
const THUMB_CMC = 1
const THUMB_MCP = 2
const INDEX_MCP = 5
const MIDDLE_MCP = 9
const RING_MCP = 13
const PINKY_MCP = 17
const KNUCKLES = [INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP]

// Index-to-pinky knuckle span relative to palm length, from MediaPipe's own
// skeleton of a real hand. Lets the across-the-palm span stand in for palm
// length when the hand tips forward/back and the palm itself foreshortens.
const KNUCKLE_SPAN_RATIO = 0.68

// Tilt from foreshortening is sqrt(trueLength^2 - onScreen^2), which is
// extremely sensitive near zero tilt: a bone predicted just 7% too long
// already reads as a 22 degree tilt. Treat anything showing at least this
// fraction of its expected length as flat - small real tilts barely change
// how a nail looks anyway, while a false one visibly squashes every nail.
const FLAT_LENGTH_FRACTION = 0.9

// The thumb is rotated about its own axis relative to the other fingers -
// with the back of the hand to the camera its nail faces partly sideways,
// away from the index finger. Joint centers alone can't show that roll, so
// apply it as a fixed anatomical offset.
const THUMB_PRONATION = (40 * Math.PI) / 180

// The landmarks run down the middle of the finger, but the nail sits on its
// back surface - about half a finger-thickness out along the nail normal.
// Invisible while the nail faces the camera, but once the finger rolls the
// nail visibly slides toward the side that's turning away. Expressed as a
// fraction of nail width (the finger is roughly as thick as its nail is wide).
const SURFACE_OFFSET_RATIO = 0.45

// Below this |handedness| the label is too unsure to decide which side of the
// hand is its back, so assume the back faces the camera (the pose the try-on
// asks for) instead of risking hiding every nail on a misread.
const HANDEDNESS_CONFIDENCE = 0.3

// How far a nail tilts toward/away from the camera, for one measured in the
// image, comes from how short it looks against how wide: a nail facing the
// camera shows about this length (cuticle to free edge) per drawn tip width.
// The landmarks' depth can't be trusted for it with the fingers curled toward
// the camera - on a live claw they tilted the tips so far that they came out
// about a third too short, squashing the design and baring the nail's free
// edge below them. Never foreshortened below MIN_FIT_FORESHORTENING.
const NAIL_LENGTH_RATIO = 1.1
const MIN_FIT_FORESHORTENING = 0.5
// A tip is drawn at least this times as long on screen as the nail it covers,
// stretching its design lengthwise by up to MAX_TIP_STRETCH if it has to.
const TIP_COVER = 1.03
const MAX_TIP_STRETCH = 1.25

// The tip templates (public/models/nail-tips, from
// scan/export_shape_templates.py) curve across as a circular arc of this
// radius, in nail widths, spanning their whole width - a deep C whose edges
// sit 0.39 widths below the top of the dome. Turned about its own axis, such
// a tip narrows on screen and its far side wraps out of sight.
const TIP_ARC_RADIUS = 0.516
const TIP_ARC_HALF_ANGLE = Math.asin(0.5 / TIP_ARC_RADIUS)
// With the back of the hand to the camera the thumbnail faces partly
// sideways, so it shows narrower than it is. A fitted thumb tip is drawn at
// the thumbnail's true width, turned until its outline is as narrow as the
// nail found in the image - so it shows from the side like the nail, its far
// part cut off, instead of as a shrunken front view. Turned at most this far;
// a nail narrower still is taken to be smaller than expected.
const MAX_THUMB_ROLL = (80 * Math.PI) / 180

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s }
}

function dot(a: Vec3, b: Vec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}

function length(a: Vec3) {
  return Math.hypot(a.x, a.y, a.z)
}

function normalize(a: Vec3): Vec3 | null {
  const len = length(a)
  return len > 1e-6 ? scale(a, 1 / len) : null
}

/** a turned by `angle` about the view (z) axis. */
function rotateAboutView(a: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c, z: a.z }
}

/** Unit vector `a` tilted, keeping its on-screen direction and which way it
 *  leans in depth, so that its on-screen length is `flat`. */
function withFlatLength(a: Vec3, flat: number): Vec3 {
  const onScreen = Math.hypot(a.x, a.y)
  if (onScreen < 1e-6) return a
  return {
    x: (a.x / onScreen) * flat,
    y: (a.y / onScreen) * flat,
    z: (a.z >= 0 ? 1 : -1) * Math.sqrt(Math.max(0, 1 - flat * flat)),
  }
}

/** a turned by `angle` about unit vector k (right-hand rule). */
function rotateAbout(a: Vec3, k: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return add(add(scale(a, c), scale(cross(k, a), s)), scale(k, dot(k, a) * (1 - c)))
}

/** a with its component along unit vector n removed, normalized. */
function orthogonalize(a: Vec3, n: Vec3): Vec3 | null {
  return normalize(sub(a, scale(n, dot(a, n))))
}

/**
 * Where a tip's outline falls on screen across its nail, in nail widths from
 * the top of its dome along the on-screen direction across it, for a tip
 * turned `roll` radians about its own axis: from that direction to the
 * tip's own across, positive when its normal leans that way (that side then
 * wraps out of sight).
 */
function tipSpan(roll: number) {
  // A point on the arc at angle phi from the top (toward the tip's own
  // across) lands at R * (sin(phi + roll) - sin(roll)), phi within
  // +-TIP_ARC_HALF_ANGLE.
  const first = roll - TIP_ARC_HALF_ANGLE
  const last = roll + TIP_ARC_HALF_ANGLE
  const hi = first <= Math.PI / 2 && Math.PI / 2 <= last ? 1 : Math.max(Math.sin(first), Math.sin(last))
  const lo = first <= -Math.PI / 2 && -Math.PI / 2 <= last ? -1 : Math.min(Math.sin(first), Math.sin(last))
  const shift = Math.sin(roll)
  return { lo: TIP_ARC_RADIUS * (lo - shift), hi: TIP_ARC_RADIUS * (hi - shift) }
}

/** On-screen width of a turned tip's outline, in nail widths (see tipSpan). */
function tipSpanWidth(roll: number) {
  const { lo, hi } = tipSpan(roll)
  return hi - lo
}

/** A thumbnail's roll and true width (see MAX_THUMB_ROLL), from its
 *  on-screen width and the width it should have. */
function thumbRoll(onScreen: number, expected: number) {
  if (onScreen >= expected) return { angle: 0, width: onScreen }
  const narrowest = tipSpanWidth(MAX_THUMB_ROLL)
  if (onScreen <= expected * narrowest) return { angle: MAX_THUMB_ROLL, width: onScreen / narrowest }
  // The outline narrows steadily as the tip turns: bisect for the angle.
  let lo = 0
  let hi = MAX_THUMB_ROLL
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2
    if (tipSpanWidth(mid) * expected > onScreen) lo = mid
    else hi = mid
  }
  return { angle: (lo + hi) / 2, width: expected }
}

/**
 * The on-screen direction across a tip posed along axis/across/normal (a
 * unit vector on the side `across` points to) and its outline's extent along
 * it, in nail widths from the top of the dome - null if the tip points
 * straight at the camera.
 */
function tipOutlineSpan(axis: Vec3, across: Vec3, normal: Vec3) {
  const flat = Math.hypot(axis.x, axis.y)
  if (flat < 1e-6) return null
  let dir = { x: -axis.y / flat, y: axis.x / flat }
  if (dir.x * across.x + dir.y * across.y < 0) dir = { x: -dir.x, y: -dir.y }
  const roll = Math.atan2(dir.x * normal.x + dir.y * normal.y, dir.x * across.x + dir.y * across.y)
  return { dir, ...tipSpan(roll) }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * The hand in raw-camera pixel space - x right / y down (image pixels), z
 * away from the camera in the same pixel units - reduced to what the nail
 * poses need: the palm points and thumb knuckle in 3D, the palm length in
 * pixels, and a way to get any bone's depth step.
 *
 * x/y come straight from the image landmarks, the most accurate thing
 * MediaPipe gives. Depth is the weak part: on a real photo of a flat hand
 * held square to the camera, MediaPipe's world landmarks put the wrist ~5 cm
 * farther away than the knuckles and tilted every fingertip ~40 degrees back.
 * Used as-is that tilts and foreshortens every nail, so a bone only gets
 * depth when two independent cues agree:
 *  - the world landmarks' depth step along it (the network's guess), and
 *  - how much shorter it looks on screen than its true length (geometry: a
 *    bone tilted out of the screen plane projects shorter).
 * It gets the smaller of the two, signed by the network - so a bone showing
 * its full length on screen stays flat whatever the network claims.
 *
 * World landmarks also give the pixel scale, but only the wrist-to-knuckle
 * bones are trustworthy for it: their world lengths stay put between palm
 * and back views of the same hand, while finger segments and the knuckle
 * span shift by 20-40%.
 */
function handGeometry(hand: TrackedHand, width: number, height: number) {
  const { landmarks, worldLandmarks } = hand
  const world = worldLandmarks && worldLandmarks.length === landmarks.length ? worldLandmarks : null
  const image: Vec3[] = landmarks.map((p) => ({ x: p.x * width, y: p.y * height, z: 0 }))
  const screenLength = (a: number, b: number) => Math.hypot(image[a].x - image[b].x, image[a].y - image[b].y)
  const knuckleSpan = screenLength(INDEX_MCP, PINKY_MCP)

  let palmLength: number
  let networkStep: (a: number, b: number) => number
  let trueLength: (a: number, b: number) => number
  if (world) {
    const worldLength = (a: number, b: number) => length(sub(world[a], world[b]))
    // Median over the wrist->knuckle bones, but never less than what the
    // knuckle span implies: when the hand tips forward/back those bones all
    // foreshorten together while the span across them doesn't.
    const fromPalm = median([INDEX_MCP, MIDDLE_MCP, RING_MCP].map((k) => screenLength(WRIST, k) / worldLength(WRIST, k)))
    const fromSpan = knuckleSpan / (KNUCKLE_SPAN_RATIO * worldLength(WRIST, MIDDLE_MCP))
    const pxPerWorld = Math.max(fromPalm, fromSpan)
    palmLength = worldLength(WRIST, MIDDLE_MCP) * pxPerWorld
    networkStep = (a, b) => (world[b].z - world[a].z) * pxPerWorld
    trueLength = (a, b) => worldLength(a, b) * pxPerWorld
  } else {
    // Normalized z is "roughly the same scale as x" - a weaker hint.
    palmLength = Math.max(screenLength(WRIST, MIDDLE_MCP), knuckleSpan / KNUCKLE_SPAN_RATIO)
    networkStep = (a, b) => (landmarks[b].z - landmarks[a].z) * width
    trueLength = (a, b) => screenLength(a, b)
  }

  /** Signed depth change from landmark a to b, given b's true distance from
   *  a in pixels. Positive = b is farther from the camera. */
  const depthStep = (a: number, b: number, boneLength: number) => {
    const onScreen = screenLength(a, b)
    const flatLength = boneLength * FLAT_LENGTH_FRACTION
    const fromForeshortening = Math.sqrt(Math.max(0, flatLength * flatLength - onScreen * onScreen))
    const fromNetwork = networkStep(a, b)
    return Math.sign(fromNetwork) * Math.min(Math.abs(fromNetwork), fromForeshortening)
  }

  const points = image.map((p) => ({ ...p }))
  for (const k of KNUCKLES) points[k].z = depthStep(WRIST, k, trueLength(WRIST, k))
  points[THUMB_CMC].z = depthStep(WRIST, THUMB_CMC, trueLength(WRIST, THUMB_CMC))
  points[THUMB_MCP].z = points[THUMB_CMC].z + depthStep(THUMB_CMC, THUMB_MCP, trueLength(THUMB_CMC, THUMB_MCP))

  return { points, palmLength, depthStep }
}

export type NailPose = {
  finger: FingerConfig
  /** Display-space position of the nail's cuticle end, on the nail surface.
   *  Display space = the (mirrored, if mirror) video canvas: x right, y down
   *  in pixels, z toward the viewer. */
  origin: Vec3
  /** Unit, along the nail from cuticle toward the free edge. */
  axis: Vec3
  /** Unit, the direction the design image's left->right runs across the nail
   *  (= axis x normal in display space). The design image shows each tip
   *  with its cuticle end at the top, so a tip goes onto its nail the way a
   *  real press-on would: turned so the image's top meets the cuticle - with
   *  the finger pointing up, that's the tip rotated 180 degrees (its left
   *  edge on the right). Rotated, never mirrored, whichever hand and whether
   *  or not the video is mirrored. Which tip goes on which finger is separate
   *  and fixed: FingerConfig.nailIndex, leftmost tip in the image = thumb. */
  across: Vec3
  /** Unit, outward from the nail surface. */
  normal: Vec3
  /** True nail width in pixels (not foreshortened - the renderers project). */
  width: number
  /** How squarely the landmarks say the nail faces the viewer: 1 = facing,
   *  <= 0 = turned away (palm side). Drives fading - for a fitted nail even
   *  though `normal` is then turned to face the viewer. */
  facing: number
  /** The hand shows its palm side to the camera (the nail is only visible
   *  because the finger curls toward it). */
  palmTowardCamera: boolean
  /** On-screen length of the real nail the tip has to cover, px, if measured
   *  (NailFit.length) - see tipFrame. */
  visibleLength: number | null
  /** Where the tip is cut off before its cuticle end, if anywhere: a line on
   *  screen (display space) through `point`, the tip hidden on the side
   *  `normal` (unit, toward the free edge) points away from. */
  cutoff: { point: Point; normal: Point } | null
  /** How opaque to draw the tip: by `facing`, or fully while the model sees
   *  the nail (NailFit.seen). */
  opacity: number
}

/** Where a nail actually is in the camera image (see nailFit.ts), overriding
 *  what the landmarks alone would put there. */
export type NailFit = {
  /** Center of the nail's proximal (cuticle) edge, raw camera pixels. */
  cuticle: Point
  /** In-plane correction, radians, to the DIP->TIP direction on screen
   *  (positive turns it from +x toward +y in raw camera pixels). */
  rotation: number
  /** How wide the tip should appear on screen, raw camera pixels. */
  width: number
  /** How long the nail itself (cuticle to free edge) appears on screen, raw
   *  camera pixels - known only from a model mask. */
  length?: number
  /** The nail's proximal edge on screen as a line, with no part of the nail
   *  before it - known only from a model mask: how much further along the
   *  nail it runs per pixel across (across = the nail's direction turned
   *  +90 degrees, raw camera pixels), and how far along from `cuticle` it
   *  passes it (px). */
  cuticleEdge?: { slope: number; offset: number }
  /** The segmentation model is currently finding this nail - so it's in
   *  view, whatever the landmarks say about which way it faces. */
  seen?: boolean
}

/**
 * Full 3D pose of every nail on one hand, from that frame's landmarks -
 * refined by `fits` (indexed like FINGERS) where the nail was found in the
 * image. Shared by the 3D mesh renderer and the 2D canvas-warp fallback so
 * both place, size, orient and hide nails identically.
 */
export function computeNailPoses(
  hand: TrackedHand,
  width: number,
  height: number,
  mirror: boolean,
  fits?: ReadonlyArray<NailFit | null>,
): NailPose[] {
  if (hand.landmarks.length < 21) return []
  const { points: P, palmLength, depthStep } = handGeometry(hand, width, height)
  if (!(palmLength > 1)) return []

  const radial = normalize(sub(P[INDEX_MCP], P[PINKY_MCP])) // pinky side -> thumb side
  const distal = normalize(sub(P[MIDDLE_MCP], P[WRIST]))
  if (!radial || !distal) return []

  // radial x distal is the palm-plane normal; which way it points relative to
  // the back of the hand depends on the hand. For a physical right hand in
  // raw camera space (z away from camera) it points out of the palm, so the
  // back-of-hand (nail) side is its negation; mirrored for a left hand.
  const palmNormal = cross(radial, distal)
  let side: number
  if (Math.abs(hand.handedness) >= HANDEDNESS_CONFIDENCE) {
    side = hand.handedness > 0 ? -1 : 1
  } else {
    side = palmNormal.z > 0 ? -1 : 1 // whichever makes the back face the camera
  }
  // The back-of-hand normal is side * palmNormal; raw z points away from the
  // camera.
  const palmTowardCamera = side * palmNormal.z > 0

  const poses: NailPose[] = []

  for (const [fingerIdx, finger] of FINGERS.entries()) {
    const fit = fits?.[fingerIdx] ?? null
    const dip = P[finger.dip]
    const tipFlat = P[finger.tip]
    const tip = { ...tipFlat, z: dip.z + depthStep(finger.dip, finger.tip, palmLength * finger.distalRatio) }
    const segment = normalize(sub(tip, dip))
    if (!segment) continue
    // A nail found in the image brings its own on-screen direction - and,
    // measured from a model mask, how far it tilts toward/away from the
    // camera (below); otherwise that tilt comes from the landmarks.
    let axis = fit ? rotateAboutView(segment, fit.rotation) : segment

    // A finger only bends about its own sideways axis, so that axis (taken
    // from the knuckle row and made perpendicular to the finger) stays valid
    // however much the finger is curled - unlike the palm normal, which a
    // curled fingertip no longer lines up with. The thumb sits off the palm
    // plane, so it uses its own knuckle-to-index-knuckle direction, which
    // follows it as it swings from beside the index to spread wide.
    const lateralRef = finger.name === 'thumb' ? sub(P[THUMB_MCP], P[INDEX_MCP]) : radial
    const lateral = orthogonalize(lateralRef, axis)
    if (!lateral) continue
    let normal = scale(cross(lateral, axis), side)
    if (finger.name === 'thumb') {
      // lateral points away from the index finger, i.e. the way the
      // thumbnail turns.
      normal = add(scale(normal, Math.cos(THUMB_PRONATION)), scale(lateral, Math.sin(THUMB_PRONATION)))
    }

    const priorWidth = palmLength * finger.widthRatio
    const cuticleOnAxis = add(dip, scale(sub(tip, dip), finger.cuticleT))
    const surfaceCuticle = add(cuticleOnAxis, scale(normal, priorWidth * SURFACE_OFFSET_RATIO))
    const facingRaw = -normal.z
    let nailWidth = priorWidth
    let originRaw = surfaceCuticle
    let visibleLength = fit?.length ?? null
    let cutoffRaw: { point: Point; normal: Point } | null = null
    if (fit) {
      // The detected cuticle is exactly where the tip's cuticle end belongs
      // on screen; only its depth is left to the landmark estimate.
      originRaw = { x: fit.cuticle.x, y: fit.cuticle.y, z: surfaceCuticle.z }
      const roll = finger.name === 'thumb' ? thumbRoll(fit.width, priorWidth) : { angle: 0, width: fit.width }
      if (fit.length !== undefined) {
        axis = withFlatLength(axis, clamp(fit.length / (roll.width * NAIL_LENGTH_RATIO), MIN_FIT_FORESHORTENING, 1))
      }
      // How far a nail rolls about its own axis is the landmarks' least
      // reliable guess, and a rolled tip's curved outline shifts to one side
      // of its center line, baring the real nail on the other. So a fitted
      // tip is drawn unrolled - its width lying in the screen plane, centered
      // on the fitted line - at exactly the on-screen width it was given.
      // Only the thumb's is turned, by how much narrower its nail shows than
      // it is (see MAX_THUMB_ROLL) - and then moved across so its outline is
      // centered on the fitted line all the same.
      const flatAcross = normalize({ x: axis.y, y: -axis.x, z: 0 })
      if (flatAcross) {
        // A nail found in the image faces the camera, whatever the landmarks
        // say - drawn facing away, its tip would show mirrored.
        const across = cross(flatAcross, axis).z <= 0 ? flatAcross : scale(flatAcross, -1)
        normal = cross(across, axis)
        if (roll.angle > 0) {
          // The thumbnail turns away from the index finger (see lateral), so
          // that side of the tip wraps out of sight: its normal leans there.
          normal = rotateAbout(normal, axis, (dot(lateral, across) >= 0 ? 1 : -1) * roll.angle)
        }
        nailWidth = clamp(roll.width, priorWidth * 0.6, priorWidth * 1.6)
        const outline = tipOutlineSpan(axis, cross(axis, normal), normal)
        if (outline) {
          const middle = ((outline.lo + outline.hi) / 2) * nailWidth
          originRaw = { ...originRaw, x: originRaw.x - outline.dir.x * middle, y: originRaw.y - outline.dir.y * middle }
        }
        // Seen from the side, the thumbnail's cuticle slants across it (see
        // NailFit.cuticleEdge), lowest toward the middle of the nail turning
        // out of sight, highest at the near side - where the tip would hang
        // over the skin. So the tip's cuticle end comes down to that slant's
        // lowest point under it, and everything before the slant is cut off.
        if (roll.angle > 0 && outline && fit.cuticleEdge) {
          const flat = Math.hypot(axis.x, axis.y)
          const along = { x: axis.x / flat, y: axis.y / flat }
          const { slope, offset } = fit.cuticleEdge
          const drop = Math.min(0, offset - (Math.abs(slope) * (outline.hi - outline.lo) * nailWidth) / 2)
          originRaw = { ...originRaw, x: originRaw.x + along.x * drop, y: originRaw.y + along.y * drop }
          if (visibleLength !== null) visibleLength -= drop
          // across = along turned +90 degrees; the edge runs along
          // across + slope * along, so along - slope * across is its normal.
          const edgeNormal = { x: along.x + slope * along.y, y: along.y - slope * along.x }
          const edgeNormalLength = Math.hypot(edgeNormal.x, edgeNormal.y)
          cutoffRaw = {
            point: { x: fit.cuticle.x + along.x * offset, y: fit.cuticle.y + along.y * offset },
            normal: { x: edgeNormal.x / edgeNormalLength, y: edgeNormal.y / edgeNormalLength },
          }
        }
      }
    }

    // Raw camera space -> display space. Mirroring flips x; display z points
    // toward the viewer (raw z points away), so z always flips.
    const sx = mirror ? -1 : 1
    const toDisplay = (v: Vec3): Vec3 => ({ x: v.x * sx, y: v.y, z: -v.z })
    const origin = { ...toDisplay(originRaw), x: mirror ? width - originRaw.x : originRaw.x }
    const axisD = toDisplay(axis)
    const normalD = toDisplay(normal)

    poses.push({
      finger,
      origin,
      axis: axisD,
      across: cross(axisD, normalD),
      normal: normalD,
      width: nailWidth,
      facing: facingRaw,
      palmTowardCamera,
      visibleLength,
      cutoff: cutoffRaw && {
        point: { x: mirror ? width - cutoffRaw.point.x : cutoffRaw.point.x, y: cutoffRaw.point.y },
        normal: { x: cutoffRaw.normal.x * sx, y: cutoffRaw.normal.y },
      },
      opacity: fit?.seen ? 1 : facingOpacity(facingRaw),
    })
  }

  return poses
}

export type TipFrame = { axis: Vec3; across: Vec3; normal: Vec3; length: number }

/**
 * How to draw a tip whose design is `tipLength` long: along the pose's own
 * axis, across and normal, unless the tip would then fall short of the nail
 * measured under it (NailPose.visibleLength) and leave its free edge showing
 * - then tilted toward the screen plane, and if even lying flat it's too
 * short (a stubby design on a long nail), stretched lengthwise up to
 * MAX_TIP_STRETCH.
 */
export function tipFrame(pose: NailPose, tipLength: number): TipFrame {
  const unchanged = { axis: pose.axis, across: pose.across, normal: pose.normal, length: tipLength }
  if (pose.visibleLength === null || !(tipLength > 0)) return unchanged
  const needed = pose.visibleLength * TIP_COVER
  if (tipLength * Math.hypot(pose.axis.x, pose.axis.y) >= needed) return unchanged
  const length = Math.min(Math.max(tipLength, needed), tipLength * MAX_TIP_STRETCH)
  const axis = withFlatLength(pose.axis, Math.min(1, needed / length))
  // The whole tip tilts, about the on-screen direction across it - so a
  // turned one (the thumb's) stays turned as far.
  const hinge = normalize(cross(pose.axis, axis))
  if (!hinge) return { ...unchanged, length }
  const angle = Math.acos(clamp(dot(pose.axis, axis), -1, 1))
  return { axis, across: rotateAbout(pose.across, hinge, angle), normal: rotateAbout(pose.normal, hinge, angle), length }
}

/**
 * Where the 3D tip posed by `frame` from `origin`, `width` wide, shows on
 * screen - for drawing it flat in its place: its outline's center line at
 * the cuticle end, the unit direction across it, and how wide it is (px).
 * Null if the tip points straight at the camera.
 */
export function tipOutline(origin: Vec3, frame: TipFrame, width: number): { cuticle: Point; across: Point; width: number } | null {
  const outline = tipOutlineSpan(frame.axis, frame.across, frame.normal)
  if (!outline) return null
  const middle = ((outline.lo + outline.hi) / 2) * width
  return {
    cuticle: { x: origin.x + outline.dir.x * middle, y: origin.y + outline.dir.y * middle },
    across: outline.dir,
    width: (outline.hi - outline.lo) * width,
  }
}

/** 0 when the nail is edge-on or turned away from the viewer, ramping to 1. */
export function facingOpacity(facing: number) {
  const t = Math.min(1, Math.max(0, (facing - 0.08) / (0.32 - 0.08)))
  return t * t * (3 - 2 * t)
}

// Real designs come out anywhere from long stiletto to short square; anything
// outside this range is a segmentation failure, not a nail.
export function clampDesignAspect(aspectRatio: number) {
  return Math.min(1.2, Math.max(0.3, aspectRatio))
}
