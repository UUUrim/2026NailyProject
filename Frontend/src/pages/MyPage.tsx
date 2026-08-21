import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { useAuth } from '@/hooks/useAuth'
import { getMyPrintOrders, type PrintOrderResponse as NailTipPrintOrder } from '@/apis/prints'
import { getMyProfile, updateNickname, updatePassword, verifyCurrentPassword, type UserProfileResponse } from '@/apis/user'
import {
  getMyDesigns,
  getLikedDesigns,
  getSavedFolders,
  reorderSavedFolders,
  likeDesign,
  moveLikedDesign,
  unlikeDesign,
  createSavedFolder,
  deleteSavedFolder,
  type DesignImageResponse,
  type SavedDesignResponse,
  type SavedFolderResponse,
} from '@/apis/design'
import { FavoriteFolderModal } from '@/components/mypage/FavoriteFolderModal'
import { NextStepButton } from '@/components/common/NextStepButton'
import { DesignImageDetailModal, type DesignImageDetailInput } from '@/components/design/DesignImageDetailModal'
import { ModalActionIcons } from '@/components/design/ModalActionIcons'
import { getMyScans, getScanResult, type ScanHistoryItem, type ScanResultResponse } from '@/apis/scan'
import { getNailShape } from '@/constants/nailShapes'
import { SHAPE_PREVIEW_IMAGES } from '@/constants/designPreferences'
import { ApiError } from '@/utils/apiClient'
import { getPasswordRuleChecks, isPasswordValid } from '@/utils/passwordRules'
import { PrinterProgressWidget } from '@/components/mypage/PrinterProgressWidget'
import { ScanDetailModal } from '@/components/mypage/ScanDetailModal'
import { ScanXModalShell } from '@/components/mypage/ScanXModalShell'
import { buildScanSessions, isFullyAnalyzedSession, type ScanSession } from '@/utils/scanDetail'
import { analyzeSkinTone, generateSkinTonePalette } from '@/utils/skinTone'
import '@/styles/mypage.css'
import '@/styles/design-chat.css'
import '@/styles/nail-design.css'
type SectionId = 'dashboard' | 'profile' | 'timeline' | 'scans' | 'prints' | 'designs' | 'favorites'

type LikeModalTarget = {
  designId: number
  imageUrl: string
  mode: 'like' | 'move'
  currentFolderId?: number | null
}

const PRINT_STATUS_LABEL: Record<NailTipPrintOrder['status'], string> = {
  QUEUED: '출력 대기',
  MERGING: '모델 병합 중',
  MERGED: '병합 완료',
  PRINTING: '출력 중',
  COMPLETED: '완료',
  FAILED: '실패',
}

const PRINT_STATUS_HINT: Record<NailTipPrintOrder['status'], string> = {
  QUEUED: '프린터 대기열에 등록되어 있어요.',
  MERGING: '손톱 모델을 하나로 합치고 있어요.',
  MERGED: '모델 병합이 끝났어요. 곧 출력이 시작돼요.',
  PRINTING: '네일팁을 출력하고 있어요.',
  COMPLETED: '네일팁 출력이 완료되었어요.',
  FAILED: '출력 중 문제가 발생했어요.',
}

// 손 스캔 분석 상태 (네일팁 출력 관련 상태는 출력 이력에서만 표시)
const SCAN_STATUS_LABEL: Record<string, string> = {
  READY: '분석 대기 중',
  ANALYZING: '분석 진행 중',
  MEASURED: '분석 완료',
  GENERATING_STL: '분석 완료',
  COMPLETED: '분석 완료',
  FAILED: '분석 실패',
}

function scanStatusBadgeClass(status: string | null | undefined): string {
  const raw = (status ?? '').toLowerCase()
  if (raw === 'generating_stl') return 'measured'
  return raw || 'ready'
}

function formatMetricCurve(value: number | null | undefined): string {
  if (value == null) return '-'
  const fixed = Number(value).toFixed(2).replace(/\.?0+$/, '')
  return fixed
}

type FingerStat = { label: string; hand: 'L' | 'R'; partLabel: string; lengthMm: number; widthMm: number; cCurve: number }

type ScanDetail = {
  scannedAt: string
  seasonCode: string | null
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
      cCurveMm?: number
      cCurve?: number
      curve?: number
    }
    // 실제 스캔 파이프라인(scan/server.py) 필드명은 cCurveMm — cCurve/curve는 옛 목업 호환용
    return {
      lengthMm: Number(m.lengthMm ?? m.length ?? 12),
      widthMm: Number(m.widthMm ?? m.width ?? 9),
      cCurve: Number(m.cCurveMm ?? m.cCurve ?? m.curve ?? 0.55),
    }
  } catch {
    return { lengthMm: 12, widthMm: 9, cCurve: 0.55 }
  }
}

