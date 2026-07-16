import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AppFooter } from '@/components/layout/AppFooter'
import { AuthNav } from '@/components/layout/AuthNav'
import '@/styles/app-shell.css'

type AppShellProps = {
  children: ReactNode
  mainClassName?: string
}

export function AppShell({ children, mainClassName = '' }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <div className="app-shell__header-inner">
          <Link to="/" className="app-shell__logo">
            Naily
          </Link>
          <nav className="app-shell__nav" aria-label="주요 메뉴">
            <AuthNav
              loginClassName="app-shell__login"
              signupClassName="app-shell__signup"
              profileClassName="app-shell__profile"
            />
          </nav>
        </div>
      </header>

      <main className={`app-shell__main ${mainClassName}`.trim()}>{children}</main>

      <AppFooter />
    </div>
  )
}
