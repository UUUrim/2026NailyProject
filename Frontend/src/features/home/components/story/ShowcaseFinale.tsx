import { Link } from 'react-router-dom'
import { CtaButton } from '@/features/home/components/CtaButton'
import { ScrollReveal } from '@/features/home/components/ScrollReveal'
import { ShowcaseImage } from '@/features/home/components/story/ShowcaseImage'
import { SHOWCASE_IMAGES } from '@/features/home/constants/home'
import { ORBIT_SLOT_COUNT, ORBIT_SLOT_RINGS, useShowcaseOrbit } from '@/features/home/hooks/useShowcaseOrbit'

type ShowcaseFinaleProps = {
  onStartClick?: () => void
}

export function ShowcaseFinale({ onStartClick }: ShowcaseFinaleProps) {
  const { sectionRef, stageRef, centerRef } = useShowcaseOrbit()

  return (
    <section ref={sectionRef} className="story-showcase" aria-labelledby="story-showcase-title">
      <div ref={stageRef} className="story-showcase__rings" aria-hidden="true">
        {Array.from({ length: ORBIT_SLOT_COUNT }, (_, index) => (
          <span key={index} className="story-showcase__card" data-ring={ORBIT_SLOT_RINGS[index]}>
            <ShowcaseImage
              src={SHOWCASE_IMAGES[index % SHOWCASE_IMAGES.length]}
              placeholder={String(index + 1).padStart(2, '0')}
            />
          </span>
        ))}
      </div>

      <div ref={centerRef} className="story-showcase__center">
        <ScrollReveal>
          <h2 id="story-showcase-title" className="story-showcase__title">
            당신의 디자인을
            <br />
            만들어 보세요
          </h2>
          <div className="story-showcase__actions">
            <CtaButton onClick={onStartClick} />
            <Link to="/gallery" className="story-showcase__gallery">
              디자인 둘러보기
            </Link>
          </div>
        </ScrollReveal>
      </div>
    </section>
  )
}
