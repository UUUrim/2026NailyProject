import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { NailShapeId } from '@/constants/nailShapes'

type NailPreview3DProps = {
  textureUrl: string
  shapeId: NailShapeId
}

function createNailProfile(shapeId: NailShapeId): THREE.Vector2[] {
  const profiles: Record<NailShapeId, THREE.Vector2[]> = {
    square: [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.35, 0),
      new THREE.Vector2(0.35, 0.9),
      new THREE.Vector2(0, 0.95),
    ],
    oval: [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.32, 0.05),
      new THREE.Vector2(0.28, 0.92),
      new THREE.Vector2(0, 0.95),
    ],
    round: [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.34, 0.08),
      new THREE.Vector2(0.3, 0.88),
      new THREE.Vector2(0, 0.95),
    ],
    almond: [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.3, 0.12),
      new THREE.Vector2(0.08, 0.98),
      new THREE.Vector2(0, 0.95),
    ],
    stiletto: [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.28, 0.15),
      new THREE.Vector2(0.02, 1.05),
      new THREE.Vector2(0, 0.95),
    ],
    ballerina: [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.3, 0.1),
      new THREE.Vector2(0.12, 0.88),
      new THREE.Vector2(0.28, 0.88),
      new THREE.Vector2(0.3, 0.95),
      new THREE.Vector2(0, 0.95),
    ],
  }
  return profiles[shapeId] ?? profiles.oval
}

export function NailPreview3D({ textureUrl, shapeId }: NailPreview3DProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const width = container.clientWidth
    const height = container.clientHeight || 360

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf4f4f6)

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100)
    camera.position.set(0, 0.15, 2.4)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    const ambient = new THREE.AmbientLight(0xffffff, 0.65)
    const key = new THREE.DirectionalLight(0xffffff, 1.1)
    key.position.set(2, 3, 4)
    scene.add(ambient, key)

    const profile = createNailProfile(shapeId)
    const geometry = new THREE.LatheGeometry(profile, 48)
    const nail = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xfce8ef }))
    nail.rotation.x = -Math.PI / 2
    nail.position.y = -0.35
    scene.add(nail)

    const fingerPad = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 32, 32),
      new THREE.MeshStandardMaterial({ color: 0xf5d0c5, roughness: 0.85 }),
    )
    fingerPad.position.set(0, -0.75, 0)
    fingerPad.scale.set(1, 0.45, 0.9)
    scene.add(fingerPad)

    const loader = new THREE.TextureLoader()
    let disposed = false

    loader.load(textureUrl, (texture) => {
      if (disposed) return
      texture.colorSpace = THREE.SRGBColorSpace
      nail.material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.28,
        metalness: 0.08,
      })
    })

    let frameId = 0
    const animate = () => {
      frameId = requestAnimationFrame(animate)
      nail.rotation.z += 0.01
      fingerPad.rotation.y += 0.005
      renderer.render(scene, camera)
    }
    animate()

    const onResize = () => {
      const w = container.clientWidth
      const h = container.clientHeight || 360
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
      renderer.dispose()
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [textureUrl, shapeId])

  return <div ref={containerRef} className="nail-preview-3d" aria-label="3D 네일팁 미리보기" />
}
