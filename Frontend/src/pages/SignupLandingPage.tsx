import { Link } from 'react-router-dom'
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout'
import '@/styles/signup.css'

export function SignupLandingPage() {
  return (
    <AuthSplitLayout>
      <section className="signup-box signup-box--landing">
        <h1 className="signup-box__title">
          회원가입하고 나만의 네일팁을
          <br />
          만들어 보세요
        </h1>

        <Link to="/signup/email" className="signup-box__primary">
          이메일로 가입
        </Link>

        <div className="signup-box__divider">
          <span>또는</span>
        </div>

        <div className="signup-box__social">
          <Link to="/signup/google" className="signup-box__social-button">
            <img src="/images/google-logo.png" alt="" className="signup-box__social-icon" />
            구글로 가입
          </Link>
          <Link to="/signup/naver" className="signup-box__social-button">
            <img src="/images/naver-logo.png" alt="" className="signup-box__social-icon" />
            네이버로 가입
          </Link>
        </div>
      </section>
    </AuthSplitLayout>
  )
}
