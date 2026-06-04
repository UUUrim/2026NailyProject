// import { Link } from 'react-router-dom'

// type PageBackLinkProps = {
//   to: string
//   label?: string
// }

// export function PageBackLink({ to, label = '이전 단계로' }: PageBackLinkProps) {
//   return (
//     <Link to={to} className="page-back-link">
//       ← {label}
//     </Link>
//   )
// }

//수정
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