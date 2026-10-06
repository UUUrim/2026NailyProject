import type { Landmark, NormalizedLandmark } from '@mediapipe/tasks-vision'

export type Point = { x: number; y: number }
export type Vec3 = { x: number; y: number; z: number }

/** One tracked hand as the AR renderers consume it (see landmarkSmoothing.ts). */
export type TrackedHand = {
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

/** a with its component along unit vector n removed, normalized. */
function orthogonalize(a: Vec3, n: Vec3): Vec3 | null {
  return normalize(sub(a, scale(n, dot(a, n))))
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
  /** normal.z: 1 = nail faces the viewer, <= 0 = turned away (palm side). */
  facing: number
}

/**
 * Full 3D pose of every nail on one hand, from that frame's landmarks. Shared
 * by the 3D mesh renderer and the 2D canvas-warp fallback so both place, size,
 * orient and hide nails identically.
 */
export function computeNailPoses(hand: TrackedHand, width: number, height: number, mirror: boolean): NailPose[] {
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

  const poses: NailPose[] = []

  for (const finger of FINGERS) {
    const dip = P[finger.dip]
    const tipFlat = P[finger.tip]
    const tip = { ...tipFlat, z: dip.z + depthStep(finger.dip, finger.tip, palmLength * finger.distalRatio) }
    const axis = normalize(sub(tip, dip))
    if (!axis) continue

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

    const nailWidth = palmLength * finger.widthRatio
    const cuticleOnAxis = add(dip, scale(sub(tip, dip), finger.cuticleT))
    const originRaw = add(cuticleOnAxis, scale(normal, nailWidth * SURFACE_OFFSET_RATIO))

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
      facing: normalD.z,
    })
  }

  return poses
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
