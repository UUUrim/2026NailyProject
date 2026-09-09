// 손톱 실측 평균값을 "평균보다 긴/짧은 편" 같은 비교 문구·percentile 막대로 바꾸는 공용 로직.
// 전체 사용자 모집단 통계 API가 아직 없어, 성인 평균 손톱 규격을 고정 기준값으로 사용한다.
// (mean: 기준 평균값, spread: 이 값만큼 벗어나면 percentile이 대략 상/하위 16% 지점에 닿도록 잡은 폭)
//
// cCurve는 0~1 지수가 아니라 스캔 파이프라인(scan/nail_measurer.py)이 내려주는 C-curve
// sagitta 깊이(mm)다. 실측값은 대략 0~5mm 범위이고, 파이프라인 기준으로 일반 손톱 ≈ 2mm,
// 3mm 이상이면 "곡률이 뚜렷/깊은 편"으로 본다. 이에 맞춰 mean 2.0 / spread 1.0으로 잡는다.
export const NAIL_BASELINE = {
  length: { mean: 13, spread: 3.5 }, // mm
  width: { mean: 10, spread: 2.2 }, // mm
  cCurve: { mean: 2.0, spread: 1.0 }, // mm (C-curve sagitta)
}

// cCurveMm 실측값이 없을 때 쓰는 "일반적인 손톱" 대체값 (scan/export_shape_templates.py의
// GENERIC_C_CURVE_MM와 동일). NAIL_BASELINE.cCurve.mean과 맞춰 두어야 대체값이 들어가도
// percentile이 한쪽으로 튀지 않는다.
export const FALLBACK_C_CURVE_MM = 2.0

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
