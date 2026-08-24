import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/shared/hooks/useAuth'

export function ProtectedRoute() {
    const { isLoggedIn } = useAuth()
    const location = useLocation()

    if (!isLoggedIn) {
        return <Navigate to="/login" state={{ from: location }} replace />
    }
    return <Outlet />
}
