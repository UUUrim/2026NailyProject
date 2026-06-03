import { Link } from 'react-router-dom'

type PageBackLinkProps = {
  to: string
  label?: string
}

export function PageBackLink({ to, label = '이전 단계로' }: PageBackLinkProps) {
  return (
    <Link to={to} className="page-back-link">
      ← {label}
    </Link>
  )
}
