import '@/styles/login.css'
import { Link, useNavigate } from 'react-router-dom'
import { setLoggedIn } from '@/utils/auth'

export function LoginPage() {
  const navigate = useNavigate()

  const handleLogin = async () => {
    const email = (document.getElementById('email') as HTMLInputElement).value
    const password = (document.getElementById('password') as HTMLInputElement).value

    try {
      const response = await fetch('/users/email/login', {  // 경로 수정
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (response.ok) {
        const result = await response.json()
        localStorage.setItem('token', result.data.token)  // ApiResponse 구조라 .data.token
        setLoggedIn(true)
        navigate('/process')
      } else {
        alert('이메일 또는 비밀번호가 틀렸습니다.')
      }
    } catch {
      alert('서버 연결에 실패했습니다.')
    }
  }

  return (
    <div className="login-wireframe">
      <div className="login-wireframe__canvas">
        <header className="login-wireframe__header">
          <Link to="/" className="login-wireframe__logo">
            Naily
          </Link>
          <nav className="login-wireframe__nav" aria-label="상단 메뉴">
            <Link to="/login" className="login-wireframe__link">
              로그인
            </Link>
            <Link to="/signup" className="login-wireframe__cta">
              무료로 시작하기
            </Link>
          </nav>
        </header>

        <main className="login-wireframe__main">
          <section className="login-card" aria-label="로그인 폼">
            <h1 className="login-card__title">
              로그인하고 나만의 네일팁을
              <br />
              만들어 보세요
            </h1>

            <form className="login-form">
              <label className="login-form__label" htmlFor="email">
                이메일
              </label>
              <input id="email" className="login-form__input" placeholder="email@domain.com" />

              <label className="login-form__label" htmlFor="password">
                비밀번호
              </label>
              <input id="password" className="login-form__input" placeholder="••••••••" />

              <div className="login-form__row">
                <label className="login-form__check">
                  <input type="checkbox" />
                  로그인 유지
                </label>
                <a href="#" className="login-form__helper">
                  비밀번호 찾기
                </a>
              </div>

              <button type="button" className="login-form__submit" onClick={handleLogin}>
                로그인
              </button>
            </form>

            <div className="login-divider">
              <span>또는</span>
            </div>

            <div className="social-login">
              <Link to="/signup/google" className="social-login__button">
                <img
                  src="/images/google-logo.png"
                  alt=""
                  className="social-login__icon-image social-login__icon-image--google"
                />
                구글로 로그인
              </Link>
              <Link to="/signup/naver" className="social-login__button">
                <img
                  src="/images/naver-logo.png"
                  alt=""
                  className="social-login__icon-image social-login__icon-image--naver"
                />
                네이버로 로그인
              </Link>
            </div>

            <p className="login-card__signup">
              아직 네일리 회원이 아니신가요? <Link to="/signup">회원가입</Link>
            </p>
          </section>
        </main>

        <footer className="login-wireframe__footer">
          <p className="login-wireframe__footer-logo">Naily</p>
          <p className="login-wireframe__copyright">© 2026. Naily(네일리) All rights reserved.</p>
          <span className="login-wireframe__mail" aria-hidden="true">
            ✉
          </span>
        </footer>
      </div>
    </div>
  )
}
