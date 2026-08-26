import type { CSSProperties } from 'react'
import { LandingServiceIcon, mapStepIcon } from '@/features/home/components/LandingServiceIcon'
import { ScrollReveal } from '@/features/home/components/ScrollReveal'
import { HOW_IT_WORKS_STEPS } from '@/features/home/constants/home'

export function HowItWorksSection() {
  return (
    <section className="how-it-works landing-section--viewport" aria-labelledby="how-it-works-title">
      <div className="landing-section__shell">
        <div className="landing-section__inner">
          <ScrollReveal>
            <h2 id="how-it-works-title" className="landing-section__title">
              네일리 <span className="landing-section__highlight">이용 흐름</span>
            </h2>
            <p className="landing-section__subtitle">
              손 스캔 · 네일팁 출력 · 디자인 생성 · 셀프/샵 활용 순서로 진행돼요.
            </p>
          </ScrollReveal>
          <div className="how-it-works__flow">
            {HOW_IT_WORKS_STEPS.map((item, index) => (
              <div key={item.step} className="how-it-works__flow-item">
                <ScrollReveal delay={100 + index * 90}>
                  <article
                    className="how-it-works__card"
                    style={{ '--step-accent': item.accent } as CSSProperties}
                  >
                    <div className="how-it-works__card-top">
                      <span className="how-it-works__step-badge">
                        {`Step ${item.step}`}
                      </span>
                    <div className="how-it-works__illustration">
                      <LandingServiceIcon name={mapStepIcon(item.step)} variant="step" />
                    </div>
                    </div>
                    <h3 className="how-it-works__card-title">{item.title}</h3>
                    <p className="how-it-works__card-description">{item.description}</p>
                  </article>
                </ScrollReveal>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
