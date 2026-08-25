import '@/styles/login.css'
import { Link } from 'react-router-dom'
import { AlertModal } from '@/shared/components/AlertModal'
import { useLoginPage } from '@/features/auth/hooks/useLoginPage'

export function LoginPageContent() {
  const {
    email,
    setEmail,
    password,
    setPassword,
    errorMessage,
    isLoading,
    modalMessage,
    setModalMessage,
    handleLogin,
    getSocialAuthUrl,
  } = useLoginPage()

  return (
      <div className="login-wireframe">
        <div className="login-wireframe__canvas">
          <main className="login-wireframe__main">
            <section className="login-card" aria-label="로그인 폼">
              <h1 className="login-card__title">
                로그인하고 나만의 네일팁을
                <br />
                만들어 보세요
              </h1>

              <form
                  className="login-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void handleLogin()
                  }}
              >
                <label className="login-form__label" htmlFor="email">
                  이메일
                </label>
                <input
                    id="email"
                    className="login-form__input"
                    type="email"
                    placeholder="email@domain.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                />

                <label className="login-form__label" htmlFor="password">
                  비밀번호
                </label>
                <input
                    id="password"
                    className="login-form__input"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                />

                <div className="login-form__row">
                  <label className="login-form__check">
                    <input type="checkbox" />
                    로그인 유지
                  </label>
                  <a href="#" className="login-form__helper">
                    비밀번호 찾기
                  </a>
                </div>

                {errorMessage && (
                    <p className="login-form__error" role="alert">
                      {errorMessage}
                    </p>
                )}

                <button
                    type="submit"
                    className="login-form__submit"
                    disabled={isLoading}
                >
                  {isLoading ? '로그인 중...' : '로그인'}
                </button>
              </form>

              <div className="login-divider">
                <span>또는</span>
              </div>

              <div className="social-login">
                {/* 수정: Link가 아니라 실제 페이지로 이동 */}
                <a href={getSocialAuthUrl('google')} className="social-login__button">
                  <img src="/images/google-logo.png" alt="" className="social-login__icon-image social-login__icon-image--google" />
                  구글로 로그인
                </a>
                <a href={getSocialAuthUrl('naver')} className="social-login__button">
                  <img src="/images/naver-logo.png" alt="" className="social-login__icon-image social-login__icon-image--naver" />
                  네이버로 로그인
                </a>

                {/*<Link to="/signup/google" className="social-login__button">*/}
                {/*  <img*/}
                {/*      src="/2026NailyProject-main/Frontend/public/google-logo.png"*/}
                {/*      alt=""*/}
                {/*      className="social-login__icon-image social-login__icon-image--google"*/}
                {/*  />*/}
                {/*  구글로 로그인*/}
                {/*</Link>*/}
                {/*<Link to="/signup/naver" className="social-login__button">*/}
                {/*  <img*/}
                {/*      src="/2026NailyProject-main/Frontend/public/naver-logo.png"*/}
                {/*      alt=""*/}
                {/*      className="social-login__icon-image social-login__icon-image--naver"*/}
                {/*  />*/}
                {/*  네이버로 로그인*/}
                {/*</Link>*/}
              </div>

              <p className="login-card__signup">
                아직 네일리 회원이 아니신가요? <Link to="/signup">회원가입</Link>
              </p>
            </section>
          </main>
        </div>

        {modalMessage && (
            <AlertModal message={modalMessage} onClose={() => setModalMessage('')} />
        )}
      </div>
  )
}
