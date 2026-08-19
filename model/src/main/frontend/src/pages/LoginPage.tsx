import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import authStylesUrl from "../styles/auth.css?url";
import { RouteStylesheet } from "../components/RouteStylesheet";

export function LoginPage() {
  const navigate = useNavigate();
  const [errorMsg, setErrorMsg] = useState('');

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;

    try {
      const res = await fetch('/api/users/email/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const result = await res.json();

      if (result.ok) {
        localStorage.setItem('accessToken', result.data.token);
        navigate('/');
      } else {
        setErrorMsg(result.message);
      }
    } catch (e) {
      setErrorMsg('서버 오류가 발생했습니다.');
    }
  }

  return (
    <>
      <RouteStylesheet href={authStylesUrl} />
      <div className="auth-page">
        <header className="auth-header">
          <Link className="brand" to="/">
            Naily
          </Link>
          <nav className="header-links" aria-label="인증 페이지 이동">
            <Link className="active" to="/login">
              Sign in
            </Link>
            <Link to="/signup">Sign up</Link>
          </nav>
        </header>

        <main className="auth-main">
          <section className="panel">
            <div className="card">
              <h1>Sign in to Naily</h1>
              <form onSubmit={onSubmit}>
                <input className="input" type="email" name="email" placeholder="E-mail" required />
                <input
                  className="input"
                  type="password"
                  name="password"
                  placeholder="Password"
                  required
                />
                {errorMsg && (
                    <p style={{ color: 'red', fontSize: '13px', margin: '0 0 8px' }}>{errorMsg}</p>
                )}
                <button className="btn" type="submit">
                  Sign in
                </button>
              </form>

              <div className="divider">or</div>

              <div className="social-list">
                <button className="social-btn" type="button">
                  <span className="icon" aria-hidden="true" />
                  <span>네이버로 로그인</span>
                </button>
                <button className="social-btn" type="button">
                  <span className="icon" aria-hidden="true" />
                  <span>구글로 로그인</span>
                </button>
              </div>

              <div className="links-row">
                <a href="#">비밀번호 찾기</a> | <Link to="/signup">회원가입 하기</Link> |{" "}
                <a href="#">고객센터</a>
              </div>
            </div>
          </section>

          <section className="visual" aria-hidden="true" />
        </main>

        <footer className="auth-footer">
          <strong>Naily</strong>
          <span>© {new Date().getFullYear()}, Naily For You. All rights reserved.</span>
          <Link to="/">홈</Link>
        </footer>
      </div>
    </>
  );
}
