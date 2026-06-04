import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout'
import { sendVerificationCode, verifyEmailCode, signup } from '@/api/user'
import { login } from '@/api/user'
import { ApiError } from '@/utils/apiClient'
import '@/styles/signup.css'

export function SignupEmailPage() {
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [verificationInput, setVerificationInput] = useState('')
  const [emailVerified, setEmailVerified] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [name, setName] = useState('')
  const [nickname, setNickname] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [isCodeSending, setIsCodeSending] = useState(false)
  const [isCodeVerifying, setIsCodeVerifying] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // ── 인증코드 발송 → POST /users/email/send?email= ─────────────────────────
  const handleSendCode = async () => {
    if (!email.trim() || !email.includes('@')) {
      setStatusMessage('올바른 이메일 주소를 입력해 주세요.')
      return
    }

    setIsCodeSending(true)
    setStatusMessage('')

    try {
      await sendVerificationCode(email)
      setStatusMessage('인증코드를 발송했습니다. 이메일을 확인해 주세요.')
    } catch (e) {
      if (e instanceof ApiError) {
        // 409: DuplicateException.email()
        if (e.status === 409) {
          setStatusMessage('이미 가입된 이메일입니다.')
        } else {
          setStatusMessage(e.message)
        }
      } else {
        setStatusMessage('인증코드 발송에 실패했습니다.')
      }
    } finally {
      setIsCodeSending(false)
    }
  }

  // ── 인증코드 검증 → POST /users/email/verify?email=&code= ─────────────────
  const handleVerifyCode = async () => {
    if (!verificationInput.trim()) {
      setStatusMessage('인증코드를 입력해 주세요.')
      return
    }

    setIsCodeVerifying(true)
    setStatusMessage('')

    try {
      await verifyEmailCode(email, verificationInput)
      setEmailVerified(true)
      setStatusMessage('이메일 인증이 완료되었습니다.')
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        setStatusMessage('인증코드가 올바르지 않습니다.')
      } else {
        setStatusMessage('인증 확인에 실패했습니다.')
      }
    } finally {
      setIsCodeVerifying(false)
    }
  }

  // ── 회원가입 → POST /users/signup → 바로 로그인 ───────────────────────────
  const handleSignup = async (event: FormEvent) => {
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

    setIsSubmitting(true)
    setStatusMessage('')

    try {
      // 1. 회원가입
      await signup({ email, password, name, nickname })

      // 2. 가입 직후 자동 로그인 (토큰 저장 포함)
      await login(email, password)

      navigate('/process')
    } catch (e) {
      if (e instanceof ApiError) {
        // 409: 이메일/닉네임 중복
        if (e.status === 409) {
          setStatusMessage(e.message) // "이미 존재하는 이메일입니다." 등 서버 메시지 그대로
        } else if (e.status === 400) {
          setStatusMessage('입력값이 올바르지 않습니다.')
        } else {
          setStatusMessage(e.message)
        }
      } else {
        setStatusMessage('회원가입에 실패했습니다. 다시 시도해 주세요.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
      <AuthSplitLayout>
        <section className="signup-box">
          <h1 className="signup-box__heading">이메일 가입</h1>

          <form onSubmit={(e) => void handleSignup(e)}>
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
                  autoComplete="email"
              />
              <button
                  type="button"
                  className="signup-box__inline-button"
                  onClick={() => void handleSendCode()}
                  disabled={emailVerified || isCodeSending}
              >
                {isCodeSending ? '발송 중...' : '인증코드'}
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
                  onClick={() => void handleVerifyCode()}
                  disabled={emailVerified || isCodeVerifying}
              >
                {isCodeVerifying ? '확인 중...' : '인증하기'}
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
                placeholder="본명을 입력해 주세요"
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

            {statusMessage && (
                <p
                    className="signup-box__status"
                    style={{ color: emailVerified && statusMessage.includes('완료') ? 'green' : undefined }}
                >
                  {statusMessage}
                </p>
            )}

            <button
                type="submit"
                className="signup-box__submit"
                disabled={isSubmitting}
            >
              {isSubmitting ? '가입 중...' : '가입하기'}
            </button>
          </form>

          <p className="signup-box__notice">
            가입하기를 클릭함으로써, 이용약관 및 개인정보 처리방침에 동의하는 것으로 간주됩니다
          </p>
        </section>
      </AuthSplitLayout>
  )
}