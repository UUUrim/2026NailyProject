import { Link } from 'react-router-dom'

export function Header() {
  return (
    <header className="landing-header">
      <div className="landing-header__inner">
        <Link to="/" className="landing-header__logo">
          Naily
        </Link>
        <nav className="landing-header__nav" aria-label="주요 메뉴">
          <Link to="/login" className="landing-header__login">
            로그인
          </Link>
          <Link to="/signup" className="landing-header__signup">
            무료로 시작하기
          </Link>
        </nav>
      </div>
    </header>
  )
}
