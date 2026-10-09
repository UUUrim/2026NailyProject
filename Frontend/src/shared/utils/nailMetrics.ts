// 손톱 실측 평균값을 "평균보다 긴/짧은 편" 같은 비교 문구·percentile 막대로 바꾸는 공용 로직.
// 전체 사용자 모집단 통계 API가 아직 없어, 성인 평균 손톱 규격을 고정 기준값으로 사용한다.
// (mean: 기준 평균값, spread: 이 값만큼 벗어나면 percentile이 대략 상/하위 16% 지점에 닿도록 잡은 폭
//  = 모집단 표준편차)
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

// 실측 평균값이 기준값(mean)에서 얼마나 벗어났는지를 0~100 percentile로 근사한다.
// (표준정규분포 근사: 기준값에서 spread만큼 벗어나면 약 상/하위 16% 지점)
export function percentileAgainstBaseline(value: number, baseline: { mean: number; spread: number }): number {
  const z = (value - baseline.mean) / baseline.spread
  const percentile = 50 + z * 34
  return Math.round(Math.min(97, Math.max(3, percentile)))
}

export function labelByPercentile(percentile: number, small: string, large: string, average: string): string {
  if (percentile < 35) return small
  if (percentile > 65) return large
  return average
}
