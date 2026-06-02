import { Link } from 'react-router-dom'
import { AuthNav } from '@/components/layout/AuthNav'

export function Header() {
  return (
    <header className="landing-header">
      <div className="landing-header__inner">
        <Link to="/" className="landing-header__logo">
          Naily
        </Link>
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
