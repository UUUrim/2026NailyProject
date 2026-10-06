import { HERO_TITLE, HERO_TITLE_STACKED } from '@/features/home/constants/home'

/**
 * 메인 히어로의 "3D 프린터가 Own Your Nail을 출력하는" 모션 엔진.
 *
 * - 타이틀을 오프스크린 캔버스에 실크 PLA 재질로 한 번 렌더링한 뒤, 알파를 스캔해
 *   아래에서 위로 쌓이는 레이어(band)로 잘라 둔다.
 * - 매 프레임 타임라인(가열 → 홈 이동 → 레이어 출력 → 헤드 복귀)에서 노즐 위치와
 *   출력된 영역을 계산하고, 출력된 부분만 캔버스에 복사한다.
 * - 프린트 헤드·갠트리·HUD 수치는 React 리렌더 없이 DOM을 직접 갱신한다.
 */

export type PrintPhase = 'loading' | 'heating' | 'homing' | 'printing' | 'finishing' | 'done'

type PrintHeroCallbacks = {
  onPhaseChange: (phase: PrintPhase) => void
  onReveal: () => void
}

type Layer = {
  top: number // device px (inclusive)
  bottom: number // device px (exclusive)
  minX: number // css px
  maxX: number // css px
}

type Layout = {
  width: number
  height: number
  dpr: number
  scale: number
  inkTop: number
  inkBottom: number
  inkLeft: number
  inkRight: number
  plateTop: number
  plateFront: number
  parkX: number
  parkY: number
  layers: Layer[]
  material: HTMLCanvasElement
  hot: HTMLCanvasElement
}

type FrameState = {
  phase: PrintPhase
  x: number
  y: number
  completed: number
  partial: { x0: number; x1: number } | null
  layerIndex: number
  progress: number
  heat: number
}

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  size: number
  color: string
  sparkle: boolean
}

type HudKey = 'layer' | 'layerTotal' | 'z' | 'progress' | 'percent' | 'nozzle' | 'bed' | 'gcode'

const FONT_FAMILY = '"Unbounded", "Pretendard", system-ui, sans-serif'
const FONT_WEIGHT = 800
const MAX_FONT_SIZE = 148
const STACK_BELOW_FONT_SIZE = 54

// 프린트 헤드 치수 (노즐 끝 기준, scale 1 기준 px) — landing-hero.css와 맞춰야 한다.
const HEAD_BEAM = 36
const HEAD_TOP = 59
const ROD_INSET = 14

const LAYER_MM = 0.2
const BED_MM = 220
const NOZZLE_TEMP = 215
const BED_TEMP = 60
const ROOM_TEMP = 24

const T_HEAT = 700
const T_HOME = 520
const T_PRINT = 3200
const T_LIFT = 900
const T_SHEEN = 1600
const T_HOT = 560
const T_COOL = 1400
const IDLE_SHEEN_EVERY = 7000
const P0 = T_HEAT + T_HOME
const P1 = P0 + T_PRINT
const DONE = P1 + T_LIFT
const REVEAL_AT = 0.7
const TRAVEL = 0.16
const GCODE_EVERY = 90

const GLITTER = ['#ffffff', '#ffd6e3', '#e7d8ff', '#fff1c7', '#d4f5ea']

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
const fontAt = (size: number) => `${FONT_WEIGHT} ${size}px ${FONT_FAMILY}`
const pad2 = (v: number) => String(v).padStart(2, '0')

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, width)
  canvas.height = Math.max(1, height)
  return canvas
}

async function loadHeroFonts() {
  if (!('fonts' in document)) return
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load(fontAt(100)),
        document.fonts.load('500 12px "JetBrains Mono"'),
      ]),
      new Promise((resolve) => window.setTimeout(resolve, 2200)),
    ])
  } catch {
    // 폰트 로딩 실패 시 fallback 폰트로 그대로 진행
  }
}

