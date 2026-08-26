import '@/styles/mypage.css'

type Props = {
  shared: boolean
  className?: string
}

/**
 * "둘러보기에 공유 중" / "비공개" 핑크 알약 배지.
 * 이미지 상세모달(우상단 오버레이)과 디자인 결과 화면 썸네일에서 똑같은 스타일로 공용으로 쓴다.
 */
export function ShareStatusBadge({ shared, className }: Props) {
  return (
    <span className={`mypage-x__share-badge${shared ? ' is-on' : ''}${className ? ` ${className}` : ''}`}>
      {shared ? '둘러보기에 공유 중' : '비공개'}
    </span>
  )
}
