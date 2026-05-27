import { ImagePlaceholder } from '@/components/landing/ImagePlaceholder'
import type { FeatureItem } from '@/constants/landing'

type FeatureSectionProps = FeatureItem

export function FeatureSection({ title, description }: FeatureSectionProps) {
  return (
    <section className="feature-section" aria-labelledby={`feature-${title}`}>
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
      <ImagePlaceholder variant="wide" label={`${title} 예시 이미지`} />
    </section>
  )
}
