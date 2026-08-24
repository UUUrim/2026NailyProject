import type { ReactNode } from 'react'
import '@/styles/app-shell.css'

type AppShellProps = {
    children: ReactNode
    mainClassName?: string
}

export function AppShell({ children, mainClassName = '' }: AppShellProps) {
    return <div className={`root-layout__page ${mainClassName}`.trim()}>{children}</div>
}
