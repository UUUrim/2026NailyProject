const RECOMMENDED_SEASON_KEY = 'naily_recommended_season_code'

export function getRecommendedSeasonCode(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(RECOMMENDED_SEASON_KEY)
}

export function setRecommendedSeasonCode(seasonCode: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(RECOMMENDED_SEASON_KEY, seasonCode)
}

export function clearRecommendedSeasonCode(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(RECOMMENDED_SEASON_KEY)
}

