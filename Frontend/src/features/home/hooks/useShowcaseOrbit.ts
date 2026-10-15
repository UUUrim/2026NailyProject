import { useEffect, useRef } from 'react'
import { prefersReducedMotion } from '@/features/home/hooks/useInView'

type OrbitRing = {
    count: number
    scale: number
    opacity: number
    /** 초당 회전량(rad). 화면 좌표는 y가 아래로 커지므로 양수가 시계방향이다 */
    speed: number
    offset: number
}

// 안쪽 줄일수록 작고 흐리고 조금 더 빠르게 — 깊이감
const RINGS: OrbitRing[] = [
    { count: 10, scale: 0.42, opacity: 0.55, speed: 0.05, offset: 0.12 },
    { count: 14, scale: 0.82, opacity: 0.85, speed: 0.036, offset: 0.3 },
    { count: 18, scale: 1, opacity: 1, speed: 0.027, offset: 0 },
]

/** 줄 사이 빈틈을 정하는 기준 반지름 — 화면 대각선 절반에 대한 비율 (가운데 글자를 피하도록 더 커질 수 있다) */
const INNER_RADIUS = 0.34

/** 기준 반지름일 때 안쪽 줄과 두 번째 줄의 중심 사이 거리(같은 비율). 이때 두 줄의 카드 사이에 보이는 빈틈을 모든 줄 사이에 똑같이 쓴다 */
const FIRST_RING_STEP = 0.19

/** 가장 안쪽 줄은 기준 반지름보다 이 비율만큼 안으로 당기고, 바깥 두 줄도 같은 빈틈을 두고 따라 들어온다 (가운데 글자와는 겹치지 않는 선까지) */
const INNER_RING_PULL = 0.93

const INTRO_MS = 1400

export const ORBIT_SLOT_COUNT = RINGS.reduce((sum, ring) => sum + ring.count, 0)

/** 카드가 속한 줄 번호(0 = 가장 안쪽) */
export const ORBIT_SLOT_RINGS: number[] = RINGS.flatMap((ring, r) => Array.from({ length: ring.count }, () => r))

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

const smoothstep = (edge0: number, edge1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)
}

/**
 * 마지막 섹션의 카드들을 동심원 3줄에 고르게 놓고 시계방향으로 천천히 돌린다.
 * 카드는 긴 변이 원의 중심을 향하도록 눕히되, 이미지가 거꾸로 서지 않게 -90°~90° 안으로 맞춘다.
 * 그 경계(원의 맨 위·아래)를 지날 때 카드가 뒤집히는 순간은 잠깐 흐리게 사라졌다 나타나게 해서 감춘다.
 * React 렌더 없이 rAF에서 transform·opacity만 바꾸고, 섹션이 화면 밖이면 멈춘다.
 */
export function useShowcaseOrbit() {
    const sectionRef = useRef<HTMLElement>(null)
    const stageRef = useRef<HTMLDivElement>(null)
    const centerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const section = sectionRef.current
        const stage = stageRef.current
        const center = centerRef.current
        if (!section || !stage || !center) return

        const cards = Array.from(stage.children) as HTMLElement[]
        const reduced = prefersReducedMotion()

        let width = 0
        let height = 0
        let radii = RINGS.map(() => 0)
        let introStart: number | null = reduced ? -Infinity : null
        let orbitTime = 0
        let lastFrame = 0
        let frame = 0
        let running = false

        const render = (now: number) => {
            const progress = introStart === null ? 0 : Math.min(1, (now - introStart) / INTRO_MS)
            const intro = easeOutCubic(progress)

            let i = 0
            RINGS.forEach((ring, r) => {
                for (let k = 0; k < ring.count; k += 1, i += 1) {
                    const card = cards[i]
                    if (!card) continue

                    const theta = ring.offset + (k / ring.count) * Math.PI * 2 + orbitTime * ring.speed
                    const x = width / 2 + Math.cos(theta) * radii[r]
                    const y = height / 2 + Math.sin(theta) * radii[r]
                    const degrees = (theta * 180) / Math.PI
                    const rotate = ((((degrees + 90) % 180) + 180) % 180) - 90
                    const fade = smoothstep(0.04, 0.3, Math.abs(Math.cos(theta)))
                    const scale = ring.scale * (0.92 + 0.08 * intro)

                    card.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) rotate(${rotate.toFixed(2)}deg) scale(${scale.toFixed(3)})`
                    card.style.opacity = (ring.opacity * fade * intro).toFixed(3)
                }
            })
        }

        const tick = (now: number) => {
            orbitTime += Math.min(0.05, (now - lastFrame) / 1000)
            lastFrame = now
            render(now)
            frame = requestAnimationFrame(tick)
        }

        const start = () => {
            if (running || reduced) return
            running = true
            lastFrame = performance.now()
            frame = requestAnimationFrame(tick)
        }

        const stop = () => {
            running = false
            cancelAnimationFrame(frame)
        }

        const measure = () => {
            width = stage.clientWidth
            height = stage.clientHeight
            const halfDiagonal = Math.hypot(width, height) / 2
            // 가장 안쪽 줄이 가운데 제목·버튼을 덮지 않도록, 글 덩어리를 감싸는 원보다는 크게 잡는다
            const textRadius = Math.hypot(center.offsetWidth / 2, center.offsetHeight / 2) * 0.82
            const baseCardWidth = cards[0]?.offsetWidth ?? 0
            const halfLengths = RINGS.map((ring) => (baseCardWidth * ring.scale) / 2)
            const minInnerRadius = textRadius + halfLengths[0]
            const baseRadius = Math.max(INNER_RADIUS * halfDiagonal, minInnerRadius)
            // 카드는 긴 변이 중심을 향하므로, 줄 사이에 실제로 보이는 빈틈 = 중심 사이 거리 − 양쪽 카드 길이의 절반.
            // 바깥 줄일수록 카드가 커서 같은 중심 거리로는 빈틈이 좁아지니, 빈틈을 기준으로 반지름을 쌓는다.
            const edgeGap = baseRadius * (FIRST_RING_STEP / INNER_RADIUS) - halfLengths[0] - halfLengths[1]
            radii = [Math.max(baseRadius * INNER_RING_PULL, minInnerRadius)]
            for (let r = 1; r < RINGS.length; r += 1) {
                radii.push(radii[r - 1] + halfLengths[r - 1] + edgeGap + halfLengths[r])
            }
            if (!running) render(performance.now())
        }

        const resizeObserver = new ResizeObserver(measure)
        resizeObserver.observe(stage)
        resizeObserver.observe(center)
        measure()

        const intersectionObserver = new IntersectionObserver(
            ([entry]) => {
                if (!entry.isIntersecting) {
                    stop()
                    return
                }
                if (introStart === null && entry.intersectionRatio >= 0.25) {
                    introStart = performance.now()
                }
                start()
            },
            { threshold: [0, 0.25] },
        )
        intersectionObserver.observe(section)

        return () => {
            stop()
            resizeObserver.disconnect()
            intersectionObserver.disconnect()
        }
    }, [])

    return { sectionRef, stageRef, centerRef }
}
