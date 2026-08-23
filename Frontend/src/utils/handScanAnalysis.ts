import type { NailShapeId } from '@/constants/nailShapes'
import { PERSONAL_COLOR_SWATCHES, SEASON_ROWS } from '@/constants/designPreferences'

export type MetricComparison = {
  value: number
  unit: string
  percentile: number
  comparisonLabel: string
}

export type FingerDetail = {
  id: string
  name: string
  lengthMm: number
  widthMm: number
  cCurve: number
  overlay: { x: number; y: number }
  // profile.json 논문 기준 비교값 (선택적 — 데이터 없을 때 기본값 사용)
  widthVsAvgMm?:  number
  lengthVsAvgMm?: number
  widthSize?:     string
  lengthSize?:    string
  nailSize?:      string
}

export type HandScanAnalysis = {
  seasonCode: string
  seasonNameKo: string
  summary: string
  skinToneHex: string
  personalColorPalette: string[]
  recommendedShape: NailShapeId
  length: MetricComparison
  width: MetricComparison
  cCurve: MetricComparison
  fingers: FingerDetail[]
}

const FINGER_NAMES = [
  '엄지',
  '검지',
  '중지',
  '약지',
  '소지',
  '엄지 (오른손)',
  '검지 (오른손)',
  '중지 (오른손)',
  '약지 (오른손)',
  '소지 (오른손)',
]

/** Nail centers on public/images/hands.png (left hand ×5, right hand ×5) */
const FINGER_OVERLAYS: { x: number; y: number }[] = [
  { x: 42, y: 47 },
  { x: 35, y: 24 },
  { x: 27, y: 16 },
  { x: 19, y: 22 },
  { x: 14, y: 34 },
  { x: 58, y: 47 },
  { x: 65, y: 24 },
  { x: 73, y: 16 },
  { x: 81, y: 22 },
  { x: 86, y: 34 },
]

function hashString(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0
  }
  return hash
}

function comparisonLabel(percentile: number, small: string, large: string, average: string): string {
  if (percentile < 35) return small
  if (percentile > 65) return large
  return average
}

function pickShape(seasonCode: string, avgLength: number): NailShapeId {
  const shapes: NailShapeId[] = ['square', 'oval', 'round', 'almond', 'stiletto', 'ballerina']
  const index = (hashString(seasonCode) + Math.round(avgLength * 10)) % shapes.length
  return shapes[index] ?? 'oval'
}

function skinToneFromSeason(seasonCode: string): string {
  const palette = PERSONAL_COLOR_SWATCHES[seasonCode] ?? ['#E8C4B8']
  return palette[1] ?? '#E8C4B8'
}

export function buildHandScanAnalysis(seasonCode: string): HandScanAnalysis {
  const seasonRow = SEASON_ROWS.find((row) => row.code === seasonCode)
  const seed = hashString(seasonCode)
  const baseLength = 11.5 + (seed % 30) / 10
  const baseWidth = 9.2 + (seed % 20) / 10
  const baseCurve = 0.42 + (seed % 25) / 100

  const lengthPercentile = 25 + (seed % 50)
  const widthPercentile = 20 + ((seed >> 3) % 55)
  const curvePercentile = 30 + ((seed >> 5) % 45)

  const fingers: FingerDetail[] = FINGER_NAMES.map((name, index) => {
    const variance = (index % 3) * 0.4
    return {
      id: `finger-${index}`,
      name,
      lengthMm: Number((baseLength + variance - index * 0.15).toFixed(1)),
      widthMm: Number((baseWidth + variance * 0.6 - index * 0.08).toFixed(1)),
      cCurve: Number((baseCurve + variance * 0.05).toFixed(2)),
      overlay: FINGER_OVERLAYS[index] ?? { x: 50, y: 50 },
    }
  })

  const palette = PERSONAL_COLOR_SWATCHES[seasonCode] ?? PERSONAL_COLOR_SWATCHES.spring_light

  return {
    seasonCode,
    seasonNameKo: seasonRow?.nameKo ?? seasonCode,
    //summary: `손톱 길이·너비·곡률과 피부 톤을 분석해 ${seasonRow?.nameKo ?? '퍼스널 컬러'} 타입으로 분류했습니다.`,
    summary: '손톱 길이·너비·곡률과 피부 톤을 분석했습니다.',
    skinToneHex: skinToneFromSeason(seasonCode),
    personalColorPalette: palette,
    recommendedShape: pickShape(seasonCode, baseLength),
    length: {
      value: baseLength,
      unit: 'mm',
      percentile: lengthPercentile,
      comparisonLabel: comparisonLabel(lengthPercentile, '평균보다 짧은 편', '평균보다 긴 편', '평균 범위'),
    },
    width: {
      value: baseWidth,
      unit: 'mm',
      percentile: widthPercentile,
      comparisonLabel: comparisonLabel(widthPercentile, '좁은 편', '넓은 편', '평균 범위'),
    },
    cCurve: {
      value: baseCurve,
      unit: '',
      percentile: curvePercentile,
      comparisonLabel: comparisonLabel(curvePercentile, '완만한 편', '깊은 편', '평균 범위'),
    },
    fingers,
  }
}