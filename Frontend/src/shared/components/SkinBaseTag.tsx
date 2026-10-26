import type { ReactNode } from 'react'
import type { SkinBaseKind } from '@/shared/utils/skinTone'
import '@/styles/skin-base-tag.css'

type Props = {
  kind: SkinBaseKind | null
  // 보여 줄 베이스 이름 — 보통은 '핑크 베이스', 좁은 채팅 사이드바에서는 '핑크'처럼 짧게
  children: ReactNode
  title?: string
  className?: string
}

/**
 * 손 분석 기록 제목 — 베이스 이름을 그 베이스(핑크/뉴트럴/옐로우) 색 바탕의 알약에 쓴다.
 * 마이페이지 손 분석 목록, 네일 팁 출력 화면, 손 촬영 화면의 최근 분석 기록, 디자인 채팅 사이드바에서 똑같이 쓴다
 * (글자 크기와, 필요하면 글자색은 쓰는 곳에서 정한다).
 */
export function SkinBaseTag({ kind, children, title, className }: Props) {
  return (
    <span
      className={`skin-base-tag${kind ? ` skin-base-tag--${kind}` : ''}${className ? ` ${className}` : ''}`}
      title={title}
    >
      {children}
    </span>
  )
}
