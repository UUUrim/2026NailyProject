import { CtaButton } from '@/components/landing/CtaButton'
import { Header } from '@/components/landing/Header'
import { HERO_SUBTITLE, MAIN_BG } from '@/constants/landing'

type HeroPanelProps = {
  variant: 'top' | 'bottom'
  showTitle?: boolean
  showHeader?: boolean
  onStartClick?: () => void
}

export function HeroPanel({
  variant,
  showTitle = true,
  showHeader = false,
  onStartClick,
}: HeroPanelProps) {
  return (
    <section
      className={`hero-panel hero-panel--${variant}`}
      aria-label={variant === 'top' ? '메인 소개' : '시작하기 안내'}
    >
      <img src={MAIN_BG} alt="" className="hero-panel__bg" />
      <div
        className={`hero-panel__overlay hero-panel__overlay--${variant}`}
        aria-hidden="true"
      />
      <div className="hero-panel__inner">
        {showHeader && <Header />}
        <div className="hero-panel__content">
          {showTitle && <h1 className="hero-panel__title">Own your Nail</h1>}
          <p className="hero-panel__subtitle">{HERO_SUBTITLE}</p>
          <CtaButton onClick={onStartClick} />
        </div>
      </div>
    </section>
  )
}
