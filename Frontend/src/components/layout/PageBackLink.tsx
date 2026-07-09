import { Link } from 'react-router-dom'

type PageBackLinkProps = {
  to: string
  label?: string
  state?: Record<string, unknown>
}

export function PageBackLink({ to, label = '이전 단계로', state }: PageBackLinkProps) {
  return (
    <Link to={to} state={state} className="page-back-link">
      ← {label}
    </Link>
  )
}