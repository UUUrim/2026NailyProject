import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
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
import { ApiError, BASE_URL } from '@/utils/apiClient'
import '@/styles/mypage.css'

type SectionId = 'dashboard' | 'profile' | 'scans' | 'designs' | 'timeline' | 'favorites' | 'prints'

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

// ── 아이콘 (선 스타일로 통일) ────────────────────────────────────────────
const Icon = {
  home: (
      <svg viewBox="0 0 24 24" fill="none"><path d="M4 11.5 12 4l8 7.5M6 10v9h12v-9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  user: (
      <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.7" /><path d="M4.5 20c1.4-3.6 4.4-5.5 7.5-5.5s6.1 1.9 7.5 5.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
  ),
  hand: (
      <svg viewBox="0 0 24 24" fill="none"><path d="M8 12.5V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11.5V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6.5 7C6.7 20 5 17 5 14.2v-2a1.4 1.4 0 0 1 2.8 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  design: (
      <svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.7" /><path d="m8 14 2.5-3 2 2L16 9l2 2.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><circle cx="9" cy="9" r="1.1" fill="currentColor" /></svg>
  ),
  timeline: (
      <svg viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><circle cx="4" cy="6" r="1.6" fill="currentColor" /><circle cx="4" cy="12" r="1.6" fill="currentColor" /><circle cx="4" cy="18" r="1.6" fill="currentColor" /></svg>
  ),
  heart: (
      <svg viewBox="0 0 24 24" fill="none"><path d="M12 20s-7-4.35-9.5-8.8C.8 8 2 4.5 5.4 4a4.9 4.9 0 0 1 6.6 2 4.9 4.9 0 0 1 6.6-2c3.4.5 4.6 4 3.9 7.2C19 15.65 12 20 12 20z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
  ),
  print: (
      <svg viewBox="0 0 24 24" fill="none"><path d="M7 8V4h10v4M6 17h12a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><rect x="8" y="14" width="8" height="6" stroke="currentColor" strokeWidth="1.6" /></svg>
  ),
  logout: (
      <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M15 16l4-4-4-4M19 12H9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  chevron: (
      <svg viewBox="0 0 24 24" fill="none" width="16" height="16"><path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
}

const NAV_ITEMS: { id: SectionId; label: string; icon: keyof typeof Icon }[] = [
  { id: 'dashboard', label: '대시보드', icon: 'home' },
  { id: 'profile', label: '프로필', icon: 'user' },
  { id: 'timeline', label: '전체 활동 타임라인', icon: 'timeline' },
  { id: 'scans', label: '손 분석 결과 이력', icon: 'hand' },
  { id: 'designs', label: '네일 디자인 생성 이력', icon: 'design' },
  { id: 'favorites', label: '찜 목록', icon: 'heart' },
  { id: 'prints', label: '네일팁 출력 내역', icon: 'print' },
]

async function downloadImage(url: string, filename: string) {
  try {
    const token = localStorage.getItem('token')
    // 브라우저가 S3에 직접 fetch하면 CORS로 막히므로, 백엔드 다운로드 프록시를 거쳐서 받음
    const res = await fetch(`${BASE_URL}/designs/download-proxy?url=${encodeURIComponent(url)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error('다운로드 실패')
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
    alert('이미지 다운로드에 실패했어요. 잠시 후 다시 시도해 주세요.')
  }
}

// 백엔드가 주는 "yyyy. M. d." 형식이든 ISO 문자열이든 안전하게 Date로 변환
function parseDateFlexible(raw: string): Date | null {
  const dotMatch = raw.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/)
  if (dotMatch) {
    return new Date(Number(dotMatch[1]), Number(dotMatch[2]) - 1, Number(dotMatch[3]))
  }
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d
}

function dateKeyOf(raw: string): string {
  const d = parseDateFlexible(raw)
  if (!d) return 'unknown'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dateLabelOf(key: string): string {
  if (key === 'unknown') return '날짜 정보 없음'
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
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

  // ── 이미지 확대/축소/이동 ──────
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })

  const ZOOM_MIN = 1
  const ZOOM_MAX = 4
  const ZOOM_STEP = 0.5

  const openDetailImage = (img: DetailImage) => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setDetailImage(img)
  }

  const closeDetailImage = () => {
    setDetailImage(null)
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const handleZoomIn = () => setZoom((z) => Math.min(ZOOM_MAX, Number((z + ZOOM_STEP).toFixed(2))))
  const handleZoomOut = () =>
      setZoom((z) => {
        const next = Math.max(ZOOM_MIN, Number((z - ZOOM_STEP).toFixed(2)))
        if (next === ZOOM_MIN) setPan({ x: 0, y: 0 })
        return next
      })

  const handleImagePointerDown = (e: ReactMouseEvent<HTMLImageElement>) => {
    if (zoom <= ZOOM_MIN) return
    setIsDragging(true)
    dragStartRef.current.x = e.clientX
    dragStartRef.current.y = e.clientY
    dragStartRef.current.panX = pan.x
    dragStartRef.current.panY = pan.y
  }

  const handleImagePointerMove = (e: ReactMouseEvent<HTMLImageElement>) => {
    if (!isDragging) return
    const dx = e.clientX - dragStartRef.current.x
    const dy = e.clientY - dragStartRef.current.y
    setPan({ x: dragStartRef.current.panX + dx, y: dragStartRef.current.panY + dy })
  }

  const stopDragging = () => setIsDragging(false)

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

  // ── 전체 활동 타임라인: 손 스캔 + 디자인 생성 + 네일팁 출력을 날짜별로 통합 ──────
  const timelineGroups = useMemo(() => {
    const map = new Map<string, { scans: ScanHistoryItem[]; designs: DesignImageResponse[]; prints: NailTipPrintOrder[] }>()

    const ensure = (key: string) => {
      if (!map.has(key)) map.set(key, { scans: [], designs: [], prints: [] })
      return map.get(key)!
    }

    scans.forEach((s) => ensure(dateKeyOf(s.scannedAt)).scans.push(s))
    designs.forEach((d) => ensure(dateKeyOf(d.createdAt)).designs.push(d))
    prints.forEach((p) => ensure(dateKeyOf(p.orderedAt)).prints.push(p))

    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [scans, designs, prints])

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
                          openDetailImage({
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
                    <span className="mypage-x__card-zoom-hint">확대해서 보기</span>
                  </button>
                  <div className="mypage-x__card-footer">
                    <span className="mypage-x__card-date">{createdAt}</span>
                    <button
                        type="button"
                        className={`mypage-x__heart-btn${liked ? ' is-liked' : ''}`}
                        onClick={() => void toggleLikeFromGrid(item.designId, item.imageUrl)}
                        aria-label={liked ? '찜 해제' : '찜하기'}
                    >
                      {Icon.heart}
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
              <div className="mypage-x__sidebar-profile-text">
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
                    <span className="mypage-x__nav-icon" aria-hidden="true">{Icon[item.icon]}</span>
                    {item.label}
                    {section === item.id && <span className="mypage-x__nav-chevron" aria-hidden="true">{Icon.chevron}</span>}
                  </button>
              ))}
            </nav>

            <button type="button" className="mypage-x__logout" onClick={handleLogout}>
              <span aria-hidden="true">{Icon.logout}</span>
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
                      <span className="mypage-x__stat-icon">{Icon.hand}</span>
                      <span className="mypage-x__stat-value">{totalScanCount}</span>
                      <span className="mypage-x__stat-label">손 분석 결과</span>
                    </button>
                    <button type="button" className="mypage-x__stat-card" onClick={() => setSection('designs')}>
                      <span className="mypage-x__stat-icon">{Icon.design}</span>
                      <span className="mypage-x__stat-value">{totalDesignCount}</span>
                      <span className="mypage-x__stat-label">생성한 디자인</span>
                    </button>
                    <button type="button" className="mypage-x__stat-card" onClick={() => setSection('favorites')}>
                      <span className="mypage-x__stat-icon">{Icon.heart}</span>
                      <span className="mypage-x__stat-value">{totalFavoriteCount}</span>
                      <span className="mypage-x__stat-label">찜한 디자인</span>
                    </button>
                    <button type="button" className="mypage-x__stat-card" onClick={() => setSection('prints')}>
                      <span className="mypage-x__stat-icon">{Icon.print}</span>
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

                  <div className="mypage-x__section-header">
                    <h2 className="mypage-x__section-heading">최근 생성한 디자인</h2>
                    <button type="button" className="mypage-x__see-all" onClick={() => setSection('designs')}>
                      전체 보기 {Icon.chevron}
                    </button>
                  </div>
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
                  <p className="mypage-x__subtitle">닉네임과 비밀번호를 관리할 수 있어요.</p>
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
                  <p className="mypage-x__subtitle">지금까지 진행한 손 스캔 분석 결과를 모아봤어요.</p>
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
                  <p className="mypage-x__subtitle">지금까지 생성한 모든 디자인이에요. 클릭하면 확대해서 볼 수 있어요.</p>
                  {isLoading ? <p className="mypage-x__empty">불러오는 중...</p> : renderImageGrid(designs, false)}
                </section>
            )}

            {section === 'timeline' && (
                <section>
                  <h1 className="mypage-x__title">전체 활동 타임라인</h1>
                  <p className="mypage-x__subtitle">
                    손 촬영·분석부터 디자인 생성, 네일팁 출력까지 — 날짜별로 진행한 전체 과정을 한눈에 볼 수 있어요.
                  </p>
                  {isLoading ? (
                      <p className="mypage-x__empty">불러오는 중...</p>
                  ) : timelineGroups.length === 0 ? (
                      <p className="mypage-x__empty">아직 활동 기록이 없어요.</p>
                  ) : (
                      <div className="mypage-x__timeline">
                        {timelineGroups.map(([key, group]) => {
                          const total = group.scans.length + group.designs.length + group.prints.length
                          if (total === 0) return null
                          return (
                              <div key={key} className="mypage-x__timeline-day">
                                <div className="mypage-x__timeline-dot" aria-hidden="true" />
                                <div className="mypage-x__timeline-content">
                                  <h3 className="mypage-x__timeline-date">{dateLabelOf(key)}</h3>

                                  {group.scans.length > 0 && (
                                      <div className="mypage-x__timeline-block">
                                        <p className="mypage-x__timeline-block-title">
                                          {Icon.hand} 손 촬영 · 분석 <span>{group.scans.length}건</span>
                                        </p>
                                        <div className="mypage-x__scan-list">
                                          {group.scans.map((scan) => (
                                              <article key={scan.scanId} className="mypage-x__scan-row mypage-x__scan-row--compact">
                                                <span className="mypage-x__scan-hand" aria-hidden="true">
                                                  {scan.handSide === 'LEFT' ? 'L' : scan.handSide === 'RIGHT' ? 'R' : '?'}
                                                </span>
                                                <div className="mypage-x__scan-info">
                                                  <p className="mypage-x__scan-title">
                                                    {scan.seasonNameKo ?? '분석 중'} · {scan.shape ?? '분석 중'}
                                                  </p>
                                                </div>
                                                <span className={`mypage-x__badge mypage-x__badge--${(scan.status ?? '').toLowerCase()}`}>
                                                  {scan.status ?? '-'}
                                                </span>
                                              </article>
                                          ))}
                                        </div>
                                      </div>
                                  )}

                                  {group.designs.length > 0 && (
                                      <div className="mypage-x__timeline-block">
                                        <p className="mypage-x__timeline-block-title">
                                          {Icon.design} 디자인 생성 <span>{group.designs.length}건</span>
                                        </p>
                                        {renderImageGrid(group.designs, false)}
                                      </div>
                                  )}

                                  {group.prints.length > 0 && (
                                      <div className="mypage-x__timeline-block">
                                        <p className="mypage-x__timeline-block-title">
                                          {Icon.print} 네일팁 출력 <span>{group.prints.length}건</span>
                                        </p>
                                        <div className="mypage-x__print-list">
                                          {group.prints.map((order) => (
                                              <article key={order.id} className="mypage-x__print-row">
                                                <div className="mypage-x__print-icon" aria-hidden="true">{Icon.print}</div>
                                                <div>
                                                  <p className="mypage-x__print-shape">{order.shapeLabelKo} 네일팁</p>
                                                  <p className="mypage-x__print-date">
                                                    {new Date(order.orderedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                                                  </p>
                                                </div>
                                                <span className={`mypage-x__badge mypage-x__badge--${order.status}`}>
                                                  {PRINT_STATUS_LABEL[order.status]}
                                                </span>
                                              </article>
                                          ))}
                                        </div>
                                      </div>
                                  )}
                                </div>
                              </div>
                          )
                        })}
                      </div>
                  )}
                </section>
            )}

            {section === 'favorites' && (
                <section>
                  <h1 className="mypage-x__title">찜 목록</h1>
                  <p className="mypage-x__subtitle">마음에 들어서 찜해둔 디자인이에요.</p>
                  {isLoading ? <p className="mypage-x__empty">불러오는 중...</p> : renderImageGrid(favorites, true)}
                </section>
            )}

            {section === 'prints' && (
                <section>
                  <h1 className="mypage-x__title">네일팁 출력 내역</h1>
                  <p className="mypage-x__subtitle">3D 네일팁 제작을 신청한 내역이에요.</p>
                  {prints.length === 0 ? (
                      <p className="mypage-x__empty">출력 신청 내역이 없어요.</p>
                  ) : (
                      <div className="mypage-x__print-list">
                        {prints.map((order) => (
                            <article key={order.id} className="mypage-x__print-row">
                              <div className="mypage-x__print-icon" aria-hidden="true">{Icon.print}</div>
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
                  onClick={closeDetailImage}
              />
              <div className="mypage-x__modal-panel mypage-x__modal-panel--lg">
                <button
                    type="button"
                    className="mypage-x__modal-close"
                    onClick={closeDetailImage}
                    aria-label="닫기"
                >
                  ✕
                </button>

                <div
                    className={`mypage-x__modal-image-viewport${zoom > 1 ? ' is-zoomed' : ''}${isDragging ? ' is-dragging' : ''}`}
                    onMouseUp={stopDragging}
                    onMouseLeave={stopDragging}
                >
                  <img
                      src={detailImage.imageUrl}
                      alt="네일 디자인 확대"
                      className="mypage-x__modal-image"
                      draggable={false}
                      style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
                      onMouseDown={handleImagePointerDown}
                      onMouseMove={handleImagePointerMove}
                  />

                  <div className="mypage-x__modal-zoom-controls">
                    <button
                        type="button"
                        onClick={handleZoomOut}
                        disabled={zoom <= ZOOM_MIN}
                        aria-label="축소"
                    >
                      −
                    </button>
                    <span className="mypage-x__modal-zoom-value">{Math.round(zoom * 100)}%</span>
                    <button
                        type="button"
                        onClick={handleZoomIn}
                        disabled={zoom >= ZOOM_MAX}
                        aria-label="확대"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="mypage-x__modal-info">
                  {detailImage.createdAt && <p className="mypage-x__modal-date">{detailImage.createdAt}</p>}
                </div>
                <div className="mypage-x__modal-actions">
                  <button
                      type="button"
                      onClick={() => void downloadImage(detailImage.imageUrl, `naily-design-${Date.now()}.png`)}
                  >
                    이미지 저장
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