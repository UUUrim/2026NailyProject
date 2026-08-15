import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AuthNav } from '@/components/layout/AuthNav'
import { useAuth } from '@/hooks/useAuth'
import { confirmLeaveChatIfNeeded, markIntentionalNavigation } from '@/utils/chatSessionGuard'
import '@/styles/landing.css'

export function Header() {
    const { isLoggedIn } = useAuth()
    const navigate = useNavigate()
    const location = useLocation()

    const handleNavClick = (to: string) => (e: React.MouseEvent) => {
        e.preventDefault()
        if (confirmLeaveChatIfNeeded()) {
            if (location.pathname === to) {
                // 이미 같은 경로에 있으면 navigate()는 아무 일도 안 일어난 것처럼 보인다
                // (React Router가 경로 변화 없음으로 판단). 세션을 진짜로 초기화하려면
                // 완전한 새로고침이 필요하다.
                markIntentionalNavigation()
                window.location.href = to
            } else {
                navigate(to)
            }
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