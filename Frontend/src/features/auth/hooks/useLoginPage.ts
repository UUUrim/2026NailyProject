import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { login } from '@/entities/user/api'
import { ApiError } from '@/shared/utils/apiClient'
import { getSocialAuthUrl } from '@/entities/user/api'

export function useLoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [modalMessage, setModalMessage] = useState('')

  useEffect(() => {
    const state = location.state as { error?: string } | null
    if (state?.error) {
      setModalMessage(state.error)
      // 새로고침 시 메시지가 다시 뜨지 않도록 state 제거
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location, navigate])

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setErrorMessage('이메일과 비밀번호를 입력해 주세요.')
      return
    }

    setIsLoading(true)
    setErrorMessage('')

    try {
      // POST /users/email/login → LoginResponseDto
      // login() 내부에서 setToken() 자동 처리
      await login(email, password)
      // ProtectedRoute가 로그인 없이 접근을 막으며 넘겨준 원래 목적지(state.from)가 있으면
      // 그리로, 없으면(직접 /login으로 들어온 경우) 기본 흐름인 /process로 이동한다.
      const from = (location.state as { from?: { pathname: string } } | null)?.from
      navigate(from?.pathname ?? '/process', { replace: true })
    } catch (e) {
      if (e instanceof ApiError) {
        // 401: InvalidCredentialsException
        if (e.status === 401) {
          setErrorMessage('이메일 또는 비밀번호가 올바르지 않습니다.')
        } else {
          setErrorMessage(e.message)
        }
      } else {
        setErrorMessage('서버 연결에 실패했습니다.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return {
    email,
    setEmail,
    password,
    setPassword,
    errorMessage,
    isLoading,
    modalMessage,
    setModalMessage,
    handleLogin,
    getSocialAuthUrl,
  }
}
