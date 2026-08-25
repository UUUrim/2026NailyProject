import '@/styles/app-footer.css'

export function AppFooter() {
    return (
        <footer className="app-footer">
            <div className="app-footer__overlay" aria-hidden="true" />
            <div className="app-footer__inner">
                <p className="app-footer__logo">Naily</p>
                <p className="app-footer__copyright">© 2026. Naily(네일리) All rights reserved.</p>
                <span className="app-footer__mail" aria-hidden="true">
          ✉
        </span>
            </div>
        </footer>
    )
}
