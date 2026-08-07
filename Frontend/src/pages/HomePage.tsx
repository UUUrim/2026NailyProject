// import { FaqSection } from '@/components/landing/FaqSection'
import { LandingScrollButtons } from '@/components/landing/LandingScrollButtons'
import { FeaturesGridSection } from '@/components/landing/FeaturesGridSection'
import { Footer } from '@/components/landing/Footer'
import { GallerySection } from '@/components/landing/GallerySection'
import { HeroPanel } from '@/components/landing/HeroPanel'
import { HowItWorksSection } from '@/components/landing/HowItWorksSection'
import { StatsSection } from '@/components/landing/StatsSection'
import { WaveDivider } from '@/components/landing/WaveDivider'
import { WhyNailySection } from '@/components/landing/WhyNailySection'
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
        <div className="landing landing--snap">
            <HeroPanel variant="top" showHeader onStartClick={handleStartClick} />
            <main className="landing__middle">
                <StatsSection />
                <WaveDivider variant="bottom" color="#faf8f9" />
                <HowItWorksSection />
                <WaveDivider variant="bottom" color="#ffffff" />
                <FeaturesGridSection />
                <WaveDivider variant="bottom" color="#fff9fb" />
                <WhyNailySection />
                <WaveDivider variant="bottom" color="#ffffff" />
                <GallerySection />
                {/*<WaveDivider variant="bottom" color="#faf8f9" />*/}
                {/*<FaqSection />*/}
            </main>
            <div className="landing-bottom">
                <HeroPanel variant="bottom" showTitle={false} onStartClick={handleStartClick} />
                <Footer />
            </div>
            <LandingScrollButtons />
        </div>
    )
}
