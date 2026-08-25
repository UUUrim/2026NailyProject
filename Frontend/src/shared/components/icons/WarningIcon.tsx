import type { SVGProps } from 'react'

/**
 * 손 스캔 정보 없음 등, "확인이 필요한 안내"에 공용으로 쓰는 경고 아이콘.
 * 채팅 ? 패널에서 쓰던 스타일을 그대로 다른 화면에서도 재사용한다.
 */
export function WarningIcon({ width = 22, height = 22, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...rest}>
      <path d="M12 3.5 21.5 20h-19L12 3.5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 9.8v4.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1" fill="currentColor" />
    </svg>
  )
}
