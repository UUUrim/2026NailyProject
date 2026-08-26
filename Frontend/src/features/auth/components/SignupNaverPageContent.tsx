import { AuthSplitLayout } from '@/features/auth/components/AuthSplitLayout'
import { useSignupNaverPage } from '@/features/auth/hooks/useSignupNaverPage'
import '@/styles/signup.css'

export function SignupNaverPageContent() {
  const {
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
  } = useSignupNaverPage()

  return (
    <AuthSplitLayout>
      <section className="signup-box">
        <h1 className="signup-box__heading">네이버 가입</h1>

        <form onSubmit={(e) => void handleSignup(e)}>
          <label className="signup-box__label">이메일</label>
          <div className="signup-box__provider-email">
            <img src="/images/naver-logo.png" alt="" className="signup-box__social-icon" />
            <span>{email}</span>
          </div>

          <label className="signup-box__label" htmlFor="naver-password">
            관리자 비밀번호
          </label>
          <input
            id="naver-password"
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

          <label className="signup-box__label" htmlFor="naver-name">
            이름
          </label>
          <input
            id="naver-name"
            className="signup-box__input"
            placeholder="본명을 입력 해주세요"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <label className="signup-box__label" htmlFor="naver-nickname">
            닉네임
          </label>
          <input
            id="naver-nickname"
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
