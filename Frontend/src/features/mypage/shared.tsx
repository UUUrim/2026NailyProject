// 마이페이지 전체(레이아웃 + 7개 탭)가 공유하는 모듈 스코프 타입/상수/순수 함수 모음.
// MyPage.tsx가 하나의 파일이던 시절 컴포넌트 바깥(모듈 스코프)에 있던 선언들을 그대로 옮겼다.
import type { PrintOrderResponse as NailTipPrintOrder } from '@/entities/print/api'
import type { DesignImageResponse, SavedDesignResponse } from '@/entities/design/api'
import type { ScanResultResponse } from '@/entities/scan/api'
import { ModalActionIcons } from '@/shared/components/ModalActionIcons'

export type SectionId = 'dashboard' | 'profile' | 'timeline' | 'scans' | 'prints' | 'designs' | 'favorites'

export type LikeModalTarget = {
  designId: number
  imageUrl: string
  mode: 'like' | 'move'
  currentFolderId?: number | null
}

export const PRINT_STATUS_LABEL: Record<NailTipPrintOrder['status'], string> = {
  QUEUED: '출력 대기',
  MERGING: '모델 병합 중',
  MERGED: '병합 완료',
  PRINTING: '출력 중',
  COMPLETED: '완료',
  FAILED: '실패',
}

export const PRINT_STATUS_HINT: Record<NailTipPrintOrder['status'], string> = {
  QUEUED: '프린터 대기열에 등록되어 있어요.',
  MERGING: '손톱 모델을 하나로 합치고 있어요.',
  MERGED: '모델 병합이 끝났어요. 곧 출력이 시작돼요.',
  PRINTING: '네일팁을 출력하고 있어요.',
  COMPLETED: '네일팁 출력이 완료되었어요.',
  FAILED: '출력 중 문제가 발생했어요.',
}

// 손 스캔 분석 상태 (네일팁 출력 관련 상태는 출력 이력에서만 표시)
export const SCAN_STATUS_LABEL: Record<string, string> = {
  READY: '분석 대기 중',
  ANALYZING: '분석 진행 중',
  MEASURED: '분석 완료',
  GENERATING_STL: '분석 완료',
  COMPLETED: '분석 완료',
  FAILED: '분석 실패',
}

export function scanStatusBadgeClass(status: string | null | undefined): string {
  const raw = (status ?? '').toLowerCase()
  if (raw === 'generating_stl') return 'measured'
  return raw || 'ready'
}

export function formatMetricCurve(value: number | null | undefined): string {
  if (value == null) return '-'
  const fixed = Number(value).toFixed(2).replace(/\.?0+$/, '')
  return fixed
}

export type FingerStat = { label: string; hand: 'L' | 'R'; partLabel: string; lengthMm: number; widthMm: number; cCurve: number }

export type ScanDetail = {
  scannedAt: string
  tone: string | null
  brightness: number | null
  saturation: number | null
  shapeId: string | null
  avgLength: number
  avgWidth: number
  avgCurve: number
  fingers: FingerStat[]
  comment: string
}

export const FINGER_LABEL_KO: Record<string, string> = {
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

export function buildScanDetail(left: ScanResultResponse | null, right: ScanResultResponse | null): ScanDetail {
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
    tone: left?.tone || right?.tone || null,
    brightness: left?.brightness ?? right?.brightness ?? null,
    saturation: left?.saturation ?? right?.saturation ?? null,
    shapeId: left?.shape || right?.shape || null,
    avgLength,
    avgWidth,
    avgCurve,
    fingers,
    comment: `평균보다 손톱이 ${isLong ? '긴' : '짧은'} 편이고, ${isNarrow ? '좁은' : '넓은'} 편이에요. 곡률(C-curve)은 ${isLowCurve ? '완만한' : '뚜렷한'} 편입니다.`,
  }
}

// ── 아이콘 (선 스타일로 통일) ────────────────────────────────────────────
export const Icon = {
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

export type NavItem = { id: SectionId; label: string; icon: keyof typeof Icon }

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
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

export const SECTION_META: Record<SectionId, { subtitle: string; title: string; description: string }> = {
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
    subtitle: 'Designs',
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
export function parseDateFlexible(raw: string | number[] | null | undefined): Date | null {
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

export function dateKeyOf(raw: string): string {
  const d = parseDateFlexible(raw)
  if (!d) return 'unknown'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function dateLabelOf(key: string): string {
  if (key === 'unknown') return '날짜 정보 없음'
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
}

export function formatTimeHms(raw: string): string {
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

export function formatDateOnly(raw: string): string {
  const d = parseDateFlexible(raw)
  if (!d) return typeof raw === 'string' ? raw : ''
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`
}

export function formatDateTimeFull(raw: string): string {
  const d = parseDateFlexible(raw)
  if (!d) return raw
  const time = formatTimeHms(raw)
  const date = formatDateOnly(raw)
  return time ? `${date} ${time}` : date
}

export function compareByTime(aRaw: string, bRaw: string, order: 'newest' | 'oldest') {
  const ta = parseDateFlexible(aRaw)?.getTime() ?? 0
  const tb = parseDateFlexible(bRaw)?.getTime() ?? 0
  return order === 'newest' ? tb - ta : ta - tb
}

export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function todayKey(): string {
  return toDateKey(new Date())
}

export function shiftDateKey(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + delta)
  return toDateKey(date)
}

export function formatNavDate(key: string): string {
  if (!key || key === 'unknown') return '날짜 정보 없음'
  const [y, m, d] = key.split('-').map(Number)
  return `${y}년 ${m}월 ${d}일`
}

export function buildCalendarCells(year: number, month: number) {
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

export type TimelineDayGroup = {
  scans: import('@/shared/utils/scanDetail').ScanSession[]
  designs: DesignImageResponse[]
  prints: NailTipPrintOrder[]
}

export type TimelineEventKind = 'scan' | 'print' | 'design'

export type TimelineDayEvent = {
  id: string
  kind: TimelineEventKind
  at: string
  timeMs: number
}

export { type NailTipPrintOrder, type DesignImageResponse, type SavedDesignResponse }
