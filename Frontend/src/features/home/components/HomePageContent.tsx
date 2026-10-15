import { LandingScrollButtons } from '@/features/home/components/LandingScrollButtons'
import { Footer } from '@/features/home/components/Footer'
import { PrintHero } from '@/features/home/components/PrintHero'
import { ArSection } from '@/features/home/components/story/ArSection'
import { DesignSection } from '@/features/home/components/story/DesignSection'
import { IntroSection } from '@/features/home/components/story/IntroSection'
import { PrintSection } from '@/features/home/components/story/PrintSection'
import { ScanSection } from '@/features/home/components/story/ScanSection'
import { ShowcaseFinale } from '@/features/home/components/story/ShowcaseFinale'
import { useHomePage } from '@/features/home/hooks/useHomePage'
import '@/styles/landing.css'
import '@/styles/landing-story.css'

export function HomePageContent() {
    const { handleStartClick } = useHomePage()

    return (
        <div className="landing landing--snap">
            <PrintHero onStartClick={handleStartClick} />
            <main className="landing__middle story">
                <IntroSection />
                <ScanSection />
                <PrintSection />
                <DesignSection />
                <ArSection />
                <ShowcaseFinale onStartClick={handleStartClick} />
            </main>
            <div className="landing-bottom">
                <Footer />
            </div>
            <LandingScrollButtons />
        </div>
    )
}
