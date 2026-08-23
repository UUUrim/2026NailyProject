import { useNavigate } from 'react-router-dom'

type PageBackLinkProps = {
  to: string
  label?: string
  state?: Record<string, unknown>
}

// history.state.idx는 React Router의 BrowserHistory가 "이 세션에서 우리가 직접 쌓은
// 히스토리 엔트리 번호"로 관리하는 값이라(페이지를 새로고침하면 0으로 초기화됨), 이게
// 0보다 크면 실제로 앱 안에서 이동해 들어온 것 — navigate(-1)로 정확히 왔던 곳으로 돌아갈 수 있다.
// 0(또는 값이 없음)이면 직접 링크로 들어왔거나 새로고침한 경우라 되돌아갈 곳이 없으므로,
// 정해둔 fallback 경로(to)로 보낸다.
function canGoBackInApp(): boolean {
  if (typeof window === 'undefined') return false
  const idx = (window.history.state as { idx?: number } | null)?.idx
  return typeof idx === 'number' && idx > 0
}

export function PageBackLink({ to, label = '이전 단계로', state }: PageBackLinkProps) {
  const navigate = useNavigate()

  const handleClick = () => {
    if (canGoBackInApp()) {
      navigate(-1)
    } else {
      navigate(to, { state })
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="page-back-link"
      aria-label={label}
      title="클릭하면 이전 페이지로 돌아갑니다."
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M19 12H7M11 6l-6 6 6 6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
