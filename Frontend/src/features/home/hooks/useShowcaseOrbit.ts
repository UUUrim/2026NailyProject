import { useEffect, useRef } from 'react'
import { prefersReducedMotion } from '@/features/home/hooks/useInView'

/**
 * 카드 자리 수. 1920×1080 화면의 나선을 정해 둔 간격으로 거의 채우는 만큼 — 남는 카드는 화면 밖 구간에서 쉰다.
 * 이보다 큰 화면에서는 카드 간격을 넓혀 나선 끝까지 채운다.
 */
export const ORBIT_SLOT_COUNT = 120

/** 이웃한 바퀴의 카드 사이에 비는 폭 — 카드 기준 너비에 대한 비율. 안쪽·바깥쪽 어디서나 같은 빈틈을 둔다 */
const RING_GAP = 0.6

/** 나선을 따라 이웃한 카드 사이에 비는 폭 — 그 자리 카드 크기에 대한 비율 */
const CARD_GAP = 0.85

/** 카드가 나선을 따라 바깥으로 흘러가는 속도(카드 자리/s). 화면 좌표는 y가 아래로 커지므로 시계방향으로 돈다 */
const FLOW_SPEED = 0.11

/**
 * 나선이 시작되는 각도 — 가운데에서 오른쪽으로 뻗어 나가 버튼 아래에서 첫 바퀴에 닿는다.
 * 나선은 한 바퀴 돌수록 벌어지므로, 첫 바퀴가 글에 가장 가까운 곳을 비어 보이기 쉬운 버튼 아래에 둔다
 */
const START_ANGLE = 0

/** 나선 시작 반지름 — 카드 기준 너비에 대한 비율. 글 덩어리 한가운데에서 아주 작게 시작한다 */
const START_RADIUS = 0.05

/** 가운데에서 이만큼(rad)만 도는 동안 첫 바퀴까지 곧장 빠져나온다 — 글 뒤에서 여러 바퀴 맴돌며 어지러워 보이지 않게 */
const EXIT_ANGLE = Math.PI * 0.5

/** 글 덩어리 위·아래 끝과 첫 바퀴 카드의 안쪽 끝 사이에 두는 빈틈 — 카드 기준 너비에 대한 비율 */
const TEXT_GAP = 0.15

/** 처음 카드 이만큼의 자리를 흐르는 동안 투명에서 서서히 나타난다 */
const FADE_IN_SPAN = 2

/** 화면 가장자리에 닿는 지점의 카드 크기를 1로 두고, 반지름에 따라 커지는 정도 */
const SCALE_POWER = 0.9
const MIN_SCALE = 0.1
const MAX_SCALE = 1.15

/** 가장 작은 카드의 불투명도 — 카드가 커질수록 1까지 진해진다 */
const INNER_OPACITY = 0.45

const INTRO_MS = 1600

/** 처음 나타날 때 카드가 이만큼(카드 자리) 덜 흘러간 자리에서 감겨 나오며 제자리를 찾는다 */
const INTRO_SWIRL = 2.5

/** 나선을 따라갈 때 한 번에 늘리는 각도(rad) */
const TRACE_STEP = 0.01

/** 나선 위 자리를 표로 적어 두는 간격(카드 자리) — 그 사이는 직선으로 잇는다 */
const SLOT_STEP = 0.05

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

const smoothstep = (edge0: number, edge1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)
}

/** 요소 가운데의 섹션 기준 좌표 — 등장 애니메이션의 transform에 흔들리지 않도록 offset 값으로 잰다 */
const centerWithin = (el: HTMLElement, root: HTMLElement) => {
    let x = el.offsetWidth / 2
    let y = el.offsetHeight / 2
    let node: HTMLElement | null = el
    while (node && node !== root) {
        x += node.offsetLeft
        y += node.offsetTop
        node = node.offsetParent as HTMLElement | null
    }
    return { x, y }
}

