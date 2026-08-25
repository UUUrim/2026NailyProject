import { useState, type FormEvent, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { socialSignup } from '@/entities/user/api'
import { ApiError } from '@/shared/utils/apiClient'

export function useSignupGooglePage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const email = params.get('email') ?? ''
  const signupToken = params.get('signupToken') ?? ''
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [name, setName] = useState('')
  const [nickname, setNickname] = useState('')
  const [statusMessage, setStatusMessage] = useState('')

  useEffect(() => {
    if (!email || !signupToken) {
      // OAuth 절차 없이 직접 들어온 경우 → 로그인으로 튕기고 소셜 버튼부터 다시 태우기
      navigate('/signup', { replace: true })
    }
  }, [email, signupToken, navigate])

  const handleSignup = async (event: FormEvent) => {   // ← async 추가
    event.preventDefault()

    if (password.length < 8) {
      setStatusMessage('비밀번호는 8자 이상이어야 합니다.')
      return
    }
    if (password !== passwordConfirm) {
      setStatusMessage('비밀번호가 일치하지 않습니다.')
      return
    }
    if (!name.trim() || !nickname.trim()) {
      setStatusMessage('이름과 닉네임을 입력해 주세요.')
      return
    }
    try {
      await socialSignup({ signupToken, password, name, nickname })
      navigate('/process')
    } catch (e) {
      setStatusMessage(e instanceof ApiError ? e.message : '가입에 실패했습니다.')
    }
    // setToken('temp-token')과 마지막 navigate('/process') 줄은 삭제
  }

  return {
    email,
    password,
    setPassword,
    passwordConfirm,
    setPasswordConfirm,
    name,
    setName,
    nickname,
    setNickname,
    statusMessage,
    handleSignup,
  }
}
