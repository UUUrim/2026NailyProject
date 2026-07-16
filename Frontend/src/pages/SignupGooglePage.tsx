import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout'
import { setToken } from '@/utils/auth'
import '@/styles/signup.css'

export function SignupGooglePage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [name, setName] = useState('')
  const [nickname, setNickname] = useState('')
  const [statusMessage, setStatusMessage] = useState('')

  const handleSignup = (event: FormEvent) => {
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

    setToken('temp-token') // 소셜 로그인 백엔드 구현 전 임시
    navigate('/process')
  }

  return (
    <AuthSplitLayout>
      <section className="signup-box">
        <h1 className="signup-box__heading">구글 가입</h1>

        <form onSubmit={handleSignup}>
          <label className="signup-box__label">이메일</label>
          <div className="signup-box__provider-email">
            <img src="/images/google-logo.png" alt="" className="signup-box__social-icon" />
            <span>example@gmail.com</span>
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
