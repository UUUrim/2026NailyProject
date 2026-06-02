import { useCallback, useEffect, useState } from 'react'
import { AUTH_CHANGE_EVENT, isLoggedIn, setLoggedIn as setAuthLoggedIn } from '@/utils/auth'

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

  const setLoggedIn = useCallback((value: boolean) => {
    setAuthLoggedIn(value)
    setLoggedInState(value)
  }, [])

  return { isLoggedIn: loggedIn, setLoggedIn }
}
