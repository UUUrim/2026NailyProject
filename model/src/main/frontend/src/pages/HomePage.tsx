import { Link, useNavigate } from "react-router-dom";
import homeStylesUrl from "../styles/home.css?url";
import { GalleryCarousel } from "../components/GalleryCarousel";
import { RouteStylesheet } from "../components/RouteStylesheet";
import { useEffect, useState } from "react";

const year = new Date().getFullYear();

export function HomePage() {
  const navigate = useNavigate();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    setIsLoggedIn(!!token);
  }, []);

  function logout() {
    localStorage.removeItem('accessToken');
    setIsLoggedIn(false);
    navigate('/');
  }

  return (
      <>
        <RouteStylesheet href={homeStylesUrl} />
        <a className="skip" href="#main">
          본문 바로가기
        </a>

        <header className="site-header">
          <div className="container header-inner">
            <Link className="brand" to="/" aria-label="Naily 홈">
              <span className="brand-mark" aria-hidden="true" />
              <span className="brand-name">Naily</span>
            </Link>

            <nav className="nav" aria-label="주요 메뉴">
              <a className="nav-link" href="#intro">소개</a>
              <a className="nav-link" href="#features">기능</a>
              <a className="nav-link" href="#gallery">둘러보기</a>
              <Link className="nav-link" to="/mypage">마이페이지</Link>
              <a className="nav-link" href="#contact">문의</a>
            </nav>

            <div className="header-actions">
              {isLoggedIn ? (
                  <>
                    <Link className="ghost-btn" to="/profile-test">프로필</Link>
                    <button className="ghost-btn" onClick={logout} style={{ cursor: 'pointer' }}>
                      로그아웃
                    </button>
                  </>
              ) : (
                  <>
                    <Link className="ghost-btn" to="/login">로그인</Link>
                    <Link className="primary-btn" to="/signup">서비스 시작하기</Link>
                  </>
              )}
            </div>
          </div>
        </header>

        <main id="main">
          <section className="hero" id="intro" aria-labelledby="hero-title">
            <div className="container hero-inner">
              <div className="hero-media" aria-hidden="true">
                <div className="wireframe wireframe-hero">
                  <span className="wireframe-x" />
                  <span className="wireframe-x" />
                </div>
              </div>

              <div className="hero-copy">
                <h1 id="hero-title">Own your Nail</h1>
                <p className="muted">지금 바로 세상에 단 하나뿐인 당신만의 네일팁을 만드세요.</p>
                <div className="hero-cta">
                  <a className="primary-btn" href="#features">서비스 시작하기</a>
                  <a className="ghost-btn" href="#gallery">둘러보기</a>
                </div>
              </div>
            </div>
          </section>

          <section className="section" id="features" aria-label="핵심 기능">
            <div className="container">
              <article className="feature">
                <header className="feature-head">
                  <h2>Fit</h2>
                  <p className="muted">손 촬영을 통해 당신의 손톱 모양에 딱 맞는 네일팁을 만듭니다.</p>
                </header>
                <div className="wireframe wireframe-block" aria-hidden="true">
                  <span className="wireframe-x" />
                  <span className="wireframe-x" />
                </div>
              </article>

              <article className="feature">
                <header className="feature-head">
                  <h2>Design</h2>
                  <p className="muted">당신이 원하는 디자인을 만듭니다.</p>
                </header>
                <div className="wireframe wireframe-block" aria-hidden="true">
                  <span className="wireframe-x" />
                  <span className="wireframe-x" />
                </div>
              </article>

              <article className="feature">
                <header className="feature-head">
                  <h2>Preview</h2>
                  <p className="muted">당신의 손에 적용된 네일팁을 미리 확인해보세요.</p>
                </header>
                <div className="wireframe wireframe-block" aria-hidden="true">
                  <span className="wireframe-x" />
                  <span className="wireframe-x" />
                </div>
              </article>

              <article className="feature">
                <header className="feature-head">
                  <h2>Printing</h2>
                  <p className="muted">3D 프린터로 당신의 네일팁을 제작합니다.</p>
                </header>
                <div className="wireframe wireframe-block" aria-hidden="true">
                  <span className="wireframe-x" />
                  <span className="wireframe-x" />
                </div>
              </article>
            </div>
          </section>

          <section className="section" id="gallery" aria-label="둘러보기">
            <div className="container">
              <div className="section-title">
                <h2>둘러보기</h2>
              </div>
              <GalleryCarousel />
            </div>
          </section>

          <section className="cta" id="contact" aria-labelledby="cta-title">
            <div className="container cta-inner">
              <div className="cta-media" aria-hidden="true">
                <div className="wireframe wireframe-cta">
                  <span className="wireframe-x" />
                  <span className="wireframe-x" />
                </div>
              </div>

              <div className="cta-copy">
                <h2 id="cta-title">서비스 문의</h2>
                <p className="muted">
                  제휴/도입/커스터마이징이 필요하신가요? 간단히 내용을 남겨주시면 빠르게 답변드릴게요.
                </p>
                <a className="primary-btn" href="mailto:hello@naily.example">서비스 문의</a>
              </div>
            </div>
          </section>
        </main>

        <footer className="site-footer">
          <div className="container footer-inner">
            <div className="footer-left">
              <div className="brand brand--footer" aria-label="Naily">
                <span className="brand-mark" aria-hidden="true" />
                <span className="brand-name">Naily</span>
              </div>
              <p className="muted small">
                © {year} Naily. All rights reserved.
              </p>
            </div>

            <div className="footer-links" aria-label="푸터 링크">
              <a href="#intro">소개</a>
              <a href="#features">기능</a>
              <a href="#gallery">둘러보기</a>
              <a href="#contact">문의</a>
            </div>
          </div>
        </footer>
      </>
  );
}