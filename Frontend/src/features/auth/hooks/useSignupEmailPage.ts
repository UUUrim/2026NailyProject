import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { sendVerificationCode, verifyEmailCode, signup } from '@/entities/user/api'
import { login } from '@/entities/user/api'
import { ApiError } from '@/shared/utils/apiClient'
import { isPasswordValid } from '@/shared/utils/passwordRules'

export function useSignupEmailPage() {
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
    if (!isPasswordValid(password)) {
      setPasswordMessage('비밀번호 조건을 모두 만족해야 합니다.')
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

  return {
    email,
    setEmail,
    verificationInput,
    setVerificationInput,
    emailVerified,
    password,
    setPassword,
    passwordConfirm,
    setPasswordConfirm,
    name,
    setName,
    nickname,
    setNickname,
    emailMessage,
    emailMessageType,
    codeMessage,
    codeMessageType,
    passwordMessage,
    nameMessage,
    nicknameMessage,
    formMessage,
    isCodeSending,
    isCodeVerifying,
    isSubmitting,
    legalModal,
    setLegalModal,
    handleSendCode,
    handleVerifyCode,
    handleSignup,
  }
}
