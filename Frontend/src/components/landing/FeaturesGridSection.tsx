import type { CSSProperties } from 'react'
import { LandingServiceIcon, mapFeatureIcon } from '@/components/landing/LandingServiceIcon'
import { ScrollReveal } from '@/components/landing/ScrollReveal'
import { FEATURES } from '@/constants/landing'

export function FeaturesGridSection() {
  return (
    <section className="features-grid landing-section--viewport" aria-labelledby="features-grid-title">
      <div className="landing-section__shell">
        <div className="landing-section__inner">
          <ScrollReveal>
            <h2 id="features-grid-title" className="landing-section__title">
              네일리의 <span className="landing-section__highlight">핵심 기능</span>
            </h2>
            <p className="landing-section__subtitle">
              정밀 분석, 선택적 3D 출력, AI 디자인 — 각각 독립적으로도, 함께도 이용할 수 있어요.
            </p>
          </ScrollReveal>
          <div className="features-grid__cards">
            {FEATURES.map((feature, index) => (
              <ScrollReveal key={feature.title} delay={100 + index * 110}>
                <article
                  className="features-grid__card"
                  style={{ '--feature-gradient': feature.gradient } as CSSProperties}
                >
                  <div className="features-grid__visual">
                    <LandingServiceIcon name={mapFeatureIcon(feature.icon)} variant="feature" />
                  </div>
                  <h3 className="features-grid__card-title">{feature.title}</h3>
                  <p className="features-grid__card-description">{feature.description}</p>
                </article>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
