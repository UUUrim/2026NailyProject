import { LandingBenefitIcon, mapBenefitIcon } from '@/components/landing/LandingServiceIcon'
import { ScrollReveal } from '@/components/landing/ScrollReveal'
import { NAILY_BENEFITS } from '@/constants/landing'

function ServiceBrowserMockup() {
  return (
    <div className="service-browser" aria-hidden="true">
      <div className="service-browser__frame">
        <div className="service-browser__toolbar">
          <span className="service-browser__dot" />
          <span className="service-browser__dot" />
          <span className="service-browser__dot" />
          <div className="service-browser__url">naily.com</div>
        </div>
        <div className="service-browser__tabs">
          <span className="service-browser__tab is-active">손 스캔</span>
          <span className="service-browser__tab">AI 디자인</span>
        </div>
        <div className="service-browser__content">
          <div className="service-browser__scan">
            <div className="service-browser__scan-viewfinder">
              <div className="service-browser__hand-outline" />
              <span className="service-browser__scan-label">손톱 분석 중...</span>
            </div>
            <div className="service-browser__scan-data">
              <div className="service-browser__data-row">
                <span>손톱 길이</span>
                <strong>12.4mm</strong>
              </div>
              <div className="service-browser__data-row">
                <span>손톱 너비</span>
                <strong>9.5mm</strong>
              </div>
              <div className="service-browser__data-row">
                <span>곡률</span>
                <strong>0.6</strong>
              </div>
            </div>
          </div>
          <div className="service-browser__design">
            <div className="service-browser__chat">
              <div className="service-browser__bubble service-browser__bubble--ai">
                어떤 분위기의 네일을 원하세요?
              </div>
              <div className="service-browser__bubble service-browser__bubble--user">
                크리스마스에 어울리는 네일을 만들어줘
              </div>
            </div>
            <div className="service-browser__generating">
              <svg
                className="service-browser__generating-art"
                viewBox="3 0 132 72"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="nailFill1" x1="8" y1="18" x2="26" y2="46">
                    <stop offset="0%" stopColor="#f8d4e0" />
                    <stop offset="100%" stopColor="#de869f" />
                  </linearGradient>
                  <linearGradient id="nailFill2" x1="34" y1="14" x2="52" y2="46">
                    <stop offset="0%" stopColor="#fdeff4" />
                    <stop offset="55%" stopColor="#e4d4ff" />
                    <stop offset="100%" stopColor="#de869f" />
                  </linearGradient>
                  <linearGradient id="nailFill3" x1="60" y1="16" x2="78" y2="46">
                    <stop offset="0%" stopColor="#fdeff4" />
                    <stop offset="100%" stopColor="#f8d4e0" />
                  </linearGradient>
                  <clipPath id="nailClip2">
                    <rect x="34" y="14" width="18" height="20" rx="6" />
                  </clipPath>
                  <clipPath id="nailClip3">
                    <rect x="60" y="16" width="18" height="12" rx="6" />
                  </clipPath>
                </defs>
                <rect x="8" y="18" width="18" height="28" rx="6" fill="url(#nailFill1)" stroke="#de869f" strokeWidth="1.5" />
                <rect x="34" y="14" width="18" height="32" rx="6" fill="rgba(222,134,159,0.12)" stroke="#de869f" strokeWidth="1.5" />
                <rect x="34" y="14" width="18" height="32" rx="6" fill="url(#nailFill2)" clipPath="url(#nailClip2)" />
                <rect x="60" y="16" width="18" height="30" rx="6" fill="rgba(222,134,159,0.12)" stroke="#de869f" strokeWidth="1.5" />
                <rect x="60" y="16" width="18" height="30" rx="6" fill="url(#nailFill3)" clipPath="url(#nailClip3)" />
                <rect x="86" y="20" width="18" height="26" rx="6" fill="rgba(222,134,159,0.08)" stroke="#de869f" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.6" />
                <rect x="112" y="22" width="18" height="24" rx="6" fill="rgba(222,134,159,0.08)" stroke="#de869f" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.4" />
              </svg>
              <div className="service-browser__generating-bar" aria-hidden="true">
                <span className="service-browser__generating-bar-fill" />
              </div>
              <span className="service-browser__generating-label">디자인 생성 중...</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function WhyNailySection() {
  return (
    <section className="why-naily landing-section--viewport" aria-labelledby="why-naily-title">
      <div className="landing-section__shell">
        <div className="landing-section__inner why-naily__inner">
          <ScrollReveal className="why-naily__visual-col" delay={80}>
            <ServiceBrowserMockup />
          </ScrollReveal>
          <div className="why-naily__content-col">
            <ScrollReveal>
              <h2 id="why-naily-title" className="landing-section__title landing-section__title--left">
                <span className="landing-section__highlight">네일리</span>의 장점
              </h2>
              <p className="why-naily__intro">
                웹에서 모든 분석과 디자인 도구를 제공해요.
              </p>
            </ScrollReveal>
            <div className="why-naily__benefits-grid">
              {NAILY_BENEFITS.map((benefit, index) => (
                <article key={benefit.title} className="why-naily__benefit">
                  <ScrollReveal delay={140 + index * 80}>
                    <LandingBenefitIcon name={mapBenefitIcon(benefit.icon)} />
                    <h3 className="why-naily__benefit-title">{benefit.title}</h3>
                    <p className="why-naily__benefit-description">{benefit.description}</p>
                  </ScrollReveal>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
