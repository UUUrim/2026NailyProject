import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { setToken } from '@/shared/utils/auth'

export function useOAuthSuccessPage() {
    const [params] = useSearchParams()
    const navigate = useNavigate()

    useEffect(() => {
        const token = params.get('token')
        const error = params.get('error')
        if (token) {
            setToken(token)
            navigate('/process', { replace: true })
        } else if (error) {
            navigate('/login', { replace: true, state: { error } })
        } else {
            navigate('/login', { replace: true })
        }
    }, [params, navigate])
}
