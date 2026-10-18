import type { MouseEvent } from 'react'
import { ScrollReveal } from '@/features/home/components/ScrollReveal'
import { STORY_STEPS } from '@/features/home/constants/home'
import { STORY_STEP_ICONS } from '@/features/home/components/story/storyStepIcons'

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
                    <span className="story-intro__step-icon">{STORY_STEP_ICONS[step.id]}</span>
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
