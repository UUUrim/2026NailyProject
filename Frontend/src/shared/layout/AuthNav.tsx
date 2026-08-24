import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/shared/hooks/useAuth'
import { confirmLeaveChatIfNeeded } from '@/shared/utils/chatSessionGuard'

type AuthNavProps = {
    loginClassName?: string
    signupClassName?: string
    profileClassName?: string
}

export function AuthNav({
                            loginClassName = '',
                            signupClassName = '',
                            profileClassName = '',
                        }: AuthNavProps) {
    const { isLoggedIn: loggedIn } = useAuth()
    const navigate = useNavigate()

    const handleMypageClick = (e: React.MouseEvent) => {
        e.preventDefault()
        if (confirmLeaveChatIfNeeded()) {
            navigate('/mypage')
        }
    }

    if (loggedIn) {
        return (
            <Link to="/mypage" className={profileClassName} aria-label="마이페이지" onClick={handleMypageClick}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8" />
                    <path
                        d="M5 20c1.5-3.5 4.2-5 7-5s5.5 1.5 7 5"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                    />
                </svg>
            </Link>
        )
    }

    return (
        <>
            <Link to="/login" className={loginClassName}>
                로그인
            </Link>
            <Link to="/signup" className={signupClassName}>
                무료로 시작하기
            </Link>
        </>
    )
}