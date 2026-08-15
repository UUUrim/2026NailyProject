import type { ScanHistoryItem, ScanResultResponse } from '@/apis/scan'
import { PERSONAL_COLOR_SWATCHES } from '@/constants/designPreferences'

/** 한 번의 촬영에서 나온 왼손/오른손 스캔 기록을 하나로 묶은 단위 */
export type ScanSession = {
  key: string
  scannedAt: string
  leftScanId: number | null
  rightScanId: number | null
  seasonCode: string | null
  seasonNameKo: string | null
  shape: string | null
  status: string | null
  avgLengthMm: number | null
  avgWidthMm: number | null
  avgCurve: number | null
}

export type FingerStat = {
  label: string
  hand: 'L' | 'R'
  partLabel: string
  lengthMm: number
  widthMm: number
  cCurve: number
}

export type ScanDetail = {
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

export function avgNullable(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null && b == null) return null
  if (a == null) return b ?? null
  if (b == null) return a
  return Number(((a + b) / 2).toFixed(2))
}

/** 퍼스널컬러 팔레트의 대표색(두 번째 스와치, 없으면 첫 색) */
export function representativePersonalColor(seasonCode: string | null | undefined): string {
  const palette = seasonCode ? PERSONAL_COLOR_SWATCHES[seasonCode] : undefined
  if (!palette?.length) return '#de869f'
  return palette[1] ?? palette[0]
}

export function pickPalettePreview(seasonCode: string | null | undefined, count = 5): string[] {
  const palette = seasonCode ? PERSONAL_COLOR_SWATCHES[seasonCode] : undefined
  if (!palette?.length) return []
  return palette.slice(0, count)
}

export function formatMetricCurve(value: number | null | undefined): string {
  if (value == null) return '-'
  const fixed = Number(value).toFixed(2).replace(/\.?0+$/, '')
  return fixed
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

// 백엔드가 주는 "yyyy. M. d." / "yyyy. M. d. HH:mm:ss" 형식이든 ISO 문자열이든 안전하게 Date로 변환
// (MyPage 외 utils에는 없음 — 여기로 복사)
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

export function formatDateTimeFull(raw: string): string {
  const d = parseDateFlexible(raw)
  if (!d) return raw
  const time = formatTimeHms(raw)
  const date = formatDateOnly(raw)
  return time ? `${date} ${time}` : date
}

export function laterScannedAt(a: string, b: string): string {
  const ta = parseDateFlexible(a)?.getTime() ?? 0
  const tb = parseDateFlexible(b)?.getTime() ?? 0
  return tb >= ta ? b : a
}

export function pickAnalysisStatus(
    leftStatus: string | null | undefined,
    rightStatus: string | null | undefined,
): string | null {
  const statuses = [leftStatus, rightStatus].filter(Boolean) as string[]
  if (statuses.length === 0) return null
  const order = ['FAILED', 'READY', 'ANALYZING', 'MEASURED', 'GENERATING_STL', 'COMPLETED']
  for (const s of order) {
    if (statuses.includes(s)) return s
  }
  return statuses[0]
}

export function formatNavDate(key: string): string {
  if (!key || key === 'unknown') return '날짜 정보 없음'
  const [y, m, d] = key.split('-').map(Number)
  return `${y}년 ${m}월 ${d}일`
}

/** 분석이 완료되어 출력/재확인이 의미 있는 상태인지 (재스캔 안내, 출력 페이지 등에서 공용으로 사용) */
export const COMPLETED_SCAN_STATUSES = new Set(['MEASURED', 'GENERATING_STL', 'COMPLETED'])

export function isCompletedScanStatus(status: string | null | undefined): boolean {
  return Boolean(status && COMPLETED_SCAN_STATUSES.has(status))
}

/**
 * 세션에 실제 분석 결과값(퍼스널 컬러 / 추천 쉐입 / 길이·너비·곡률)이 전부 채워져 있는지 확인한다.
 * status 문자열만으로는 "완료"라고 나와도 실제 값은 비어 있는 경우가 있어서, 손 분석 결과 페이지에
 * 실제로 표시되는 값 자체를 기준으로 "분석 완료"를 판단한다.
 * (마이페이지 손 분석 이력, 재스캔 안내, 네일팁 출력 페이지에서 공용으로 사용)
 */
export function isFullyAnalyzedSession(session: ScanSession): boolean {
  return (
      session.seasonCode != null &&
      session.shape != null &&
      session.avgLengthMm != null &&
      session.avgWidthMm != null &&
      session.avgCurve != null
  )
}

/**
 * 한 번의 촬영에서 나온 왼손/오른손 기록을 하나의 세션으로 묶음.
 * (같은 세션이면 촬영 시각이 서로 가까움 — 90분 이내면 같은 세션으로 판단)
 * 양손 촬영을 모두 마친 경우만 반환.
 */
export function buildScanSessions(scans: ScanHistoryItem[]): ScanSession[] {
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
    // 양손 촬영을 모두 마친 경우만 이력으로 저장·표시
    if (!partner) return
    used.add(partner.scanId)

    const left = scan.handSide === 'LEFT' ? scan : partner.handSide === 'LEFT' ? partner : null
    const right = scan.handSide === 'RIGHT' ? scan : partner.handSide === 'RIGHT' ? partner : null
    if (!left || !right) return

    sessions.push({
      key: `${left.scanId}-${right.scanId}`,
      scannedAt: laterScannedAt(left.scannedAt, right.scannedAt),
      leftScanId: left.scanId,
      rightScanId: right.scanId,
      seasonCode: left.seasonCode ?? right.seasonCode ?? null,
      seasonNameKo: left.seasonNameKo ?? right.seasonNameKo ?? null,
      shape: left.shape ?? right.shape ?? null,
      status: pickAnalysisStatus(left.status, right.status),
      avgLengthMm: avgNullable(left.avgLengthMm, right.avgLengthMm),
      avgWidthMm: avgNullable(left.avgWidthMm, right.avgWidthMm),
      avgCurve: avgNullable(left.avgCurve, right.avgCurve),
    })
  })

  return sessions
}