function buildLayout(width: number, dpr: number): Layout {
  const scale = width < 520 ? 0.7 : width < 820 ? 0.85 : 1
  const probe = createCanvas(1, 1).getContext('2d')!
  probe.font = fontAt(100)

  const maxTextWidth = width * 0.88
  let lines = [HERO_TITLE]
  let fontSize = Math.min(MAX_FONT_SIZE, (maxTextWidth / probe.measureText(HERO_TITLE).width) * 100)
  if (fontSize < STACK_BELOW_FONT_SIZE) {
    lines = HERO_TITLE_STACKED
    const widest = Math.max(...lines.map((line) => probe.measureText(line).width))
    fontSize = Math.min(MAX_FONT_SIZE, (maxTextWidth / widest) * 100)
  }

  probe.font = fontAt(fontSize)
  const metrics = lines.map((line) => probe.measureText(line))
  const textWidth = Math.max(...metrics.map((m) => m.width))
  const depth = Math.max(3, Math.round(fontSize * 0.05))
  const lineAdvance = fontSize * 1.04
  const headroom = Math.round((HEAD_TOP + 34) * scale)
  const firstBaseline = headroom + depth + metrics[0].actualBoundingBoxAscent
  const baselines = lines.map((_, i) => firstBaseline + i * lineAdvance)
  const estBottom = baselines[baselines.length - 1] + metrics[metrics.length - 1].actualBoundingBoxDescent
  const surface = clamp(fontSize * 0.34, 24, 44)
  const height = Math.ceil(estBottom + surface * 0.62 + 30)

  const material = createCanvas(Math.round(width * dpr), Math.round(height * dpr))
  const m = material.getContext('2d', { willReadFrequently: true })!
  m.scale(dpr, dpr)
  m.font = fontAt(fontSize)
  m.textAlign = 'center'
  m.textBaseline = 'alphabetic'
  const cx = width / 2 - depth * 0.25

  // 윗면·옆면 두께 (뒤 → 앞 순서로 겹쳐 그림)
  for (let d = depth; d >= 1; d--) {
    m.fillStyle = d === depth ? '#fbd9e5' : '#eea5be'
    lines.forEach((line, i) => m.fillText(line, cx + d * 0.55, baselines[i] - d))
  }

  // 정면: 핑크 실크 PLA + 라일락 광택
  const face = m.createLinearGradient(cx - textWidth / 2, 0, cx + textWidth / 2, 0)
  face.addColorStop(0, '#e98aaa')
  face.addColorStop(0.28, '#d9678e')
  face.addColorStop(0.52, '#b784dc')
  face.addColorStop(0.74, '#df6f98')
  face.addColorStop(1, '#ec90b0')
  m.fillStyle = face
  lines.forEach((line, i) => m.fillText(line, cx, baselines[i]))

  // 알파 스캔으로 실제 잉크 영역과 행별 좌우 범위를 구한다.
  const cw = material.width
  const ch = material.height
  const { data } = m.getImageData(0, 0, cw, ch)
  const rowMin = new Int32Array(ch).fill(-1)
  const rowMax = new Int32Array(ch).fill(-1)
  let topRow = -1
  let bottomRow = -1
  let leftCol = cw
  let rightCol = 0
  for (let y = 0; y < ch; y++) {
    const offset = y * cw * 4 + 3
    let lo = -1
    for (let x = 0; x < cw; x++) {
      if (data[offset + x * 4] > 16) {
        lo = x
        break
      }
    }
    if (lo < 0) continue
    let hi = lo
    for (let x = cw - 1; x > lo; x--) {
      if (data[offset + x * 4] > 16) {
        hi = x
        break
      }
    }
    rowMin[y] = lo
    rowMax[y] = hi + 1
    if (topRow < 0) topRow = y
    bottomRow = y + 1
    leftCol = Math.min(leftCol, lo)
    rightCol = Math.max(rightCol, hi + 1)
  }

  const layers: Layer[] = []
  if (topRow >= 0) {
    const inkRows = bottomRow - topRow
    const layerRows = Math.max(2, Math.round(clamp(inkRows / dpr / 30, 2.4, 5) * dpr))
    for (let bottom = bottomRow; bottom > topRow; bottom -= layerRows) {
      const top = Math.max(topRow, bottom - layerRows)
      let lo = Infinity
      let hi = -Infinity
      for (let y = top; y < bottom; y++) {
        if (rowMin[y] < 0) continue
        lo = Math.min(lo, rowMin[y])
        hi = Math.max(hi, rowMax[y])
      }
      if (lo === Infinity) {
        // 두 줄 배치의 줄 사이처럼 비어 있는 레이어는 노즐이 제자리에서 Z만 올린다.
        const prev = layers[layers.length - 1]
        const x = prev ? (layers.length % 2 === 1 ? prev.maxX : prev.minX) : width / 2
        layers.push({ top, bottom, minX: x, maxX: x })
      } else {
        layers.push({ top, bottom, minX: lo / dpr, maxX: hi / dpr })
      }
    }

    // 재질 마감: 실크 광택 → 위쪽 하이라이트 → 레이어 결(rib)
    m.setTransform(1, 0, 0, 1, 0, 0)
    m.globalCompositeOperation = 'source-atop'

    const silk = m.createLinearGradient(leftCol, topRow, rightCol, bottomRow)
    silk.addColorStop(0, 'rgba(206, 176, 255, 0)')
    silk.addColorStop(0.3, 'rgba(206, 176, 255, 0.2)')
    silk.addColorStop(0.62, 'rgba(172, 234, 218, 0.14)')
    silk.addColorStop(1, 'rgba(255, 196, 216, 0)')
    m.fillStyle = silk
    m.fillRect(0, topRow, cw, inkRows)

    const gloss = m.createLinearGradient(0, topRow, 0, bottomRow)
    gloss.addColorStop(0, 'rgba(255, 255, 255, 0.22)')
    gloss.addColorStop(0.5, 'rgba(255, 255, 255, 0)')
    gloss.addColorStop(1, 'rgba(110, 28, 64, 0.2)')
    m.fillStyle = gloss
    m.fillRect(0, topRow, cw, inkRows)

    for (const layer of layers) {
      const rib = m.createLinearGradient(0, layer.top, 0, layer.bottom)
      rib.addColorStop(0, 'rgba(255, 255, 255, 0.26)')
      rib.addColorStop(0.35, 'rgba(255, 255, 255, 0.04)')
      rib.addColorStop(0.75, 'rgba(110, 28, 64, 0.05)')
      rib.addColorStop(1, 'rgba(110, 28, 64, 0.3)')
      m.fillStyle = rib
      m.fillRect(0, layer.top, cw, layer.bottom - layer.top)
    }
    m.globalCompositeOperation = 'source-over'
  }

  // 막 토출된 레이어를 밝게 덮어 줄 "뜨거운" 버전
  const hot = createCanvas(cw, ch)
  const h = hot.getContext('2d')!
  h.drawImage(material, 0, 0)
  h.globalCompositeOperation = 'source-in'
  h.fillStyle = '#fff6f9'
  h.fillRect(0, 0, cw, ch)

  const inkTop = topRow >= 0 ? topRow / dpr : headroom
  const inkBottom = bottomRow >= 0 ? bottomRow / dpr : estBottom

  return {
    width,
    height,
    dpr,
    scale,
    inkTop,
    inkBottom,
    inkLeft: topRow >= 0 ? leftCol / dpr : width * 0.1,
    inkRight: topRow >= 0 ? rightCol / dpr : width * 0.9,
    plateTop: inkBottom - surface * 0.38,
    plateFront: inkBottom + surface * 0.62,
    parkX: width - (ROD_INSET + 46) * scale,
    parkY: inkTop - 30 * scale,
    layers,
    material,
    hot,
  }
}

