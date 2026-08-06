import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { NailArTryOnModal } from '@/components/ar/NailArTryOnModal'
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
import { getMyScans, getScanResult, type ScanHistoryItem, type ScanResultResponse } from '@/apis/scan'
import { getNailShape } from '@/constants/nailShapes'
import { SHAPE_PREVIEW_IMAGES } from '@/constants/designPreferences'
import { ApiError } from '@/utils/apiClient'
import { downloadImage } from '@/utils/downloadImage'
import '@/styles/mypage.css'

type SectionId = 'dashboard' | 'profile' | 'timeline' | 'scans' | 'prints' | 'designs' | 'favorites'

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

// 손 스캔 상태값을 사용자가 이해할 수 있는 한글 문구로
const SCAN_STATUS_LABEL: Record<string, string> = {
  READY: '분석 대기 중',
  ANALYZING: '분석 진행 중',
  MEASURED: '분석 완료',
  GENERATING_STL: '네일팁 제작 중',
  COMPLETED: '분석 완료',
  FAILED: '분석 실패',
}

// 한 번의 촬영에서 나온 왼손/오른손 스캔 기록을 하나로 묶은 단위
type ScanSession = {
  key: string
  scannedAt: string
  leftScanId: number | null
  rightScanId: number | null
  seasonNameKo: string | null
  shape: string | null
  status: string | null
}

type FingerStat = { label: string; lengthMm: number; widthMm: number; cCurve: number }

type ScanDetail = {
  scannedAt: string
  seasonNameKo: string | null
  shapeId: string | null
  avgLength: number
  avgWidth: number
  avgCurve: number
  fingers: FingerStat[]
  comment: string
}

const FINGER_LABEL_KO: Record<string, string> = {
  THUMB: '엄지',
  INDEX: '검지',
  MIDDLE: '중지',
  RING: '약지',
  PINKY: '소지',
}

function parseFingerMeasurements(measurements: string | null | undefined) {
  try {
    const m = JSON.parse(measurements ?? '{}') as {
      lengthMm?: number
      length?: number
      widthMm?: number
      width?: number
      cCurve?: number
      curve?: number
    }
    return {
      lengthMm: Number(m.lengthMm ?? m.length ?? 12),
      widthMm: Number(m.widthMm ?? m.width ?? 9),
      cCurve: Number(m.cCurve ?? m.curve ?? 0.55),
    }
  } catch {
    return { lengthMm: 12, widthMm: 9, cCurve: 0.55 }
  }
}

function buildScanDetail(left: ScanResultResponse | null, right: ScanResultResponse | null): ScanDetail {
  const fingers: FingerStat[] = [
    ...(left?.fingers ?? []).map((f) => ({
      label: `${FINGER_LABEL_KO[f.finger] ?? f.finger}(L)`,
      ...parseFingerMeasurements(f.measurements),
    })),
    ...(right?.fingers ?? []).map((f) => ({
      label: `${FINGER_LABEL_KO[f.finger] ?? f.finger}(R)`,
      ...parseFingerMeasurements(f.measurements),
    })),
  ]

  const avg = (nums: number[]) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0)
  const avgLength = Number(avg(fingers.map((f) => f.lengthMm)).toFixed(1))
  const avgWidth = Number(avg(fingers.map((f) => f.widthMm)).toFixed(1))
  const avgCurve = Number(avg(fingers.map((f) => f.cCurve)).toFixed(2))

  const isLong = avgLength >= 12.5
  const isNarrow = avgWidth <= 10
  const isLowCurve = avgCurve <= 0.55

  return {
    scannedAt: left?.scannedAt ?? right?.scannedAt ?? '',
    seasonNameKo: left?.seasonNameKo || right?.seasonNameKo || null,
    shapeId: left?.shape || right?.shape || null,
    avgLength,
    avgWidth,
    avgCurve,
    fingers,
    comment: `평균보다 손톱이 ${isLong ? '긴' : '짧은'} 편이고, ${isNarrow ? '좁은' : '넓은'} 편이에요. 곡률(C-curve)은 ${isLowCurve ? '완만한' : '뚜렷한'} 편입니다.`,
  }
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

