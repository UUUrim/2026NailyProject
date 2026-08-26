import { LandingScrollButtons } from '@/features/home/components/LandingScrollButtons'
import { FeaturesGridSection } from '@/features/home/components/FeaturesGridSection'
import { Footer } from '@/features/home/components/Footer'
import { GallerySection } from '@/features/home/components/GallerySection'
import { HeroPanel } from '@/features/home/components/HeroPanel'
import { HowItWorksSection } from '@/features/home/components/HowItWorksSection'
import { StatsSection } from '@/features/home/components/StatsSection'
import { WaveDivider } from '@/features/home/components/WaveDivider'
import { WhyNailySection } from '@/features/home/components/WhyNailySection'
import { useHomePage } from '@/features/home/hooks/useHomePage'
import '@/styles/landing.css'

export function HomePageContent() {
    const { handleStartClick } = useHomePage()

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
