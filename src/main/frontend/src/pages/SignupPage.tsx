import { Link } from "react-router-dom";
import authStylesUrl from "../styles/auth.css?url";
import { RouteStylesheet } from "../components/RouteStylesheet";

export function SignupPage() {
  return (
    <>
      <RouteStylesheet href={authStylesUrl} />
      <div className="auth-page">
        <header className="auth-header">
          <Link className="brand" to="/">
            Naily
          </Link>
          <nav className="header-links" aria-label="인증 페이지 이동">
            <Link to="/login">Sign in</Link>
            <Link className="active" to="/signup">
              Sign up
            </Link>
          </nav>
        </header>

        <main className="auth-main">
          <section className="visual" aria-hidden="true" />

          <section className="panel">
            <div className="card">
              <h1>Sign up for Naily</h1>

              <div className="social-list">
                <button className="social-btn" type="button">
                  <span className="icon" aria-hidden="true" />
                  <span>네이버로 시작</span>
                </button>
                <button className="social-btn" type="button">
                  <span className="icon" aria-hidden="true" />
                  <span>구글로 시작</span>
                </button>
              </div>

              <div className="divider">or</div>

              <Link className="social-btn" to="/signup/email">
                <span className="icon" aria-hidden="true" />
                <span>이메일로 회원가입</span>
              </Link>
            </div>
          </section>
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
