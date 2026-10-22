import type { ScanResultResponse } from '@/entities/scan/api'

// 손톱 평균 기준값과, 열 손가락 평균 판정을 "평균보다 긴/짧은 편" 같은 비교 문구·막대로 바꾸는 공용 로직.
// 평균 판정 자체는 화면에서 계산하지 않고 스캔 서버(scan/nail_measurer.py classify_size_totals)가
// 통합 measurements.json 상단 summary에 남긴 length_size/width_size/c_curve_size를 그대로 쓴다 (nailSummaryMetrics).
// 아래 NAIL_BASELINE은 성인 평균 손톱 규격 고정값이다.
// (mean: 기준 평균값, spread: 모집단 표준편차)
//
// cCurve는 0~1 지수가 아니라 스캔 파이프라인(scan/nail_measurer.py)이 내려주는 C-curve
// sagitta 깊이(mm) — 손톱 너비에 걸친 단면 활이 얼마나 깊은지다. 기준값은 STANDARD_NAILS의
// 손가락별 c_curve_mm/c_curve_sd(한국 성인 여성 평균을 우리 sagitta 단위로 환산한 값, 근거는
// 그쪽 주석)를 아래 length/width와 같은 방식으로 평균/풀링한 값이다:
//   cCurve mean = (2.85+2.26+2.43+2.35+1.71)/5 ≈ 2.3mm
//   spread(≈SD) = sqrt(각 손가락 SD²의 평균) ≈ 0.4mm
// (이전에는 근거 없이 2.0mm/1.0으로 잡혀 있었다.)
//
// length/width의 mean·spread는 scan/nail_measurer.py의 STANDARD_NAILS(Yeo, Kim, Park & Kim
// (2017), "우리나라 성인 여성의 손톱 형태 측정", J. Kor. Soc. Cosmetology 23(2), 269-275,
// Table 4 "Total")를 그대로 근거로 삼는다 — 5개 손가락 평균·SD를 그대로 평균/풀링한 값:
//   length mean = (12.83+11.46+11.81+11.49+9.82)/5 ≈ 11.5mm
//   width  mean = (12.60+9.83+10.38+9.70+7.85)/5   ≈ 10.1mm
//   spread(≈SD) = sqrt(각 손가락 SD²의 평균) — length ≈ 0.98mm, width ≈ 0.85mm
// (이전에는 13mm/3.5, 10mm/2.2로 잡혀 있었는데, length mean이 실측 평균보다 1.5mm 높고
// spread도 실제 SD의 3~4배로 넓어서, 웬만큼 짧거나 길어도 항상 "평균" 근처로만 나왔다.)
export const NAIL_BASELINE = {
  length: { mean: 11.5, spread: 1.0 }, // mm
  width: { mean: 10.1, spread: 0.85 }, // mm
  cCurve: { mean: 2.3, spread: 0.4 }, // mm (C-curve sagitta)
}

// cCurveMm 실측값이 없을 때 쓰는 "일반적인 손톱" 대체값 — 어떤 손가락인지 모르는 호출부용
// (손가락을 알면 FINGER_SIZE_MM의 cCurveMm을 쓴다). NAIL_BASELINE.cCurve.mean과 맞춰 두어야
// 대체값이 들어가도 percentile이 한쪽으로 튀지 않는다.
export const FALLBACK_C_CURVE_MM = 2.3

// 손가락 하나의 측정값이 통째로 없을 때 쓰는 "일반적인 손톱" 대체값. NAIL_BASELINE의
// length/width mean과 맞춰 둔다 — 어떤 손가락인지 모르는 호출부(측정 실패 시 파싱 폴백)에서 쓴다.
export const FALLBACK_LENGTH_MM = 11.5
export const FALLBACK_WIDTH_MM = 10.1

// 손가락별 평균 실측값 (mm) — scan/nail_measurer.py STANDARD_NAILS와 동일 출처/순서
// (엄지 → 검지 → 중지 → 약지 → 소지). 개별 손가락 측정이 없을 때, 손가락 위치를 아는
// 호출부에서 위의 FALLBACK_LENGTH_MM/WIDTH_MM/C_CURVE_MM 대신 이 표를 쓰면 더 사실적인 대체값이 된다.
export const FINGER_SIZE_MM: { lengthMm: number; widthMm: number; cCurveMm: number }[] = [
  { lengthMm: 12.83, widthMm: 12.60, cCurveMm: 2.85 }, // 엄지
  { lengthMm: 11.46, widthMm: 9.83, cCurveMm: 2.26 }, // 검지
  { lengthMm: 11.81, widthMm: 10.38, cCurveMm: 2.43 }, // 중지
  { lengthMm: 11.49, widthMm: 9.70, cCurveMm: 2.35 }, // 약지
  { lengthMm: 9.82, widthMm: 7.85, cCurveMm: 1.71 }, // 소지
]

