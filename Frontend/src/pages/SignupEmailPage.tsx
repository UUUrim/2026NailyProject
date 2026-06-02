import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout'
import { setLoggedIn } from '@/utils/auth'
import '@/styles/signup.css'

function createVerificationCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export function SignupEmailPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [verificationInput, setVerificationInput] = useState('')
  const [sentCode, setSentCode] = useState<string | null>(null)
  const [emailVerified, setEmailVerified] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [name, setName] = useState('')
  const [nickname, setNickname] = useState('')
  const [statusMessage, setStatusMessage] = useState('')

  const handleSendCode = () => {
    if (!email.trim() || !email.includes('@')) {
      setStatusMessage('올바른 이메일 주소를 입력해 주세요.')
      return
    }
    const code = createVerificationCode()
    setSentCode(code)
    setEmailVerified(false)
    setStatusMessage(`인증코드를 발송했습니다. (개발용 코드: ${code})`)
  }

  const handleVerifyCode = () => {
    if (!sentCode) {
      setStatusMessage('먼저 인증코드를 요청해 주세요.')
      return
    }
    if (verificationInput.trim() !== sentCode) {
      setStatusMessage('인증코드가 일치하지 않습니다.')
      return
    }
    setEmailVerified(true)
    setStatusMessage('이메일 인증이 완료되었습니다.')
  }

  const handleSignup = (event: FormEvent) => {
    event.preventDefault()

    if (!emailVerified) {
      setStatusMessage('이메일 인증을 완료해 주세요.')
      return
    }
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

    setLoggedIn(true)
    navigate('/process')
  }

  return (
    <AuthSplitLayout>
      <section className="signup-box">
        <h1 className="signup-box__heading">이메일 가입</h1>

        <form onSubmit={handleSignup}>
          <label className="signup-box__label" htmlFor="signup-email">
            이메일
          </label>
          <div className="signup-box__email-grid">
            <input
              id="signup-email"
              className="signup-box__input"
              type="email"
              placeholder="아이디로 사용할 이메일을 입력해 주세요"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={emailVerified}
            />
            <button type="button" className="signup-box__inline-button" onClick={handleSendCode}>
              인증코드
            </button>
            <input
              className="signup-box__input"
              placeholder="인증코드 6자리를 입력해 주세요"
              value={verificationInput}
              onChange={(e) => setVerificationInput(e.target.value)}
              maxLength={6}
              inputMode="numeric"
              disabled={emailVerified}
            />
            <button
              type="button"
              className="signup-box__inline-button"
              onClick={handleVerifyCode}
              disabled={emailVerified}
            >
              인증하기
            </button>
          </div>

          <label className="signup-box__label" htmlFor="signup-password">
            비밀번호
          </label>
          <input
            id="signup-password"
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

          <label className="signup-box__label" htmlFor="signup-name">
            이름
          </label>
          <input
            id="signup-name"
            className="signup-box__input"
            placeholder="본명을 입력 해주세요"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <label className="signup-box__label" htmlFor="signup-nickname">
            닉네임
          </label>
          <input
            id="signup-nickname"
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
