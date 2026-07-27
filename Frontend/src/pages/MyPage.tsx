import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { useAuth } from '@/hooks/useAuth'
import { getNailTipPrintOrders, type NailTipPrintOrder } from '@/utils/mypageStorage'
import { getMyProfile, updateNickname, updatePassword, type UserProfileResponse } from '@/apis/user'
import {
  getMyDesigns,
  getLikedDesigns,
  likeDesign,
  unlikeDesign,
  deleteDesign,
  type DesignImageResponse,
  type SavedDesignResponse,
} from '@/apis/design'
import { getMyScans, type ScanHistoryItem } from '@/apis/scan'
import { ApiError } from '@/utils/apiClient'
import '@/styles/mypage.css'

type SectionId = 'dashboard' | 'profile' | 'scans' | 'designs' | 'sessions' | 'favorites' | 'prints'

type DetailImage = {
  designId: number | null
  imageUrl: string
  createdAt?: string
  promptSummary?: string
  liked: boolean
  canDelete: boolean
  isFavoriteView: boolean
}

const PRINT_STATUS_LABEL: Record<NailTipPrintOrder['status'], string> = {
  queued: '출력 대기',
  printing: '출력 중',
  completed: '완료',
}

const NAV_ITEMS: { id: SectionId; label: string; icon: string }[] = [
  { id: 'dashboard', label: '대시보드', icon: '⌂' },
  { id: 'profile', label: '프로필', icon: '☺' },
  { id: 'scans', label: '손 분석 결과 이력', icon: '✋' },
  { id: 'designs', label: '네일 디자인 생성 이력', icon: '✎' },
  { id: 'sessions', label: '세션별 통합 보기', icon: '▤' },
  { id: 'favorites', label: '찜 목록', icon: '♥' },
  { id: 'prints', label: '네일팁 출력 내역', icon: '⛬' },
]

