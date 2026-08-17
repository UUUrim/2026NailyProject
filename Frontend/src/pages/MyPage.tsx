import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { useAuth } from '@/hooks/useAuth'
import { getNailTipPrintOrders, type NailTipPrintOrder } from '@/utils/mypageStorage'
import { getMyProfile, updateNickname, updatePassword, type UserProfileResponse } from '@/api/user'
import { getMyDesigns, getLikedDesigns, type DesignImageResponse, type SavedDesignResponse } from '@/api/design'
import { ApiError } from '@/utils/apiClient'
import '@/styles/mypage.css'

type TabId = 'designs' | 'prints' | 'favorites' | 'scan'

export function MyPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { logout } = useAuth()

  // ── 프로필 ──────
  const [profile, setProfile] = useState<UserProfileResponse | null>(null)
  const [editing, setEditing] = useState(false)
  const [nickname, setNickname] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [profileMessage, setProfileMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // ── 탭 ───────
  const initialTab = (location.state as { tab?: TabId } | null)?.tab ?? 'designs'
  const [tab, setTab] = useState<TabId>(initialTab)

  // ── 데이터 ──────
  const [designs, setDesigns] = useState<DesignImageResponse[]>([])
  const [favorites, setFavorites] = useState<SavedDesignResponse[]>([])
  const [nailTipPrints, setNailTipPrints] = useState<NailTipPrintOrder[]>(getNailTipPrintOrders)
  const [isLoadingDesigns, setIsLoadingDesigns] = useState(true)
  const [isLoadingFavorites, setIsLoadingFavorites] = useState(true)

  // ── 초기 로딩 ─────────
  useEffect(() => {
    // 프로필 조회 GET /users/me
    getMyProfile()
        .then((data) => {
          setProfile(data)
          setNickname(data.nickname)
        })
        .catch(() => {})
  }, [])

  useEffect(() => {
    if (tab === 'designs') {
      // setIsLoadingDesigns(true) 삭제
      getMyDesigns()
          .then(setDesigns)
          .catch(() => {})
          .finally(() => setIsLoadingDesigns(false))
    }
    if (tab === 'favorites') {
      // setIsLoadingFavorites(true) 삭제
      getLikedDesigns()
          .then(setFavorites)
          .catch(() => {})
          .finally(() => setIsLoadingFavorites(false))
    }

  }, [tab])

  // ── 프로필 저장 ──────────────
  const handleSaveProfile = async () => {
    if (newPassword && newPassword !== passwordConfirm) {
      setProfileMessage('비밀번호가 일치하지 않습니다.')
      return
    }
    if (newPassword && newPassword.length < 8) {
      setProfileMessage('비밀번호는 8자 이상이어야 합니다.')
      return
    }

    setIsSaving(true)
    setProfileMessage('')

    try {
      // PATCH /users/me — 닉네임 수정
      if (nickname.trim() && nickname !== profile?.nickname) {
        const updated = await updateNickname(nickname.trim())
        setProfile(updated)
      }

      // PATCH /users/me/password — 비밀번호 수정
      if (newPassword && currentPassword) {
        await updatePassword(currentPassword, newPassword)
      }

      setEditing(false)
      setCurrentPassword('')
      setNewPassword('')
      setPasswordConfirm('')
      setProfileMessage('프로필이 저장되었습니다.')
    } catch (e) {
      if (e instanceof ApiError) {
        setProfileMessage(e.message)
      } else {
        setProfileMessage('저장에 실패했습니다.')
      }
    } finally {
      setIsSaving(false)
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  const printStatusLabel: Record<NailTipPrintOrder['status'], string> = {
    queued: '출력 대기',
    printing: '출력 중',
    completed: '완료',
  }

  return (
      <AppShell mainClassName="mypage-v2">
        <section className="mypage-v2__profile">
          <div className="mypage-v2__avatar" aria-hidden="true">
            {profile?.nickname.charAt(0) ?? '?'}
          </div>
          <div className="mypage-v2__profile-body">
            <h1>{profile?.nickname ?? '-'}</h1>
            <p>{profile?.email ?? '-'}</p>
            <p className="mypage-v2__name">{profile?.name ?? '-'}</p>
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
                    현재 비밀번호
                    <input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="비밀번호 변경 시에만 입력"
                    />
                  </label>
                  <label>
                    새 비밀번호
                    <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
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
                    <button
                        type="button"
                        className="primary"
                        onClick={() => void handleSaveProfile()}
                        disabled={isSaving}
                    >
                      {isSaving ? '저장 중...' : '저장'}
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
            내 디자인
          </button>
          <button type="button" className={tab === 'prints' ? 'is-active' : ''} onClick={() => setTab('prints')}>
            출력 내역 ({nailTipPrints.length})
          </button>
          <button type="button" className={tab === 'favorites' ? 'is-active' : ''} onClick={() => setTab('favorites')}>
            찜 목록
          </button>
        </nav>

        {tab === 'designs' && (
            <section className="mypage-v2__grid">
              {isLoadingDesigns ? (
                  <p className="mypage-v2__empty">불러오는 중...</p>
              ) : designs.length === 0 ? (
                  <p className="mypage-v2__empty">아직 생성된 디자인이 없습니다.</p>
              ) : (
                  designs.map((design) => (
                      <article key={design.designId} className="mypage-v2__card">
                        <img src={design.imageUrl} alt="" />
                        <p>{new Date(design.createdAt).toLocaleDateString('ko-KR')}</p>
                      </article>
                  ))
              )}
            </section>
        )}

        {tab === 'prints' && (
            <section className="mypage-v2__list">
              {nailTipPrints.length === 0 ? (
                  <p className="mypage-v2__empty">출력 신청 내역이 없습니다.</p>
              ) : (
                  nailTipPrints.map((order) => (
                      <article key={order.id} className="mypage-v2__print-row">
                        <div className="mypage-v2__print-icon" aria-hidden="true">💅</div>
                        <div>
                          <p className="mypage-v2__print-shape">{order.shapeLabelKo} 네일팁</p>
                          <p className="mypage-v2__print-status">{printStatusLabel[order.status]}</p>
                          <p className="mypage-v2__print-date">{new Date(order.orderedAt).toLocaleString('ko-KR')}</p>
                        </div>
                      </article>
                  ))
              )}
            </section>
        )}

        {tab === 'favorites' && (
            <section className="mypage-v2__grid">
              {isLoadingFavorites ? (
                  <p className="mypage-v2__empty">불러오는 중...</p>
              ) : favorites.length === 0 ? (
                  <p className="mypage-v2__empty">찜한 디자인이 없습니다.</p>
              ) : (
                  favorites.map((item) => (
                      <article key={`${item.designId}-${item.imageUrl}`} className="mypage-v2__card">
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