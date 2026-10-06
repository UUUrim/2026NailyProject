import * as THREE from 'three'
import type { NailDesignAsset } from '@/features/mypage/utils/nailDesignAsset'
import {
  FINGERS,
  clampDesignAspect,
  computeNailPoses,
  facingOpacity,
  type TrackedHand,
} from '@/features/mypage/utils/fingerLandmarks'
import { createFingerTexture, type ShapeTemplate } from '@/features/mypage/utils/nailMeshAsset'

// MediaPipe HandLandmarker is configured for up to two hands elsewhere
// (numHands: 2) - mirror that here so both hands can show the 3D overlay.
const MAX_HANDS = 2

// The design's own colors are shown as-is at the middle of the nail (an
// earlier lit MeshPhysicalMaterial rendered nails far too dark on a real
// camera), with only a gentle falloff where the C-curve wraps away from the
// viewer and a small soft highlight - just enough shading that the dome reads
// as curved when the finger rolls, never enough to shift the design's color.
const NAIL_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vViewNormal;
  void main() {
    vUv = uv;
    vViewNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const NAIL_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D map;
  uniform float opacity;
  varying vec2 vUv;
  varying vec3 vViewNormal;
  // View space here is the video canvas: x right, y down, z toward the viewer.
  const vec3 HIGHLIGHT_DIR = normalize(vec3(-0.25, -0.45, 1.6));
  void main() {
    vec4 texel = texture2D(map, vUv);
    float alpha = texel.a * opacity;
    if (alpha < 0.01) discard;
    vec3 n = normalize(vViewNormal);
    float shade = mix(0.8, 1.0, smoothstep(0.0, 0.8, abs(n.z)));
    float highlight = pow(max(dot(n, HIGHLIGHT_DIR), 0.0), 60.0) * 0.18;
    gl_FragColor = vec4(texel.rgb * shade + highlight, alpha);
    #include <colorspace_fragment>
  }
`

function createNailMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: null },
      opacity: { value: 1 },
    },
    vertexShader: NAIL_VERTEX_SHADER,
    fragmentShader: NAIL_FRAGMENT_SHADER,
    transparent: true,
    side: THREE.DoubleSide,
  })
}

type FingerTexture = { texture: THREE.CanvasTexture; aspectRatio: number }

// Renders per-shape template meshes (one clone per finger per detected hand)
// posed from live hand landmarks and textured with that finger's cutout of the
// generated design image. Meant to sit in a transparent WebGL <canvas> layered
// directly on top of the 2D video-drawing canvas, so this class only ever
// draws the nail meshes - the camera feed itself is handled by the caller.
export class NailArScene {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.OrthographicCamera
  private template: ShapeTemplate | null = null
  private fingerTextures: Array<FingerTexture | null> = FINGERS.map(() => null)
  private meshGroups: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[][] = [] // [handIndex][fingerIndex]
  private width = 0
  private height = 0
  private readonly basisX = new THREE.Vector3()
  private readonly basisY = new THREE.Vector3()
  private readonly basisZ = new THREE.Vector3()

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    this.renderer.setClearColor(0x000000, 0)

    // left/right/top/bottom map directly onto video pixel coordinates - top=0
    // so world Y increases downward, matching the canvas/video convention the
    // landmark math uses. The camera sits at z=0 looking down -z, so world
    // +z is toward the viewer; nail depths are a few hundred px either way.
    this.camera = new THREE.OrthographicCamera(0, 1, 0, 1, -10000, 10000)
  }

  setTemplate(template: ShapeTemplate) {
    this.template = template

    for (const group of this.meshGroups) {
      for (const mesh of group) {
        this.scene.remove(mesh)
        mesh.geometry.dispose()
        mesh.material.dispose()
      }
    }
    this.meshGroups = []

    for (let h = 0; h < MAX_HANDS; h += 1) {
      const group = FINGERS.map((_finger, fingerIdx) => {
        const material = createNailMaterial()
        material.uniforms.map.value = this.fingerTextures[fingerIdx]?.texture ?? null
        const mesh = new THREE.Mesh(template.geometry.clone(), material)
        // The pose matrix (a rotation plus non-uniform scale along the
        // nail's own axes) is written directly each frame - see
        // updateFromHands.
        mesh.matrixAutoUpdate = false
        mesh.frustumCulled = false
        mesh.visible = false
        this.scene.add(mesh)
        return mesh
      })
      this.meshGroups.push(group)
    }
  }

  setFingerTextures(asset: NailDesignAsset) {
    FINGERS.forEach((finger, fingerIdx) => {
      this.fingerTextures[fingerIdx]?.texture.dispose()
      const nailAsset = asset.fingerNails[finger.nailIndex]
      this.fingerTextures[fingerIdx] = nailAsset
        ? { texture: createFingerTexture(nailAsset.canvas), aspectRatio: nailAsset.aspectRatio }
        : null
      for (const group of this.meshGroups) {
        group[fingerIdx].material.uniforms.map.value = this.fingerTextures[fingerIdx]?.texture ?? null
      }
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

  updateFromHands(hands: TrackedHand[], width: number, height: number, mirror: boolean) {
    this.resize(width, height)

    for (const group of this.meshGroups) {
      for (const mesh of group) mesh.visible = false
    }
    const template = this.template
    if (!template) return

    hands.slice(0, MAX_HANDS).forEach((hand, handIdx) => {
      const group = this.meshGroups[handIdx]
      if (!group) return

      for (const pose of computeNailPoses(hand, width, height, mirror)) {
        const fingerIdx = FINGERS.indexOf(pose.finger)
        const mesh = group[fingerIdx]
        const fingerTexture = this.fingerTextures[fingerIdx]
        if (!mesh || !fingerTexture) continue

        const opacity = facingOpacity(pose.facing)
        if (opacity <= 0) continue

        // Width comes from the measured hand; length follows the design
        // cutout's own proportions (the press-on tip as it was generated), so
        // the cutout fills the UV rect exactly instead of being stretched.
        const widthScale = pose.width / template.naturalWidth
        const nailLength = pose.width / clampDesignAspect(fingerTexture.aspectRatio)
        const lengthScale = nailLength / template.naturalLength

        // Local +x (u grows along it) -> pose.across, local +y (cuticle ->
        // free edge) -> pose.axis, local +z (out of the dome) -> pose.normal.
        this.basisX.set(pose.across.x, pose.across.y, pose.across.z).multiplyScalar(widthScale)
        this.basisY.set(pose.axis.x, pose.axis.y, pose.axis.z).multiplyScalar(lengthScale)
        this.basisZ.set(pose.normal.x, pose.normal.y, pose.normal.z).multiplyScalar(widthScale)
        mesh.matrix.makeBasis(this.basisX, this.basisY, this.basisZ)
        mesh.matrix.setPosition(pose.origin.x, pose.origin.y, pose.origin.z)
        mesh.matrixWorldNeedsUpdate = true

        mesh.material.uniforms.opacity.value = opacity
        mesh.visible = true
      }
    })
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    for (const group of this.meshGroups) {
      for (const mesh of group) {
        mesh.geometry.dispose()
        mesh.material.dispose()
      }
    }
    for (const fingerTexture of this.fingerTextures) fingerTexture?.texture.dispose()
    this.renderer.dispose()
  }
}
