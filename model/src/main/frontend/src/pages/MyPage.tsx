import { FormEvent, useState, useEffect } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import mypageStylesUrl from "../styles/mypage.css?url";
import { RouteStylesheet } from "../components/RouteStylesheet";

type AnalysisRecord = {
  id: string;
  title: string;
  description: string;
  accuracy: string;
};

type NailTip = {
  id: string;
  name: string;
  createdAt: string;
};

const analysisRecords: AnalysisRecord[] = [
  {
    id: "1",
    title: "2026-04-10 손 분석",
    description: "손톱 폭 평균 14.2mm / 추천 팁 타입: 슬림 오벌",
    accuracy: "정확도 96%",
  },
  {
    id: "2",
    title: "2026-03-22 손 분석",
    description: "손톱 길이 평균 10.8mm / 추천 팁 타입: 라운드",
    accuracy: "정확도 94%",
  },
  {
    id: "3",
    title: "2026-03-01 손 분석",
    description: "좌우 비율 보정 필요 / 개인 맞춤 보정 적용됨",
    accuracy: "정확도 91%",
  },
];

const nailTips: NailTip[] = [
  { id: "1", name: "Spring Pink Gloss", createdAt: "2026-04-12" },
  { id: "2", name: "Mono Marble", createdAt: "2026-04-07" },
  { id: "3", name: "Fresh Mint Line", createdAt: "2026-03-29" },
  { id: "4", name: "Daily Beige", createdAt: "2026-03-15" },
  { id: "5", name: "Silver Dot Accent", createdAt: "2026-02-18" },
  { id: "6", name: "French Soft White", createdAt: "2026-01-30" },
];

export function MyPage() {
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // 페이지 로드 시 프로필 조회
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      navigate('/login');
      return;
    }

    fetch('/api/users/me', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    })
        .then(res => res.json())
        .then(result => {
          if (result.ok) {
            setName(result.data.name);
            setNickname(result.data.nickname);
            setEmail(result.data.email);
          } else {
            // 토큰 만료 등 인증 오류 시 로그인 페이지로
            localStorage.removeItem('accessToken');
            navigate('/login');
          }
        })
        .catch(() => setErrorMsg('프로필을 불러오는 데 실패했습니다.'));
  }, [navigate]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // 추후 정보 수정 API 연결
  }

  return (
      <>
        <RouteStylesheet href={mypageStylesUrl} />
        <header className="site-header">
          <div className="container header-inner">
            <Link className="brand" to="/">
              Naily
            </Link>
            <nav className="header-nav" aria-label="페이지 이동">
              <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : undefined)}>
                메인
              </NavLink>
              <NavLink to="/login" className={({ isActive }) => (isActive ? "active" : undefined)}>
                로그인
              </NavLink>
              <NavLink to="/signup" className={({ isActive }) => (isActive ? "active" : undefined)}>
                회원가입
              </NavLink>
              <NavLink to="/mypage" className={({ isActive }) => (isActive ? "active" : undefined)}>
                마이페이지
              </NavLink>
            </nav>
          </div>
        </header>

        <main className="page">
          <div className="container">
            <h1 className="page-title">마이페이지</h1>
            <p className="page-subtitle">내 프로필과 저장 기록을 확인하고 관리할 수 있습니다.</p>

            {errorMsg && (
                <p style={{ color: 'red', fontSize: '14px', marginBottom: '16px' }}>{errorMsg}</p>
            )}

            <section className="layout" aria-label="마이페이지 콘텐츠">
              <div className="left-col">
                <article className="card" aria-label="프로필 정보">
                  <div className="profile-top">
                    <div className="avatar" aria-hidden="true" />
                    <h2 className="name">{name}</h2>
                    <p className="nickname">@{nickname}</p>
                  </div>

                  <dl className="profile-meta">
                    <div className="meta-item">
                      <dt>이름</dt>
                      <dd>{name}</dd>
                    </div>
                    <div className="meta-item">
                      <dt>닉네임</dt>
                      <dd>{nickname}</dd>
                    </div>
                    <div className="meta-item">
                      <dt>이메일</dt>
                      <dd>{email}</dd>
                    </div>
                    <div className="meta-item">
                      <dt>비밀번호</dt>
                      <dd>********</dd>
                    </div>
                  </dl>
                </article>

                <article className="card edit-card" aria-label="정보 수정">
                  <div className="section-head">
                    <h2>정보 수정</h2>
                    <button className="btn" type="button">
                      취소
                    </button>
                  </div>

                  <form className="form-grid" onSubmit={onSubmit}>
                    <div className="field">
                      <label htmlFor="name">이름</label>
                      <input
                          id="name"
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="nickname-edit">닉네임</label>
                      <input
                          id="nickname-edit"
                          type="text"
                          value={nickname}
                          onChange={(e) => setNickname(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="email-edit">이메일</label>
                      <input
                          id="email-edit"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="password">비밀번호 변경</label>
                      <input
                          id="password"
                          type="password"
                          placeholder="새 비밀번호 입력"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                    <button className="btn primary" type="submit">
                      정보 수정 저장
                    </button>
                  </form>
                </article>
              </div>

              <div className="right-col">
                <article className="card history-card" aria-label="손 분석 저장 기록">
                  <div className="section-head">
                    <h2>손 분석 결과 기록</h2>
                    <div className="history-tabs" aria-hidden="true">
                      <span className="pill active">최신순</span>
                      <span className="pill">정확도순</span>
                    </div>
                  </div>

                  <div className="list">
                    {analysisRecords.map((row) => (
                        <article className="list-item" key={row.id}>
                          <div>
                            <h3>{row.title}</h3>
                            <p>{row.description}</p>
                          </div>
                          <span className="chip">{row.accuracy}</span>
                        </article>
                    ))}
                  </div>
                </article>

                <article className="card history-card" aria-label="저장된 네일팁">
                  <div className="section-head">
                    <h2>이전에 생성한 네일팁</h2>
                    <button className="btn" type="button">
                      전체 보기
                    </button>
                  </div>

                  <div className="tips-grid">
                    {nailTips.map((tip) => (
                        <article className="tip-card" key={tip.id}>
                          <div className="tip-thumb" aria-hidden="true" />
                          <div className="tip-info">
                            <h3>{tip.name}</h3>
                            <p>생성일: {tip.createdAt}</p>
                          </div>
                        </article>
                    ))}
                  </div>
                </article>
              </div>
            </section>
          </div>
        </main>

        <footer className="site-footer">
          <div className="container footer-inner">
            <span>© {new Date().getFullYear()} Naily. All rights reserved.</span>
            <Link to="/">메인으로 돌아가기</Link>
          </div>
        </footer>
      </>
  );
}