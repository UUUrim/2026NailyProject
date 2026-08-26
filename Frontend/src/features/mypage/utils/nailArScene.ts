import * as THREE from 'three'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { NailDesignAsset } from '@/features/mypage/utils/nailDesignAsset'
import { FINGERS, anchorCenter, computeFingerPlacement } from '@/features/mypage/utils/fingerLandmarks'
import { createFingerTexture, type ShapeTemplate } from '@/features/mypage/utils/nailMeshAsset'

// MediaPipe HandLandmarker is configured for up to two hands elsewhere
// (numHands: 2) - mirror that here so both hands can show the 3D overlay.
const MAX_HANDS = 2

// Show the extracted design texture exactly as generated - no scene lighting,
// no clearcoat/gloss simulation. An earlier version used MeshPhysicalMaterial
// with directional lights for a glossier look, but the lighting math (and a
// speculative position offset meant to compensate the 2D renderer's
// asymmetric anchor) went wrong on a real camera: nails rendered far too
// dark and visibly misplaced. MeshBasicMaterial ignores lights entirely, so
// the texture's own colors show through faithfully and predictably.
function createNailMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide })
}

// Renders per-shape template meshes (one clone per finger per detected hand)
// positioned/rotated/scaled from live hand landmarks, textured with the
// generated design image. Meant to sit in a transparent WebGL <canvas>
// layered directly on top of the existing 2D video-drawing canvas, so this
// class only ever draws the nail meshes - the camera feed itself is handled
// by the caller exactly as it already is for the 2D path.
export class NailArScene {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.OrthographicCamera
  private template: ShapeTemplate | null = null
  private materials: THREE.MeshBasicMaterial[] = [] // one per finger, shared across hands
  private meshGroups: THREE.Mesh[][] = [] // meshGroups[handIndex][fingerIndex]
  private width = 0
  private height = 0

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    this.renderer.setClearColor(0x000000, 0)

    // left/right/top/bottom map directly onto video pixel coordinates - top=0
    // so world Y increases downward, matching the canvas/video convention the
    // 2D renderer and landmark math already use (no extra flipping needed).
    this.camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1000, 1000)
    this.camera.position.z = 500
  }

  setTemplate(template: ShapeTemplate) {
    this.template = template

    for (const group of this.meshGroups) {
      for (const mesh of group) {
        this.scene.remove(mesh)
        mesh.geometry.dispose()
      }
    }
    this.meshGroups = []

    for (let h = 0; h < MAX_HANDS; h += 1) {
      const group = FINGERS.map((_finger, fingerIdx) => {
        const geometry = template.geometry.clone()
        if (!this.materials[fingerIdx]) {
          this.materials[fingerIdx] = createNailMaterial()
        }
        const mesh = new THREE.Mesh(geometry, this.materials[fingerIdx])
        mesh.visible = false
        this.scene.add(mesh)
        return mesh
      })
      this.meshGroups.push(group)
    }
  }

  setFingerTextures(asset: NailDesignAsset) {
    // Letterbox each cutout to the mesh's own UV aspect ratio (see
    // createFingerTexture) so the design never gets stretched to fit - call
    // setTemplate() first so this ratio is known; falls back to the
    // cutout's own ratio (i.e. no padding) if called out of order.
    const targetAspectRatio = this.template ? this.template.naturalWidth / this.template.naturalLength : null

    FINGERS.forEach((finger, fingerIdx) => {
      const nailAsset = asset.fingerNails[finger.nailIndex]
      if (!nailAsset) return
      if (!this.materials[fingerIdx]) {
        this.materials[fingerIdx] = createNailMaterial()
      }
      const material = this.materials[fingerIdx]
      material.map?.dispose()
      material.map = createFingerTexture(nailAsset.canvas, targetAspectRatio ?? nailAsset.aspectRatio)
      material.needsUpdate = true
    })
  }

  resize(width: number, height: number) {
    if (this.width === width && this.height === height) return
    this.width = width
    this.height = height
    this.camera.left = 0
    this.camera.right = width
    this.camera.top = 0
    this.camera.bottom = height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  updateFromLandmarks(hands: NormalizedLandmark[][], width: number, height: number, mirror: boolean) {
    this.resize(width, height)

    for (const group of this.meshGroups) {
      for (const mesh of group) mesh.visible = false
    }
    const template = this.template
    if (!template) return

    hands.slice(0, MAX_HANDS).forEach((landmarks, handIdx) => {
      const group = this.meshGroups[handIdx]
      if (!group) return

      FINGERS.forEach((finger, fingerIdx) => {
        const mesh = group[fingerIdx]
        if (!mesh) return

        const placement = computeFingerPlacement(landmarks, finger, width, height, mirror, (segment) =>
          segment * (template.naturalWidth / template.naturalLength),
        )
        if (!placement) return

        // Preserve the template shape's own proportions - scale by the
        // measured nail width alone (the reliable per-frame landmark
        // measurement) and derive length from the template's natural aspect
        // ratio, rather than fitting to two independently-measured
        // dimensions (which could shrink/distort the shape when they
        // disagree).
        const scale = placement.width / template.naturalWidth
        const renderLength = template.naturalLength * scale

        // loadShapeTemplate() recenters the geometry, so its local Y range
        // is exactly [-naturalLength/2, +naturalLength/2] with +Y toward the
        // tip - anchorCenter() places mesh.position (the geometry's own
        // center) so that the -naturalLength/2 (cuticle) edge lands exactly
        // on the landmark cuticle point, flat (no fore/aft tilt rotation).
        const center = anchorCenter(placement, renderLength)
        mesh.position.set(center.x, center.y, 0)
        mesh.rotation.set(0, 0, placement.angle)
        mesh.scale.setScalar(scale)
        mesh.visible = true
      })
    })
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    for (const group of this.meshGroups) {
      for (const mesh of group) mesh.geometry.dispose()
    }
    for (const material of this.materials) {
      material.map?.dispose()
      material.dispose()
    }
    this.renderer.dispose()
  }
}
