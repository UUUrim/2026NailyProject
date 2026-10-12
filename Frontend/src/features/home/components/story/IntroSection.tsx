import type { MouseEvent, ReactNode } from 'react'
import { ScrollReveal } from '@/features/home/components/ScrollReveal'
import { STORY_STEPS, type StoryStepId } from '@/features/home/constants/home'

const STEP_ICONS: Record<StoryStepId, ReactNode> = {
  scan: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M4 12h16" />
    </svg>
  ),
  print: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4h14M8 4v4h8V4M11 8v2l1 1.5 1-1.5V8" />
      <path d="M8 20v-3.5C8 14.6 9.8 13 12 13s4 1.6 4 3.5V20M4 20h16" />
    </svg>
  ),
  design: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 12.5c0 3.6-3.6 6.5-8 6.5-1.1 0-2.2-.2-3.1-.5L4 20l1.4-3.5C4.5 15.4 4 14 4 12.5 4 8.9 7.6 6 12 6s8 2.9 8 6.5Z" />
      <path d="m12 9.5.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z" />
    </svg>
  ),
  ar: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M12 8.5c1.3 0 2 1 2 2.4V14h-4v-3.1c0-1.4.7-2.4 2-2.4Z" />
      <path d="M10.5 18h3" />
    </svg>
  ),
}

function scrollToSection(event: MouseEvent<HTMLAnchorElement>, anchor: string) {
  event.preventDefault()
  document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function IntroSection() {
  return (
    <section className="story-intro" aria-labelledby="story-intro-title">
      <div className="story-intro__inner">
        <ScrollReveal>
          <p className="story-kicker story-kicker--center">What is Naily</p>
          <h2 id="story-intro-title" className="story-intro__title">
            손 스캔부터 AR 미리보기까지,
            <br />
            나만의 네일을 한 곳에서
          </h2>
          <p className="story-intro__text">
            내 손톱을 측정해 꼭 맞는 네일 팁을 출력하고,
            <br className="story-br-wide" />
              AI로 디자인을 만들어 내 손 위에 미리 입혀볼 수 있어요.
          </p>
        </ScrollReveal>

        <ol className="story-intro__steps">
          {STORY_STEPS.map((step, index) => (
            <li key={step.id}>
              <ScrollReveal delay={120 + index * 80}>
                <a
                  href={`#${step.anchor}`}
                  className="story-intro__step"
                  onClick={(event) => scrollToSection(event, step.anchor)}
                >
                  <span className="story-intro__step-top">
                    <span className="story-intro__step-icon">{STEP_ICONS[step.id]}</span>
                    <span className="story-intro__step-index">{step.index}</span>
                  </span>
                  <strong>{step.title}</strong>
                  <span className="story-intro__step-text">{step.summary}</span>
                </a>
              </ScrollReveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