async function downloadImage(url: string, filename: string) {
  try {
    const res = await fetch(url, { mode: 'cors' })
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(objectUrl)
  } catch {
    // CORS 등으로 blob 다운로드가 막히면 새 탭에서 열기로 대체
    window.open(url, '_blank')
  }
}

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

  // ── 섹션 ───────
  const initialSection = (location.state as { tab?: SectionId } | null)?.tab ?? 'dashboard'
  const [section, setSection] = useState<SectionId>(initialSection)

  // ── 데이터 ──────
  const [designs, setDesigns] = useState<DesignImageResponse[]>([])
  const [favorites, setFavorites] = useState<SavedDesignResponse[]>([])
  const [scans, setScans] = useState<ScanHistoryItem[]>([])
  const [prints] = useState<NailTipPrintOrder[]>(getNailTipPrintOrders)
  const [isLoading, setIsLoading] = useState(true)

  const [detailImage, setDetailImage] = useState<DetailImage | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  // ── 초기 로딩 (전부 한 번에 불러와서 대시보드 집계에도 사용) ─────────
  useEffect(() => {
    getMyProfile()
        .then((data) => {
          setProfile(data)
          setNickname(data.nickname)
        })
        .catch(() => {})

    setIsLoading(true)
    Promise.allSettled([getMyDesigns(), getLikedDesigns(), getMyScans()]).then(
        ([designsRes, favoritesRes, scansRes]) => {
          if (designsRes.status === 'fulfilled') setDesigns(designsRes.value)
          if (favoritesRes.status === 'fulfilled') setFavorites(favoritesRes.value)
          if (scansRes.status === 'fulfilled') setScans(scansRes.value)
          setIsLoading(false)
        },
    )
  }, [])

  const likedKeySet = useMemo(
      () => new Set(favorites.map((f) => `${f.designId}-${f.imageUrl}`)),
      [favorites],
  )

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
      if (nickname.trim() && nickname !== profile?.nickname) {
        const updated = await updateNickname(nickname.trim())
        setProfile(updated)
      }
      if (newPassword && currentPassword) {
        await updatePassword(currentPassword, newPassword)
      }
      setEditing(false)
      setCurrentPassword('')
      setNewPassword('')
      setPasswordConfirm('')
      setProfileMessage('프로필이 저장되었습니다.')
    } catch (e) {
      setProfileMessage(e instanceof ApiError ? e.message : '저장에 실패했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  // ── 찜 토글 (그리드에서 바로) ─────────
  const toggleLikeFromGrid = async (designId: number, imageUrl: string) => {
    const key = `${designId}-${imageUrl}`
    const isLiked = likedKeySet.has(key)
    try {
      if (isLiked) {
        await unlikeDesign(designId, imageUrl)
        setFavorites((prev) => prev.filter((f) => !(f.designId === designId && f.imageUrl === imageUrl)))
      } else {
        await likeDesign(designId, imageUrl)
        setFavorites((prev) => [
          { designId, imageUrl, savedAt: new Date().toISOString(), folder: null },
          ...prev,
        ])
      }
    } catch (e) {
      alert(e instanceof ApiError ? e.message : '요청에 실패했습니다.')
    }
  }

  // ── 상세 모달 액션 ─────────
  const handleModalToggleLike = async () => {
    if (!detailImage || detailImage.designId == null || isBusy) return
    setIsBusy(true)
    try {
      await toggleLikeFromGrid(detailImage.designId, detailImage.imageUrl)
      setDetailImage({ ...detailImage, liked: !detailImage.liked })
    } finally {
      setIsBusy(false)
    }
  }

  const handleModalDelete = async () => {
    if (!detailImage || detailImage.designId == null || isBusy) return
    if (!window.confirm('이 디자인을 삭제할까요? 삭제하면 되돌릴 수 없어요.')) return
    setIsBusy(true)
    try {
      await deleteDesign(detailImage.designId)
      setDesigns((prev) => prev.filter((d) => d.designId !== detailImage.designId))
      setFavorites((prev) => prev.filter((f) => f.designId !== detailImage.designId))
      setDetailImage(null)
    } catch (e) {
      alert(e instanceof ApiError ? e.message : '삭제에 실패했습니다.')
    } finally {
      setIsBusy(false)
    }
  }

  const handleModalUnfavorite = async () => {
    if (!detailImage || detailImage.designId == null || isBusy) return
    setIsBusy(true)
    try {
      await unlikeDesign(detailImage.designId, detailImage.imageUrl)
      setFavorites((prev) =>
          prev.filter((f) => !(f.designId === detailImage.designId && f.imageUrl === detailImage.imageUrl)),
      )
      setDetailImage(null)
    } catch (e) {
      alert(e instanceof ApiError ? e.message : '요청에 실패했습니다.')
    } finally {
      setIsBusy(false)
    }
  }

  // ── 세션별 그룹핑 (디자인 생성 이력을 sessionId 기준으로) ─────────
  const sessionGroups = useMemo(() => {
    const map = new Map<string, DesignImageResponse[]>()
    for (const d of designs) {
      const key = d.sessionId != null ? String(d.sessionId) : '기타'
      const list = map.get(key) ?? []
      list.push(d)
      map.set(key, list)
    }
    return [...map.entries()]
  }, [designs])

  const renderImageGrid = (items: DesignImageResponse[] | SavedDesignResponse[], isFavoriteView: boolean) => {
    if (items.length === 0) {
      return <p className="mypage-x__empty">아직 데이터가 없어요.</p>
    }
    return (
        <div className="mypage-x__grid">
          {items.map((item) => {
            const key = `${item.designId}-${item.imageUrl}`
            const liked = likedKeySet.has(key)
            const createdAt = 'createdAt' in item ? item.createdAt : new Date(item.savedAt).toLocaleDateString('ko-KR')
            return (
                <article key={key} className="mypage-x__card">
                  <button
                      type="button"
                      className="mypage-x__card-image-btn"
                      onClick={() =>
                          setDetailImage({
                            designId: item.designId,
                            imageUrl: item.imageUrl,
                            createdAt,
                            promptSummary: 'promptSummary' in item ? item.promptSummary : undefined,
                            liked,
                            canDelete: !isFavoriteView,
                            isFavoriteView,
                          })
                      }
                  >
                    <img src={item.imageUrl} alt="네일 디자인" />
                  </button>
                  <div className="mypage-x__card-footer">
                    <span className="mypage-x__card-date">{createdAt}</span>
                    <button
                        type="button"
                        className={`mypage-x__heart-btn${liked ? ' is-liked' : ''}`}
                        onClick={() => void toggleLikeFromGrid(item.designId, item.imageUrl)}
                        aria-label={liked ? '찜 해제' : '찜하기'}
                    >
                      {liked ? '♥' : '♡'}
                    </button>
                  </div>
                </article>
            )
          })}
        </div>
    )
  }

  const totalDesignCount = designs.length
  const totalScanCount = scans.length
  const totalFavoriteCount = favorites.length
  const totalPrintCount = prints.length

  return (
      <AppShell mainClassName="mypage-x-page">
        <div className="mypage-x">
          {/* ── 왼쪽 사이드바 ───────────────────────────────────────── */}
          <aside className="mypage-x__sidebar">
            <div className="mypage-x__sidebar-profile">
              <div className="mypage-x__avatar" aria-hidden="true">
                {profile?.nickname.charAt(0) ?? '?'}
              </div>
              <div>
                <p className="mypage-x__sidebar-name">{profile?.nickname ?? '-'}</p>
                <p className="mypage-x__sidebar-email">{profile?.email ?? '-'}</p>
              </div>
            </div>

            <nav className="mypage-x__nav" aria-label="마이페이지 메뉴">
              {NAV_ITEMS.map((item) => (
                  <button
                      key={item.id}
                      type="button"
                      className={`mypage-x__nav-item${section === item.id ? ' is-active' : ''}`}
                      onClick={() => setSection(item.id)}
                  >
                    <span className="mypage-x__nav-icon" aria-hidden="true">{item.icon}</span>
                    {item.label}
                  </button>
              ))}
            </nav>

            <button type="button" className="mypage-x__logout" onClick={handleLogout}>
              로그아웃
            </button>
          </aside>

          {/* ── 메인 콘텐츠 ─────────────────────────────────────────── */}
          <main className="mypage-x__main">
            {section === 'dashboard' && (
                <section>
                  <h1 className="mypage-x__title">안녕하세요, {profile?.nickname ?? '회원'}님 👋</h1>
                  <p className="mypage-x__subtitle">지금까지의 네일리 활동을 한눈에 확인해보세요.</p>

                  <div className="mypage-x__stat-grid">
                    <button type="button" className="mypage-x__stat-card" onClick={() => setSection('scans')}>
                      <span className="mypage-x__stat-icon">✋</span>
                      <span className="mypage-x__stat-value">{totalScanCount}</span>
                      <span className="mypage-x__stat-label">손 분석 결과</span>
                    </button>
                    <button type="button" className="mypage-x__stat-card" onClick={() => setSection('designs')}>
                      <span className="mypage-x__stat-icon">✎</span>
                      <span className="mypage-x__stat-value">{totalDesignCount}</span>
                      <span className="mypage-x__stat-label">생성한 디자인</span>
                    </button>
                    <button type="button" className="mypage-x__stat-card" onClick={() => setSection('favorites')}>
                      <span className="mypage-x__stat-icon">♥</span>
                      <span className="mypage-x__stat-value">{totalFavoriteCount}</span>
                      <span className="mypage-x__stat-label">찜한 디자인</span>
                    </button>
                    <button type="button" className="mypage-x__stat-card" onClick={() => setSection('prints')}>
                      <span className="mypage-x__stat-icon">⛬</span>
                      <span className="mypage-x__stat-value">{totalPrintCount}</span>
                      <span className="mypage-x__stat-label">네일팁 출력 신청</span>
                    </button>
                  </div>

                  <div className="mypage-x__dashboard-actions">
                    <button type="button" className="mypage-x__cta" onClick={() => navigate('/scan/hand')}>
                      손 스캔하러 가기
                    </button>
                    <button type="button" className="mypage-x__cta mypage-x__cta--outline" onClick={() => navigate('/design/chat')}>
                      새 디자인 생성하기
                    </button>
                  </div>

                  <h2 className="mypage-x__section-heading">최근 생성한 디자인</h2>
                  {isLoading ? (
                      <p className="mypage-x__empty">불러오는 중...</p>
                  ) : (
                      renderImageGrid(designs.slice(0, 4), false)
                  )}
                </section>
            )}

            {section === 'profile' && (
                <section>
                  <h1 className="mypage-x__title">프로필</h1>
                  <div className="mypage-x__profile-card">
                    <div className="mypage-x__avatar mypage-x__avatar--lg" aria-hidden="true">
                      {profile?.nickname.charAt(0) ?? '?'}
                    </div>
                    <div className="mypage-x__profile-body">
                      {!editing ? (
                          <>
                            <h2>{profile?.nickname ?? '-'}</h2>
                            <p>{profile?.email ?? '-'}</p>
                            <p className="mypage-x__muted">{profile?.name ?? '-'}</p>
                            <button type="button" className="mypage-x__edit-btn" onClick={() => setEditing(true)}>
                              프로필 수정
                            </button>
                          </>
                      ) : (
                          <div className="mypage-x__edit-form">
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
                            <div className="mypage-x__edit-actions">
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
                      {profileMessage && <p className="mypage-x__message">{profileMessage}</p>}
                    </div>
                  </div>
                </section>
            )}

            {section === 'scans' && (
                <section>
                  <h1 className="mypage-x__title">손 분석 결과 이력</h1>
                  {isLoading ? (
                      <p className="mypage-x__empty">불러오는 중...</p>
                  ) : scans.length === 0 ? (
                      <p className="mypage-x__empty">아직 손 스캔 이력이 없어요.</p>
                  ) : (
                      <div className="mypage-x__scan-list">
                        {scans.map((scan) => (
                            <article key={scan.scanId} className="mypage-x__scan-row">
                              <span className="mypage-x__scan-hand" aria-hidden="true">
                                {scan.handSide === 'LEFT' ? 'L' : scan.handSide === 'RIGHT' ? 'R' : '?'}
                              </span>
                              <div className="mypage-x__scan-info">
                                <p className="mypage-x__scan-title">
                                  {scan.seasonNameKo ?? '분석 중'} · {scan.shape ?? '분석 중'}
                                </p>
                                <p className="mypage-x__scan-date">{scan.scannedAt}</p>
                              </div>
                              <span className={`mypage-x__badge mypage-x__badge--${(scan.status ?? '').toLowerCase()}`}>
                                {scan.status ?? '-'}
                              </span>
                            </article>
                        ))}
                      </div>
                  )}
                </section>
            )}

            {section === 'designs' && (
                <section>
                  <h1 className="mypage-x__title">네일 디자인 생성 이력</h1>
                  {isLoading ? <p className="mypage-x__empty">불러오는 중...</p> : renderImageGrid(designs, false)}
                </section>
            )}

            {section === 'sessions' && (
                <section>
                  <h1 className="mypage-x__title">세션별 통합 보기</h1>
                  <p className="mypage-x__subtitle">
                    한 번의 디자인 생성 대화(세션)에서 만들어진 디자인들을 모아 보여줘요. 손 분석·출력 내역은 세션과
                    별개로 기록되어 각각의 탭에서 확인할 수 있어요.
                  </p>
                  {isLoading ? (
                      <p className="mypage-x__empty">불러오는 중...</p>
                  ) : sessionGroups.length === 0 ? (
                      <p className="mypage-x__empty">아직 생성된 디자인이 없어요.</p>
                  ) : (
                      sessionGroups.map(([sessionKey, items]) => (
                          <div key={sessionKey} className="mypage-x__session-group">
                            <h3 className="mypage-x__session-heading">
                              {sessionKey === '기타' ? '세션 정보 없음' : `세션 #${sessionKey}`}
                              <span className="mypage-x__session-date">{items[0]?.createdAt}</span>
                            </h3>
                            {renderImageGrid(items, false)}
                          </div>
                      ))
                  )}
                </section>
            )}

            {section === 'favorites' && (
                <section>
                  <h1 className="mypage-x__title">찜 목록</h1>
                  {isLoading ? <p className="mypage-x__empty">불러오는 중...</p> : renderImageGrid(favorites, true)}
                </section>
            )}

            {section === 'prints' && (
                <section>
                  <h1 className="mypage-x__title">네일팁 출력 내역</h1>
                  {prints.length === 0 ? (
                      <p className="mypage-x__empty">출력 신청 내역이 없어요.</p>
                  ) : (
                      <div className="mypage-x__print-list">
                        {prints.map((order) => (
                            <article key={order.id} className="mypage-x__print-row">
                              <div className="mypage-x__print-icon" aria-hidden="true">💅</div>
                              <div>
                                <p className="mypage-x__print-shape">{order.shapeLabelKo} 네일팁</p>
                                <p className="mypage-x__print-date">{new Date(order.orderedAt).toLocaleString('ko-KR')}</p>
                              </div>
                              <span className={`mypage-x__badge mypage-x__badge--${order.status}`}>
                                {PRINT_STATUS_LABEL[order.status]}
                              </span>
                            </article>
                        ))}
                      </div>
                  )}
                </section>
            )}
          </main>
        </div>

        {/* ── 이미지 상세 모달 ───────────────────────────────────────── */}
        {detailImage && (
            <div className="mypage-x__modal" role="dialog" aria-modal="true">
              <button
                  type="button"
                  className="mypage-x__modal-backdrop"
                  aria-label="닫기"
                  onClick={() => setDetailImage(null)}
              />
              <div className="mypage-x__modal-panel">
                <button
                    type="button"
                    className="mypage-x__modal-close"
                    onClick={() => setDetailImage(null)}
                    aria-label="닫기"
                >
                  ✕
                </button>
                <img src={detailImage.imageUrl} alt="네일 디자인 확대" className="mypage-x__modal-image" />
                <div className="mypage-x__modal-info">
                  {detailImage.createdAt && <p className="mypage-x__modal-date">{detailImage.createdAt}</p>}
                  {detailImage.promptSummary && (
                      <p className="mypage-x__modal-prompt">{detailImage.promptSummary}</p>
                  )}
                </div>
                <div className="mypage-x__modal-actions">
                  <button
                      type="button"
                      onClick={() => void downloadImage(detailImage.imageUrl, `naily-design-${Date.now()}.png`)}
                  >
                    로컬에 저장
                  </button>
                  <button
                      type="button"
                      className={detailImage.liked ? 'is-active' : ''}
                      onClick={() => void handleModalToggleLike()}
                      disabled={isBusy || detailImage.designId == null}
                  >
                    {detailImage.liked ? '♥ 찜 해제' : '♡ 찜하기'}
                  </button>
                  {detailImage.isFavoriteView ? (
                      <button type="button" className="danger" onClick={() => void handleModalUnfavorite()} disabled={isBusy}>
                        찜 목록에서 제거
                      </button>
                  ) : (
                      detailImage.canDelete && (
                          <button type="button" className="danger" onClick={() => void handleModalDelete()} disabled={isBusy}>
                            이미지 삭제
                          </button>
                      )
                  )}
                </div>
              </div>
            </div>
        )}
      </AppShell>
  )
}