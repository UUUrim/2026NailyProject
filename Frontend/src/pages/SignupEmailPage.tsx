import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout'
import { sendVerificationCode, verifyEmailCode, signup } from '@/apis/user'
import { login } from '@/apis/user'
import { ApiError } from '@/utils/apiClient'
import { LegalDocumentModal } from '@/components/common/LegalDocumentModal'
import {
  TERMS_OF_SERVICE,
  TERMS_OF_SERVICE_UPDATED_AT,
  PRIVACY_POLICY,
  PRIVACY_POLICY_UPDATED_AT,
} from '@/constants/legalDocuments'
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

  // 필드별 안내 문구 — 각 입력칸 바로 아래에 표시된다.
  const [emailMessage, setEmailMessage] = useState('')
  const [emailMessageType, setEmailMessageType] = useState<'error' | 'success'>('error')
  const [codeMessage, setCodeMessage] = useState('')
  const [codeMessageType, setCodeMessageType] = useState<'error' | 'success'>('error')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [nameMessage, setNameMessage] = useState('')
  const [nicknameMessage, setNicknameMessage] = useState('')
  // 특정 입력칸에 속하지 않는 일반 오류(네트워크 실패 등)
  const [formMessage, setFormMessage] = useState('')

  const [isCodeSending, setIsCodeSending] = useState(false)
  const [isCodeVerifying, setIsCodeVerifying] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [legalModal, setLegalModal] = useState<'terms' | 'privacy' | null>(null)

  // ── 인증코드 발송 → POST /users/email/send?email= ─────────────────────────
  const handleSendCode = async () => {
    if (!email.trim() || !email.includes('@')) {
      setEmailMessageType('error')
      setEmailMessage('올바른 이메일 주소를 입력해 주세요.')
      return
    }

    setIsCodeSending(true)
    setEmailMessage('')

    try {
      await sendVerificationCode(email)
      setEmailMessageType('success')
      setEmailMessage('인증코드를 발송했습니다. 이메일을 확인해 주세요.')
    } catch (e) {
      setEmailMessageType('error')
      if (e instanceof ApiError) {
        // 409: DuplicateException.email()
        setEmailMessage(e.status === 409 ? '이미 가입된 이메일입니다.' : e.message)
      } else {
        setEmailMessage('인증코드 발송에 실패했습니다.')
      }
    } finally {
      setIsCodeSending(false)
    }
  }

  // ── 인증코드 검증 → POST /users/email/verify?email=&code= ─────────────────
  const handleVerifyCode = async () => {
    if (!verificationInput.trim()) {
      setCodeMessageType('error')
      setCodeMessage('인증코드를 입력해 주세요.')
      return
    }

    setIsCodeVerifying(true)
    setCodeMessage('')

    try {
      await verifyEmailCode(email, verificationInput)
      setEmailVerified(true)
      setCodeMessageType('success')
      setCodeMessage('인증에 성공하였습니다.')
    } catch (e) {
      setCodeMessageType('error')
      if (e instanceof ApiError && e.status === 400) {
        setCodeMessage('인증코드가 일치하지 않습니다.')
      } else {
        setCodeMessage('인증 확인에 실패했습니다.')
      }
    } finally {
      setIsCodeVerifying(false)
    }
  }

  // ── 회원가입 → POST /users/signup → 바로 로그인 ───────────────────────────
  const handleSignup = async (event: FormEvent) => {
    event.preventDefault()

    setPasswordMessage('')
    setNameMessage('')
    setNicknameMessage('')
    setFormMessage('')

    let hasError = false

    if (!emailVerified) {
      setCodeMessageType('error')
      setCodeMessage('이메일 인증을 완료해 주세요.')
      hasError = true
    }
    if (password.length < 8) {
      setPasswordMessage('비밀번호는 8자 이상이어야 합니다.')
      hasError = true
    } else if (password !== passwordConfirm) {
      setPasswordMessage('비밀번호가 일치하지 않습니다.')
      hasError = true
    }
    if (!name.trim()) {
      setNameMessage('이름을 입력해 주세요.')
      hasError = true
    }
    if (!nickname.trim()) {
      setNicknameMessage('닉네임을 입력해 주세요.')
      hasError = true
    }
    if (hasError) return

    setIsSubmitting(true)

    try {
      // 1. 회원가입
      await signup({ email, password, name, nickname })

      // 2. 가입 직후 자동 로그인 (토큰 저장 포함)
      await login(email, password)

      navigate('/process')
    } catch (e) {
      if (e instanceof ApiError) {
        // 409: 이메일/닉네임 중복 — 서버 메시지 문구로 어느 필드 문제인지 추정해서 해당 칸 아래에 표시
        if (e.status === 409) {
          if (e.message.includes('닉네임')) {
            setNicknameMessage(e.message)
          } else if (e.message.includes('이메일')) {
            setEmailMessageType('error')
            setEmailMessage(e.message)
          } else {
            setFormMessage(e.message)
          }
        } else if (e.status === 400) {
          setFormMessage('입력값이 올바르지 않습니다.')
        } else {
          setFormMessage(e.message)
        }
      } else {
        setFormMessage('회원가입에 실패했습니다. 다시 시도해 주세요.')
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
              {emailMessage && (
                  <p className={`signup-box__field-message signup-box__field-message--grid ${emailMessageType === 'success' ? 'is-success' : 'is-error'}`}>
                    {emailMessage}
                  </p>
              )}

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
              {codeMessage && (
                  <p className={`signup-box__field-message signup-box__field-message--grid ${codeMessageType === 'success' ? 'is-success' : 'is-error'}`}>
                    {codeMessage}
                  </p>
              )}
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
            {passwordMessage && <p className="signup-box__field-message is-error">{passwordMessage}</p>}

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
            {nameMessage && <p className="signup-box__field-message is-error">{nameMessage}</p>}

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
            {nicknameMessage && <p className="signup-box__field-message is-error">{nicknameMessage}</p>}

            {formMessage && <p className="signup-box__status">{formMessage}</p>}

            <button
                type="submit"
                className="signup-box__submit"
                disabled={isSubmitting}
            >
              {isSubmitting ? '가입 중...' : '가입하기'}
            </button>
          </form>

          <p className="signup-box__notice">
            가입하기를 클릭함으로써,{' '}
            <button type="button" className="signup-box__notice-link" onClick={() => setLegalModal('terms')}>
              이용약관
            </button>
            {' '}및{' '}
            <button type="button" className="signup-box__notice-link" onClick={() => setLegalModal('privacy')}>
              개인정보 처리방침
            </button>
            에 동의하는 것으로 간주됩니다
          </p>
        </section>

        {legalModal === 'terms' && (
            <LegalDocumentModal
                title="이용약관"
                updatedAt={TERMS_OF_SERVICE_UPDATED_AT}
                sections={TERMS_OF_SERVICE}
                onClose={() => setLegalModal(null)}
            />
        )}
        {legalModal === 'privacy' && (
            <LegalDocumentModal
                title="개인정보 처리방침"
                updatedAt={PRIVACY_POLICY_UPDATED_AT}
                sections={PRIVACY_POLICY}
                onClose={() => setLegalModal(null)}
            />
        )}
      </AuthSplitLayout>
  )
}
