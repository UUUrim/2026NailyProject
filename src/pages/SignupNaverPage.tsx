import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout'
import '@/styles/signup.css'

export function SignupNaverPage() {
  return (
    <AuthSplitLayout>
      <section className="signup-box">
        <h1 className="signup-box__heading">네이버 가입</h1>

        <label className="signup-box__label">이메일</label>
        <div className="signup-box__provider-email">
          <img src="/images/naver-logo.png" alt="" className="signup-box__social-icon" />
          <span>example@naver.com</span>
        </div>

        <label className="signup-box__label">관리자 비밀번호</label>
        <input className="signup-box__input" placeholder="영문, 숫자, 특수문자를 모두 포함한 8-20자" />
        <input className="signup-box__input" placeholder="비밀번호를 한 번 더 입력해 주세요" />

        <label className="signup-box__label">이름</label>
        <input className="signup-box__input" placeholder="본명을 입력 해주세요" />

        <label className="signup-box__label">닉네임</label>
        <input className="signup-box__input" placeholder="한글, 영문, 숫자 2-20자" />

        <button type="button" className="signup-box__submit">
          가입하기
        </button>

        <p className="signup-box__notice">
          가입하기를 클릭함으로써, 이용약관 및 개인정보 처리방침에 동의하는 것으로 간주됩니다
        </p>
      </section>
    </AuthSplitLayout>
  )
}
