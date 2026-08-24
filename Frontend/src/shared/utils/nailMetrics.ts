// 손톱 실측 평균값을 "평균보다 긴/짧은 편" 같은 비교 문구·percentile 막대로 바꾸는 공용 로직.
// 전체 사용자 모집단 통계 API가 아직 없어, 성인 평균 손톱 규격을 고정 기준값으로 사용한다.
// (mean: 기준 평균값, spread: 이 값만큼 벗어나면 percentile이 대략 상/하위 16% 지점에 닿도록 잡은 폭)
export const NAIL_BASELINE = {
  length: { mean: 13, spread: 3.5 }, // mm
  width: { mean: 10, spread: 2.2 }, // mm
  cCurve: { mean: 0.55, spread: 0.22 },
}

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
