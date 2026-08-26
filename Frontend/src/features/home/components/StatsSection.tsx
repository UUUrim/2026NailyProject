import { ScrollReveal } from '@/features/home/components/ScrollReveal'
import { STATS } from '@/features/home/constants/home'

export function StatsSection() {
  return (
    <section className="stats-section landing-section--viewport" aria-labelledby="stats-title">
      <div className="landing-section__shell">
        <div className="landing-section__inner">
          <ScrollReveal>
            <h2 id="stats-title" className="landing-section__title">
              웹에서 완성하는 <span className="landing-section__highlight">맞춤 네일 경험</span>
            </h2>
            <p className="landing-section__subtitle">
              손 스캔 · 네일팁 출력 · AI 디자인까지, 브라우저 하나로 진행해요.
            </p>
          </ScrollReveal>
          <div className="stats-section__grid">
            {STATS.map((stat, index) => (
              <ScrollReveal key={stat.label} className="stats-section__item" delay={120 + index * 100}>
                {index > 0 && <div className="stats-section__divider" aria-hidden="true" />}
                <p className="stats-section__value">{stat.value}</p>
                <p className="stats-section__label">{stat.label}</p>
                <p className="stats-section__description">{stat.description}</p>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
