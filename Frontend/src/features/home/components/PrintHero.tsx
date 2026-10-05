import { CtaButton } from '@/features/home/components/CtaButton'
import { HERO_SUBTITLE, HERO_TITLE } from '@/features/home/constants/home'
import { usePrintHero } from '@/features/home/hooks/usePrintHero'
import type { PrintPhase } from '@/features/home/utils/printHeroEngine'
import { Header } from '@/shared/layout/Header'
import '@/styles/landing-hero.css'

const PHASE_LABEL: Record<PrintPhase, string> = {
  loading: 'Loading file',
  heating: 'Heating',
  homing: 'Homing',
  printing: 'Printing',
  finishing: 'Finishing',
  done: 'Print complete',
}

// 빌드 플레이트의 원근 격자 (viewBox 0 0 100 10 기준)
// PLATE_INSET을 바꾸면 landing-hero.css의 .print-hero__plate left/right 계산식도 함께 바꿔야 한다.
const PLATE_INSET = 2
const PLATE_COLUMNS = Array.from({ length: 21 }, (_, i) => i / 20)
const PLATE_ROWS = [2.2, 5, 8.4]

type PrintHeroProps = {
  onStartClick?: () => void
}

export function PrintHero({ onStartClick }: PrintHeroProps) {
  const { rootRef, phase, revealed, replay } = usePrintHero()

  const handleScrollCue = () => {
    rootRef.current?.nextElementSibling?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <section ref={rootRef} className="print-hero" aria-labelledby="print-hero-title">
      <div className="print-hero__backdrop" aria-hidden="true">
        <div className="print-hero__aurora">
          <span className="print-hero__blob print-hero__blob--pink" />
          <span className="print-hero__blob print-hero__blob--lilac" />
          <span className="print-hero__blob print-hero__blob--mint" />
        </div>
        <div className="print-hero__grid" />
        <div className="print-hero__grain" />
      </div>

      <Header overlay />

      <div className="print-hero__content">
        <h1 id="print-hero-title" className="print-hero__sr-only">
          {HERO_TITLE}
        </h1>

        <div className="print-hero__machine" data-phase={phase}>
          <div className="print-hero__hud print-hero__hud--top" aria-hidden="true">
            <span className="print-hero__status">
              <span className="print-hero__status-dot" />
              {PHASE_LABEL[phase]}
            </span>
            <span className="print-hero__file">
              own-your-nail.gcode <em>· Silk PLA · Petal Pink</em>
            </span>
            <span className="print-hero__gcode" data-ph="gcode" />
            <span className="print-hero__temps">
              <span>
                Nozzle <b data-ph="nozzle">24</b>°C
              </span>
              <span>
                Bed <b data-ph="bed">24</b>°C
              </span>
            </span>
          </div>

          <div className="print-hero__stage" data-ph="stage" aria-hidden="true">
            <span className="print-hero__rod print-hero__rod--left" />
            <span className="print-hero__rod print-hero__rod--right" />

            <div className="print-hero__plate">
              <svg className="print-hero__plate-surface" viewBox="0 0 100 10" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="print-hero-plate-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#efe2e8" />
                    <stop offset="0.55" stopColor="#f9f3f6" />
                    <stop offset="1" stopColor="#ffffff" />
                  </linearGradient>
                </defs>
                <polygon
                  points={`${PLATE_INSET},0 ${100 - PLATE_INSET},0 100,10 0,10`}
                  fill="url(#print-hero-plate-fill)"
                />
                <g className="print-hero__plate-grid">
                  {PLATE_COLUMNS.map((u) => (
                    <line
                      key={u}
                      x1={PLATE_INSET + u * (100 - PLATE_INSET * 2)}
                      y1="0"
                      x2={u * 100}
                      y2="10"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  {PLATE_ROWS.map((v) => {
                    const inset = PLATE_INSET * (1 - v / 10)
                    return (
                      <line key={v} x1={inset} y1={v} x2={100 - inset} y2={v} vectorEffect="non-scaling-stroke" />
                    )
                  })}
                </g>
              </svg>
              <span className="print-hero__plate-edge" />
            </div>

            <canvas className="print-hero__canvas" data-ph="canvas" />

            <svg className="print-hero__tube">
              <path data-ph="tube" />
            </svg>

            <div className="print-hero__gantry" data-ph="gantry">
              <span className="print-hero__beam print-hero__beam--upper" />
              <span className="print-hero__beam print-hero__beam--lower" />
              <span className="print-hero__carriage print-hero__carriage--left" />
              <span className="print-hero__carriage print-hero__carriage--right" />
            </div>

            <div className="print-hero__head" data-ph="head">
              <div className="print-hero__head-inner">
                <div className="print-hero__head-body">
                  <span className="print-hero__fan" />
                  <span className="print-hero__led" />
                  <span className="print-hero__head-label">NAILY</span>
                </div>
                <span className="print-hero__nozzle" />
                <span className="print-hero__tip" />
              </div>
            </div>
          </div>

          <div className="print-hero__hud print-hero__hud--bottom">
            <span className="print-hero__readout" aria-hidden="true">
              Layer <b data-ph="layer">00</b>/<b data-ph="layer-total">00</b>
            </span>
            <span className="print-hero__readout print-hero__readout--z" aria-hidden="true">
              Z <b data-ph="z">0.00</b>mm
            </span>
            <span className="print-hero__progress" aria-hidden="true">
              <span className="print-hero__progress-bar" data-ph="progress" />
            </span>
            <b className="print-hero__percent" data-ph="percent" aria-hidden="true">
              0%
            </b>
            <button
              type="button"
              className="print-hero__reprint"
              onClick={replay}
              disabled={phase !== 'done'}
              aria-label="타이틀 다시 출력하기"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M13 8a5 5 0 1 1-1.46-3.54M13 2.5v2.5h-2.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Reprint
            </button>
          </div>
        </div>

        <div className="print-hero__copy" data-revealed={revealed}>
          <p className="print-hero__subtitle">{HERO_SUBTITLE}</p>
          <CtaButton onClick={onStartClick} />
        </div>
      </div>

      <button type="button" className="print-hero__scroll" onClick={handleScrollCue} aria-label="다음 섹션으로 이동">
        <span>Scroll</span>
        <span className="print-hero__scroll-line" />
      </button>
    </section>
  )
}