export class PrintHeroEngine {
  private readonly root: HTMLElement
  private readonly stage: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly gantry: HTMLElement
  private readonly head: HTMLElement
  private readonly tube: SVGPathElement | null
  private readonly hud: Record<HudKey, HTMLElement | null>
  private readonly callbacks: PrintHeroCallbacks
  private readonly reducedMotion: boolean

  private layout: Layout | null = null
  private phase: PrintPhase = 'loading'
  private elapsed = 0
  private lastNow = 0
  private raf = 0
  private layoutRaf = 0
  private sheenTimer = 0
  private sheenStart = -Infinity
  private revealed = false
  private destroyed = false
  private visible = true
  private particles: Particle[] = []
  private spawnCarry = 0
  private extruded = 0
  private lastX = 0
  private lastGcodeAt = -Infinity
  private lastGcodeLayer = -1
  private pointer = { x: 0, y: 0, tx: 0, ty: 0, amount: 0, target: 0 }
  private readonly textCache = new Map<HTMLElement, string>()
  private resizeObserver: ResizeObserver | null = null
  private intersectionObserver: IntersectionObserver | null = null

  static mount(root: HTMLElement, callbacks: PrintHeroCallbacks) {
    const pick = <T extends Element>(name: string) => root.querySelector<T>(`[data-ph="${name}"]`)
    const stage = pick<HTMLElement>('stage')
    const canvas = pick<HTMLCanvasElement>('canvas')
    const gantry = pick<HTMLElement>('gantry')
    const head = pick<HTMLElement>('head')
    const ctx = canvas?.getContext('2d')
    if (!stage || !canvas || !ctx || !gantry || !head) return null

    const engine = new PrintHeroEngine(root, callbacks, {
      stage,
      canvas,
      ctx,
      gantry,
      head,
      tube: pick<SVGPathElement>('tube'),
      hud: {
        layer: pick('layer'),
        layerTotal: pick('layer-total'),
        z: pick('z'),
        progress: pick('progress'),
        percent: pick('percent'),
        nozzle: pick('nozzle'),
        bed: pick('bed'),
        gcode: pick('gcode'),
      },
    })
    void engine.start()
    return engine
  }