/**
 * 마지막 섹션의 카드들을 하나로 이어진 원형 나선 위에 놓고, 나선을 따라 바깥으로 천천히 흘려보낸다.
 * 나선은 제목·버튼 덩어리 한가운데에서 아주 작게 시작해 1/4바퀴 만에 첫 바퀴로 빠져나오고,
 * 그다음부터 시계방향으로 감기며 커지다가 화면 밖으로 빠져나간 뒤, 다시 가운데에서 나타난다.
 * 첫 바퀴는 글 덩어리의 위·아래만 비켜 가는 작은 원이라, 글 위아래가 비어 보이지 않는 대신 양옆에서는 제목 뒤로 지나간다.
 * 글 뒤의 흰 원이 그 카드들을 흐리게 덮는다.
 * 바깥 바퀴 사이에는 어디서나 같은 빈틈을 두고 — 한 바퀴 돌 때 반지름이 (그 자리 카드 길이 + 바퀴 사이 빈틈)만큼 커진다 —
 * 나선을 따라서는 카드 크기에 비례한 간격으로 놓는다.
 * 이 나선을 각도를 조금씩 늘려 가며 따라가 카드 자리별 각도·반지름 표로 만들어 두고, 프레임마다 표에서 읽는다.
 * 카드는 긴 변이 가운데를 향하도록 눕히되, 이미지가 거꾸로 서지 않게 -90°~90° 안으로 맞춘다.
 * 그 경계(가운데의 바로 위·아래)를 지날 때는 카드를 긴 변 방향의 가는 선으로 접었다가 펴서, 뒤집히는 순간이
 * 카드가 제자리에서 한 번 돌아 넘어가는 것처럼 보이게 한다 — 흐리게 지우면 곡선이 끊겨 보인다.
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

        /** 나선 중심 — 제목·버튼 덩어리의 한가운데 (글 뒤의 흰 원과 같은 중심) */
        let originX = 0
        let originY = 0
        let edgeRadius = 1
        /** SLOT_STEP 간격의 카드 자리마다 나선 시작점에서 감긴 각도와 반지름 */
        let slotAngles: number[] = []
        let slotRadii: number[] = []
        /** 나선이 화면 밖으로 완전히 빠져나가는 지점까지의 카드 자리 수 */
        let visibleSlots = 0
        /** 카드 간격(카드 자리) — 화면이 아주 커서 카드가 모자라면 1보다 넓힌다 */
        let spacing = 1
        /** 카드 하나가 나선을 한 번 다 흐르는 길이(카드 자리, visibleSlots 이상) */
        let cycle = 1
        let introStart: number | null = reduced ? -Infinity : null
        let orbitTime = 0
        let lastFrame = 0
        let frame = 0
        let running = false

        const scaleAt = (radius: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, (radius / edgeRadius) ** SCALE_POWER))

        const render = (now: number) => {
            if (!slotAngles.length) return
            const progress = introStart === null ? 0 : Math.min(1, (now - introStart) / INTRO_MS)
            const intro = easeOutCubic(progress)
            const flow = orbitTime * FLOW_SPEED - (1 - intro) * INTRO_SWIRL
            const last = slotAngles.length - 1

            cards.forEach((card, i) => {
                // 나선 시작점에서부터 흘러간 카드 자리
                const slot = (((i * spacing + flow) % cycle) + cycle) % cycle
                if (slot >= visibleSlots) {
                    card.style.opacity = '0'
                    return
                }

                const at = slot / SLOT_STEP
                const j = Math.min(last, Math.floor(at))
                const next = Math.min(last, j + 1)
                const t = at - j
                const theta = START_ANGLE + slotAngles[j] + (slotAngles[next] - slotAngles[j]) * t
                const radius = slotRadii[j] + (slotRadii[next] - slotRadii[j]) * t
                const dx = Math.cos(theta) * radius
                const dy = Math.sin(theta) * radius

                const degrees = (theta * 180) / Math.PI
                const rotate = ((((degrees + 90) % 180) + 180) % 180) - 90
                // 짧은 변 방향으로 접히는 정도 — 가운데의 바로 위·아래에서 0이 되고, 그 순간 회전이 180° 넘어간다.
                // 여러 바퀴의 카드가 같은 각도에서 접히므로, 접히는 구간을 좁혀 위아래로 줄지어 보이지 않게 한다
                const fold = smoothstep(0, 0.16, Math.abs(Math.cos(theta)))
                const appear = smoothstep(0, FADE_IN_SPAN, slot)
                const size = scaleAt(radius)
                const depth = Math.min(1, (size - MIN_SCALE) / (1 - MIN_SCALE))
                const opacity = (INNER_OPACITY + (1 - INNER_OPACITY) * depth) * (0.4 + 0.6 * fold) * appear * intro
                const scale = size * (0.92 + 0.08 * intro)

                card.style.transform = `translate3d(${(originX + dx).toFixed(1)}px, ${(originY + dy).toFixed(1)}px, 0) translate(-50%, -50%) rotate(${rotate.toFixed(2)}deg) scale(${scale.toFixed(3)}, ${(scale * fold).toFixed(3)})`
                card.style.opacity = opacity.toFixed(3)
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
            const width = stage.clientWidth
            const height = stage.clientHeight
            const cardWidth = cards[0]?.offsetWidth ?? 0
            const cardHeight = cards[0]?.offsetHeight ?? 0
            if (!width || !height || !cardWidth || !cardHeight) return

            // 스테이지는 섹션을 꽉 채우므로 섹션 기준 좌표가 곧 스테이지 좌표다
            const origin = centerWithin(center, section)
            originX = origin.x
            originY = origin.y
            edgeRadius = Math.max(cardWidth, Math.min(originX, width - originX, originY, height - originY))
            // 화면 모서리를 지나 가장 큰 카드까지 다 빠져나가는 반지름에서 나선이 끝난다
            const endRadius =
                Math.hypot(Math.max(originX, width - originX), Math.max(originY, height - originY)) + cardWidth * MAX_SCALE * 0.6
            const ringGap = cardWidth * RING_GAP
            const slotLength = cardHeight + cardWidth * CARD_GAP

            // 첫 바퀴는 카드의 안쪽 끝이 글 덩어리의 위·아래 끝을 비켜 가는 반지름 — 카드 크기가 반지름에 따라 달라서 몇 번 되풀이해 맞춘다
            const textHalfHeight = center.offsetHeight / 2
            let exitRadius = textHalfHeight
            for (let n = 0; n < 6; n += 1) {
                exitRadius = textHalfHeight + (cardWidth * scaleAt(exitRadius)) / 2 + cardWidth * TEXT_GAP
            }
            const startRadius = Math.min(cardWidth * START_RADIUS, exitRadius)
            const exitScale = scaleAt(exitRadius)

            // 카드는 긴 변이 가운데를 향하므로, 바퀴 사이로는 긴 변이, 나선을 따라서는 짧은 변이 이웃과 마주한다
            let angle = 0
            let radius = startRadius
            let slot = 0
            slotAngles = [0]
            slotRadii = [radius]
            while (radius < endRadius) {
                const scale = scaleAt(radius)
                const leaving = angle < EXIT_ANGLE
                // 빠져나오는 동안은 바깥으로 곧장 뻗다가 첫 바퀴에 닿을 즈음 원을 따라 눕는다
                const grow = leaving
                    ? startRadius + (exitRadius - startRadius) * (1 - (1 - Math.min(1, (angle + TRACE_STEP) / EXIT_ANGLE)) ** 2) - radius
                    : ((cardWidth * scale + ringGap) / (Math.PI * 2)) * TRACE_STEP
                // 빠져나오는 길의 카드는 첫 바퀴 카드 간격으로 놓아, 글 뒤에 몰리지 않게 한다
                const advance = Math.hypot(radius * TRACE_STEP, grow) / (slotLength * (leaving ? exitScale : scale))
                while (slotAngles.length * SLOT_STEP <= slot + advance) {
                    const t = (slotAngles.length * SLOT_STEP - slot) / advance
                    slotAngles.push(angle + TRACE_STEP * t)
                    slotRadii.push(radius + grow * t)
                }
                angle += TRACE_STEP
                radius += grow
                slot += advance
            }
            visibleSlots = slot
            spacing = Math.max(1, visibleSlots / cards.length)
            cycle = Math.max(visibleSlots, spacing * cards.length)

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
