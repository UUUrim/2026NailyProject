import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { NailShapeId } from '@/shared/constants/nailShapes'

type NailPreview3DProps = {
  textureUrl: string
  shapeId: NailShapeId
}

const FINGER_ORDER = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const
// 손가락별 상대 크기 (엄지/중지가 크고, 소지가 작음)
const FINGER_SCALE: Record<(typeof FINGER_ORDER)[number], number> = {
  thumb: 0.95,
  index: 0.85,
  middle: 0.95,
  ring: 0.85,
  pinky: 0.65,
}
// 손가락별 길이 단차 (중지가 가장 길고 엄지/소지가 짧은 자연스러운 라인)
const FINGER_Y_OFFSET: Record<(typeof FINGER_ORDER)[number], number> = {
  thumb: -0.12,
  index: 0.04,
  middle: 0.16,
  ring: 0.08,
  pinky: -0.16,
}

function createNailShape(shapeId: NailShapeId): THREE.Shape {
  const shape = new THREE.Shape()
  const W = 0.42 // 손톱 밑동 반너비

  switch (shapeId) {
    case 'square': {
      const L = 1.05
      shape.moveTo(-W, 0)
      shape.lineTo(-W, L - 0.08)
      shape.quadraticCurveTo(-W, L, -W + 0.08, L)
      shape.lineTo(W - 0.08, L)
      shape.quadraticCurveTo(W, L, W, L - 0.08)
      shape.lineTo(W, 0)
      shape.quadraticCurveTo(0, -0.05, -W, 0)
      break
    }
    case 'round': {
      const L = 0.95
      shape.moveTo(-W, 0)
      shape.lineTo(-W, L * 0.45)
      shape.quadraticCurveTo(-W, L, 0, L)
      shape.quadraticCurveTo(W, L, W, L * 0.45)
      shape.lineTo(W, 0)
      shape.quadraticCurveTo(0, -0.05, -W, 0)
      break
    }
    case 'almond': {
      const L = 1.25
      shape.moveTo(-W, 0)
      shape.lineTo(-W * 0.9, L * 0.4)
      shape.quadraticCurveTo(-W * 0.5, L * 0.92, 0, L)
      shape.quadraticCurveTo(W * 0.5, L * 0.92, W * 0.9, L * 0.4)
      shape.lineTo(W, 0)
      shape.quadraticCurveTo(0, -0.05, -W, 0)
      break
    }
    case 'stiletto': {
      const L = 1.35
      shape.moveTo(-W, 0)
      shape.lineTo(-W * 0.85, L * 0.35)
      shape.quadraticCurveTo(-W * 0.25, L * 0.85, 0, L)
      shape.quadraticCurveTo(W * 0.25, L * 0.85, W * 0.85, L * 0.35)
      shape.lineTo(W, 0)
      shape.quadraticCurveTo(0, -0.05, -W, 0)
      break
    }
    case 'ballerina': {
      const L = 1.1
      const T = 0.26
      shape.moveTo(-W, 0)
      shape.lineTo(-W * 0.85, L * 0.6)
      shape.quadraticCurveTo(-W * 0.7, L - 0.05, -T, L)
      shape.lineTo(T, L)
      shape.quadraticCurveTo(W * 0.7, L - 0.05, W * 0.85, L * 0.6)
      shape.lineTo(W, 0)
      shape.quadraticCurveTo(0, -0.05, -W, 0)
      break
    }
    case 'oval':
    default: {
      const L = 1.15
      shape.moveTo(-W, 0)
      shape.lineTo(-W * 0.95, L * 0.35)
      shape.quadraticCurveTo(-W * 0.85, L, 0, L)
      shape.quadraticCurveTo(W * 0.85, L, W * 0.95, L * 0.35)
      shape.lineTo(W, 0)
      shape.quadraticCurveTo(0, -0.05, -W, 0)
      break
    }
  }
  return shape
}

