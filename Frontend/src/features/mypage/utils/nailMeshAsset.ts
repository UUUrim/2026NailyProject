import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'

export const NAIL_SHAPES = ['round', 'oval', 'almond', 'square', 'stiletto', 'ballerina'] as const
export type NailShape = (typeof NAIL_SHAPES)[number]

export function isKnownNailShape(value: string | null | undefined): value is NailShape {
  return !!value && (NAIL_SHAPES as readonly string[]).includes(value)
}

export type ShapeTemplate = {
  geometry: THREE.BufferGeometry
  /** The template's own natural width/length extent (arbitrary shared unit -
   *  only the ratio between them matters, used to scale-without-distorting
   *  onto whatever size is measured from the camera). */
  naturalWidth: number
  naturalLength: number
}

const templateCache = new Map<NailShape, Promise<ShapeTemplate>>()
const loader = new GLTFLoader()

function loadGltf(url: string): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject)
  })
}

function findFirstMeshGeometry(root: THREE.Object3D): THREE.BufferGeometry | null {
  let found: THREE.BufferGeometry | null = null
  root.traverse((obj) => {
    if (found) return
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh && mesh.geometry) {
      found = mesh.geometry
    }
  })
  return found
}

// Loads a pre-made per-shape template mesh (produced once offline by
// scan/export_shape_templates.py, see that script for how the UV/geometry is
// built) and caches it - all five fingers on a hand share the same shape, so
// this only needs to happen once per AR session, not once per finger.
export async function loadShapeTemplate(shape: NailShape): Promise<ShapeTemplate> {
  const cached = templateCache.get(shape)
  if (cached) return cached

  const promise = (async () => {
    const gltf = await loadGltf(`/models/nail-tips/${shape}.glb`)
    const geometry = findFirstMeshGeometry(gltf.scene)
    if (!geometry) {
      throw new Error(`네일팁 쉐입 모델(${shape})에서 메시를 찾을 수 없습니다.`)
    }

    // export_shape_templates.py's trimesh export doesn't bake vertex normals
    // in - without them, the material has no surface-curvature information
    // to shade against, so lighting renders perfectly flat across the whole
    // dome (the "looks like a pasted-on 2D image" symptom) regardless of how
    // the lights are set up. Compute them once here from the actual geometry.
    if (!geometry.attributes.normal) {
      geometry.computeVertexNormals()
    }

    geometry.computeBoundingBox()
    const box = geometry.boundingBox
    if (!box) {
      throw new Error(`네일팁 쉐입 모델(${shape})의 크기를 계산할 수 없습니다.`)
    }
    const size = new THREE.Vector3()
    box.getSize(size)

    // export_shape_templates.py builds the geometry in its own local
    // coordinate frame (X in [0, width], Y in [-cuticleDepth, length], Z the
    // thin curvature axis) - NOT centered on the origin. Every downstream
    // placement (nailArScene.ts) treats mesh.position as the nail's visual
    // center, so recenter once here rather than carrying an off-center
    // offset through every frame's position/rotation/scale math.
    const center = new THREE.Vector3()
    box.getCenter(center)
    geometry.translate(-center.x, -center.y, -center.z)
    geometry.computeBoundingBox()

    // Pick the two largest-extent axes as width/length (the shell's
    // thickness axis is, by construction, the thinnest one) rather than
    // hardcoding which axis is which - self-adapting if the export script's
    // axis convention ever changes.
    const extents = [size.x, size.y, size.z].sort((a, b) => b - a)
    const [longest, secondLongest] = extents

    return {
      geometry,
      naturalWidth: Math.min(longest, secondLongest),
      naturalLength: Math.max(longest, secondLongest),
    }
  })()

  templateCache.set(shape, promise)
  return promise
}

// Wraps an already-prepared per-finger design cutout (from
// nailDesignAsset.ts's alpha-masked canvases) as a texture for the mesh.
//
// The cutout's own width:height ratio (per finger, per design - typically
// 0.5-0.65 in practice) essentially never matches the template mesh's UV
// aspect ratio (naturalWidth/naturalLength, fixed per shape). A UV space is
// just the unit square [0,1]x[0,1] - mapping the cutout onto it directly
// stretches it to whatever the mesh's ratio happens to be, squashing or
// widening the design. Instead, letterbox: pad the cutout (transparently) up
// to a canvas shaped exactly like the mesh's UV rect, at the cutout's own
// native resolution (a straight pixel copy, no resampling), so the design
// renders at its true proportions with transparent margin absorbing the
// mismatch instead of stretching it away.
export function createFingerTexture(canvas: HTMLCanvasElement, targetAspectRatio: number): THREE.CanvasTexture {
  const srcAspect = canvas.width / canvas.height

  let outW = canvas.width
  let outH = canvas.height
  if (srcAspect > targetAspectRatio) {
    // Cutout is proportionally wider than the mesh's UV rect - pad height.
    outH = Math.max(canvas.height, Math.round(canvas.width / targetAspectRatio))
  } else {
    // Cutout is proportionally narrower/taller - pad width.
    outW = Math.max(canvas.width, Math.round(canvas.height * targetAspectRatio))
  }

  let source: HTMLCanvasElement = canvas
  if (outW !== canvas.width || outH !== canvas.height) {
    const padded = document.createElement('canvas')
    padded.width = outW
    padded.height = outH
    const ctx = padded.getContext('2d')
    if (ctx) {
      ctx.drawImage(canvas, Math.round((outW - canvas.width) / 2), Math.round((outH - canvas.height) / 2))
      source = padded
    }
  }

  const texture = new THREE.CanvasTexture(source)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}
