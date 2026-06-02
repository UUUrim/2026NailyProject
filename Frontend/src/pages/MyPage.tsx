import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { useAuth } from '@/hooks/useAuth'
import {
  getFavorites,
  getPrintOrders,
  getProfile,
  getSavedDesigns,
  updateProfile,
  type FavoriteItem,
  type PrintOrder,
  type SavedDesign,
  type UserProfile,
} from '@/utils/mypageStorage'
import '@/styles/mypage.css'

type TabId = 'designs' | 'prints' | 'favorites'

export function MyPage() {
  const navigate = useNavigate()
  const { setLoggedIn } = useAuth()
  const [profile, setProfile] = useState<UserProfile>(getProfile)
  const [editing, setEditing] = useState(false)
  const [nickname, setNickname] = useState(profile.nickname)
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [profileMessage, setProfileMessage] = useState('')
  const [tab, setTab] = useState<TabId>('designs')
  const [designs, setDesigns] = useState<SavedDesign[]>(getSavedDesigns)
  const [prints, setPrints] = useState<PrintOrder[]>(getPrintOrders)
  const [favorites, setFavorites] = useState<FavoriteItem[]>(getFavorites)

  const refreshLists = () => {
    setDesigns(getSavedDesigns())
    setPrints(getPrintOrders())
    setFavorites(getFavorites())
  }

  const handleSaveProfile = () => {
    if (password && password !== passwordConfirm) {
      setProfileMessage('비밀번호가 일치하지 않습니다.')
      return
    }
    if (password && password.length < 8) {
      setProfileMessage('비밀번호는 8자 이상이어야 합니다.')
      return
    }
    const next = updateProfile({ nickname: nickname.trim() || profile.nickname })
    setProfile(next)
    setEditing(false)
    setPassword('')
    setPasswordConfirm('')
    setProfileMessage('프로필이 저장되었습니다.')
  }

  const handleLogout = () => {
    setLoggedIn(false)
    navigate('/')
  }

  const printStatusLabel: Record<PrintOrder['status'], string> = {
    queued: '출력 대기',
    printing: '출력 중',
    completed: '완료',
  }

  return (
    <AppShell mainClassName="mypage-v2">
      <section className="mypage-v2__profile">
        <div className="mypage-v2__avatar" aria-hidden="true">
          {profile.nickname.charAt(0)}
        </div>
        <div className="mypage-v2__profile-body">
          <h1>{profile.nickname}</h1>
          <p>{profile.email}</p>
          <p className="mypage-v2__name">{profile.name}</p>
          {!editing ? (
            <button type="button" className="mypage-v2__edit-btn" onClick={() => setEditing(true)}>
              프로필 수정
            </button>
          ) : (
            <div className="mypage-v2__edit-form">
              <label>
                닉네임
                <input value={nickname} onChange={(e) => setNickname(e.target.value)} />
              </label>
              <label>
                새 비밀번호
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="변경 시에만 입력"
                />
              </label>
              <label>
                비밀번호 확인
                <input
                  type="password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                />
              </label>
              <div className="mypage-v2__edit-actions">
                <button type="button" onClick={() => setEditing(false)}>
                  취소
                </button>
                <button type="button" className="primary" onClick={handleSaveProfile}>
                  저장
                </button>
              </div>
            </div>
          )}
          {profileMessage && <p className="mypage-v2__message">{profileMessage}</p>}
        </div>
        <button type="button" className="mypage-v2__logout" onClick={handleLogout}>
          로그아웃
        </button>
      </section>

      <nav className="mypage-v2__tabs" aria-label="마이페이지 메뉴">
        <button type="button" className={tab === 'designs' ? 'is-active' : ''} onClick={() => setTab('designs')}>
          내 디자인 ({designs.length})
        </button>
        <button type="button" className={tab === 'prints' ? 'is-active' : ''} onClick={() => setTab('prints')}>
          출력 내역 ({prints.length})
        </button>
        <button
          type="button"
          className={tab === 'favorites' ? 'is-active' : ''}
          onClick={() => setTab('favorites')}
        >
          찜 목록 ({favorites.length})
        </button>
      </nav>

      <div className="mypage-v2__toolbar">
        <button type="button" onClick={refreshLists}>
          새로고침
        </button>
        <button type="button" className="primary" onClick={() => navigate('/process')}>
          네일팁 제작 계속하기
        </button>
      </div>

      {tab === 'designs' && (
        <section className="mypage-v2__grid">
          {designs.length === 0 ? (
            <p className="mypage-v2__empty">아직 저장된 디자인이 없습니다.</p>
          ) : (
            designs.map((design) => (
              <article key={design.id} className="mypage-v2__card">
                <img src={design.imageUrl} alt="" />
                <p>{new Date(design.createdAt).toLocaleDateString('ko-KR')}</p>
              </article>
            ))
          )}
        </section>
      )}

      {tab === 'prints' && (
        <section className="mypage-v2__list">
          {prints.length === 0 ? (
            <p className="mypage-v2__empty">출력 신청 내역이 없습니다.</p>
          ) : (
            prints.map((order) => (
              <article key={order.id} className="mypage-v2__print-row">
                <img src={order.imageUrl} alt="" />
                <div>
                  <p className="mypage-v2__print-status">{printStatusLabel[order.status]}</p>
                  <p>{new Date(order.orderedAt).toLocaleString('ko-KR')}</p>
                </div>
              </article>
            ))
          )}
        </section>
      )}

      {tab === 'favorites' && (
        <section className="mypage-v2__grid">
          {favorites.length === 0 ? (
            <p className="mypage-v2__empty">찜한 디자인이 없습니다.</p>
          ) : (
            favorites.map((item) => (
              <article key={item.id} className="mypage-v2__card">
                <img src={item.imageUrl} alt="" />
                <p>{new Date(item.savedAt).toLocaleDateString('ko-KR')}</p>
              </article>
            ))
          )}
        </section>
      )}
    </AppShell>
  )
}
