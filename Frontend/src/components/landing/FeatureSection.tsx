import type { CSSProperties } from 'react'
import type { FeatureIcon, FeatureItem } from '@/constants/landing'

type FeatureSectionProps = FeatureItem

function FeatureIconGraphic({ icon }: { icon: FeatureIcon }) {
  if (icon === 'fit') {
    return (
      <svg viewBox="0 0 80 80" className="feature-section__icon-svg" aria-hidden="true">
        <circle cx="40" cy="40" r="36" fill="currentColor" opacity="0.12" />
        <rect x="22" y="24" width="36" height="28" rx="6" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <circle cx="40" cy="38" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M28 52 L40 44 L52 52" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M14 58 Q40 48 66 58" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.5" />
      </svg>
    )
  }

  if (icon === 'design') {
    return (
      <svg viewBox="0 0 80 80" className="feature-section__icon-svg" aria-hidden="true">
        <circle cx="40" cy="40" r="36" fill="currentColor" opacity="0.12" />
        <path
          d="M24 52 L32 28 L48 24 L56 40 L44 56 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <circle cx="32" cy="32" r="4" fill="currentColor" />
        <circle cx="48" cy="36" r="4" fill="currentColor" opacity="0.7" />
        <circle cx="40" cy="48" r="4" fill="currentColor" opacity="0.5" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 80 80" className="feature-section__icon-svg" aria-hidden="true">
      <circle cx="40" cy="40" r="36" fill="currentColor" opacity="0.12" />
      <path
        d="M26 54 L26 34 L38 28 L54 28 L54 54 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path d="M30 54 L30 42 L50 42 L50 54" fill="currentColor" opacity="0.2" />
      <rect x="34" y="32" width="12" height="6" rx="1" fill="currentColor" opacity="0.5" />
      <path d="M38 22 L42 28 L38 28 Z" fill="currentColor" />
    </svg>
  )
}

export function FeatureSection({ title, description, icon, accent }: FeatureSectionProps) {
  return (
    <section
      className="feature-section"
      aria-labelledby={`feature-${title}`}
      style={{ '--feature-accent': accent } as CSSProperties}
    >
      <div className="feature-section__card">
        <div className="feature-section__visual">
          <FeatureIconGraphic icon={icon} />
        </div>
        <div className="feature-section__copy">
          <h2 id={`feature-${title}`} className="feature-section__title">
            {title}
          </h2>
          <p className="feature-section__description">
            {description.split('\n').map((line, index) => (
              <span key={index}>
                {index > 0 && <br />}
                {line}
              </span>
            ))}
          </p>
        </div>
      </div>
    </section>
  )
}
