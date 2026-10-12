import { useRef, type ReactNode } from 'react'
import { ScrollReveal } from '@/features/home/components/ScrollReveal'
import type { StoryStep } from '@/features/home/constants/home'
import { useInView } from '@/features/home/hooks/useInView'

type StoryFeatureProps = {
  step: StoryStep
  title: ReactNode
  description: string
  points: string[]
  reverse?: boolean
  /** playing은 데모가 화면에 보이는 동안만 true — 반복 애니메이션은 그때만 돈다 */
  renderMedia: (playing: boolean) => ReactNode
}

const CheckIcon = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export function StoryFeature({ step, title, description, points, reverse = false, renderMedia }: StoryFeatureProps) {
  const mediaRef = useRef<HTMLDivElement>(null)
  const playing = useInView(mediaRef)

  return (
    <section
      id={step.anchor}
      className={`story-feature${reverse ? ' story-feature--reverse' : ''}`}
      aria-labelledby={`${step.anchor}-title`}
    >
      <div className="story-feature__inner">
        <ScrollReveal className="story-feature__copy">
          <p className="story-kicker">
            <span>{step.index}</span>
            {step.title}
          </p>
          <h2 id={`${step.anchor}-title`} className="story-heading">
            {title}
          </h2>
          <p className="story-text">{description}</p>
          <ul className="story-points">
            {points.map((point) => (
              <li key={point}>
                {CheckIcon}
                {point}
              </li>
            ))}
          </ul>
        </ScrollReveal>

        <ScrollReveal className="story-feature__media" delay={120}>
          {/* 데모 화면은 설명용 그림이라, 보조기기에는 옆의 글만 읽혀도 충분하다 */}
          <div ref={mediaRef} className="story-media" data-playing={playing} aria-hidden="true">
            {renderMedia(playing)}
          </div>
        </ScrollReveal>
      </div>
    </section>
  )
}
