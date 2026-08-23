import type { HandScanAnalysis } from '@/utils/handScanAnalysis'

const HAND_SCAN_RESULT_KEY = 'naily_hand_scan_result'

export type HandScanResult = HandScanAnalysis & {
  capturedAt: string
}

export function getHandScanResult(): HandScanResult | null {
  if (typeof window === 'undefined') return null
  const raw = window.sessionStorage.getItem(HAND_SCAN_RESULT_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as HandScanResult
  } catch {
    return null
  }
}

export function setHandScanResult(result: HandScanResult): void {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(HAND_SCAN_RESULT_KEY, JSON.stringify(result))
}

export function clearHandScanResult(): void {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(HAND_SCAN_RESULT_KEY)
}