type NavItem = { id: SectionId; label: string; icon: keyof typeof Icon }

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: '홈',
    items: [{ id: 'dashboard', label: '대시보드', icon: 'home' }],
  },
  {
    label: '내 기록',
    items: [
      { id: 'timeline', label: '활동 타임라인', icon: 'timeline' },
      { id: 'scans', label: '손 분석', icon: 'hand' },
      { id: 'prints', label: '네일팁 출력', icon: 'print' },
      { id: 'designs', label: '디자인', icon: 'design' },
      { id: 'favorites', label: '찜 목록', icon: 'heart' },
    ],
  },
  {
    label: '계정',
    items: [{ id: 'profile', label: '프로필 설정', icon: 'user' }],
  },
]

const SECTION_META: Record<SectionId, { title: string; subtitle: string }> = {
  dashboard: {
    title: '대시보드',
    subtitle: '지금까지의 네일리 활동을 한눈에 확인해보세요.',
  },
  profile: {
    title: '프로필 설정',
    subtitle: '닉네임과 비밀번호를 관리할 수 있어요.',
  },
  timeline: {
    title: '활동 타임라인',
    subtitle: '손 촬영·분석, 네일팁 출력, 디자인 생성까지 날짜별로 모아봤어요.',
  },
  scans: {
    title: '손 분석 이력',
    subtitle: '진행한 손 스캔 분석 결과예요. 항목을 누르면 상세 결과를 볼 수 있어요.',
  },
  designs: {
    title: '디자인 이력',
    subtitle: '생성한 모든 네일 디자인이에요. 이미지를 눌러 확대·저장·AR 미리보기가 가능해요.',
  },
  prints: {
    title: '네일팁 출력 내역',
    subtitle: '3D 네일팁 제작 신청 내역이에요. 어떤 분석 결과를 바탕으로 신청했는지 확인할 수 있어요.',
  },
  favorites: {
    title: '찜 목록',
    subtitle: '마음에 들어 찜해 둔 디자인만 모아뒀어요.',
  },
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
  const [arTryOnImageUrl, setArTryOnImageUrl] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  // ── 이미지 확대/축소/이동 ──────
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const imageViewportRef = useRef<HTMLDivElement | null>(null)

  const ZOOM_MIN = 1
  const ZOOM_MAX = 4

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

  const WHEEL_ZOOM_SENSITIVITY = 0.0015

  // 마우스 휠로 확대/축소 (passive 리스너에서는 preventDefault가 무시되므로
  // 네이티브 이벤트 리스너를 { passive: false }로 직접 등록한다)
  useEffect(() => {
    const viewport = imageViewportRef.current
    if (!viewport || !detailImage) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setZoom((z) => {
        const next = Math.min(
            ZOOM_MAX,
            Math.max(ZOOM_MIN, Number((z - e.deltaY * WHEEL_ZOOM_SENSITIVITY).toFixed(2))),
        )
        if (next === ZOOM_MIN) setPan({ x: 0, y: 0 })
        return next
      })
    }

    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [detailImage])

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

  // 한 번의 촬영에서 나온 왼손/오른손 기록을 하나의 세션으로 묶음
  // (같은 세션이면 촬영 시각이 서로 가까움 — 90분 이내면 같은 세션으로 판단)
  const scanSessions = useMemo<ScanSession[]>(() => {
    const sorted = [...scans].sort(
        (a, b) => (parseDateFlexible(b.scannedAt)?.getTime() ?? 0) - (parseDateFlexible(a.scannedAt)?.getTime() ?? 0),
    )
    const used = new Set<number>()
    const sessions: ScanSession[] = []

    sorted.forEach((scan, i) => {
      if (used.has(scan.scanId)) return
      used.add(scan.scanId)

      const scanTime = parseDateFlexible(scan.scannedAt)?.getTime() ?? 0
      const partner = sorted.find((other, j) => {
        if (j === i || used.has(other.scanId) || other.handSide === scan.handSide) return false
        const otherTime = parseDateFlexible(other.scannedAt)?.getTime() ?? 0
        return Math.abs(otherTime - scanTime) < 90 * 60 * 1000
      })
      if (partner) used.add(partner.scanId)

      const left = scan.handSide === 'LEFT' ? scan : partner?.handSide === 'LEFT' ? partner : null
      const right = scan.handSide === 'RIGHT' ? scan : partner?.handSide === 'RIGHT' ? partner : null

      sessions.push({
        key: `${scan.scanId}-${partner?.scanId ?? 'solo'}`,
        scannedAt: scan.scannedAt,
        leftScanId: left?.scanId ?? null,
        rightScanId: right?.scanId ?? null,
        seasonNameKo: left?.seasonNameKo ?? right?.seasonNameKo ?? null,
        shape: left?.shape ?? right?.shape ?? null,
        status: left?.status ?? right?.status ?? scan.status,
      })
    })

    return sessions
  }, [scans])

  // ── 손 분석 세션 상세 모달 ──────
  const [scanDetailSession, setScanDetailSession] = useState<ScanSession | null>(null)
  const [scanDetail, setScanDetail] = useState<ScanDetail | null>(null)
  const [isLoadingScanDetail, setIsLoadingScanDetail] = useState(false)

  const openScanDetail = async (session: ScanSession) => {
    setScanDetailSession(session)
    setScanDetail(null)
    setIsLoadingScanDetail(true)
    try {
      const [left, right] = await Promise.all([
        session.leftScanId ? getScanResult(session.leftScanId).catch(() => null) : Promise.resolve(null),
        session.rightScanId ? getScanResult(session.rightScanId).catch(() => null) : Promise.resolve(null),
      ])
      setScanDetail(buildScanDetail(left, right))
    } finally {
      setIsLoadingScanDetail(false)
    }
  }

  // ── 네일팁 출력 상세 모달 ──────
  const [printDetailOrder, setPrintDetailOrder] = useState<NailTipPrintOrder | null>(null)
  const [printDetailScan, setPrintDetailScan] = useState<ScanDetail | null>(null)
  const [isLoadingPrintDetail, setIsLoadingPrintDetail] = useState(false)

  const openPrintDetail = async (order: NailTipPrintOrder) => {
    setPrintDetailOrder(order)
    setPrintDetailScan(null)
    if (!order.leftScanId && !order.rightScanId) return
    setIsLoadingPrintDetail(true)
    try {
      const [left, right] = await Promise.all([
        order.leftScanId ? getScanResult(order.leftScanId).catch(() => null) : Promise.resolve(null),
        order.rightScanId ? getScanResult(order.rightScanId).catch(() => null) : Promise.resolve(null),
      ])
      setPrintDetailScan(buildScanDetail(left, right))
    } finally {
      setIsLoadingPrintDetail(false)
    }
  }

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
    const map = new Map<string, { scans: ScanSession[]; designs: DesignImageResponse[]; prints: NailTipPrintOrder[] }>()

    const ensure = (key: string) => {
      if (!map.has(key)) map.set(key, { scans: [], designs: [], prints: [] })
      return map.get(key)!
    }

    scanSessions.forEach((s) => ensure(dateKeyOf(s.scannedAt)).scans.push(s))
    designs.forEach((d) => ensure(dateKeyOf(d.createdAt)).designs.push(d))
    prints.forEach((p) => ensure(dateKeyOf(p.orderedAt)).prints.push(p))

    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [scanSessions, designs, prints])

  const renderScanSessionRow = (session: ScanSession, compact = false) => {
    const hasResult = Boolean(session.seasonNameKo && session.shape)
    const shapeLabel = session.shape ? getNailShape(session.shape)?.labelKo ?? session.shape : null
    const handLabel = session.leftScanId && session.rightScanId ? '양손' : session.leftScanId ? '왼손' : '오른손'

    return (
        <button
            key={session.key}
            type="button"
            className={`mypage-x__scan-row${compact ? ' mypage-x__scan-row--compact' : ''}`}
            onClick={() => void openScanDetail(session)}
        >
          <span className="mypage-x__scan-hand" aria-hidden="true">{handLabel.charAt(0)}</span>
          <div className="mypage-x__scan-info">
            {hasResult ? (
                <p className="mypage-x__scan-title">
                  {session.seasonNameKo} · {shapeLabel} 추천
                </p>
            ) : (
                <p className="mypage-x__scan-title mypage-x__scan-title--pending">
                  {SCAN_STATUS_LABEL[session.status ?? ''] ?? '분석 결과를 기다리고 있어요'}
                </p>
            )}
            {!compact && <p className="mypage-x__scan-date">{handLabel} 촬영 · {session.scannedAt}</p>}
          </div>
          <span className={`mypage-x__badge mypage-x__badge--${(session.status ?? '').toLowerCase()}`}>
            {SCAN_STATUS_LABEL[session.status ?? ''] ?? session.status ?? '-'}
          </span>
        </button>
    )
  }

  const totalDesignCount = designs.length
  const totalScanCount = scanSessions.length
  const totalFavoriteCount = favorites.length
  const totalPrintCount = prints.length

  const getNavCount = (id: SectionId): number | null => {
    switch (id) {
      case 'scans':
        return totalScanCount || null
      case 'designs':
        return totalDesignCount || null
      case 'prints':
        return totalPrintCount || null
      case 'favorites':
        return totalFavoriteCount || null
      default:
        return null
    }
  }

  const renderPageHeader = (id: SectionId) => {
    const meta = SECTION_META[id]
    return (
        <header className="mypage-x__page-header">
          <p className="mypage-x__page-eyebrow">My Naily</p>
          <h1 className="mypage-x__title">{meta.title}</h1>
          <p className="mypage-x__subtitle">{meta.subtitle}</p>
        </header>
    )
  }

  const renderEmptyState = ({
    icon,
    title,
    description,
    actionLabel,
    onAction,
  }: {
    icon: keyof typeof Icon
    title: string
    description: string
    actionLabel?: string
    onAction?: () => void
  }) => (
      <div className="mypage-x__empty-state">
        <span className="mypage-x__empty-icon" aria-hidden="true">{Icon[icon]}</span>
        <p className="mypage-x__empty-title">{title}</p>
        <p className="mypage-x__empty-desc">{description}</p>
        {actionLabel && onAction && (
            <button type="button" className="mypage-x__cta" onClick={onAction}>
              {actionLabel}
            </button>
        )}
      </div>
  )

  const renderImageGrid = (
    items: DesignImageResponse[] | SavedDesignResponse[],
    isFavoriteView: boolean,
    empty?: { title: string; description: string; actionLabel?: string; onAction?: () => void },
  ) => {
    if (items.length === 0) {
      if (empty) {
        return renderEmptyState({
          icon: isFavoriteView ? 'heart' : 'design',
          ...empty,
        })
      }
      return renderEmptyState({
        icon: 'design',
        title: '아직 디자인이 없어요',
        description: 'AI와 함께 첫 네일 디자인을 만들어보세요.',
        actionLabel: '디자인 만들기',
        onAction: () => navigate('/design/chat'),
      })
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
              {NAV_GROUPS.map((group) => (
                  <div key={group.label} className="mypage-x__nav-group">
                    <p className="mypage-x__nav-group-label">{group.label}</p>
                    {group.items.map((item) => {
                      const count = getNavCount(item.id)
                      return (
                          <button
                              key={item.id}
                              type="button"
                              className={`mypage-x__nav-item${section === item.id ? ' is-active' : ''}`}
                              onClick={() => setSection(item.id)}
                          >
                            <span className="mypage-x__nav-icon" aria-hidden="true">{Icon[item.icon]}</span>
                            <span className="mypage-x__nav-label">{item.label}</span>
                            {count != null && (
                                <span className="mypage-x__nav-badge">{count}</span>
                            )}
                            {section === item.id && (
                                <span className="mypage-x__nav-chevron" aria-hidden="true">{Icon.chevron}</span>
                            )}
                          </button>
                      )
                    })}
                  </div>
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
                <section className="mypage-x__panel">
                  <div className="mypage-x__hero">
                    <div className="mypage-x__hero-copy">
                      <p className="mypage-x__hero-eyebrow">Welcome back</p>
                      <h1 className="mypage-x__hero-title">
                        {profile?.nickname ?? '회원'} 님,<br />
                        오늘도 네일리와 함께해요!
                      </h1>
                      <p className="mypage-x__hero-desc">
                        손 분석부터 네일팁 출력, 디자인까지 — 내 네일 여정을 한곳에서 관리하세요.
                      </p>
                    </div>
                    {/*<div className="mypage-x__hero-actions">*/}
                    {/*  <button type="button" className="mypage-x__cta" onClick={() => navigate('/scan/hand')}>*/}
                    {/*    손 스캔하기*/}
                    {/*  </button>*/}
                    {/*  <button*/}
                    {/*      type="button"*/}
                    {/*      className="mypage-x__cta mypage-x__cta--outline"*/}
                    {/*      onClick={() => navigate('/design/chat')}*/}
                    {/*  >*/}
                    {/*    디자인 만들기*/}
                    {/*  </button>*/}
                    {/*</div>*/}
                  </div>

                  <div className="mypage-x__stat-grid">
                    <button type="button" className="mypage-x__stat-card" onClick={() => setSection('scans')}>
                      <span className="mypage-x__stat-icon">{Icon.hand}</span>
                      <span className="mypage-x__stat-value">{totalScanCount}</span>
                      <span className="mypage-x__stat-label">손 분석</span>
                    </button>
                    <button type="button" className="mypage-x__stat-card" onClick={() => setSection('prints')}>
                      <span className="mypage-x__stat-icon">{Icon.print}</span>
                      <span className="mypage-x__stat-value">{totalPrintCount}</span>
                      <span className="mypage-x__stat-label">네일팁 출력</span>
                    </button>
                    <button type="button" className="mypage-x__stat-card" onClick={() => setSection('designs')}>
                      <span className="mypage-x__stat-icon">{Icon.design}</span>
                      <span className="mypage-x__stat-value">{totalDesignCount}</span>
                      <span className="mypage-x__stat-label">생성 디자인</span>
                    </button>
                    <button type="button" className="mypage-x__stat-card" onClick={() => setSection('favorites')}>
                      <span className="mypage-x__stat-icon">{Icon.heart}</span>
                      <span className="mypage-x__stat-value">{totalFavoriteCount}</span>
                      <span className="mypage-x__stat-label">찜한 디자인</span>
                    </button>
                  </div>

                  <div className="mypage-x__section-header">
                    <h2 className="mypage-x__section-heading">최근 디자인</h2>
                    <button type="button" className="mypage-x__see-all" onClick={() => setSection('designs')}>
                      전체 보기 {Icon.chevron}
                    </button>
                  </div>
                  {isLoading ? (
                      <p className="mypage-x__loading">불러오는 중...</p>
                  ) : (
                      renderImageGrid(designs.slice(0, 4), false, {
                        title: '아직 생성한 디자인이 없어요',
                        description: 'AI와 대화하며 첫 네일 디자인을 만들어보세요.',
                        actionLabel: '디자인 만들기',
                        onAction: () => navigate('/design/chat'),
                      })
                  )}
                </section>
            )}

            {section === 'profile' && (
                <section className="mypage-x__panel">
                  {renderPageHeader('profile')}
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
                <section className="mypage-x__panel">
                  {renderPageHeader('scans')}
                  {isLoading ? (
                      <p className="mypage-x__loading">불러오는 중...</p>
                  ) : scanSessions.length === 0 ? (
                      renderEmptyState({
                        icon: 'hand',
                        title: '손 분석 이력이 없어요',
                        description: '손을 스캔하면 퍼스널컬러와 맞춤 네일팁 쉐입을 추천해드려요.',
                        actionLabel: '손 스캔하기',
                        onAction: () => navigate('/scan/hand'),
                      })
                  ) : (
                      <div className="mypage-x__scan-list">
                        {scanSessions.map((session) => renderScanSessionRow(session))}
                      </div>
                  )}
                </section>
            )}

            {section === 'designs' && (
                <section className="mypage-x__panel">
                  {renderPageHeader('designs')}
                  {isLoading ? (
                      <p className="mypage-x__loading">불러오는 중...</p>
                  ) : (
                      renderImageGrid(designs, false)
                  )}
                </section>
            )}

            {section === 'timeline' && (
                <section className="mypage-x__panel">
                  {renderPageHeader('timeline')}
                  {isLoading ? (
                      <p className="mypage-x__loading">불러오는 중...</p>
                  ) : timelineGroups.length === 0 ? (
                      renderEmptyState({
                        icon: 'timeline',
                        title: '아직 활동 기록이 없어요',
                        description: '손 스캔이나 디자인 생성을 시작하면 여기에 타임라인으로 모여요.',
                        actionLabel: '손 스캔하기',
                        onAction: () => navigate('/scan/hand'),
                      })
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
                                          {group.scans.map((session) => renderScanSessionRow(session, true))}
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
                <section className="mypage-x__panel">
                  {renderPageHeader('favorites')}
                  {isLoading ? (
                      <p className="mypage-x__loading">불러오는 중...</p>
                  ) : (
                      renderImageGrid(favorites, true, {
                        title: '찜한 디자인이 없어요',
                        description: '마음에 드는 디자인에 ♥를 눌러 모아보세요.',
                        actionLabel: '디자인 둘러보기',
                        onAction: () => setSection('designs'),
                      })
                  )}
                </section>
            )}

            {section === 'prints' && (
                <section className="mypage-x__panel">
                  {renderPageHeader('prints')}
                  {prints.length === 0 ? (
                      renderEmptyState({
                        icon: 'print',
                        title: '출력 신청 내역이 없어요',
                        description: '손 분석 후 맞춤 네일팁 3D 출력을 신청할 수 있어요.',
                        actionLabel: '손 스캔하기',
                        onAction: () => navigate('/scan/hand'),
                      })
                  ) : (
                      <div className="mypage-x__print-list">
                        {prints.map((order) => (
                            <button
                                key={order.id}
                                type="button"
                                className="mypage-x__print-row"
                                onClick={() => void openPrintDetail(order)}
                            >
                              <div className="mypage-x__print-icon" aria-hidden="true">
                                {SHAPE_PREVIEW_IMAGES[order.shapeId] ? (
                                    <img src={SHAPE_PREVIEW_IMAGES[order.shapeId]} alt="" />
                                ) : (
                                    Icon.print
                                )}
                              </div>
                              <div>
                                <p className="mypage-x__print-shape">{order.shapeLabelKo} 쉐입 네일팁 10개 출력</p>
                                <p className="mypage-x__print-date">{new Date(order.orderedAt).toLocaleString('ko-KR')}</p>
                              </div>
                              <span className={`mypage-x__badge mypage-x__badge--${order.status}`}>
                                {PRINT_STATUS_LABEL[order.status]}
                              </span>
                            </button>
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
                    ref={imageViewportRef}
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
                    <span className="mypage-x__modal-zoom-value">{Math.round(zoom * 100)}%</span>
                  </div>
                </div>

                <div className="mypage-x__modal-info">
                  {detailImage.createdAt && <p className="mypage-x__modal-date">{detailImage.createdAt}</p>}
                </div>
                <div className="mypage-x__modal-actions">
                  <button
                      type="button"
                      className="mypage-x__modal-action--accent"
                      onClick={() => setArTryOnImageUrl(detailImage.imageUrl)}
                  >
                    AR로 미리보기
                  </button>
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

        {arTryOnImageUrl && (
            <NailArTryOnModal
                imageUrl={arTryOnImageUrl}
                onClose={() => setArTryOnImageUrl(null)}
            />
        )}

        {/* ── 손 분석 결과 상세 모달 ───────────────────────────────────── */}
        {scanDetailSession && (
            <div className="mypage-x__modal" role="dialog" aria-modal="true">
              <button
                  type="button"
                  className="mypage-x__modal-backdrop"
                  aria-label="닫기"
                  onClick={() => setScanDetailSession(null)}
              />
              <div className="mypage-x__modal-panel mypage-x__scan-detail-panel">
                <button
                    type="button"
                    className="mypage-x__modal-close"
                    onClick={() => setScanDetailSession(null)}
                    aria-label="닫기"
                >
                  ✕
                </button>

                {isLoadingScanDetail || !scanDetail ? (
                    <p className="mypage-x__empty">분석 결과를 불러오는 중...</p>
                ) : (
                    <>
                      <p className="mypage-x__scan-detail-heading">
                        <strong>{dateLabelOf(dateKeyOf(scanDetail.scannedAt))}</strong>에 스캔했던{' '}
                        <strong>{profile?.nickname ?? '회원'}</strong>님의 손 분석 결과입니다.
                      </p>

                      <div className="mypage-x__scan-detail-summary">
                        <div className="mypage-x__scan-detail-summary-item">
                          <span className="mypage-x__scan-detail-summary-label">퍼스널컬러</span>
                          <span className="mypage-x__scan-detail-summary-value">{scanDetail.seasonNameKo ?? '분석 결과 없음'}</span>
                        </div>
                        <div className="mypage-x__scan-detail-summary-item">
                          {scanDetail.shapeId && SHAPE_PREVIEW_IMAGES[scanDetail.shapeId] && (
                              <img
                                  src={SHAPE_PREVIEW_IMAGES[scanDetail.shapeId]}
                                  alt=""
                                  className="mypage-x__scan-detail-shape-img"
                              />
                          )}
                          <span className="mypage-x__scan-detail-summary-label">추천 네일팁 모양</span>
                          <span className="mypage-x__scan-detail-summary-value">
                            {scanDetail.shapeId ? getNailShape(scanDetail.shapeId)?.labelKo ?? scanDetail.shapeId : '분석 결과 없음'}
                          </span>
                        </div>
                      </div>

                      <div className="mypage-x__scan-detail-metrics">
                        <div className="mypage-x__scan-detail-metric">
                          <span>평균 길이</span>
                          <strong>{scanDetail.avgLength}mm</strong>
                        </div>
                        <div className="mypage-x__scan-detail-metric">
                          <span>평균 너비</span>
                          <strong>{scanDetail.avgWidth}mm</strong>
                        </div>
                        <div className="mypage-x__scan-detail-metric">
                          <span>평균 곡률 (C-curve)</span>
                          <strong>{scanDetail.avgCurve}</strong>
                        </div>
                      </div>
                      <p className="mypage-x__scan-detail-comment">{scanDetail.comment}</p>

                      {scanDetail.fingers.length > 0 && (
                          <div className="mypage-x__scan-detail-finger-table">
                            <div className="mypage-x__scan-detail-finger-row mypage-x__scan-detail-finger-row--head">
                              <span>손가락</span><span>길이</span><span>너비</span><span>곡률</span>
                            </div>
                            {scanDetail.fingers.map((f) => (
                                <div key={f.label} className="mypage-x__scan-detail-finger-row">
                                  <span>{f.label}</span>
                                  <span>{f.lengthMm.toFixed(1)}mm</span>
                                  <span>{f.widthMm.toFixed(1)}mm</span>
                                  <span>{f.cCurve.toFixed(2)}</span>
                                </div>
                            ))}
                          </div>
                      )}
                    </>
                )}
              </div>
            </div>
        )}

        {/* ── 네일팁 출력 상세 모달 ───────────────────────────────────── */}
        {printDetailOrder && (
            <div className="mypage-x__modal" role="dialog" aria-modal="true">
              <button
                  type="button"
                  className="mypage-x__modal-backdrop"
                  aria-label="닫기"
                  onClick={() => setPrintDetailOrder(null)}
              />
              <div className="mypage-x__modal-panel mypage-x__scan-detail-panel">
                <button
                    type="button"
                    className="mypage-x__modal-close"
                    onClick={() => setPrintDetailOrder(null)}
                    aria-label="닫기"
                >
                  ✕
                </button>

                <p className="mypage-x__scan-detail-heading">
                  <strong>{new Date(printDetailOrder.orderedAt).toLocaleDateString('ko-KR')}</strong>에{' '}
                  <strong>{printDetailOrder.shapeLabelKo}</strong> 쉐입으로 네일팁 10개(양손) 출력을 신청했어요.
                </p>

                <div className="mypage-x__scan-detail-summary">
                  <div className="mypage-x__scan-detail-summary-item">
                    {SHAPE_PREVIEW_IMAGES[printDetailOrder.shapeId] && (
                        <img
                            src={SHAPE_PREVIEW_IMAGES[printDetailOrder.shapeId]}
                            alt=""
                            className="mypage-x__scan-detail-shape-img"
                        />
                    )}
                    <span className="mypage-x__scan-detail-summary-label">신청한 네일팁 모양</span>
                    <span className="mypage-x__scan-detail-summary-value">
                      {getNailShape(printDetailOrder.shapeId)?.labelKo ?? printDetailOrder.shapeId}
                    </span>
                  </div>
                  <div className="mypage-x__scan-detail-summary-item">
                    <span className="mypage-x__scan-detail-summary-label">진행 상태</span>
                    <span className="mypage-x__scan-detail-summary-value">{PRINT_STATUS_LABEL[printDetailOrder.status]}</span>
                  </div>
                </div>

                {!printDetailOrder.leftScanId && !printDetailOrder.rightScanId ? (
                    <p className="mypage-x__scan-detail-comment">
                      이 출력 신청에는 연결된 손 분석 기록 정보가 없어요. (예전에 신청한 건일 수 있어요)
                    </p>
                ) : isLoadingPrintDetail || !printDetailScan ? (
                    <p className="mypage-x__empty">연결된 손 분석 결과를 불러오는 중...</p>
                ) : (
                    <>
                      <p className="mypage-x__scan-detail-comment">
                        이 출력은 <strong>{dateLabelOf(dateKeyOf(printDetailScan.scannedAt))}</strong>에 스캔한 손 분석 결과를 바탕으로 신청됐어요.
                      </p>
                      <div className="mypage-x__scan-detail-metrics">
                        <div className="mypage-x__scan-detail-metric">
                          <span>평균 길이</span>
                          <strong>{printDetailScan.avgLength}mm</strong>
                        </div>
                        <div className="mypage-x__scan-detail-metric">
                          <span>평균 너비</span>
                          <strong>{printDetailScan.avgWidth}mm</strong>
                        </div>
                        <div className="mypage-x__scan-detail-metric">
                          <span>평균 곡률 (C-curve)</span>
                          <strong>{printDetailScan.avgCurve}</strong>
                        </div>
                      </div>
                    </>
                )}
              </div>
            </div>
        )}
      </AppShell>
  )
}