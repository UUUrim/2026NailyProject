import { useState } from 'react'
import { ScrollReveal } from '@/features/home/components/ScrollReveal'
import { FAQ_ITEMS } from '@/features/home/constants/home'

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState(0)

  const toggle = (index: number) => {
    setOpenIndex((prev) => (prev === index ? -1 : index))
  }

  return (
    <section className="faq-section landing-section--viewport" aria-labelledby="faq-title">
      <div className="landing-section__shell">
        <div className="landing-section__inner">
          <ScrollReveal>
            <h2 id="faq-title" className="landing-section__title">
              네일리에 대해 <span className="landing-section__highlight">궁금한 점</span>
            </h2>
            <p className="landing-section__subtitle">
              서비스 이용 방식에 대해 자주 묻는 질문을 모았어요.
            </p>
          </ScrollReveal>

          <ScrollReveal className="faq-section__list" delay={120}>
            {FAQ_ITEMS.map((item, index) => {
              const isOpen = openIndex === index
              return (
                <article key={item.question} className={`faq-section__item${isOpen ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className="faq-section__question"
                    onClick={() => toggle(index)}
                    aria-expanded={isOpen}
                  >
                    <span>{item.question}</span>
                    <span className="faq-section__toggle" aria-hidden="true">
                      {isOpen ? '−' : '+'}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="faq-section__answer">
                      <p>{item.answer}</p>
                    </div>
                  )}
                </article>
              )
            })}
          </ScrollReveal>
        </div>
      </div>
    </section>
  )
}
