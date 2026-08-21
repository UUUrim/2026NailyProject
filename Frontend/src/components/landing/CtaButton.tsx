import type { ReactNode } from 'react'

type CtaButtonProps = {
  children?: ReactNode
  onClick?: () => void
}

export function CtaButton({
  children = '시작하기',
  onClick,
}: CtaButtonProps) {
  return (
    <button type="button" className="cta-button" onClick={onClick}>
      {children}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
            d="M5 12h12M13 6l6 6-6 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
