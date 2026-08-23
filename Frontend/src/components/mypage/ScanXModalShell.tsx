import type { CSSProperties, ReactNode } from 'react'
import '@/styles/mypage.css'

type Props = {
  ariaLabel: string
  eyebrow?: string
  title: string
  subtitle?: string | null
  onClose: () => void
  children: ReactNode
  /** 패널 최대 너비 (기본 580px) — 표+이미지처럼 더 넓은 폭이 필요한 모달에서 넘겨준다 */
  maxWidth?: string
}

/**
 * 손 분석 결과 / 네일팁 출력 상세 / 손가락별 상세 수치 등, "제목+닫기 버튼+스크롤 가능한 바디"로
 * 구성된 mypage-x__scanx-panel 계열 모달들이 공유하는 셸.
 * 제목 영역은 고정하고 바디만 스크롤되도록 해서, 모달마다 구조가 어긋나지 않게 한다.
 */
export function ScanXModalShell({ ariaLabel, eyebrow, title, subtitle, onClose, children, maxWidth }: Props) {
  const panelStyle = maxWidth ? ({ '--scanx-panel-max-width': maxWidth } as CSSProperties) : undefined

  return (
    <div className="mypage-x__modal" role="dialog" aria-modal="true" aria-label={ariaLabel}>
      <button type="button" className="mypage-x__modal-backdrop" aria-label="닫기" onClick={onClose} />
      <div className="mypage-x__modal-panel mypage-x__scanx-panel" style={panelStyle}>
        <button
          type="button"
          className="mypage-x__modal-close mypage-x__modal-close--plain"
          onClick={onClose}
          aria-label="닫기"
        >
          ✕
        </button>

        <header className="mypage-x__scanx-head">
          {eyebrow && <p className="mypage-x__scanx-eyebrow">{eyebrow}</p>}
          <h2 className="mypage-x__scanx-title">{title}</h2>
          {subtitle && <p className="mypage-x__scanx-date">{subtitle}</p>}
        </header>

        <div className="mypage-x__scanx-scroll">{children}</div>
      </div>
    </div>
  )
}
