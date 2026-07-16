import { useState, type FormEvent, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout'
import { socialSignup } from '@/apis/user'
import { ApiError } from '@/utils/apiClient'
import '@/styles/signup.css'

export function SignupGooglePage() {
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

  return (
    <AuthSplitLayout>
      <section className="signup-box">
        <h1 className="signup-box__heading">구글 가입</h1>

        <form onSubmit={(e) => void handleSignup(e)}>
          <label className="signup-box__label">이메일</label>
          <div className="signup-box__provider-email">
            <img src="/images/google-logo.png" alt="" className="signup-box__social-icon" />
            <span>{email}</span>
          </div>

          <label className="signup-box__label" htmlFor="google-password">
            관리자 비밀번호
          </label>
          <input
            id="google-password"
            className="signup-box__input"
            type="password"
            autoComplete="new-password"
            placeholder="영문, 숫자, 특수문자를 모두 포함한 8-20자"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <input
            className="signup-box__input"
            type="password"
            autoComplete="new-password"
            placeholder="비밀번호를 한 번 더 입력해 주세요"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
          />

          <label className="signup-box__label" htmlFor="google-name">
            이름
          </label>
          <input
            id="google-name"
            className="signup-box__input"
            placeholder="본명을 입력 해주세요"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <label className="signup-box__label" htmlFor="google-nickname">
            닉네임
          </label>
          <input
            id="google-nickname"
            className="signup-box__input"
            placeholder="한글, 영문, 숫자 2-20자"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />

          {statusMessage && <p className="signup-box__status">{statusMessage}</p>}

          <button type="submit" className="signup-box__submit">
            가입하기
          </button>
        </form>

        <p className="signup-box__notice">
          가입하기를 클릭함으로써, 이용약관 및 개인정보 처리방침에 동의하는 것으로 간주됩니다
        </p>
      </section>
    </AuthSplitLayout>
  )
}
