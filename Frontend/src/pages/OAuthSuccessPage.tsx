// 소셜 로그인 추가

import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { setToken } from '@/utils/auth'

export function OAuthSuccessPage() {
    const [params] = useSearchParams()
    const navigate = useNavigate()

    useEffect(() => {
        const token = params.get('token')
        if (token) {
            setToken(token)
            navigate('/process', { replace: true })
        } else {
            navigate('/login', { replace: true })
        }
    }, [params, navigate])

    return null
}