function buildScanDetail(left: ScanResultResponse | null, right: ScanResultResponse | null): ScanDetail {
  const fingers: FingerStat[] = [
    ...(left?.fingers ?? []).map((f) => ({
      label: `${FINGER_LABEL_KO[f.finger] ?? f.finger}(L)`,
      hand: 'L' as const,
      partLabel: FINGER_LABEL_KO[f.finger] ?? f.finger,
      ...parseFingerMeasurements(f.measurements),
    })),
    ...(right?.fingers ?? []).map((f) => ({
      label: `${FINGER_LABEL_KO[f.finger] ?? f.finger}(R)`,
      hand: 'R' as const,
      partLabel: FINGER_LABEL_KO[f.finger] ?? f.finger,
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
    seasonCode: left?.seasonCode || right?.seasonCode || null,
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
  plus: (
      <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
  ),
  close: (
      <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
  ),
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
  calendar: (
      <svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" stroke="currentColor" strokeWidth="1.6" /><path d="M8 3.5v3M16 3.5v3M3.5 9.5h17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
  ),
  logout: (
      <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M15 16l4-4-4-4M19 12H9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  chevron: (
      <svg viewBox="0 0 24 24" fill="none" width="16" height="16"><path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  chevronLeft: (
      <svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="m15 6-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  chevronRight: (
      <svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  chevronDown: (
      <svg viewBox="0 0 24 24" fill="none" width="13" height="13"><path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  trash: ModalActionIcons.trash,
  folder: (
      <svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="M3.5 6.2A1.7 1.7 0 0 1 5.2 4.5h4.1c.5 0 .97.22 1.3.6l1.05 1.2c.32.38.8.6 1.3.6h5.35a1.7 1.7 0 0 1 1.7 1.7v9.7a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7V6.2z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
  ),
  lengthIcon: (
      <svg viewBox="0 0 24 24" fill="none" width="16" height="16"><path d="M12 4v16M12 4l-3 3.2M12 4l3 3.2M12 20l-3-3.2M12 20l3-3.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  widthIcon: (
      <svg viewBox="0 0 24 24" fill="none" width="16" height="16"><path d="M4 12h16M4 12l3.2-3.2M4 12l3.2 3.2M20 12l-3.2-3.2M20 12l-3.2 3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  curveIcon: (
      <svg viewBox="0 0 24 24" fill="none" width="16" height="16"><path d="M3.5 14.8c3.2-2.4 6.2-3.2 8.5-3.2s5.3.8 8.5 3.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  summaryIcon: (
      <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" /><path d="M12 7.6v5.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="12" cy="16.4" r="1.05" fill="currentColor" /></svg>
  ),
  palette: (
      <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
        <path d="M12 3.5c-4.7 0-8.5 3.4-8.5 8.1 0 3.3 2.2 5.4 4.4 5.4.7 0 1.3-.3 1.7-.8.3-.4.8-.7 1.4-.7h1.1c2.9 0 5.4-2.3 5.4-5.3C17.5 6.4 15.1 3.5 12 3.5z" stroke="currentColor" strokeWidth="1.55" strokeLinejoin="round" />
        <circle cx="8.2" cy="10.2" r="1.05" fill="currentColor" />
        <circle cx="11.1" cy="7.8" r="1.05" fill="currentColor" />
        <circle cx="14.3" cy="8.6" r="1.05" fill="currentColor" />
        <circle cx="15.2" cy="11.8" r="1.05" fill="currentColor" />
      </svg>
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

const SECTION_META: Record<SectionId, { subtitle: string; title: string; description: string }> = {
  dashboard: {
    subtitle: 'My Naily',
    title: '대시보드',
    description: '지금까지의 네일리 활동을 한눈에 확인해보세요.',
  },
  profile: {
    subtitle: 'Profile',
    title: '프로필 설정',
    description: '닉네임과 비밀번호를 관리할 수 있어요.',
  },
  timeline: {
    subtitle: 'Timeline',
    title: '활동 타임라인',
    description: '날짜별로 손 분석, 네일팁 출력, 디자인 생성 활동을 한눈에 살펴보세요.',
  },
  scans: {
    subtitle: 'Hand Analysis',
    title: '손 분석 이력',
    description: '양손 촬영을 모두 마친 손 스캔 분석 결과예요. 항목을 누르면 상세 결과를 볼 수 있어요.',
  },
  designs: {
    subtitle: 'Design',
    title: '디자인 이력',
    description: '생성한 최종 네일 디자인만 모아놨어요. 이미지를 눌러 자세히 확인해 보세요.',
  },
  prints: {
    subtitle: 'Nail Tips Print',
    title: '네일팁 출력 내역',
    description: '3D 네일팁 제작 신청 내역이에요. 어떤 분석 결과를 바탕으로 신청했는지 확인할 수 있어요.',
  },
  favorites: {
    subtitle: 'Liked',
    title: '찜 목록',
    description: 'ㅇㅇ 님이 찜해둔 디자인만 모아놨어요.',
  },
}

// 백엔드가 주는 "yyyy. M. d." / "yyyy. M. d. HH:mm:ss" 형식이든 ISO 문자열이든 안전하게 Date로 변환
function parseDateFlexible(raw: string | number[] | null | undefined): Date | null {
  if (raw == null) return null
  // Jackson이 LocalDateTime을 배열로 내려주는 경우: [y, m, d, h, mi, s]
  if (Array.isArray(raw) && raw.length >= 3) {
    return new Date(
        Number(raw[0]),
        Number(raw[1]) - 1,
        Number(raw[2]),
        Number(raw[3] ?? 0),
        Number(raw[4] ?? 0),
        Number(raw[5] ?? 0),
    )
  }
  if (typeof raw !== 'string' || !raw) return null
  const dotMatch = raw.match(
      /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  )
  if (dotMatch) {
    return new Date(
        Number(dotMatch[1]),
        Number(dotMatch[2]) - 1,
        Number(dotMatch[3]),
        Number(dotMatch[4] ?? 0),
        Number(dotMatch[5] ?? 0),
        Number(dotMatch[6] ?? 0),
    )
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

function formatTimeHms(raw: string): string {
  const d = parseDateFlexible(raw)
  if (!d) return ''
  // 표시용: HH:MM (저장 형식은 그대로 두고 화면에서만 초 단위를 생략)
  if (typeof raw === 'string' && !/\d{1,2}:\d{2}/.test(raw) && !raw.includes('T')) {
    return ''
  }
  return [d.getHours(), d.getMinutes()]
      .map((n) => String(n).padStart(2, '0'))
      .join(':')
}

function formatDateOnly(raw: string): string {
  const d = parseDateFlexible(raw)
  if (!d) return typeof raw === 'string' ? raw : ''
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`
}

function formatDateTimeFull(raw: string): string {
  const d = parseDateFlexible(raw)
  if (!d) return raw
  const time = formatTimeHms(raw)
  const date = formatDateOnly(raw)
  return time ? `${date} ${time}` : date
}

function compareByTime(aRaw: string, bRaw: string, order: 'newest' | 'oldest') {
  const ta = parseDateFlexible(aRaw)?.getTime() ?? 0
  const tb = parseDateFlexible(bRaw)?.getTime() ?? 0
  return order === 'newest' ? tb - ta : ta - tb
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function todayKey(): string {
  return toDateKey(new Date())
}

function shiftDateKey(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + delta)
  return toDateKey(date)
}

function formatNavDate(key: string): string {
  if (!key || key === 'unknown') return '날짜 정보 없음'
  const [y, m, d] = key.split('-').map(Number)
  return `${y}년 ${m}월 ${d}일`
}

function buildCalendarCells(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: Array<{ key: string; day: number; inMonth: boolean } | null> = []
  for (let i = 0; i < firstDay; i += 1) cells.push(null)
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({
      key: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      day,
      inMonth: true,
    })
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

type TimelineDayGroup = {
  scans: ScanSession[]
  designs: DesignImageResponse[]
  prints: NailTipPrintOrder[]
}

type TimelineEventKind = 'scan' | 'print' | 'design'

type TimelineDayEvent = {
  id: string
  kind: TimelineEventKind
  at: string
  timeMs: number
}

export function MyPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { logout } = useAuth()

  // ── 프로필: 닉네임 변경 (1단계: 현재 비밀번호 확인 → 2단계: 새 닉네임 입력) ──────
  const [profile, setProfile] = useState<UserProfileResponse | null>(null)
  const [isEditingNickname, setIsEditingNickname] = useState(false)
  const [nicknameStage, setNicknameStage] = useState<'password' | 'nickname' | 'done'>('password')
  const [nicknamePassword, setNicknamePassword] = useState('')
  const [nicknamePasswordError, setNicknamePasswordError] = useState('')
  const [isVerifyingNicknamePassword, setIsVerifyingNicknamePassword] = useState(false)
  const [nickname, setNickname] = useState('')
  const [nicknameError, setNicknameError] = useState('')
  const [isSavingNickname, setIsSavingNickname] = useState(false)

  // ── 프로필: 비밀번호 변경 (1단계: 현재 비밀번호 확인 → 2단계: 새 비밀번호 입력) ──────
  const [isEditingPassword, setIsEditingPassword] = useState(false)
  const [passwordStage, setPasswordStage] = useState<'password' | 'new' | 'done'>('password')
  const [currentPassword, setCurrentPassword] = useState('')
  const [currentPasswordError, setCurrentPasswordError] = useState('')
  const [isVerifyingCurrentPassword, setIsVerifyingCurrentPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [newPasswordSubmitError, setNewPasswordSubmitError] = useState('')
  const [isSavingPassword, setIsSavingPassword] = useState(false)

  // ── 섹션 ───────
  const initialSection = (location.state as { tab?: SectionId } | null)?.tab ?? 'dashboard'
  const [section, setSection] = useState<SectionId>(initialSection)

  useEffect(() => {
    const tab = (location.state as { tab?: SectionId } | null)?.tab
    if (tab) setSection(tab)
  }, [location.state])

  // ── 데이터 ──────
  const [designs, setDesigns] = useState<DesignImageResponse[]>([])
  const [favorites, setFavorites] = useState<SavedDesignResponse[]>([])
  const [scans, setScans] = useState<ScanHistoryItem[]>([])
  const [prints, setPrints] = useState<NailTipPrintOrder[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const [detailImage, setDetailImage] = useState<DesignImageDetailInput | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  // ── 활동 타임라인 ──────
  const [selectedTimelineDate, setSelectedTimelineDate] = useState(todayKey)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [calendarViewMode, setCalendarViewMode] = useState<'days' | 'months'>('days')
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const calendarRef = useRef<HTMLDivElement | null>(null)
  const dayBodyRef = useRef<HTMLDivElement | null>(null)
  const sortMenuRef = useRef<HTMLDivElement | null>(null)
  const timelineDateInitialized = useRef(false)
  const [hoveredActivityId, setHoveredActivityId] = useState<string | null>(null)
  const [pinnedActivityId, setPinnedActivityId] = useState<string | null>(null)
  const [listSortOrder, setListSortOrder] = useState<'newest' | 'oldest'>('newest')
  const [folderSortOrder, setFolderSortOrder] = useState<'name' | 'lastSaved'>('lastSaved')
  const [folderSortMenuOpen, setFolderSortMenuOpen] = useState(false)
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [listPage, setListPage] = useState(1)
  const [savedFolders, setSavedFolders] = useState<SavedFolderResponse[]>([])
  const [likeModalTarget, setLikeModalTarget] = useState<LikeModalTarget | null>(null)
  const [selectedFavoriteFolderId, setSelectedFavoriteFolderId] = useState<number | null>(null)
  const mainPanelRef = useRef<HTMLElement | null>(null)
  const folderSortMenuRef = useRef<HTMLDivElement | null>(null)

  // ── 찜 탭 폴더 목록에서 바로 새 폴더 만들기 ──────
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderNameInStrip, setNewFolderNameInStrip] = useState('')
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [createFolderError, setCreateFolderError] = useState<string | null>(null)

  const startCreatingFolderInStrip = () => {
    setCreateFolderError(null)
    setCreatingFolder(true)
  }

  const cancelCreatingFolderInStrip = () => {
    setCreatingFolder(false)
    setNewFolderNameInStrip('')
    setCreateFolderError(null)
  }

  const handleCreateFolderInStrip = async () => {
    const name = newFolderNameInStrip.trim()
    if (!name) {
      setCreateFolderError('폴더 이름을 입력해 주세요.')
      return
    }
    setIsCreatingFolder(true)
    setCreateFolderError(null)
    try {
      const created = await createSavedFolder(name)
      setSavedFolders((prev) => [...prev, created])
      cancelCreatingFolderInStrip()
    } catch (e) {
      setCreateFolderError(e instanceof ApiError ? e.message : '폴더를 만들지 못했습니다.')
    } finally {
      setIsCreatingFolder(false)
    }
  }

  const openDetailImage = (img: DesignImageDetailInput) => setDetailImage(img)
  const closeDetailImage = () => setDetailImage(null)

  useEffect(() => {
    getMyProfile()
        .then((data) => {
          setProfile(data)
          setNickname(data.nickname)
        })
        .catch(() => {})

    setIsLoading(true)
    Promise.allSettled([getMyDesigns(), getLikedDesigns(), getMyScans(), getMyPrintOrders(), getSavedFolders()]).then(
        ([designsRes, favoritesRes, scansRes, printsRes, foldersRes]) => {
          if (designsRes.status === 'fulfilled') setDesigns(designsRes.value)
          if (favoritesRes.status === 'fulfilled') {
            setFavorites(favoritesRes.value)
          } else {
            console.error('찜 목록 조회 실패', favoritesRes.reason)
          }
          if (scansRes.status === 'fulfilled') setScans(scansRes.value)
          if (printsRes.status === 'fulfilled') setPrints(printsRes.value)
          if (foldersRes.status === 'fulfilled') {
            setSavedFolders(foldersRes.value)
          } else {
            console.error('찜 폴더 조회 실패', foldersRes.reason)
          }
          setIsLoading(false)
        },
    )
  }, [])

  const likedKeySet = useMemo(
      () => new Set(favorites.map((f) => `${f.designId}-${f.imageUrl}`)),
      [favorites],
  )

  // 한 번의 촬영에서 나온 왼손/오른손 기록을 하나의 세션으로 묶고, 실제 분석 결과값이
  // 전부 채워진 것만 이력으로 노출한다 (utils/scanDetail — 출력/스캔 페이지와 동일한 기준 사용)
  const scanSessions = useMemo<ScanSession[]>(
      () => buildScanSessions(scans).filter(isFullyAnalyzedSession),
      [scans],
  )

  // ── 손 분석 세션 상세 모달 ──────
  const [scanDetailSession, setScanDetailSession] = useState<ScanSession | null>(null)
  const openScanDetail = (session: ScanSession) => setScanDetailSession(session)
  const closeScanDetail = () => setScanDetailSession(null)

  // ── 네일팁 출력 상세 모달 ──────
  const [printDetailOrder, setPrintDetailOrder] = useState<NailTipPrintOrder | null>(null)
  const [printDetailScan, setPrintDetailScan] = useState<ScanDetail | null>(null)
  const [isLoadingPrintDetail, setIsLoadingPrintDetail] = useState(false)

  const openPrintDetail = async (order: NailTipPrintOrder) => {
    setPrintDetailOrder(order)
    setPrintDetailScan(null)
    if (!order.leftScanId && !order.rightScanId) {
      setIsLoadingPrintDetail(false)
      return
    }
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

  const closePrintDetail = () => {
    setPrintDetailOrder(null)
    setPrintDetailScan(null)
    setIsLoadingPrintDetail(false)
  }

  // ── 닉네임 변경: 1단계(비밀번호 확인) → 2단계(새 닉네임) → 완료 ──────
  const handleStartEditNickname = () => {
    setNicknameStage('password')
    setNicknamePassword('')
    setNicknamePasswordError('')
    setNickname('')
    setNicknameError('')
    setIsEditingNickname(true)
  }

  const handleCloseNicknameForm = () => {
    setIsEditingNickname(false)
    setNicknameStage('password')
    setNicknamePassword('')
    setNicknamePasswordError('')
    setNickname('')
    setNicknameError('')
  }

  const handleVerifyNicknamePassword = async () => {
    if (!nicknamePassword) {
      setNicknamePasswordError('현재 비밀번호를 입력해 주세요.')
      return
    }
    if (!profile?.email) return

    setIsVerifyingNicknamePassword(true)
    setNicknamePasswordError('')

    try {
      const isCorrect = await verifyCurrentPassword(profile.email, nicknamePassword)
      if (!isCorrect) {
        setNicknamePasswordError('현재 비밀번호가 일치하지 않습니다. 다시 입력해 주세요.')
        setNicknamePassword('')
        return
      }
      setNickname(profile.nickname ?? '')
      setNicknameStage('nickname')
    } catch (e) {
      setNicknamePasswordError(e instanceof ApiError ? e.message : '비밀번호 확인에 실패했습니다.')
    } finally {
      setIsVerifyingNicknamePassword(false)
    }
  }

  const handleSaveNickname = async () => {
    const trimmed = nickname.trim()
    if (!trimmed) {
      setNicknameError('닉네임을 입력해 주세요.')
      return
    }

    setIsSavingNickname(true)
    setNicknameError('')

    try {
      const updated = await updateNickname(trimmed)
      setProfile(updated)
      setNicknameStage('done')
    } catch (e) {
      setNicknameError(e instanceof ApiError ? e.message : '닉네임 변경에 실패했습니다.')
    } finally {
      setIsSavingNickname(false)
    }
  }

  // ── 비밀번호 변경: 1단계(현재 비밀번호 확인) → 2단계(새 비밀번호) → 완료 ──────
  const handleStartEditPassword = () => {
    setPasswordStage('password')
    setCurrentPassword('')
    setCurrentPasswordError('')
    setNewPassword('')
    setPasswordConfirm('')
    setNewPasswordSubmitError('')
    setIsEditingPassword(true)
  }

  const handleClosePasswordForm = () => {
    setIsEditingPassword(false)
    setPasswordStage('password')
    setCurrentPassword('')
    setCurrentPasswordError('')
    setNewPassword('')
    setPasswordConfirm('')
    setNewPasswordSubmitError('')
  }

  const handleVerifyCurrentPassword = async () => {
    if (!currentPassword) {
      setCurrentPasswordError('현재 비밀번호를 입력해 주세요.')
      return
    }
    if (!profile?.email) return

    setIsVerifyingCurrentPassword(true)
    setCurrentPasswordError('')

    try {
      const isCorrect = await verifyCurrentPassword(profile.email, currentPassword)
      if (!isCorrect) {
        setCurrentPasswordError('현재 비밀번호가 일치하지 않습니다. 다시 입력해 주세요.')
        setCurrentPassword('')
        return
      }
      setPasswordStage('new')
    } catch (e) {
      setCurrentPasswordError(e instanceof ApiError ? e.message : '비밀번호 확인에 실패했습니다.')
    } finally {
      setIsVerifyingCurrentPassword(false)
    }
  }

  const handleSavePassword = async () => {
    // 저장 버튼이 이 조건에서 비활성화되어 있어 사실상 도달하지 않지만, 방어적으로 한 번 더 확인한다.
    if (!isPasswordValid(newPassword) || newPassword !== passwordConfirm) return

    setIsSavingPassword(true)
    setNewPasswordSubmitError('')

    try {
      await updatePassword(currentPassword, newPassword)
      setPasswordStage('done')
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // 확인 이후 시점에 뒤늦게 현재 비밀번호 불일치가 감지된 경우 — 1단계로 되돌려서 다시 확인하게 한다.
        setPasswordStage('password')
        setCurrentPassword('')
        setCurrentPasswordError('현재 비밀번호가 일치하지 않습니다. 다시 입력해 주세요.')
      } else {
        setNewPasswordSubmitError(e instanceof ApiError ? e.message : '비밀번호 변경에 실패했습니다.')
      }
    } finally {
      setIsSavingPassword(false)
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  const findFavoriteFolder = (designId: number, imageUrl: string) =>
      favorites.find((f) => f.designId === designId && f.imageUrl === imageUrl)?.folder ?? null

  const openLikeFolderModal = (designId: number, imageUrl: string) => {
    setLikeModalTarget({ designId, imageUrl, mode: 'like' })
  }

  const openMoveFolderModal = (designId: number, imageUrl: string) => {
    setLikeModalTarget({
      designId,
      imageUrl,
      mode: 'move',
      currentFolderId: findFavoriteFolder(designId, imageUrl)?.folderId ?? null,
    })
  }

  const toggleLikeFromGrid = async (designId: number, imageUrl: string) => {
    const key = `${designId}-${imageUrl}`
    const isLiked = likedKeySet.has(key)
    if (isLiked) {
      try {
        await unlikeDesign(designId, imageUrl)
        setFavorites((prev) => prev.filter((f) => !(f.designId === designId && f.imageUrl === imageUrl)))
        void getSavedFolders().then(setSavedFolders).catch(() => {})
        if (detailImage && detailImage.designId === designId && detailImage.imageUrl === imageUrl) {
          setDetailImage({ ...detailImage, liked: false, folder: null })
        }
      } catch (e) {
        alert(e instanceof ApiError ? e.message : '요청에 실패했습니다.')
      }
      return
    }
    openLikeFolderModal(designId, imageUrl)
  }

  const confirmLikeWithFolder = async (choice: { folderId?: number; newFolderName?: string }) => {
    if (!likeModalTarget) return
    const { designId, imageUrl, mode } = likeModalTarget
    const saved =
        mode === 'move'
            ? await moveLikedDesign(designId, imageUrl, choice)
            : await likeDesign(designId, imageUrl, choice)
    setFavorites((prev) => [saved, ...prev.filter((f) => !(f.designId === designId && f.imageUrl === imageUrl))])
    const folders = await getSavedFolders()
    setSavedFolders(folders)
    if (detailImage && detailImage.designId === designId && detailImage.imageUrl === imageUrl) {
      setDetailImage({ ...detailImage, liked: true, folder: saved.folder })
    }
  }

  // ── 전체 활동 타임라인: 손 스캔 + 디자인 생성 + 네일팁 출력을 날짜별로 통합 ──────
  const timelineByDate = useMemo(() => {
    const map = new Map<string, TimelineDayGroup>()

    const ensure = (key: string) => {
      if (!map.has(key)) map.set(key, { scans: [], designs: [], prints: [] })
      return map.get(key)!
    }

    scanSessions.forEach((s) => ensure(dateKeyOf(s.scannedAt)).scans.push(s))
    designs.forEach((d) => ensure(dateKeyOf(d.createdAt)).designs.push(d))
    prints.forEach((p) => ensure(dateKeyOf(p.orderedAt)).prints.push(p))

    return map
  }, [scanSessions, designs, prints])

  const timelineActivityDates = useMemo(
      () => new Set(timelineByDate.keys()),
      [timelineByDate],
  )

  const hasAnyTimelineActivity = timelineActivityDates.size > 0

  useEffect(() => {
    if (timelineDateInitialized.current || isLoading) return
    timelineDateInitialized.current = true
    if (timelineActivityDates.size > 0) {
      const latest = [...timelineActivityDates].sort((a, b) => (a < b ? 1 : -1))[0]
      setSelectedTimelineDate(latest)
      const [y, m] = latest.split('-').map(Number)
      setCalendarMonth({ year: y, month: m - 1 })
    }
  }, [isLoading, timelineActivityDates])

  useEffect(() => {
    if (!calendarOpen && !sortMenuOpen && !folderSortMenuOpen) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (calendarOpen && !calendarRef.current?.contains(target)) {
        setCalendarOpen(false)
      }
      if (sortMenuOpen && !sortMenuRef.current?.contains(target)) {
        setSortMenuOpen(false)
      }
      if (folderSortMenuOpen && !folderSortMenuRef.current?.contains(target)) {
        setFolderSortMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [calendarOpen, sortMenuOpen, folderSortMenuOpen])

  useEffect(() => {
    setListPage(1)
  }, [section, listSortOrder, folderSortOrder, selectedFavoriteFolderId])

  useEffect(() => {
    if (section !== 'favorites') setSelectedFavoriteFolderId(null)
  }, [section])

  useEffect(() => {
    mainPanelRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [listPage, section])

  useEffect(() => {
    setPinnedActivityId(null)
    setHoveredActivityId(null)
  }, [selectedTimelineDate])

  useEffect(() => {
    if (section !== 'timeline') {
      setPinnedActivityId(null)
      setHoveredActivityId(null)
    }
  }, [section])

  const selectedDayGroup = useMemo<TimelineDayGroup>(
      () => timelineByDate.get(selectedTimelineDate) ?? { scans: [], designs: [], prints: [] },
      [timelineByDate, selectedTimelineDate],
  )

  const timelineScansOldest = useMemo(
      () => [...selectedDayGroup.scans].sort((a, b) => compareByTime(a.scannedAt, b.scannedAt, 'oldest')),
      [selectedDayGroup.scans],
  )
  const timelinePrintsOldest = useMemo(
      () => [...selectedDayGroup.prints].sort((a, b) => compareByTime(a.orderedAt, b.orderedAt, 'oldest')),
      [selectedDayGroup.prints],
  )
  const timelineDesignsOldest = useMemo(
      () => [...selectedDayGroup.designs].sort((a, b) => compareByTime(a.createdAt, b.createdAt, 'oldest')),
      [selectedDayGroup.designs],
  )

  const sortedScanSessions = useMemo(
      () => [...scanSessions].sort((a, b) => compareByTime(a.scannedAt, b.scannedAt, listSortOrder)),
      [scanSessions, listSortOrder],
  )
  const sortedPrints = useMemo(
      () => [...prints].sort((a, b) => compareByTime(a.orderedAt, b.orderedAt, listSortOrder)),
      [prints, listSortOrder],
  )
  const sortedDesigns = useMemo(
      () => [...designs].sort((a, b) => compareByTime(a.createdAt, b.createdAt, listSortOrder)),
      [designs, listSortOrder],
  )
  const sortedFavorites = useMemo(
      () => [...favorites].sort((a, b) => compareByTime(a.savedAt, b.savedAt, listSortOrder)),
      [favorites, listSortOrder],
  )

  const dayEvents = useMemo<TimelineDayEvent[]>(() => {
    const events: TimelineDayEvent[] = [
      ...timelineScansOldest.map((s) => ({
        id: `scan-${s.key}`,
        kind: 'scan' as const,
        at: s.scannedAt,
        timeMs: parseDateFlexible(s.scannedAt)?.getTime() ?? 0,
      })),
      ...timelinePrintsOldest.map((p) => ({
        id: `print-${p.id}`,
        kind: 'print' as const,
        at: p.orderedAt,
        timeMs: parseDateFlexible(p.orderedAt)?.getTime() ?? 0,
      })),
      ...timelineDesignsOldest.map((d) => ({
        id: `design-${d.designId}-${d.imageUrl}`,
        kind: 'design' as const,
        at: d.createdAt,
        timeMs: parseDateFlexible(d.createdAt)?.getTime() ?? 0,
      })),
    ]
    return events.sort((a, b) => a.timeMs - b.timeMs)
  }, [timelineScansOldest, timelinePrintsOldest, timelineDesignsOldest])

  const dayTotalCount =
      selectedDayGroup.scans.length + selectedDayGroup.designs.length + selectedDayGroup.prints.length

  const activeActivityId = pinnedActivityId ?? hoveredActivityId

  const scrollToRightActivity = (id: string) => {
    const root = dayBodyRef.current
    if (!root) return
    const nodes = root.querySelectorAll<HTMLElement>('[data-activity-side="right"]')
    for (const el of nodes) {
      if (el.dataset.activityId === id) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        break
      }
    }
  }

  const handleActivityHover = (id: string | null) => {
    if (pinnedActivityId) return
    setHoveredActivityId(id)
  }

  const handleActivitySelect = (id: string) => {
    setPinnedActivityId((prev) => {
      if (prev === id) {
        setHoveredActivityId(null)
        return null
      }
      return id
    })
    scrollToRightActivity(id)
  }

  const moveTimelineDate = (delta: number) => {
    const next = shiftDateKey(selectedTimelineDate, delta)
    if (next > todayKey()) return
    setSelectedTimelineDate(next)
    const [y, m] = next.split('-').map(Number)
    setCalendarMonth({ year: y, month: m - 1 })
  }

  const openTimelineCalendar = () => {
    const [y, m] = selectedTimelineDate.split('-').map(Number)
    setCalendarMonth({ year: y, month: m - 1 })
    setCalendarViewMode('days')
    setCalendarOpen((prev) => !prev)
  }

  const selectTimelineDate = (key: string) => {
    if (key > todayKey()) return
    setSelectedTimelineDate(key)
    setCalendarOpen(false)
  }

  // 오늘이 속한 달을 넘어서는(=미래) 달로는 이동할 수 없다 — 어차피 그 달의 날짜는
  // 전부 is-future로 막혀 있어서 고를 게 없기 때문.
  const isCurrentOrFutureMonth = (year: number, month: number) => {
    const now = new Date()
    return year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth())
  }

  const shiftCalendarMonth = (delta: number) => {
    setCalendarMonth((prev) => {
      if (delta > 0 && isCurrentOrFutureMonth(prev.year, prev.month)) return prev
      const date = new Date(prev.year, prev.month + delta, 1)
      return { year: date.getFullYear(), month: date.getMonth() }
    })
  }

  const shiftCalendarYear = (delta: number) => {
    setCalendarMonth((prev) => {
      if (delta > 0 && prev.year >= new Date().getFullYear()) return prev
      return { ...prev, year: prev.year + delta }
    })
  }

  const selectCalendarMonth = (month: number) => {
    setCalendarMonth((prev) => ({ ...prev, month }))
    setCalendarViewMode('days')
  }

  const renderScanSessionRow = (
      session: ScanSession,
      options?: { activityId?: string; interactive?: boolean },
  ) => {
    const activityId = options?.activityId ?? `scan-${session.key}`
    const timeLabel = formatDateTimeFull(session.scannedAt)
    const highlighted = options?.interactive ? activeActivityId === activityId : false
    const shapeLabel = session.recommendedShape
        ? getNailShape(session.recommendedShape)?.labelKo ?? session.recommendedShape
        : null
    const skinHex = session.skinToneHex
    const toneLabel = skinHex ? analyzeSkinTone(skinHex).tone.label.replace(/\s+/g, '') : '미분석'
    const palettePreview = skinHex ? generateSkinTonePalette(skinHex, 5) : []
    const metricsLine = [
      `길이 ${session.avgLengthMm != null ? `${Number(session.avgLengthMm).toFixed(1)}mm` : '-'}`,
      `너비 ${session.avgWidthMm != null ? `${Number(session.avgWidthMm).toFixed(1).replace(/\.0$/, '')}mm` : '-'}`,
      `곡률 ${formatMetricCurve(session.avgCurve)}`,
    ].join(' · ')

    return (
        <button
            key={session.key}
            type="button"
            data-activity-id={options?.interactive ? activityId : undefined}
            data-activity-side={options?.interactive ? 'right' : undefined}
            className={`mypage-x__scan-row mypage-x__scan-row--rich${highlighted ? ' is-highlighted' : ''}`}
            onClick={() => {
              if (options?.interactive) handleActivitySelect(activityId)
              openScanDetail(session)
            }}
            onMouseEnter={() => options?.interactive && handleActivityHover(activityId)}
            onMouseLeave={() => options?.interactive && handleActivityHover(null)}
        >
          <span
              className="mypage-x__scan-swatch mypage-x__scan-swatch--lg"
              style={{ background: skinHex ?? '#de869f' }}
              aria-hidden="true"
          />
          <div className="mypage-x__scan-info">
            <p className="mypage-x__scan-season">{toneLabel}</p>
            <p className="mypage-x__scan-metrics">{metricsLine}</p>
            <p className="mypage-x__scan-shape-line">추천 쉐입: {shapeLabel ?? '미정'}</p>
            {palettePreview.length > 0 && (
                <div className="mypage-x__scan-palette" aria-label="대표 피부색 추천 컬러">
                  {palettePreview.map((hex, idx) => (
                      <i key={`${hex}-${idx}`} style={{ background: hex }} />
                  ))}
                </div>
            )}
          </div>
          {timeLabel && <span className="mypage-x__scan-date-end">{timeLabel}</span>}
        </button>
    )
  }

  const renderPrintOrderRow = (
      order: NailTipPrintOrder,
      options?: { activityId?: string; interactive?: boolean },
  ) => {
    const activityId = options?.activityId ?? `print-${order.id}`
    const highlighted = options?.interactive ? activeActivityId === activityId : false
    const timeLabel = formatDateTimeFull(order.orderedAt)

    return (
        <button
            key={order.id}
            type="button"
            data-activity-id={options?.interactive ? activityId : undefined}
            data-activity-side={options?.interactive ? 'right' : undefined}
            className={`mypage-x__print-row${highlighted ? ' is-highlighted' : ''}`}
            onMouseEnter={() => options?.interactive && handleActivityHover(activityId)}
            onMouseLeave={() => options?.interactive && handleActivityHover(null)}
            onClick={() => {
              if (options?.interactive) handleActivitySelect(activityId)
              void openPrintDetail(order)
            }}
        >
          <div className="mypage-x__print-icon" aria-hidden="true">
            {SHAPE_PREVIEW_IMAGES[order.shapeId] ? (
                <img src={SHAPE_PREVIEW_IMAGES[order.shapeId]} alt="" />
            ) : (
                Icon.print
            )}
          </div>
          <div className="mypage-x__scan-info">
            <p className="mypage-x__print-shape">{order.shapeLabelKo} 네일팁 출력</p>
          </div>
          <div className="mypage-x__print-meta-end">
            <span className={`mypage-x__badge mypage-x__badge--${order.status.toLowerCase()}`}>
              {PRINT_STATUS_LABEL[order.status]}
            </span>
            {timeLabel && <span className="mypage-x__item-meta">{timeLabel}</span>}
          </div>
        </button>
    )
  }

  const eventKindMeta: Record<TimelineEventKind, { label: string; icon: keyof typeof Icon }> = {
    scan: { label: '손 촬영 · 분석', icon: 'hand' },
    print: { label: '네일팁 출력', icon: 'print' },
    design: { label: '디자인 생성', icon: 'design' },
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

  const renderSortControl = () => (
      <div className="mypage-x__sort" ref={sortMenuRef}>
        <button
            type="button"
            className={`mypage-x__sort-trigger${sortMenuOpen ? ' is-open' : ''}`}
            onClick={() => setSortMenuOpen((prev) => !prev)}
            aria-haspopup="listbox"
            aria-expanded={sortMenuOpen}
        >
          <span>{listSortOrder === 'newest' ? '최신순' : '오래된순'}</span>
          <span className="mypage-x__sort-caret" aria-hidden="true">{Icon.chevron}</span>
        </button>
        {sortMenuOpen && (
            <div className="mypage-x__sort-menu" role="listbox">
              <button
                  type="button"
                  role="option"
                  aria-selected={listSortOrder === 'newest'}
                  className={`mypage-x__sort-option${listSortOrder === 'newest' ? ' is-selected' : ''}`}
                  onClick={() => {
                    setListSortOrder('newest')
                    setSortMenuOpen(false)
                  }}
              >
                최신순
              </button>
              <button
                  type="button"
                  role="option"
                  aria-selected={listSortOrder === 'oldest'}
                  className={`mypage-x__sort-option${listSortOrder === 'oldest' ? ' is-selected' : ''}`}
                  onClick={() => {
                    setListSortOrder('oldest')
                    setSortMenuOpen(false)
                  }}
              >
                오래된순
              </button>
            </div>
        )}
      </div>
  )

  const pageSizeForSection = (id: SectionId) => (id === 'designs' ? 12 : 10)

  const paginate = <T,>(items: T[], id: SectionId) => {
    const size = pageSizeForSection(id)
    const totalPages = Math.max(1, Math.ceil(items.length / size))
    const page = Math.min(listPage, totalPages)
    const start = (page - 1) * size
    return {
      page,
      totalPages,
      slice: items.slice(start, start + size),
      total: items.length,
    }
  }

  const renderPagination = (totalPages: number) => {
    if (totalPages <= 1) return null
    const current = Math.min(listPage, totalPages)
    return (
        <div className="mypage-x__pagination">
          <button
              type="button"
              className="mypage-x__page-arrow"
              disabled={current <= 1}
              onClick={() => setListPage((p) => Math.max(1, p - 1))}
              aria-label="이전 페이지"
          >
            {Icon.chevronLeft}
          </button>
          <div className="mypage-x__page-numbers">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                <button
                    key={pageNum}
                    type="button"
                    className={`mypage-x__page-num${pageNum === current ? ' is-active' : ''}`}
                    onClick={() => setListPage(pageNum)}
                    aria-current={pageNum === current ? 'page' : undefined}
                >
                  {pageNum}
                </button>
            ))}
          </div>
          <button
              type="button"
              className="mypage-x__page-arrow"
              disabled={current >= totalPages}
              onClick={() => setListPage((p) => Math.min(totalPages, p + 1))}
              aria-label="다음 페이지"
          >
            {Icon.chevronRight}
          </button>
        </div>
    )
  }

  const renderFolderSortControl = () => {
    const label = folderSortOrder === 'name' ? '이름순' : '최근 저장순'
    return (
        <div className="mypage-x__sort" ref={folderSortMenuRef}>
          <button
              type="button"
              className={`mypage-x__sort-trigger${folderSortMenuOpen ? ' is-open' : ''}`}
              onClick={() => setFolderSortMenuOpen((prev) => !prev)}
              aria-haspopup="listbox"
              aria-expanded={folderSortMenuOpen}
          >
            <span>{label}</span>
            <span className="mypage-x__sort-caret" aria-hidden="true">{Icon.chevron}</span>
          </button>
          {folderSortMenuOpen && (
              <div className="mypage-x__sort-menu" role="listbox">
                {([
                  ['lastSaved', '최근 저장순'],
                  ['name', '이름순'],
                ] as const).map(([value, textLabel]) => (
                    <button
                        key={value}
                        type="button"
                        role="option"
                        aria-selected={folderSortOrder === value}
                        className={`mypage-x__sort-option${folderSortOrder === value ? ' is-selected' : ''}`}
                        onClick={() => {
                          setFolderSortOrder(value)
                          setFolderSortMenuOpen(false)
                        }}
                    >
                      {textLabel}
                    </button>
                ))}
              </div>
          )}
        </div>
    )
  }

  const sortedFolders = (() => {
    const list = [...savedFolders]
    if (folderSortOrder === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    } else {
      list.sort((a, b) => {
        const ta = parseDateFlexible(a.lastSavedAt ?? '')?.getTime() ?? 0
        const tb = parseDateFlexible(b.lastSavedAt ?? '')?.getTime() ?? 0
        return tb - ta
      })
    }
    return list
  })()

  const moveFolderOrder = async (folderId: number, direction: -1 | 1) => {
    const ids = sortedFolders.map((f) => f.folderId)
    const idx = ids.indexOf(folderId)
    const next = idx + direction
    if (idx < 0 || next < 0 || next >= ids.length) return
        ;[ids[idx], ids[next]] = [ids[next], ids[idx]]
    setSavedFolders((prev) => {
      const byId = new Map(prev.map((f) => [f.folderId, f]))
      return ids.map((id, order) => {
        const folder = byId.get(id)!
        return { ...folder, sortOrder: order }
      })
    })
    try {
      await reorderSavedFolders(ids)
    } catch {
      void getSavedFolders().then(setSavedFolders).catch(() => {})
    }
  }

  const [folderToDelete, setFolderToDelete] = useState<SavedFolderResponse | null>(null)
  const [folderDeleteError, setFolderDeleteError] = useState<string | null>(null)

  const openDeleteFolderModal = (folder: SavedFolderResponse) => {
    setFolderDeleteError(null)
    setFolderToDelete(folder)
  }

  const closeDeleteFolderModal = () => {
    if (isBusy) return
    setFolderToDelete(null)
    setFolderDeleteError(null)
  }

  const confirmDeleteFolder = async () => {
    if (!folderToDelete || isBusy) return
    setIsBusy(true)
    setFolderDeleteError(null)
    try {
      await deleteSavedFolder(folderToDelete.folderId)
      if (selectedFavoriteFolderId === folderToDelete.folderId) {
        setSelectedFavoriteFolderId(null)
      }
      const [folders, likedDesigns] = await Promise.all([getSavedFolders(), getLikedDesigns()])
      setSavedFolders(folders)
      setFavorites(likedDesigns)
      setFolderToDelete(null)
    } catch (e) {
      setFolderDeleteError(e instanceof ApiError ? e.message : '폴더 삭제에 실패했습니다.')
    } finally {
      setIsBusy(false)
    }
  }

  const renderPageHeader = (id: SectionId) => {
    const meta = SECTION_META[id]
    const sortable = id === 'scans' || id === 'prints' || id === 'designs'
    const totalCount =
        id === 'scans' ? totalScanCount
            : id === 'prints' ? totalPrintCount
                : id === 'designs' ? totalDesignCount
                    : 0
    const description =
        id === 'favorites'
            ? meta.description.replace('ㅇㅇ', profile?.nickname ?? '회원')
            : meta.description
    return (
        <header className="mypage-x__page-header">
          <p className="mypage-x__page-subtitle">{meta.subtitle}</p>
          <h1 className="mypage-x__title">{meta.title}</h1>
          <p className="mypage-x__desc">{description}</p>
          {sortable && (
              <div className="mypage-x__list-toolbar">
                <p className="mypage-x__list-count">총 {totalCount}개</p>
                <div className="mypage-x__list-toolbar-actions">
                  {renderSortControl()}
                </div>
              </div>
          )}
        </header>
    )
  }

  const renderFavBlockToolbar = (
      title: string,
      count: number,
      sortKind: 'folder' | 'image',
      options?: { onBack?: () => void },
  ) => (
      <div className="mypage-x__fav-block-toolbar">
        <div className="mypage-x__fav-block-title">
          {options?.onBack && (
              <button
                  type="button"
                  className="mypage-x__fav-back"
                  onClick={options.onBack}
                  aria-label="폴더 목록으로"
              >
                {Icon.chevronLeft}
              </button>
          )}
          <h3 className="mypage-x__section-heading mypage-x__section-heading--inline">{title}</h3>
          <p className="mypage-x__list-count">총 {count}개</p>
        </div>
        <div className="mypage-x__list-toolbar-actions">
          {sortKind === 'folder' ? renderFolderSortControl() : renderSortControl()}
        </div>
      </div>
  )

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
        {actionLabel && onAction && <NextStepButton label={actionLabel} onClick={onAction} />}
      </div>
  )

  const renderImageGrid = (
      items: DesignImageResponse[] | SavedDesignResponse[],
      isFavoriteView: boolean,
      empty?: { title: string; description: string; actionLabel?: string; onAction?: () => void },
      options?: {
        dateMode?: 'time' | 'date' | 'datetime'
        interactive?: boolean
        getActivityId?: (item: DesignImageResponse | SavedDesignResponse) => string
      },
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
        actionLabel: '디자인 만들러 가기',
        onAction: () => navigate('/design/chat'),
      })
    }
    const dateMode = options?.dateMode ?? 'date'
    return (
        <div className="mypage-x__grid">
          {items.map((item) => {
            const key = `${item.designId}-${item.imageUrl}`
            const liked = likedKeySet.has(key)
            const rawDate = 'createdAt' in item ? item.createdAt : item.savedAt
            const cardDate =
                dateMode === 'time'
                    ? (formatTimeHms(rawDate) || formatDateOnly(rawDate))
                    : dateMode === 'datetime'
                        ? formatDateTimeFull(rawDate)
                        : formatDateOnly(rawDate)
            const modalDate = formatDateTimeFull(rawDate)
            const activityId = options?.getActivityId?.(item)
            const highlighted = Boolean(options?.interactive && activityId && activeActivityId === activityId)
            const folder =
                'folder' in item
                    ? item.folder
                    : liked
                        ? findFavoriteFolder(item.designId, item.imageUrl)
                        : null
            const isShared =
                'shared' in item
                    ? Boolean(item.shared)
                    : designs.some((d) => d.designId === item.designId && d.shared)
            return (
                <article
                    key={key}
                    data-activity-id={options?.interactive ? activityId : undefined}
                    data-activity-side={options?.interactive ? 'right' : undefined}
                    className={`mypage-x__card${highlighted ? ' is-highlighted' : ''}`}
                    onMouseEnter={() => options?.interactive && activityId && handleActivityHover(activityId)}
                    onMouseLeave={() => options?.interactive && handleActivityHover(null)}
                >
                  <button
                      type="button"
                      className="mypage-x__card-image-btn"
                      onClick={() => {
                        if (options?.interactive && activityId) handleActivitySelect(activityId)
                        openDetailImage({
                          designId: item.designId,
                          imageUrl: item.imageUrl,
                          createdAt: modalDate,
                          liked,
                          folder,
                        })
                      }}
                  >
                    <img src={item.imageUrl} alt="네일 디자인" />
                    {isShared && (
                        <span className="mypage-x__card-share-badge" aria-label="둘러보기에 공유 중">
                          공유 중
                        </span>
                    )}
                    <span className="mypage-x__card-zoom-hint">확대해서 보기</span>
                  </button>
                  <div className="mypage-x__card-footer">
                    <span className="mypage-x__card-date">{cardDate}</span>
                    {liked && folder ? (
                        <div className="mypage-x__like-pill">
                          <button
                              type="button"
                              className="mypage-x__like-pill-folder"
                              onClick={() => openMoveFolderModal(item.designId, item.imageUrl)}
                              title="저장 위치 변경"
                          >
                            {folder.name}
                          </button>
                          <span className="mypage-x__like-pill-divider" aria-hidden="true" />
                          <button
                              type="button"
                              className="mypage-x__like-pill-heart is-liked"
                              onClick={() => void toggleLikeFromGrid(item.designId, item.imageUrl)}
                              aria-label="찜 해제"
                          >
                            {Icon.heart}
                          </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            className={`mypage-x__heart-btn${liked ? ' is-liked' : ''}`}
                            onClick={() => void toggleLikeFromGrid(item.designId, item.imageUrl)}
                            aria-label={liked ? '찜 해제' : '찜하기'}
                        >
                          {Icon.heart}
                        </button>
                    )}
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
          <main className="mypage-x__main" ref={mainPanelRef}>
            {section === 'dashboard' && (
                <section className="mypage-x__panel">
                  <div className="mypage-x__hero">
                    <div className="mypage-x__hero-copy">
                      <p className="mypage-x__hero-subtitle">My Naily</p>
                      <h1 className="mypage-x__hero-title">
                        {profile?.nickname ?? '회원'} 님,<br />
                        오늘도 네일리와 함께해요!
                      </h1>
                      <p className="mypage-x__hero-desc">
                        손 분석부터 네일팁 출력, 디자인까지 — 나의 네일 여정을 한곳에서 관리하세요.
                      </p>
                    </div>
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
                        actionLabel: '디자인 만들러 가기',
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
                      <h2>{profile?.nickname ?? '-'}</h2>
                      <p>{profile?.email ?? '-'}</p>
                      <p className="mypage-x__muted">{profile?.name ?? '-'}</p>

                      {!isEditingNickname && !isEditingPassword && (
                          <div className="mypage-x__profile-actions">
                            <button type="button" className="mypage-x__edit-btn" onClick={handleStartEditNickname}>
                              닉네임 변경
                            </button>
                            <button type="button" className="mypage-x__edit-btn" onClick={handleStartEditPassword}>
                              비밀번호 변경
                            </button>
                          </div>
                      )}

                      {isEditingNickname && (
                          <div className="mypage-x__edit-form">
                            {nicknameStage === 'password' && (
                                <>
                                  <label>
                                    현재 비밀번호
                                    <input
                                        type="password"
                                        value={nicknamePassword}
                                        onChange={(e) => setNicknamePassword(e.target.value)}
                                        placeholder="본인 확인을 위해 입력해 주세요"
                                        autoComplete="current-password"
                                    />
                                  </label>
                                  {nicknamePasswordError && (
                                      <p className="mypage-x__field-error">{nicknamePasswordError}</p>
                                  )}
                                  <div className="mypage-x__edit-actions">
                                    <button type="button" onClick={handleCloseNicknameForm}>
                                      취소
                                    </button>
                                    <button
                                        type="button"
                                        className="primary"
                                        onClick={() => void handleVerifyNicknamePassword()}
                                        disabled={isVerifyingNicknamePassword}
                                    >
                                      {isVerifyingNicknamePassword ? '확인 중...' : '확인'}
                                    </button>
                                  </div>
                                </>
                            )}

                            {nicknameStage === 'nickname' && (
                                <>
                                  <label>
                                    새 닉네임
                                    <input value={nickname} onChange={(e) => setNickname(e.target.value)} autoFocus />
                                  </label>
                                  {nicknameError && <p className="mypage-x__field-error">{nicknameError}</p>}
                                  <div className="mypage-x__edit-actions">
                                    <button type="button" onClick={handleCloseNicknameForm}>
                                      취소
                                    </button>
                                    <button
                                        type="button"
                                        className="primary"
                                        onClick={() => void handleSaveNickname()}
                                        disabled={isSavingNickname || !nickname.trim()}
                                    >
                                      {isSavingNickname ? '저장 중...' : '저장'}
                                    </button>
                                  </div>
                                </>
                            )}

                            {nicknameStage === 'done' && (
                                <>
                                  <p className="mypage-x__field-hint is-ok">닉네임이 변경되었습니다.</p>
                                  <div className="mypage-x__edit-actions">
                                    <button type="button" className="primary" onClick={handleCloseNicknameForm}>
                                      확인
                                    </button>
                                  </div>
                                </>
                            )}
                          </div>
                      )}

                      {isEditingPassword && (
                          <div className="mypage-x__edit-form">
                            {passwordStage === 'password' && (
                                <>
                                  <label>
                                    현재 비밀번호
                                    <input
                                        type="password"
                                        value={currentPassword}
                                        onChange={(e) => setCurrentPassword(e.target.value)}
                                        autoComplete="current-password"
                                    />
                                  </label>
                                  {currentPasswordError && (
                                      <p className="mypage-x__field-error">{currentPasswordError}</p>
                                  )}
                                  <div className="mypage-x__edit-actions">
                                    <button type="button" onClick={handleClosePasswordForm}>
                                      취소
                                    </button>
                                    <button
                                        type="button"
                                        className="primary"
                                        onClick={() => void handleVerifyCurrentPassword()}
                                        disabled={isVerifyingCurrentPassword}
                                    >
                                      {isVerifyingCurrentPassword ? '확인 중...' : '확인'}
                                    </button>
                                  </div>
                                </>
                            )}

                            {passwordStage === 'new' && (
                                <>
                                  <label>
                                    새 비밀번호
                                    <input
                                        type="password"
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        autoComplete="new-password"
                                        autoFocus
                                    />
                                  </label>
                                  <ul className="mypage-x__password-rules">
                                    {getPasswordRuleChecks(newPassword).map((rule) => (
                                        <li key={rule.key} className={rule.passed ? 'is-met' : 'is-unmet'}>
                                          <span aria-hidden="true">{rule.passed ? '✓' : '✕'}</span>
                                          {rule.label}
                                        </li>
                                    ))}
                                  </ul>

                                  <label>
                                    새 비밀번호 확인
                                    <input
                                        type="password"
                                        value={passwordConfirm}
                                        onChange={(e) => setPasswordConfirm(e.target.value)}
                                        autoComplete="new-password"
                                    />
                                  </label>
                                  {passwordConfirm.length > 0 && (
                                      <p
                                          className={`mypage-x__field-hint ${
                                              newPassword === passwordConfirm ? 'is-ok' : 'is-error'
                                          }`}
                                      >
                                        {newPassword === passwordConfirm ? '비밀번호가 일치합니다.' : '비밀번호가 일치하지 않습니다.'}
                                      </p>
                                  )}
                                  {newPasswordSubmitError && (
                                      <p className="mypage-x__field-error">{newPasswordSubmitError}</p>
                                  )}

                                  <div className="mypage-x__edit-actions">
                                    <button type="button" onClick={handleClosePasswordForm}>
                                      취소
                                    </button>
                                    <button
                                        type="button"
                                        className="primary"
                                        onClick={() => void handleSavePassword()}
                                        disabled={isSavingPassword || !isPasswordValid(newPassword) || newPassword !== passwordConfirm}
                                    >
                                      {isSavingPassword ? '변경 중...' : '변경'}
                                    </button>
                                  </div>
                                </>
                            )}

                            {passwordStage === 'done' && (
                                <>
                                  <p className="mypage-x__field-hint is-ok">비밀번호가 변경되었습니다.</p>
                                  <div className="mypage-x__edit-actions">
                                    <button type="button" className="primary" onClick={handleClosePasswordForm}>
                                      확인
                                    </button>
                                  </div>
                                </>
                            )}
                          </div>
                      )}
                    </div>
                  </div>
                </section>
            )}

            {section === 'scans' && (
                <section className="mypage-x__panel">
                  {renderPageHeader('scans')}
                  {isLoading ? (
                      <p className="mypage-x__loading">불러오는 중...</p>
                  ) : sortedScanSessions.length === 0 ? (
                      renderEmptyState({
                        icon: 'hand',
                        title: '손 분석 이력이 없어요',
                        description: '손을 스캔하면 퍼스널컬러와 맞춤 네일팁 쉐입을 추천해드려요.',
                        actionLabel: '손 촬영하러 가기',
                        onAction: () => navigate('/scan/hand'),
                      })
                  ) : (
                      <>
                        {(() => {
                          const { slice, totalPages } = paginate(sortedScanSessions, 'scans')
                          return (
                              <>
                                <div className="mypage-x__scan-list">
                                  {slice.map((session) => renderScanSessionRow(session))}
                                </div>
                                {renderPagination(totalPages)}
                              </>
                          )
                        })()}
                      </>
                  )}
                </section>
            )}

            {section === 'designs' && (
                <section className="mypage-x__panel">
                  {renderPageHeader('designs')}
                  {isLoading ? (
                      <p className="mypage-x__loading">불러오는 중...</p>
                  ) : (
                      <>
                        {(() => {
                          const { slice, totalPages } = paginate(sortedDesigns, 'designs')
                          return (
                              <>
                                {renderImageGrid(slice, false, undefined, { dateMode: 'date' })}
                                {renderPagination(totalPages)}
                              </>
                          )
                        })()}
                      </>
                  )}
                </section>
            )}

            {section === 'timeline' && (
                <section className="mypage-x__panel">
                  {renderPageHeader('timeline')}
                  {isLoading ? (
                      <p className="mypage-x__loading">불러오는 중...</p>
                  ) : !hasAnyTimelineActivity ? (
                      renderEmptyState({
                        icon: 'timeline',
                        title: '아직 활동 기록이 없어요',
                        description: '손 스캔이나 디자인 생성을 시작하면 여기에 타임라인으로 모여요.',
                        actionLabel: '손 스캔하기',
                        onAction: () => navigate('/scan/hand'),
                      })
                  ) : (
                      <div className="mypage-x__day-timeline">
                        <div className="mypage-x__day-nav" ref={calendarRef}>
                          <div className="mypage-x__day-nav-main">
                            <button
                                type="button"
                                className="mypage-x__day-nav-arrow"
                                onClick={() => moveTimelineDate(-1)}
                                aria-label="이전 날"
                            >
                              {Icon.chevronLeft}
                            </button>
                            <button
                                type="button"
                                className={`mypage-x__day-nav-date-btn${calendarOpen ? ' is-open' : ''}`}
                                onClick={openTimelineCalendar}
                                aria-label="날짜 선택"
                                aria-expanded={calendarOpen}
                            >
                              {formatNavDate(selectedTimelineDate)}
                            </button>
                            <button
                                type="button"
                                className="mypage-x__day-nav-arrow"
                                onClick={() => moveTimelineDate(1)}
                                disabled={selectedTimelineDate >= todayKey()}
                                aria-label="다음 날"
                            >
                              {Icon.chevronRight}
                            </button>
                          </div>

                          {calendarOpen && (
                              <div className="mypage-x__naily-cal" role="dialog" aria-label="날짜 선택 달력">
                                <div className="mypage-x__naily-cal-head">
                                  <div className="mypage-x__naily-cal-month-nav">
                                    <button
                                        type="button"
                                        className="mypage-x__naily-cal-month-btn"
                                        onClick={() =>
                                            calendarViewMode === 'days' ? shiftCalendarMonth(-1) : shiftCalendarYear(-1)
                                        }
                                        aria-label={calendarViewMode === 'days' ? '이전 달' : '이전 연도'}
                                    >
                                      {Icon.chevronLeft}
                                    </button>
                                    <button
                                        type="button"
                                        className="mypage-x__naily-cal-month mypage-x__naily-cal-month--btn"
                                        onClick={() => setCalendarViewMode((prev) => (prev === 'days' ? 'months' : 'days'))}
                                        aria-label="월 선택"
                                    >
                                      {calendarViewMode === 'days'
                                          ? `${calendarMonth.year}년 ${calendarMonth.month + 1}월`
                                          : `${calendarMonth.year}년`}
                                    </button>
                                    <button
                                        type="button"
                                        className="mypage-x__naily-cal-month-btn"
                                        onClick={() =>
                                            calendarViewMode === 'days' ? shiftCalendarMonth(1) : shiftCalendarYear(1)
                                        }
                                        aria-label={calendarViewMode === 'days' ? '다음 달' : '다음 연도'}
                                        disabled={
                                            calendarViewMode === 'days'
                                                ? isCurrentOrFutureMonth(calendarMonth.year, calendarMonth.month)
                                                : calendarMonth.year >= new Date().getFullYear()
                                        }
                                    >
                                      {Icon.chevronRight}
                                    </button>
                                  </div>
                                </div>

                                {calendarViewMode === 'months' ? (
                                    <div className="mypage-x__naily-cal-month-grid">
                                      {Array.from({ length: 12 }, (_, month) => month).map((month) => {
                                        const now = new Date()
                                        const isFutureMonth =
                                            calendarMonth.year > now.getFullYear() ||
                                            (calendarMonth.year === now.getFullYear() && month > now.getMonth())
                                        const isSelected = month === calendarMonth.month
                                        return (
                                            <button
                                                key={month}
                                                type="button"
                                                className={[
                                                  'mypage-x__naily-cal-month-cell',
                                                  isSelected ? 'is-selected' : '',
                                                ].filter(Boolean).join(' ')}
                                                onClick={() => selectCalendarMonth(month)}
                                                disabled={isFutureMonth}
                                            >
                                              {month + 1}월
                                            </button>
                                        )
                                      })}
                                    </div>
                                ) : (
                                    <>
                                      <div className="mypage-x__naily-cal-weekdays">
                                        {['일', '월', '화', '수', '목', '금', '토'].map((w) => (
                                            <span key={w}>{w}</span>
                                        ))}
                                      </div>

                                      <div className="mypage-x__naily-cal-grid">
                                        {buildCalendarCells(calendarMonth.year, calendarMonth.month).map((cell, idx) => {
                                          if (!cell) {
                                            return <span key={`empty-${idx}`} className="mypage-x__naily-cal-empty" />
                                          }
                                          const isSelected = cell.key === selectedTimelineDate
                                          const isToday = cell.key === todayKey()
                                          const hasActivity = timelineActivityDates.has(cell.key)
                                          const isFuture = cell.key > todayKey()
                                          return (
                                              <button
                                                  key={cell.key}
                                                  type="button"
                                                  className={[
                                                    'mypage-x__naily-cal-day',
                                                    isSelected ? 'is-selected' : '',
                                                    isToday ? 'is-today' : '',
                                                    hasActivity ? 'has-activity' : '',
                                                    isFuture ? 'is-future' : '',
                                                  ].filter(Boolean).join(' ')}
                                                  onClick={() => selectTimelineDate(cell.key)}
                                                  disabled={isFuture}
                                              >
                                                {cell.day}
                                                {hasActivity && <i aria-hidden="true" />}
                                              </button>
                                          )
                                        })}
                                      </div>
                                    </>
                                )}

                                <div className="mypage-x__naily-cal-footer">
                                  <button
                                      type="button"
                                      className="mypage-x__naily-cal-today"
                                      onClick={() => selectTimelineDate(todayKey())}
                                  >
                                    오늘로 이동
                                  </button>
                                </div>
                              </div>
                          )}
                        </div>

                        <div className="mypage-x__day-body" ref={dayBodyRef}>
                          <aside className="mypage-x__day-rail">
                            <div className="mypage-x__day-rail-head">
                              <p className="mypage-x__day-rail-title">하루 활동 타임라인</p>
                              <span>{dayTotalCount}건</span>
                            </div>
                            {dayEvents.length === 0 ? (
                                <p className="mypage-x__day-overview-empty">이 날에는 아직 활동이 없어요.</p>
                            ) : (
                                <div className="mypage-x__day-rail-list" role="list">
                                  {dayEvents.map((event) => {
                                    const meta = eventKindMeta[event.kind]
                                    const timeLabel = formatTimeHms(event.at)
                                    const highlighted = activeActivityId === event.id
                                    return (
                                        <button
                                            key={event.id}
                                            type="button"
                                            data-activity-id={event.id}
                                            data-activity-side="left"
                                            className={`mypage-x__day-rail-item mypage-x__day-rail-item--${event.kind}${highlighted ? ' is-highlighted' : ''}`}
                                            onMouseEnter={() => handleActivityHover(event.id)}
                                            onMouseLeave={() => handleActivityHover(null)}
                                            onClick={() => handleActivitySelect(event.id)}
                                        >
                                          <div className="mypage-x__day-rail-marker" aria-hidden="true">
                                            <span className="mypage-x__day-rail-dot" />
                                          </div>
                                          <div className="mypage-x__day-rail-content">
                                            {timeLabel && (
                                                <p className="mypage-x__day-rail-time">{timeLabel}</p>
                                            )}
                                            <p className="mypage-x__day-rail-label">
                                              <span className="mypage-x__day-rail-icon">{Icon[meta.icon]}</span>
                                              {meta.label}
                                            </p>
                                          </div>
                                        </button>
                                    )
                                  })}
                                </div>
                            )}
                          </aside>

                          <div className="mypage-x__day-sections">
                            <div className="mypage-x__timeline-block mypage-x__timeline-block--scan">
                              <p className="mypage-x__timeline-block-title">
                                {Icon.hand} 손 촬영 · 분석 <span>{timelineScansOldest.length}건</span>
                              </p>
                              {timelineScansOldest.length === 0 ? (
                                  <p className="mypage-x__day-section-empty">이 날의 손 분석 기록이 없어요.</p>
                              ) : (
                                  <div className="mypage-x__scan-list">
                                    {timelineScansOldest.map((session) =>
                                        renderScanSessionRow(session, {
                                          activityId: `scan-${session.key}`,
                                          interactive: true,
                                        }),
                                    )}
                                  </div>
                              )}
                            </div>

                            <div className="mypage-x__timeline-block mypage-x__timeline-block--print">
                              <p className="mypage-x__timeline-block-title">
                                {Icon.print} 네일팁 출력 <span>{timelinePrintsOldest.length}건</span>
                              </p>
                              {timelinePrintsOldest.length === 0 ? (
                                  <p className="mypage-x__day-section-empty">이 날의 네일팁 출력 기록이 없어요.</p>
                              ) : (
                                  <div className="mypage-x__print-list">
                                    {timelinePrintsOldest.map((order) =>
                                        renderPrintOrderRow(order, {
                                          activityId: `print-${order.id}`,
                                          interactive: true,
                                        }),
                                    )}
                                  </div>
                              )}
                            </div>

                            <div className="mypage-x__timeline-block mypage-x__timeline-block--design">
                              <p className="mypage-x__timeline-block-title">
                                {Icon.design} 디자인 생성 <span>{timelineDesignsOldest.length}건</span>
                              </p>
                              {timelineDesignsOldest.length === 0 ? (
                                  <p className="mypage-x__day-section-empty">이 날의 디자인 생성 기록이 없어요.</p>
                              ) : (
                                  renderImageGrid(timelineDesignsOldest, false, undefined, {
                                    dateMode: 'time',
                                    interactive: true,
                                    getActivityId: (item) => `design-${item.designId}-${item.imageUrl}`,
                                  })
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                  )}
                </section>
            )}

            {section === 'favorites' && (
                <section className="mypage-x__panel">
                  {renderPageHeader('favorites')}
                  {isLoading ? (
                      <p className="mypage-x__loading">불러오는 중...</p>
                  ) : (() => {
                    const selectedFolder = selectedFavoriteFolderId != null
                        ? sortedFolders.find((f) => f.folderId === selectedFavoriteFolderId) ?? null
                        : null
                    const folderImages = selectedFolder
                        ? sortedFavorites.filter((f) => f.folder?.folderId === selectedFolder.folderId)
                        : sortedFavorites

                    if (selectedFolder) {
                      const { slice, totalPages } = paginate(folderImages, 'favorites')
                      return (
                          <div className="mypage-x__fav-block">
                            {renderFavBlockToolbar(selectedFolder.name, folderImages.length, 'image', {
                              onBack: () => setSelectedFavoriteFolderId(null),
                            })}
                            {renderImageGrid(slice, true, {
                              title: '이 폴더에 찜한 이미지가 없어요',
                              description: '다른 폴더로 이동하거나 새 디자인을 찜해보세요.',
                              actionLabel: '전체 찜 보기',
                              onAction: () => setSelectedFavoriteFolderId(null),
                            }, { dateMode: 'date' })}
                            {renderPagination(totalPages)}
                          </div>
                      )
                    }

                    return (
                        <>
                          <div className="mypage-x__fav-block">
                            {renderFavBlockToolbar('폴더', sortedFolders.length, 'folder')}
                            <div className="mypage-x__folder-strip">
                              {sortedFolders.map((folder) => {
                                const thumbs = folder.recentImageUrls ?? []
                                return (
                                    <div key={folder.folderId} className="mypage-x__folder-card">
                                      <button
                                          type="button"
                                          className="mypage-x__folder-card-open"
                                          onClick={() => setSelectedFavoriteFolderId(folder.folderId)}
                                      >
                                        <div className="mypage-x__folder-thumbs" aria-hidden="true">
                                          <div className="mypage-x__folder-thumb-main">
                                            {thumbs[0] ? <img src={thumbs[0]} alt="" /> : <span />}
                                          </div>
                                          <div className="mypage-x__folder-thumb-side">
                                            <div>{thumbs[1] ? <img src={thumbs[1]} alt="" /> : <span />}</div>
                                            <div>{thumbs[2] ? <img src={thumbs[2]} alt="" /> : <span />}</div>
                                          </div>
                                        </div>
                                        <div className="mypage-x__folder-meta">
                                          <div className="mypage-x__folder-meta-row">
                                            <p className="mypage-x__folder-name">{folder.name}</p>
                                          </div>
                                          <p className="mypage-x__folder-count">{folder.itemCount}개</p>
                                        </div>
                                      </button>
                                      {!folder.isDefault && (
                                          <button
                                              type="button"
                                              className="mypage-x__folder-delete-btn"
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                openDeleteFolderModal(folder)
                                              }}
                                              disabled={isBusy}
                                              title="폴더 삭제"
                                              aria-label={`${folder.name} 폴더 삭제`}
                                          >
                                            {Icon.trash}
                                          </button>
                                      )}
                                    </div>
                                )
                              })}

                              {creatingFolder ? (
                                  <div className="mypage-x__folder-card mypage-x__folder-card--new is-editing">
                                    <div className="mypage-x__folder-new-thumb" aria-hidden="true">
                                      {Icon.plus}
                                    </div>
                                    <div className="mypage-x__folder-meta">
                                      <div className="mypage-x__folder-new-input-row">
                                        <input
                                            value={newFolderNameInStrip}
                                            onChange={(e) => setNewFolderNameInStrip(e.target.value)}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter') {
                                                e.preventDefault()
                                                void handleCreateFolderInStrip()
                                              }
                                            }}
                                            placeholder="폴더 이름"
                                            maxLength={50}
                                            autoFocus
                                            disabled={isCreatingFolder}
                                        />
                                        <button
                                            type="button"
                                            className="mypage-x__folder-new-cancel"
                                            onClick={cancelCreatingFolderInStrip}
                                            aria-label="새 폴더 만들기 취소"
                                            disabled={isCreatingFolder}
                                        >
                                          {Icon.close}
                                        </button>
                                      </div>
                                      {createFolderError && <p className="mypage-x__folder-new-error">{createFolderError}</p>}
                                    </div>
                                  </div>
                              ) : (
                                  <button
                                      type="button"
                                      className="mypage-x__folder-card mypage-x__folder-card--new"
                                      onClick={startCreatingFolderInStrip}
                                  >
                                    <div className="mypage-x__folder-new-thumb" aria-hidden="true">
                                      {Icon.plus}
                                    </div>
                                    <div className="mypage-x__folder-meta">
                                      <p className="mypage-x__folder-name">새 폴더 만들기</p>
                                    </div>
                                  </button>
                              )}
                            </div>
                          </div>

                          <div className="mypage-x__fav-block">
                            {renderFavBlockToolbar('전체 찜 이미지', sortedFavorites.length, 'image')}
                            {(() => {
                              const { slice, totalPages } = paginate(sortedFavorites, 'favorites')
                              return (
                                  <>
                                    {renderImageGrid(slice, true, {
                                      title: '찜한 디자인이 없어요',
                                      description: '마음에 드는 디자인에 ♥를 눌러 모아보세요.',
                                      actionLabel: '디자인 둘러보기',
                                      onAction: () => setSection('designs'),
                                    }, { dateMode: 'date' })}
                                    {renderPagination(totalPages)}
                                  </>
                              )
                            })()}
                          </div>
                        </>
                    )
                  })()}
                </section>
            )}

            {section === 'prints' && (
                <section className="mypage-x__panel">
                  {renderPageHeader('prints')}
                  {sortedPrints.length === 0 ? (
                      renderEmptyState({
                        icon: 'print',
                        title: '출력 신청 내역이 없어요',
                        description: '손 분석 후 맞춤 네일팁 3D 출력을 신청할 수 있어요.',
                        actionLabel: '출력하러 가기',
                        onAction: () => navigate('/print'),
                      })
                  ) : (
                      <>
                        {(() => {
                          const { slice, totalPages } = paginate(sortedPrints, 'prints')
                          return (
                              <>
                                <div className="mypage-x__print-list">
                                  {slice.map((order) => renderPrintOrderRow(order))}
                                </div>
                                {renderPagination(totalPages)}
                              </>
                          )
                        })()}
                      </>
                  )}
                </section>
            )}
          </main>
        </div>

        {/* ── 이미지 상세 모달 ───────────────────────────────────────── */}
        <DesignImageDetailModal
            image={detailImage}
            onClose={closeDetailImage}
            checkLiked={(designId, imageUrl) => likedKeySet.has(`${designId}-${imageUrl}`)}
            onLikeChange={(designId, imageUrl, saved) => {
              if (saved) {
                setFavorites((prev) => [saved, ...prev.filter((f) => !(f.designId === designId && f.imageUrl === imageUrl))])
              } else {
                setFavorites((prev) => prev.filter((f) => !(f.designId === designId && f.imageUrl === imageUrl)))
              }
              void getSavedFolders().then(setSavedFolders).catch(() => {})
            }}
            onShareChange={(designId, shared) => {
              setDesigns((prev) => prev.map((d) => (d.designId === designId ? { ...d, shared } : d)))
            }}
            onDeleted={(designId) => {
              setDesigns((prev) => prev.filter((d) => d.designId !== designId))
              setFavorites((prev) => prev.filter((f) => f.designId !== designId))
            }}
        />

        <FavoriteFolderModal
            open={!!likeModalTarget}
            onClose={() => setLikeModalTarget(null)}
            onConfirm={confirmLikeWithFolder}
            mode={likeModalTarget?.mode ?? 'like'}
            initialFolderId={likeModalTarget?.currentFolderId ?? null}
        />

        {/* ── 찜 폴더 삭제 확인 모달 ───────────────────────────────────── */}
        {folderToDelete && (
            <div className="mypage-x__modal" role="dialog" aria-modal="true" aria-label="폴더 삭제 확인">
              <button
                  type="button"
                  className="mypage-x__modal-backdrop"
                  aria-label="닫기"
                  onClick={closeDeleteFolderModal}
              />
              <div className="mypage-x__modal-panel mypage-x__confirm-panel">
                <button
                    type="button"
                    className="mypage-x__modal-close mypage-x__modal-close--plain"
                    onClick={closeDeleteFolderModal}
                    aria-label="닫기"
                    disabled={isBusy}
                >
                  ✕
                </button>

                <div className="mypage-x__confirm-icon mypage-x__confirm-icon--danger" aria-hidden="true">
                  {Icon.trash}
                </div>

                <h2 className="mypage-x__confirm-title">
                  <strong>{folderToDelete.name}</strong> 폴더를 삭제할까요?
                </h2>

                {folderToDelete.itemCount > 0 && (
                    <p className="mypage-x__confirm-desc">
                      폴더만 사라지고, 안에 있던 찜 이미지 <strong>{folderToDelete.itemCount}개</strong>는{' '}
                      <strong>기본</strong> 폴더로 자동 이동돼요.
                    </p>
                )}

                {folderToDelete.itemCount > 0 && (
                    <div className="mypage-x__confirm-flow" aria-hidden="true">
                      <div className="mypage-x__confirm-flow-folder">
                        <div className="mypage-x__confirm-flow-thumbs">
                          {(folderToDelete.recentImageUrls ?? []).slice(0, 3).map((url, i) => (
                              <img key={i} src={url} alt="" />
                          ))}
                          {(folderToDelete.recentImageUrls ?? []).length === 0 && (
                              <span className="mypage-x__confirm-flow-empty">{Icon.folder}</span>
                          )}
                        </div>
                        <span className="mypage-x__confirm-flow-label">{folderToDelete.name}</span>
                      </div>

                      <span className="mypage-x__confirm-flow-arrow">{Icon.chevronRight}</span>

                      <div className="mypage-x__confirm-flow-folder mypage-x__confirm-flow-folder--default">
                        <div className="mypage-x__confirm-flow-thumbs mypage-x__confirm-flow-thumbs--default">
                          <span className="mypage-x__confirm-flow-heart">{Icon.heart}</span>
                        </div>
                        <span className="mypage-x__confirm-flow-label">기본</span>
                      </div>
                    </div>
                )}

                {folderDeleteError && <p className="mypage-x__message">{folderDeleteError}</p>}

                <div className="mypage-x__modal-actions">
                  <button type="button" onClick={closeDeleteFolderModal} disabled={isBusy}>
                    취소
                  </button>
                  <button
                      type="button"
                      className="mypage-x__modal-action--danger"
                      onClick={() => void confirmDeleteFolder()}
                      disabled={isBusy}
                  >
                    <span>{isBusy ? '삭제 중...' : '폴더 삭제'}</span>
                  </button>
                </div>
              </div>
            </div>
        )}

        {/* ── 손 분석 결과 상세 모달 ───────────────────────────────────── */}
        <ScanDetailModal session={scanDetailSession} onClose={closeScanDetail} />

        {/* ── 네일팁 출력 상세 모달 ───────────────────────────────────── */}
        {printDetailOrder && (() => {
          const shapeLabel = getNailShape(printDetailOrder.shapeId)?.labelKo
              ?? printDetailOrder.shapeLabelKo
              ?? printDetailOrder.shapeId
          const shapeEn = getNailShape(printDetailOrder.shapeId)?.labelEn ?? null
          const statusKey = printDetailOrder.status.toLowerCase()
          const hasLinkedScan = Boolean(printDetailOrder.leftScanId || printDetailOrder.rightScanId)
          const lengthPct = printDetailScan
              ? Math.min(100, Math.max(8, (printDetailScan.avgLength / 18) * 100))
              : 0
          const widthPct = printDetailScan
              ? Math.min(100, Math.max(8, (printDetailScan.avgWidth / 14) * 100))
              : 0
          const curvePct = printDetailScan
              ? Math.min(100, Math.max(8, printDetailScan.avgCurve * 100))
              : 0

          const subtitle = formatDateTimeFull(printDetailOrder.orderedAt)
              || formatNavDate(dateKeyOf(printDetailOrder.orderedAt))

          return (
              <ScanXModalShell
                  ariaLabel="네일팁 출력 상세"
                  eyebrow="Nail Tips Print"
                  title="네일팁 출력"
                  subtitle={subtitle}
                  onClose={closePrintDetail}
              >
                  <section className={`mypage-x__printx-status mypage-x__printx-status--${statusKey}`}>
                    <div className="mypage-x__printx-status-copy">
                      <p className="mypage-x__scanx-kicker">진행 상태</p>
                      <strong>{PRINT_STATUS_LABEL[printDetailOrder.status]}</strong>
                      <span className={printDetailOrder.status === 'FAILED' ? 'mypage-x__printx-status-fail' : undefined}>
                        {printDetailOrder.status === 'FAILED' && printDetailOrder.failReason
                            ? printDetailOrder.failReason
                            : PRINT_STATUS_HINT[printDetailOrder.status]}
                      </span>
                    </div>
                    <span className={`mypage-x__badge mypage-x__badge--${statusKey}`}>
                      {PRINT_STATUS_LABEL[printDetailOrder.status]}
                    </span>
                  </section>

                  {printDetailOrder.status === 'PRINTING' && <PrinterProgressWidget />}

                  <section className="mypage-x__scanx-shape">
                    <div className="mypage-x__scanx-shape-copy">
                      <p className="mypage-x__scanx-kicker">신청한 네일팁 쉐입</p>
                      <strong>{shapeLabel}</strong>
                      {shapeEn && <span>{shapeEn}</span>}
                    </div>
                    <div className="mypage-x__scanx-shape-preview" aria-hidden="true">
                      {SHAPE_PREVIEW_IMAGES[printDetailOrder.shapeId] ? (
                          <img src={SHAPE_PREVIEW_IMAGES[printDetailOrder.shapeId]} alt="" />
                      ) : (
                          Icon.print
                      )}
                    </div>
                  </section>

                  <p className="mypage-x__scanx-comment">
                    <span className="mypage-x__scanx-comment-label">
                      출력 요약
                      <i aria-hidden="true">{Icon.summaryIcon}</i>
                    </span>
                    {shapeLabel} 쉐입으로 네일팁 10개(양손) 출력을 신청했어요.
                  </p>

                  <section className="mypage-x__scanx-metrics" aria-label="출력에 사용된 손톱 지표">
                    <p className="mypage-x__scanx-section-label">출력에 사용된 손톱 수치</p>
                    {!hasLinkedScan ? (
                        <p className="mypage-x__printx-empty-note">
                          연결된 손 분석 기록이 없어요. 예전에 신청한 건일 수 있어요.
                        </p>
                    ) : isLoadingPrintDetail || !printDetailScan ? (
                        <p className="mypage-x__empty">연결된 손 분석 결과를 불러오는 중...</p>
                    ) : (
                        <>
                          <p className="mypage-x__printx-scan-note">
                            {formatNavDate(dateKeyOf(printDetailScan.scannedAt))} 손 분석 결과 사용
                          </p>
                          <div className="mypage-x__scanx-metric-grid">
                            <article className="mypage-x__scanx-metric">
                              <div className="mypage-x__scanx-metric-top">
                                <div className="mypage-x__scanx-metric-copy">
                                  <p>길이</p>
                                  <strong>{printDetailScan.avgLength.toFixed(1)}<em>mm</em></strong>
                                </div>
                                <span className="mypage-x__scanx-metric-icon" aria-hidden="true">{Icon.lengthIcon}</span>
                              </div>
                              <div className="mypage-x__scanx-meter" aria-hidden="true">
                                <i style={{ width: `${lengthPct}%` }} />
                              </div>
                              <span className="mypage-x__scanx-metric-hint">끝에서 큐티클까지</span>
                            </article>
                            <article className="mypage-x__scanx-metric">
                              <div className="mypage-x__scanx-metric-top">
                                <div className="mypage-x__scanx-metric-copy">
                                  <p>너비</p>
                                  <strong>{printDetailScan.avgWidth.toFixed(1)}<em>mm</em></strong>
                                </div>
                                <span className="mypage-x__scanx-metric-icon" aria-hidden="true">{Icon.widthIcon}</span>
                              </div>
                              <div className="mypage-x__scanx-meter" aria-hidden="true">
                                <i style={{ width: `${widthPct}%` }} />
                              </div>
                              <span className="mypage-x__scanx-metric-hint">최대 너비 평균</span>
                            </article>
                            <article className="mypage-x__scanx-metric">
                              <div className="mypage-x__scanx-metric-top">
                                <div className="mypage-x__scanx-metric-copy">
                                  <p>곡률</p>
                                  <strong>{printDetailScan.avgCurve.toFixed(2)}</strong>
                                </div>
                                <span className="mypage-x__scanx-metric-icon" aria-hidden="true">{Icon.curveIcon}</span>
                              </div>
                              <div className="mypage-x__scanx-meter" aria-hidden="true">
                                <i style={{ width: `${curvePct}%` }} />
                              </div>
                              <span className="mypage-x__scanx-metric-hint">C-curve (0~1)</span>
                            </article>
                          </div>
                        </>
                    )}
                  </section>
              </ScanXModalShell>
          )
        })()}
      </AppShell>
  )
}