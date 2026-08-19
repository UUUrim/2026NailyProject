import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import authStylesUrl from "../styles/auth.css?url";
import { RouteStylesheet } from "../components/RouteStylesheet";

export function SignupEmailPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [isVerified, setIsVerified] = useState(false);
  const [nickname, setNickname] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // 인증코드 발송
  async function sendCode() {
    if (!email) { setErrorMsg('이메일을 입력해주세요.'); return; }
    setErrorMsg('');
    try {
      const res = await fetch(`/api/users/email/send?email=${encodeURIComponent(email)}`, {
        method: 'POST'
      });
      const result = await res.json();
      if (result.ok) {
        setSuccessMsg('인증코드가 발송되었습니다. 이메일을 확인해주세요.');
      } else {
        setErrorMsg(result.message);
      }
    } catch {
      setErrorMsg('서버 오류가 발생했습니다.');
    }
  }

  // 인증코드 확인
  async function verifyEmail() {
    if (!verifyCode) { setErrorMsg('인증코드를 입력해주세요.'); return; }
    setErrorMsg('');
    try {
      const res = await fetch(`/api/users/email/verify?email=${encodeURIComponent(email)}&code=${encodeURIComponent(verifyCode)}`, {
        method: 'POST'
      });
      const result = await res.json();
      if (result.ok) {
        setIsVerified(true);
        setSuccessMsg('이메일 인증이 완료되었습니다!');
      } else {
        setErrorMsg(result.message);
      }
    } catch {
      setErrorMsg('서버 오류가 발생했습니다.');
    }
  }

  // 회원가입
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isVerified) { setErrorMsg('이메일 인증을 먼저 완료해주세요.'); return; }
    if (!email || !password || !name || !nickname) { setErrorMsg('모든 항목을 입력해주세요.'); return; }
    setErrorMsg('');

    try {
      const res = await fetch('/api/users/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name, nickname })
      });
      const result = await res.json();
      if (result.ok) {
        navigate('/login');
      } else {
        setErrorMsg(result.message);
      }
    } catch {
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

                <form className="form-stack" onSubmit={onSubmit}>

                  {/* 이메일 + 인증코드 발송 */}
                  <div className="field">
                    <label htmlFor="email">이메일</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                          id="email"
                          className="input"
                          type="email"
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          required
                          disabled={isVerified}
                      />
                      <button type="button" onClick={sendCode} disabled={isVerified}
                              style={{ whiteSpace: 'nowrap', padding: '0 12px' }}>
                        인증코드 발송
                      </button>
                    </div>
                  </div>

                  {/* 인증코드 입력 */}
                  <div className="field">
                    <label htmlFor="verifyCode">인증코드</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                          id="verifyCode"
                          className="input"
                          type="text"
                          value={verifyCode}
                          onChange={e => setVerifyCode(e.target.value)}
                          disabled={isVerified}
                          placeholder="6자리 코드 입력"
                      />
                      <button type="button" onClick={verifyEmail} disabled={isVerified}
                              style={{ whiteSpace: 'nowrap', padding: '0 12px' }}>
                        확인
                      </button>
                    </div>
                  </div>

                  {/* 이름 */}
                  <div className="field">
                    <label htmlFor="name">이름</label>
                    <input
                        id="name"
                        className="input"
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        required
                    />
                  </div>

                  {/* 닉네임 */}
                  <div className="field">
                    <label htmlFor="nickname">닉네임</label>
                    <input
                        id="nickname"
                        className="input"
                        type="text"
                        value={nickname}
                        onChange={e => setNickname(e.target.value)}
                        required
                    />
                  </div>

                  {/* 비밀번호 */}
                  <div className="field">
                    <label htmlFor="password">비밀번호</label>
                    <input
                        id="password"
                        className="input"
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        required
                    />
                  </div>

                  {/* 메시지 */}
                  {errorMsg && <p style={{ color: 'red', fontSize: '13px', margin: '0' }}>{errorMsg}</p>}
                  {successMsg && <p style={{ color: 'green', fontSize: '13px', margin: '0' }}>{successMsg}</p>}

                  <div className="submit-wrap">
                    <button className="btn" type="submit">
                      Sign up
                    </button>
                  </div>
                </form>

                <div className="links-row">
                  <Link to="/signup">이전 단계로</Link> | <Link to="/login">로그인으로 이동</Link>
                </div>
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
