import { Outlet } from 'react-router-dom'
import { Header } from '@/shared/layout/Header.tsx'
import { AppFooter } from '@/shared/layout/AppFooter.tsx'
import '@/styles/root-layout.css'

export function RootLayout() {
    return (
        <div className="root-layout">
            <div className="root-layout__header">
                <Header />
            </div>

            <main className="root-layout__main">
                <Outlet />
            </main>

            <AppFooter />
        </div>
    )
}