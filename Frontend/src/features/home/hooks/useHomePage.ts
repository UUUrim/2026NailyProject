import { useNavigate } from 'react-router-dom'
import { isLoggedIn } from '@/shared/utils/auth'

export function useHomePage() {
    const navigate = useNavigate()

    const handleStartClick = () => {
        if (isLoggedIn()) {
            navigate('/process')
            return
        }
        navigate('/login')
    }

    return { handleStartClick }
}
