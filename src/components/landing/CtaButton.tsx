import type { ReactNode } from 'react'

type CtaButtonProps = {
  children?: ReactNode
  onClick?: () => void
}

export function CtaButton({
  children = '시작하기 >',
  onClick,
}: CtaButtonProps) {
  return (
    <button type="button" className="cta-button" onClick={onClick}>
      {children}
    </button>
  )
}
