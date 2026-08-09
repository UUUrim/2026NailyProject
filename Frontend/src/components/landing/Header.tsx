import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AuthNav } from '@/components/layout/AuthNav'
import { useAuth } from '@/hooks/useAuth'
import { confirmLeaveChatIfNeeded } from '@/utils/chatSessionGuard'
import '@/styles/landing.css'

export function Header() {
    const { isLoggedIn } = useAuth()
    const navigate = useNavigate()
    const location = useLocation()

    const handleNavClick = (to: string) => (e: React.MouseEvent) => {
        e.preventDefault()
        if (confirmLeaveChatIfNeeded()) {
            navigate(to)
        }
    }

    const navLinkClassName = (to: string) => {
        const isActive = location.pathname.startsWith(to)
        return `landing-header__center-link${isActive ? ' landing-header__center-link--active' : ''}`
    }

    return (
        <header className="landing-header">
            <div className="landing-header__inner">
                <Link to="/" className="landing-header__logo" onClick={handleNavClick('/')}>
                    <img src="/images/logo.png" alt="Naily" className="landing-header__logo-image" />
                </Link>

                {isLoggedIn && (
                    <nav className="landing-header__center-nav" aria-label="바로가기 메뉴">
                        <Link to="/scan/hand" className={navLinkClassName('/scan')} onClick={handleNavClick('/scan/hand')}>
                            scan
                        </Link>
                        <Link to="/design/chat" className={navLinkClassName('/design')} onClick={handleNavClick('/design/chat')}>
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