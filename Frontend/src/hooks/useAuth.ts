import { useCallback, useEffect, useState } from 'react'
import { AUTH_CHANGE_EVENT, isLoggedIn, clearToken } from '@/utils/auth'

export function useAuth() {
  const [loggedIn, setLoggedInState] = useState(() => isLoggedIn())

  useEffect(() => {
    const sync = () => setLoggedInState(isLoggedIn())
    window.addEventListener(AUTH_CHANGE_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(AUTH_CHANGE_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const logout = useCallback(() => {
    clearToken()
    setLoggedInState(false)
  }, [])

  return { isLoggedIn: loggedIn, logout }
}