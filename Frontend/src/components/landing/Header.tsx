import { Link } from 'react-router-dom'
import { AuthNav } from '@/components/layout/AuthNav'
import { useAuth } from '@/hooks/useAuth'
import '@/styles/landing.css'

export function Header() {
    const { isLoggedIn } = useAuth()

    return (
        <header className="landing-header">
            <div className="landing-header__inner">
                <Link to="/" className="landing-header__logo">
                    <img src="/images/logo.png" alt="Naily" className="landing-header__logo-image" />
                </Link>

                {isLoggedIn && (
                    <nav className="landing-header__center-nav" aria-label="바로가기 메뉴">
                        <Link to="/scan/hand" className="landing-header__center-link">
                            scan
                        </Link>
                        <Link to="/design/chat" className="landing-header__center-link">
                            design
                        </Link>
                    </nav>
                )}

                <nav className="landing-header__nav" aria-label="주요 메뉴">
                    <AuthNav
                        loginClassName="landing-header__login"
                        signupClassName="landing-header__signup"
                        profileClassName="landing-header__profile"
                    />
                </nav>
            </div>
        </header>
    )
}