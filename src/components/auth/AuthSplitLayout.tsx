import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

type AuthSplitLayoutProps = {
  children: ReactNode
}

export function AuthSplitLayout({ children }: AuthSplitLayoutProps) {
  return (
    <div className="auth-split">
      <aside className="auth-split__visual" aria-hidden="true">
        <Link to="/" className="auth-split__logo">
          Naily
        </Link>
        <span className="auth-split__line auth-split__line--left" />
        <span className="auth-split__line auth-split__line--right" />
      </aside>

      <section className="auth-split__panel">
        <header className="auth-split__header">
          <nav className="auth-split__nav" aria-label="회원가입 상단 메뉴">
            <Link to="/login" className="auth-split__link">
              로그인
            </Link>
            <Link to="/signup" className="auth-split__cta">
              무료로 시작하기
            </Link>
          </nav>
        </header>

        <main className="auth-split__content">{children}</main>
      </section>
    </div>
  )
}