function createNailGeometry(shapeId: NailShapeId): THREE.ExtrudeGeometry {
  const shape = createNailShape(shapeId)
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.05,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.015,
    bevelSegments: 3,
    curveSegments: 24,
  })

  // 텍스처가 손톱 실루엣에 딱 맞게 덮이도록 UV를 좌표 기반으로 재계산 (cover-fit)
  geometry.computeBoundingBox()
  const bbox = geometry.boundingBox
  if (bbox) {
    const { min, max } = bbox
    const width = Math.max(max.x - min.x, 0.0001)
    const height = Math.max(max.y - min.y, 0.0001)
    const uv = geometry.attributes.uv
    const pos = geometry.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const u = (pos.getX(i) - min.x) / width
      const v = (pos.getY(i) - min.y) / height
      uv.setXY(i, u, v)
    }
    uv.needsUpdate = true
  }

  return geometry
}

export function NailPreview3D({ textureUrl, shapeId }: NailPreview3DProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const width = container.clientWidth
    const height = container.clientHeight || 380

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf4f4f6)

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100)
    camera.position.set(0, 0.15, 6.2)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    const ambient = new THREE.AmbientLight(0xffffff, 0.7)
    const key = new THREE.DirectionalLight(0xffffff, 1.1)
    key.position.set(2, 3, 4)
    const rim = new THREE.DirectionalLight(0xffe6ef, 0.4)
    rim.position.set(-3, 1, -2)
    scene.add(ambient, key, rim)

    const handsGroup = new THREE.Group()
    scene.add(handsGroup)

    const geometry = createNailGeometry(shapeId)
    const placeholderMaterial = new THREE.MeshStandardMaterial({ color: 0xfce8ef, roughness: 0.35 })
    const nailMeshes: THREE.Mesh[] = []

    const NAIL_SPACING = 0.56
    const HAND_GAP = 0.75

    // 왼손: 소지→엄지 순으로 왼쪽부터 배치(엄지가 안쪽으로), 오른손: 엄지→소지 순
    const leftHandFingers = [...FINGER_ORDER].reverse() // pinky..thumb
    const rightHandFingers = [...FINGER_ORDER] // thumb..pinky

    const leftStartX = -(HAND_GAP / 2 + leftHandFingers.length * NAIL_SPACING)
    leftHandFingers.forEach((finger, i) => {
      const mesh = new THREE.Mesh(geometry, placeholderMaterial)
      const scale = FINGER_SCALE[finger]
      mesh.scale.set(scale, scale, 1)
      mesh.position.set(leftStartX + i * NAIL_SPACING, FINGER_Y_OFFSET[finger] - 0.3, 0)
      handsGroup.add(mesh)
      nailMeshes.push(mesh)
    })

    const rightStartX = HAND_GAP / 2
    rightHandFingers.forEach((finger, i) => {
      const mesh = new THREE.Mesh(geometry, placeholderMaterial)
      const scale = FINGER_SCALE[finger]
      mesh.scale.set(scale, scale, 1)
      mesh.position.set(rightStartX + i * NAIL_SPACING, FINGER_Y_OFFSET[finger] - 0.3, 0)
      handsGroup.add(mesh)
      nailMeshes.push(mesh)
    })

    const loader = new THREE.TextureLoader()
    let disposed = false

    loader.load(textureUrl, (texture) => {
      if (disposed) return
      texture.colorSpace = THREE.SRGBColorSpace
      const material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.25,
        metalness: 0.06,
      })
      nailMeshes.forEach((mesh) => {
        mesh.material = material
      })
    })

    let frameId = 0
    const animate = () => {
      frameId = requestAnimationFrame(animate)
      handsGroup.rotation.y += 0.004
      renderer.render(scene, camera)
    }
    animate()

    const onResize = () => {
      const w = container.clientWidth
      const h = container.clientHeight || 380
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    return () => {
      disposed = true
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', onResize)
      geometry.dispose()
      placeholderMaterial.dispose()
      renderer.dispose()
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [textureUrl, shapeId])

  return (
      <div className="nail-preview-3d-wrap">
        <div ref={containerRef} className="nail-preview-3d" aria-label="3D 네일팁 미리보기 (양손)" />
        <div className="nail-preview-3d-labels">
          <span>왼손 (L)</span>
          <span>오른손 (R)</span>
        </div>
      </div>
  )
}