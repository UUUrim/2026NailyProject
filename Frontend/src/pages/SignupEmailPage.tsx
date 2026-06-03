import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout'
import '@/styles/signup.css'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'

export function SignupEmailPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [name, setName] = useState('')
  const [nickname, setNickname] = useState('')

  // 인증코드 발송
  const handleSendCode = async () => {
    if (!email) { alert('이메일을 입력해주세요.'); return }
    try {
      const response = await fetch(`/users/email/send?email=${encodeURIComponent(email)}`, {
        method: 'POST',
      })
      const result = await response.json()
      alert(result.message)
    } catch {
      alert('서버 연결에 실패했습니다.')
    }
  }

  // 인증코드 검증
  const handleVerifyCode = async () => {
    if (!code) { alert('인증코드를 입력해주세요.'); return }
    try {
      const response = await fetch(
          `/users/email/verify?email=${encodeURIComponent(email)}&code=${encodeURIComponent(code)}`,
          { method: 'POST' }
      )
      const result = await response.json()
      alert(result.message)
    } catch {
      alert('서버 연결에 실패했습니다.')
    }
  }

  // 회원가입
  const handleSignup = async () => {
    if (password !== passwordConfirm) { alert('비밀번호가 일치하지 않습니다.'); return }
    try {
      const response = await fetch('/users/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name, nickname }),
      })
      const result = await response.json()
      if (response.ok) {
        alert('회원가입이 완료되었습니다!')
        navigate('/login')
      } else {
        alert(result.message || '회원가입에 실패했습니다.')
      }
    } catch {
      alert('서버 연결에 실패했습니다.')
    }
  }

  return (
      <AuthSplitLayout>
        <section className="signup-box">
          <h1 className="signup-box__heading">이메일 가입</h1>

          <label className="signup-box__label">이메일</label>
          <div className="signup-box__email-grid">
            <input
                className="signup-box__input"
                placeholder="아이디로 사용할 이메일을 입력해 주세요"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
            />
            <button type="button" className="signup-box__inline-button" onClick={handleSendCode}>
              인증코드
            </button>
            <input
                className="signup-box__input"
                placeholder="인증코드 6자리를 입력해 주세요"
                value={code}
                onChange={(e) => setCode(e.target.value)}
            />
            <button type="button" className="signup-box__inline-button" onClick={handleVerifyCode}>
              인증하기
            </button>
          </div>

          <label className="signup-box__label">비밀번호</label>
          <input
              className="signup-box__input"
              placeholder="영문, 숫자, 특수문자를 모두 포함한 8-20자"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
          />
          <input
              className="signup-box__input"
              placeholder="비밀번호를 한 번 더 입력해 주세요"
              type="password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
          />

          <label className="signup-box__label">이름</label>
          <input
              className="signup-box__input"
              placeholder="본명을 입력 해주세요"
              value={name}
              onChange={(e) => setName(e.target.value)}
          />

          <label className="signup-box__label">닉네임</label>
          <input
              className="signup-box__input"
              placeholder="한글, 영문, 숫자 2-20자"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
          />

          <button type="button" className="signup-box__submit" onClick={handleSignup}>
            가입하기
          </button>

          <p className="signup-box__notice">
            가입하기를 클릭함으로써, 이용약관 및 개인정보 처리방침에 동의하는 것으로 간주됩니다
          </p>
        </section>
      </AuthSplitLayout>
  )
}