  private constructor(
    root: HTMLElement,
    callbacks: PrintHeroCallbacks,
    els: {
      stage: HTMLElement
      canvas: HTMLCanvasElement
      ctx: CanvasRenderingContext2D
      gantry: HTMLElement
      head: HTMLElement
      tube: SVGPathElement | null
      hud: Record<HudKey, HTMLElement | null>
    },
  ) {
    this.root = root
    this.callbacks = callbacks
    this.stage = els.stage
    this.canvas = els.canvas
    this.ctx = els.ctx
    this.gantry = els.gantry
    this.head = els.head
    this.tube = els.tube
    this.hud = els.hud
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  private async start() {
    await loadHeroFonts()
    if (this.destroyed) return

    this.relayout()
    this.resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(this.layoutRaf)
      this.layoutRaf = requestAnimationFrame(() => this.relayout())
    })
    this.resizeObserver.observe(this.stage)

    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting
      if (this.visible) this.requestFrame()
    })
    this.intersectionObserver.observe(this.root)

    this.root.addEventListener('pointermove', this.handlePointerMove)
    this.root.addEventListener('pointerleave', this.handlePointerLeave)

    if (this.reducedMotion) this.elapsed = DONE + T_COOL
    this.requestFrame()
  }

  replay() {
    if (!this.layout || this.destroyed) return
    this.elapsed = 0
    this.particles = []
    this.spawnCarry = 0
    this.extruded = 0
    this.lastGcodeAt = -Infinity
    this.lastGcodeLayer = -1
    this.sheenStart = -Infinity
    window.clearTimeout(this.sheenTimer)
    this.sheenTimer = 0
    this.requestFrame()
  }

  destroy() {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    cancelAnimationFrame(this.layoutRaf)
    window.clearTimeout(this.sheenTimer)
    this.resizeObserver?.disconnect()
    this.intersectionObserver?.disconnect()
    this.root.removeEventListener('pointermove', this.handlePointerMove)
    this.root.removeEventListener('pointerleave', this.handlePointerLeave)
  }

  private relayout() {
    if (this.destroyed) return
    // clientWidth는 transform(진입 애니메이션의 scale 등)의 영향을 받지 않는다.
    const width = this.stage.clientWidth
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (width <= 0 || (this.layout && this.layout.width === width && this.layout.dpr === dpr)) return

    const layout = buildLayout(width, dpr)
    this.layout = layout
    this.canvas.width = layout.material.width
    this.canvas.height = layout.material.height
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${layout.height}px`

    const { style } = this.stage
    style.height = `${layout.height}px`
    style.setProperty('--head-scale', String(layout.scale))
    style.setProperty('--rod-inset', `${ROD_INSET * layout.scale}px`)
    style.setProperty('--plate-top', `${layout.plateTop}px`)
    style.setProperty('--plate-front', `${layout.plateFront}px`)
    this.setText(this.hud.layerTotal, pad2(layout.layers.length))
    this.requestFrame()
  }

  private requestFrame() {
    if (this.destroyed || this.raf || !this.layout) return
    this.raf = requestAnimationFrame(this.frame)
  }

  private readonly frame = (now: number) => {
    this.raf = 0
    const layout = this.layout
    if (!layout || this.destroyed) return

    // 탭이 백그라운드였던 긴 공백은 한 프레임으로 취급해 타임라인을 일시정지시킨다.
    const gap = this.lastNow ? now - this.lastNow : 16
    const dt = gap > 400 ? 16 : gap
    this.lastNow = now
    this.elapsed += dt

    const state = this.stateAt(this.elapsed)
    this.syncPhase(state)
    this.updatePointer(dt)
    this.updateParticles(state, dt)
    this.render(state)
    this.updateDom(state)

    const pointerSettling =
      Math.abs(this.pointer.target - this.pointer.amount) > 0.01 ||
      (this.pointer.amount > 0.01 &&
        (Math.abs(this.pointer.tx - this.pointer.x) > 0.5 || Math.abs(this.pointer.ty - this.pointer.y) > 0.5))
    const busy =
      state.phase !== 'done' ||
      this.elapsed - DONE < T_COOL ||
      this.elapsed - this.sheenStart < T_SHEEN ||
      this.particles.length > 0 ||
      pointerSettling

    if (busy && (this.visible || state.phase !== 'done')) {
      this.raf = requestAnimationFrame(this.frame)
    } else {
      this.lastNow = 0
      this.scheduleIdleSheen()
    }
  }

  private scheduleIdleSheen() {
    if (this.reducedMotion || this.sheenTimer || !this.visible) return
    this.sheenTimer = window.setTimeout(() => {
      this.sheenTimer = 0
      if (!this.visible || this.destroyed) return
      this.sheenStart = this.elapsed
      this.requestFrame()
    }, IDLE_SHEEN_EVERY)
  }

  private syncPhase(state: FrameState) {
    if (state.phase !== this.phase) {
      this.phase = state.phase
      this.callbacks.onPhaseChange(state.phase)
      if (state.phase === 'done' && !this.reducedMotion) this.sheenStart = this.elapsed
    }
    if (!this.revealed && (state.phase === 'finishing' || state.phase === 'done' || state.progress >= REVEAL_AT)) {
      this.revealed = true
      this.callbacks.onReveal()
    }
  }

  private stateAt(t: number): FrameState {
    const L = this.layout!
    const { layers, dpr, parkX, parkY } = L
    const n = layers.length

    if (n === 0 || t >= DONE) {
      const cool = n === 0 ? 1 : clamp((t - DONE) / T_COOL, 0, 1)
      return {
        phase: 'done',
        x: parkX,
        y: parkY,
        completed: n,
        partial: null,
        layerIndex: n - 1,
        progress: 1,
        heat: lerp(1, 0.28, cool),
      }
    }

    if (t < T_HEAT) {
      return {
        phase: 'heating',
        x: parkX,
        y: parkY,
        completed: 0,
        partial: null,
        layerIndex: -1,
        progress: 0,
        heat: easeOutCubic(t / T_HEAT),
      }
    }

    if (t < P0) {
      const u = easeInOutCubic((t - T_HEAT) / T_HOME)
      return {
        phase: 'homing',
        x: lerp(parkX, layers[0].minX, u),
        y: lerp(parkY, layers[0].top / dpr, u),
        completed: 0,
        partial: null,
        layerIndex: -1,
        progress: 0,
        heat: 1,
      }
    }

    if (t < P1) {
      const f = ((t - P0) / T_PRINT) * n
      const k = Math.min(n - 1, Math.floor(f))
      const local = f - k
      const layer = layers[k]
      const top = layer.top / dpr
      const forward = k % 2 === 0
      const startX = forward ? layer.minX : layer.maxX
      const endX = forward ? layer.maxX : layer.minX
      const prev = k > 0 ? layers[k - 1] : null
      const fromX = prev ? ((k - 1) % 2 === 0 ? prev.maxX : prev.minX) : startX
      const fromY = prev ? prev.top / dpr : top

      if (local < TRAVEL) {
        const u = easeInOutSine(local / TRAVEL)
        return {
          phase: 'printing',
          x: lerp(fromX, startX, u),
          y: lerp(fromY, top, u),
          completed: k,
          partial: null,
          layerIndex: k,
          progress: f / n,
          heat: 1,
        }
      }

      const x = lerp(startX, endX, easeInOutSine((local - TRAVEL) / (1 - TRAVEL)))
      return {
        phase: 'printing',
        x,
        y: top,
        completed: k,
        partial: forward ? { x0: startX, x1: x } : { x0: x, x1: startX },
        layerIndex: k,
        progress: f / n,
        heat: 1,
      }
    }

    const raw = (t - P1) / T_LIFT
    const last = layers[n - 1]
    const lastX = (n - 1) % 2 === 0 ? last.maxX : last.minX
    return {
      phase: 'finishing',
      x: lerp(lastX, parkX, easeInOutCubic(raw)),
      y: lerp(last.top / dpr, parkY, easeOutCubic(Math.min(1, raw * 1.6))),
      completed: n,
      partial: null,
      layerIndex: n - 1,
      progress: 1,
      heat: 1,
    }
  }

  private updatePointer(dt: number) {
    const p = this.pointer
    const follow = Math.min(1, dt / 90)
    p.x += (p.tx - p.x) * follow
    p.y += (p.ty - p.y) * follow
    p.amount += (p.target - p.amount) * Math.min(1, dt / 220)
  }

  private updateParticles(state: FrameState, dt: number) {
    const s = this.layout!.scale
    if (state.phase === 'printing' && state.partial && !this.reducedMotion) {
      this.spawnCarry += dt * 0.07
      while (this.spawnCarry >= 1) {
        this.spawnCarry -= 1
        this.particles.push({
          x: state.x + (Math.random() - 0.5) * 6 * s,
          y: state.y - Math.random() * 3 * s,
          vx: (Math.random() - 0.5) * 190 * s,
          vy: -(40 + Math.random() * 150) * s,
          age: 0,
          life: 380 + Math.random() * 360,
          size: (0.8 + Math.random() * 1.5) * s,
          color: GLITTER[Math.floor(Math.random() * GLITTER.length)],
          sparkle: Math.random() < 0.3,
        })
      }
    }

    const sec = dt / 1000
    for (const p of this.particles) {
      p.age += dt
      p.vy += 620 * s * sec
      p.x += p.vx * sec
      p.y += p.vy * sec
    }
    this.particles = this.particles.filter((p) => p.age < p.life)
  }

  private render(state: FrameState) {
    const L = this.layout!
    const { ctx } = this
    const { dpr, layers } = L
    const cw = this.canvas.width
    const ch = this.canvas.height

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, cw, ch)
    if (layers.length === 0) return

    // 1) 빌드 플레이트에 비친 반사
    const base = layers[0].bottom
    const reflect = Math.round((L.plateFront - L.inkBottom) * dpr)
    if (reflect > 0) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, base, cw, reflect)
      ctx.clip()
      ctx.setTransform(1, 0, 0, -1, 0, base * 2)
      ctx.globalAlpha = 0.2
      this.drawPrinted(state, L.material)
      ctx.restore()

      ctx.save()
      ctx.globalCompositeOperation = 'destination-out'
      const fade = ctx.createLinearGradient(0, base, 0, base + reflect)
      fade.addColorStop(0, 'rgba(0, 0, 0, 0.1)')
      fade.addColorStop(1, 'rgba(0, 0, 0, 1)')
      ctx.fillStyle = fade
      ctx.fillRect(0, base, cw, reflect)
      ctx.restore()
    }

    // 2) 출력된 부분 + 3) 식어가는 새 레이어의 열감
    this.drawContactShadow(state)
    this.drawPrinted(state, L.material)
    this.drawHot(state)

    // 4) 광택 스윕과 커서 하이라이트 (출력물 픽셀 위에만)
    this.drawHighlights()

    // 5) 노즐 열광 + 글리터 파티클
    this.drawNozzle(state)
    this.drawParticles()
  }

  private blitRows(src: HTMLCanvasElement, top: number, bottom: number, x0 = 0, x1 = src.width) {
    const h = bottom - top
    const w = x1 - x0
    if (h <= 0 || w <= 0) return
    this.ctx.drawImage(src, x0, top, w, h, x0, top, w, h)
  }

  private drawPrinted(state: FrameState, src: HTMLCanvasElement) {
    const { layers, dpr } = this.layout!
    if (state.completed > 0) {
      this.blitRows(src, layers[state.completed - 1].top, layers[0].bottom)
    }
    if (state.partial && state.completed < layers.length) {
      const layer = layers[state.completed]
      const x0 = Math.max(0, Math.floor(state.partial.x0 * dpr))
      const x1 = Math.min(src.width, Math.ceil(state.partial.x1 * dpr))
      this.blitRows(src, layer.top, layer.bottom, x0, x1)
    }
  }

  private drawContactShadow(state: FrameState) {
    const L = this.layout!
    const amount = Math.min(1, state.completed / 4)
    if (amount <= 0) return

    const { ctx } = this
    const first = L.layers[0]
    ctx.save()
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0)
    ctx.filter = `blur(${(5 * L.scale).toFixed(1)}px)`
    ctx.fillStyle = `rgba(120, 40, 72, ${(0.2 * amount).toFixed(3)})`
    ctx.fillRect(first.minX, L.inkBottom - 2, first.maxX - first.minX, 6 * L.scale)
    ctx.restore()
  }

  private drawHot(state: FrameState) {
    const { layers, hot, dpr, scale } = this.layout!
    const { ctx } = this
    const perLayer = T_PRINT / layers.length
    const first = Math.max(0, state.completed - Math.ceil(T_HOT / perLayer) - 1)

    for (let k = first; k < state.completed; k++) {
      const a = 1 - (this.elapsed - (P0 + (k + 1) * perLayer)) / T_HOT
      if (a <= 0) continue
      ctx.globalAlpha = a * a * 0.7
      this.blitRows(hot, layers[k].top, layers[k].bottom)
    }

    if (state.partial && state.completed < layers.length) {
      const layer = layers[state.completed]
      const x0 = Math.max(0, Math.floor(state.partial.x0 * dpr))
      const x1 = Math.min(hot.width, Math.ceil(state.partial.x1 * dpr))
      ctx.globalAlpha = 0.5
      this.blitRows(hot, layer.top, layer.bottom, x0, x1)

      // 노즐 바로 뒤쪽은 더 뜨겁게
      const trail = Math.round(70 * scale * dpr)
      const nozzle = Math.round(state.x * dpr)
      const forward = state.completed % 2 === 0
      ctx.globalAlpha = 0.45
      this.blitRows(
        hot,
        layer.top,
        layer.bottom,
        Math.max(x0, forward ? nozzle - trail : nozzle),
        Math.min(x1, forward ? nozzle : nozzle + trail),
      )
    }
    ctx.globalAlpha = 1
  }

  private drawHighlights() {
    const L = this.layout!
    const { ctx } = this
    const sheenU = (this.elapsed - this.sheenStart) / T_SHEEN
    const sheenOn = sheenU >= 0 && sheenU <= 1
    const pointerOn = this.pointer.amount > 0.01
    if (!sheenOn && !pointerOn) return

    ctx.save()
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0)
    ctx.beginPath()
    ctx.rect(0, 0, L.width, L.inkBottom)
    ctx.clip()
    ctx.globalCompositeOperation = 'source-atop'

    if (sheenOn) {
      const span = L.inkRight - L.inkLeft
      const cx = lerp(L.inkLeft - span * 0.2, L.inkRight + span * 0.2, easeInOutSine(sheenU))
      const band = Math.max(80, span * 0.11)
      const g = ctx.createLinearGradient(cx - band, L.inkTop - band * 0.3, cx + band, L.inkBottom + band * 0.3)
      g.addColorStop(0, 'rgba(255, 255, 255, 0)')
      g.addColorStop(0.32, 'rgba(210, 188, 255, 0.3)')
      g.addColorStop(0.5, 'rgba(255, 255, 255, 0.78)')
      g.addColorStop(0.68, 'rgba(182, 236, 220, 0.3)')
      g.addColorStop(1, 'rgba(255, 255, 255, 0)')
      ctx.fillStyle = g
      ctx.fillRect(cx - band * 2, 0, band * 4, L.inkBottom)
    }

    if (pointerOn) {
      const { x, y, amount } = this.pointer
      const r = 140 * L.scale + 40
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, `rgba(255, 255, 255, ${0.5 * amount})`)
      g.addColorStop(0.45, `rgba(222, 204, 255, ${0.24 * amount})`)
      g.addColorStop(1, 'rgba(222, 204, 255, 0)')
      ctx.fillStyle = g
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }
    ctx.restore()
  }

  private drawNozzle(state: FrameState) {
    const L = this.layout!
    const strength = state.heat * (state.phase === 'printing' ? 1 : 0.55)
    if (strength <= 0.02) return

    const { ctx } = this
    const r = 26 * L.scale
    ctx.save()
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0)
    const g = ctx.createRadialGradient(state.x, state.y, 0, state.x, state.y, r)
    g.addColorStop(0, `rgba(255, 255, 255, ${0.9 * strength})`)
    g.addColorStop(0.28, `rgba(255, 176, 204, ${0.5 * strength})`)
    g.addColorStop(1, 'rgba(255, 176, 204, 0)')
    ctx.fillStyle = g
    ctx.fillRect(state.x - r, state.y - r, r * 2, r * 2)
    ctx.restore()
  }

  private drawParticles() {
    if (this.particles.length === 0) return
    const L = this.layout!
    const { ctx } = this
    ctx.save()
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0)
    for (const p of this.particles) {
      ctx.globalAlpha = (1 - p.age / p.life) ** 1.5
      ctx.fillStyle = p.color
      if (p.sparkle) {
        const r = p.size * 2.6
        const w = p.size * 0.55
        ctx.beginPath()
        ctx.moveTo(p.x, p.y - r)
        ctx.lineTo(p.x + w, p.y - w)
        ctx.lineTo(p.x + r, p.y)
        ctx.lineTo(p.x + w, p.y + w)
        ctx.lineTo(p.x, p.y + r)
        ctx.lineTo(p.x - w, p.y + w)
        ctx.lineTo(p.x - r, p.y)
        ctx.lineTo(p.x - w, p.y - w)
        ctx.closePath()
        ctx.fill()
      } else {
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  private updateDom(state: FrameState) {
    const L = this.layout!
    const s = L.scale
    const { x, y } = state

    this.head.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`
    this.head.style.setProperty('--heat', state.heat.toFixed(3))
    this.gantry.style.transform = `translate3d(0, ${(y - HEAD_BEAM * s).toFixed(2)}px, 0)`

    if (this.tube) {
      // 헤드 윗면에서 스테이지 상단의 피더까지 늘어지는 필라멘트 튜브
      const hy = y - HEAD_TOP * s
      const ax = L.width * 0.74
      const ay = 0
      const slack = clamp((hy - ay) * 0.5, 6, 64 * s)
      this.tube.setAttribute(
        'd',
        `M ${x.toFixed(1)} ${hy.toFixed(1)} C ${x.toFixed(1)} ${(hy - slack).toFixed(1)}, ${ax.toFixed(1)} ${(ay + slack).toFixed(1)}, ${ax.toFixed(1)} ${ay}`,
      )
    }

    const n = L.layers.length
    const shownLayer =
      state.phase === 'printing' ? state.layerIndex + 1 : state.phase === 'finishing' || state.phase === 'done' ? n : 0
    this.setText(this.hud.layer, pad2(shownLayer))
    this.setText(this.hud.z, (shownLayer * LAYER_MM).toFixed(2))
    this.setText(this.hud.percent, `${Math.round(state.progress * 100)}%`)
    if (this.hud.progress) this.hud.progress.style.transform = `scaleX(${state.progress.toFixed(4)})`

    const t = this.elapsed
    const ramp = state.phase === 'heating' ? state.heat : 1
    const jitter = state.phase === 'printing' ? Math.round(Math.sin(t / 290) * 1.4) : 0
    this.setText(this.hud.nozzle, String(Math.round(lerp(ROOM_TEMP, NOZZLE_TEMP, ramp)) + jitter))
    this.setText(this.hud.bed, String(Math.round(lerp(ROOM_TEMP, BED_TEMP, ramp))))

    this.extruded += Math.abs(x - this.lastX) * (state.partial ? 0.0331 : 0)
    this.lastX = x
    this.setText(this.hud.gcode, this.gcodeFor(state))
  }

  private gcodeFor(state: FrameState) {
    const t = this.elapsed
    switch (state.phase) {
      case 'loading':
      case 'heating':
        return t < T_HEAT / 2 ? `M104 S${NOZZLE_TEMP}` : `M140 S${BED_TEMP}`
      case 'homing':
        return 'G28 ; HOME'
      case 'finishing':
        return 'G1 Z10 F3000'
      case 'done':
        return 'M84 ; DONE'
      case 'printing': {
        const cached = this.hud.gcode ? this.textCache.get(this.hud.gcode) : undefined
        if (state.layerIndex !== this.lastGcodeLayer) {
          this.lastGcodeLayer = state.layerIndex
          this.lastGcodeAt = t
          return `G1 Z${((state.layerIndex + 1) * LAYER_MM).toFixed(2)} F600`
        }
        if (cached && t - this.lastGcodeAt < GCODE_EVERY) return cached
        this.lastGcodeAt = t
        const xmm = ((state.x / this.layout!.width) * BED_MM).toFixed(1)
        const ymm = (96 + Math.sin(t / 53) * 18).toFixed(1)
        return `G1 X${xmm} Y${ymm} E${this.extruded.toFixed(3)}`
      }
    }
  }

  private setText(el: HTMLElement | null, value: string) {
    if (!el || this.textCache.get(el) === value) return
    this.textCache.set(el, value)
    el.textContent = value
  }

  private readonly handlePointerMove = (event: PointerEvent) => {
    const layout = this.layout
    if (!layout) return
    const stageRect = this.stage.getBoundingClientRect()
    const p = this.pointer
    p.tx = event.clientX - stageRect.left
    p.ty = event.clientY - stageRect.top
    if (p.amount < 0.02) {
      p.x = p.tx
      p.y = p.ty
    }
    p.target = 1

    const rootRect = this.root.getBoundingClientRect()
    this.root.style.setProperty('--px', (((event.clientX - rootRect.left) / rootRect.width) * 2 - 1).toFixed(3))
    this.root.style.setProperty('--py', (((event.clientY - rootRect.top) / rootRect.height) * 2 - 1).toFixed(3))
    this.requestFrame()
  }

  private readonly handlePointerLeave = () => {
    this.pointer.target = 0
    this.root.style.setProperty('--px', '0')
    this.root.style.setProperty('--py', '0')
    this.requestFrame()
  }
}
