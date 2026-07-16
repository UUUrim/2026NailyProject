import { Link } from 'react-router-dom'
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout'
import '@/styles/signup.css'
import {getSocialAuthUrl} from "@/apis/user.ts";

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
          {/* 수정: Link가 아니라 실제 페이지로 이동 */}
          <a href={getSocialAuthUrl('google')} className="social-login__button">
            <img src="/images/google-logo.png" alt="" className="social-login__icon-image social-login__icon-image--google" />
            구글로 로그인
          </a>
          <a href={getSocialAuthUrl('naver')} className="social-login__button">
            <img src="/images/naver-logo.png" alt="" className="social-login__icon-image social-login__icon-image--naver" />
            네이버로 로그인
          </a>
        </div>
      </section>
    </AuthSplitLayout>
  )
}
