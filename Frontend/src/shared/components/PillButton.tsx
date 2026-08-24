import type { ReactNode } from 'react'
import '@/styles/pill-button.css'

type PillButtonProps = {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost'
  type?: 'button' | 'submit'
  disabled?: boolean
  className?: string
}

// 디자인 결과 화면의 "마이페이지에서 확인하기"(primary, 핑크 그라데이션)와
// "디자인 다시 생성하기"(ghost, 핑크 테두리)처럼 짝을 이뤄 쓰이는 알약 모양 버튼.
export function PillButton({
                              children,
                              onClick,
                              variant = 'primary',
                              type = 'button',
                              disabled,
                              className,
                            }: PillButtonProps) {
  return (
    <button
      type={type}
      className={`pill-button pill-button--${variant}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}
