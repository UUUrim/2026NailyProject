import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AuthNav } from '@/shared/layout/AuthNav'
import { useAuth } from '@/shared/hooks/useAuth'
import { confirmLeaveChatIfNeeded } from '@/shared/utils/chatSessionGuard'
import '@/styles/landing.css'

type HeaderProps = {
    // 메인(홈) 페이지의 히어로 위에 겹쳐 보이는 헤더에서만 true로 전달된다.
    // 히어로 맨 위에 투명 배경으로 얹혀 있고, 화면에 고정되지 않아 스크롤하면 히어로와 함께 올라간다.
    overlay?: boolean
}

export function Header({ overlay = false }: HeaderProps) {
    const { isLoggedIn } = useAuth()
    const navigate = useNavigate()
    const location = useLocation()

    const handleNavClick = (to: string) => (e: React.MouseEvent) => {
        e.preventDefault()
        if (confirmLeaveChatIfNeeded()) {
            if (location.pathname === to && to !== '/design/chat') {
                // 이미 같은 경로에 있으면 navigate()는 아무 일도 안 일어난 것처럼 보인다
                // (React Router가 경로 변화 없음으로 판단). 세션을 진짜로 초기화하려면
                // 완전한 새로고침이 필요하다.
                // (디자인 채팅은 새로고침하지 않는다 — 뒤에서 만들고 있는 디자인이 멈추지 않게, 채팅 화면이
                //  이동할 때마다 새로 마운트되어 새 채팅으로 시작한다: NailDesignChatPage)
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

    const headerClassName = overlay ? 'landing-header landing-header--overlay' : 'landing-header'

    return (
        <header className={headerClassName}>
            <div className="landing-header__inner">
                <Link to="/" className="landing-header__logo" onClick={handleNavClick('/')}>
                    <img src="/images/logo.png" alt="Naily" className="landing-header__logo-image" />
                </Link>

                <nav className="landing-header__center-nav" aria-label="바로가기 메뉴">
                    {isLoggedIn && (
                        <>
                            <Link to="/scan/hand" className={navLinkClassName('/scan')} onClick={handleNavClick('/scan/hand')}>
                                scan
                            </Link>
                            <Link to="/print" className={navLinkClassName('/print')} onClick={handleNavClick('/print')}>
                                print
                            </Link>
                            <Link to="/design/chat" className={navLinkClassName('/design')} onClick={handleNavClick('/design/chat')}>
                                design
                            </Link>
                        </>
                    )}
                    {/* 갤러리는 로그인 없이도 볼 수 있어서 항상 보여 준다 */}
                    <Link to="/gallery" className={navLinkClassName('/gallery')} onClick={handleNavClick('/gallery')}>
                        gallery
                    </Link>
                </nav>

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