import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AuthNav } from '@/components/layout/AuthNav'

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
            <AuthNav
              loginClassName="auth-split__link"
              signupClassName="auth-split__cta"
              profileClassName="auth-split__profile"
            />
          </nav>
        </header>

        <main className="auth-split__content">{children}</main>
      </section>
    </div>
  )
}
