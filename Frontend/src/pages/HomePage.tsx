import { FeatureSection } from '@/components/landing/FeatureSection'
import { Footer } from '@/components/landing/Footer'
import { GallerySection } from '@/components/landing/GallerySection'
import { HeroPanel } from '@/components/landing/HeroPanel'
import { FEATURES } from '@/constants/landing'
import { isLoggedIn } from '@/utils/auth'
import '@/styles/landing.css'
import { useNavigate } from 'react-router-dom'

export function HomePage() {
  const navigate = useNavigate()

  const handleStartClick = () => {
    if (isLoggedIn()) {
      navigate('/process')
      return
    }
    navigate('/login')
  }

  return (
    <div className="landing">
      <HeroPanel variant="top" showHeader onStartClick={handleStartClick} />
      <div className="landing__features">
        {FEATURES.map((feature) => (
          <FeatureSection key={feature.title} {...feature} />
        ))}
      </div>
      <GallerySection />
      <div className="landing-bottom">
        <HeroPanel variant="bottom" showTitle={false} onStartClick={handleStartClick} />
        <Footer />
      </div>
    </div>
  )
}