// 스캔 서버의 5단계 평균 판정 (손가락별 z-score = (실측 - 그 손가락 평균) / SD 를 -2/-1/+1/+2에서 나누고, 열 손가락 다수결)
type NailSizeLevel = 'much_smaller' | 'smaller' | 'average' | 'larger' | 'much_larger'

const NAIL_SIZE_LABELS: Record<'length' | 'width' | 'cCurve', Record<NailSizeLevel, string>> = {
  length: {
    much_smaller: '평균보다 많이 짧은 편',
    smaller: '평균보다 짧은 편',
    average: '평균 범위',
    larger: '평균보다 긴 편',
    much_larger: '평균보다 많이 긴 편',
  },
  width: {
    much_smaller: '평균보다 많이 좁은 편',
    smaller: '평균보다 좁은 편',
    average: '평균 범위',
    larger: '평균보다 넓은 편',
    much_larger: '평균보다 많이 넓은 편',
  },
  cCurve: {
    much_smaller: '평균보다 많이 완만한 편',
    smaller: '평균보다 완만한 편',
    average: '평균 범위',
    larger: '평균보다 뚜렷한 편',
    much_larger: '평균보다 많이 뚜렷한 편',
  },
}

// 판정 막대가 채워지는 정도(%) — 5단계를 고르게 나눈 칸의 가운데. 평균 범위가 딱 절반이다.
const NAIL_SIZE_BAR_PERCENT: Record<NailSizeLevel, number> = {
  much_smaller: 10,
  smaller: 30,
  average: 50,
  larger: 70,
  much_larger: 90,
}

// 측정값을 읽지 못했을 때 대신 보여 줄 열 손가락 여성 평균(mm) — 손가락별 여성 평균(FINGER_SIZE_MM = STANDARD_NAILS)을
// 서버(scan/final_measurements.py)가 avg_*_mm을 만들 때처럼 평균 내 소수 둘째 자리로 반올림한 값 (11.48 / 10.07 / 2.32)
const femaleAverageMm = (key: keyof (typeof FINGER_SIZE_MM)[number]) =>
  Math.round((FINGER_SIZE_MM.reduce((sum, f) => sum + f[key], 0) / FINGER_SIZE_MM.length) * 100) / 100
const FEMALE_AVERAGE_MM: Record<keyof typeof NAIL_SIZE_LABELS, number> = {
  length: femaleAverageMm('lengthMm'),
  width: femaleAverageMm('widthMm'),
  cCurve: femaleAverageMm('cCurveMm'),
}

export type NailSummaryMetric = {
  valueMm: number // 열 손가락 평균(mm) — 서버 summary 값, 읽지 못하면 여성 평균
  label: string // 평균 판정 문구 — 판정을 읽지 못하면 average(평균 범위)
  barPercent: number // 판정 막대 채움(%)
}

type ScanSummarySource = Pick<
  ScanResultResponse,
  'avgLengthMm' | 'avgWidthMm' | 'avgCurve' | 'lengthSize' | 'widthSize' | 'curveSize'
>

/** 열 손가락 평균 길이·너비·곡률과 평균 판정 — 통합 measurements.json 상단 summary 값이라 왼손/오른손 응답이 같다.
 *  측정값을 읽지 못하면 여성 평균 수치, 판정을 읽지 못하면 average로 대체한다 (값·판정 각각 따로). */
export function nailSummaryMetrics(left: ScanSummarySource | null, right: ScanSummarySource | null) {
  const pick = <K extends keyof ScanSummarySource>(key: K): ScanSummarySource[K] | null => left?.[key] ?? right?.[key] ?? null
  const metric = (axis: keyof typeof NAIL_SIZE_LABELS, valueMm: number | null, size: string | null): NailSummaryMetric => {
    const level: NailSizeLevel = size && size in NAIL_SIZE_BAR_PERCENT ? (size as NailSizeLevel) : 'average'
    return {
      valueMm: valueMm ?? FEMALE_AVERAGE_MM[axis],
      label: NAIL_SIZE_LABELS[axis][level],
      barPercent: NAIL_SIZE_BAR_PERCENT[level],
    }
  }
  return {
    length: metric('length', pick('avgLengthMm'), pick('lengthSize')),
    width: metric('width', pick('avgWidthMm'), pick('widthSize')),
    cCurve: metric('cCurve', pick('avgCurve'), pick('curveSize')),
  }
}

/** 평균 판정 한줄 요약 */
export function nailSummaryComment(metrics: ReturnType<typeof nailSummaryMetrics>): string {
  const { length, width, cCurve } = metrics
  return `손톱 길이는 ${length.label}이고 너비는 ${width.label}이며, 곡률(C-curve)은 ${cCurve.label}입니다.`
}
