import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'

export const NAIL_SHAPES = ['round', 'oval', 'almond', 'square', 'stiletto', 'ballerina'] as const
export type NailShape = (typeof NAIL_SHAPES)[number]

export function isKnownNailShape(value: string | null | undefined): value is NailShape {
  return !!value && (NAIL_SHAPES as readonly string[]).includes(value)
}

export type ShapeTemplate = {
  /** Anchored for placement: x centered on 0 (width axis, u grows with +x),
   *  y from 0 at the cuticle end to naturalLength at the free edge, and z <= 0
   *  with the top of the dome at z = 0 - so a nail pose's cuticle point on the
   *  nail surface maps straight onto the local origin. */
  geometry: THREE.BufferGeometry
  /** The template's own natural width/length extent (arbitrary shared unit -
   *  only ratios matter; the renderer rescales onto the measured nail). */
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

    // export_shape_templates.py builds the shell in nail_exact_stl.py's frame:
    // X = width (0..w), Y = length (cuticle end at min Y, free edge at max Y),
    // Z = dome height (the outer surface faces +Z). Its planar UVs follow the
    // same axes. Move the origin to the cuticle end's centerline on top of the
    // dome, which is exactly the point a nail pose describes.
    const naturalWidth = box.max.x - box.min.x
    const naturalLength = box.max.y - box.min.y
    geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -box.max.z)
    geometry.computeBoundingBox()

    return { geometry, naturalWidth, naturalLength }
  })()

  templateCache.set(shape, promise)
  return promise
}

// Wraps an already-prepared per-finger design cutout (nailDesignAsset.ts) as
// the mesh's texture. The renderer sizes each mesh to the cutout's own aspect
// ratio, so the cutout maps onto the UV rect 1:1 - no padding, no stretching,
// and its cuticle edge lands on the mesh's cuticle edge.
//
// The design image shows each tip with its cuticle end at the TOP. The
// template's glTF-exported UVs put v = 1 on the cuticle end and v = 0 on the
// free edge, and three.js' default flipY samples the image's top row at
// v = 1 - so the default is exactly right; don't turn flipY off.
export function createFingerTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}
