import { apiClient } from '@/shared/utils/apiClient'
import type { ScanSession } from '@/shared/utils/scanDetail'

// ─── 응답 타입 (ScanStartResponseDto, ScanResultResponseDto) ─────────────────
export interface ScanStartResponse {
    scanId: number
}

export interface FingerResult {
    finger: string
    measurements: string // JSON 문자열
    size: string
}

export interface ScanResultResponse {
    scanId: number
    handSide: string
    status: string
    shape: string
    // AI가 분석 직후 추천한 쉐입 — shape는 이후 STL 생성/출력 신청 시 유저가 고른 쉐입으로 바뀔 수 있어서,
    // "추천" 배지/문구는 반드시 이 필드를 써야 한다 (shape를 쓰면 출력 신청 후 추천 배지가 옮겨가 보이는 버그가 생김)
    recommendedShape: string | null
    skinToneHex: string
    recommendedColors: string[]
    tone: string | null       // warm/cool/neutral
    warmness: number | null   // 웜/쿨 연속 스칼라 (LAB b - a*0.5), tone 범주의 원본 값 — 슬라이더 위치용
    brightness: number | null // 0~1
    saturation: number | null // 0~1
    overallSize: string
    fingers: FingerResult[]
    scannedAt: string
}

// ─── 스캔 API ─────────────────────────────────────────────────────────────────

/** POST /scans — 스캔 세션 시작 */
export async function startScan(handSide: 'LEFT' | 'RIGHT', pairedScanId?: number | null): Promise<ScanStartResponse> {
    // pairedScanId: 같은 스캔(한 사람의 양손)에서 이미 찍은 반대 손의 scanId. 두 번째 손을 시작할 때 넘기면
    // 서버가 둘을 짝으로 기록하고, 양손 결과(피부톤/추천 컬러/치수)를 이 짝으로만 만든다.
    const res = await apiClient.post<ScanStartResponse>('/scans', { handSide, pairedScanId: pairedScanId ?? null })
    return res.data
}

/** POST /scans/{scanId}/analyze — 분석 요청 */
export async function requestAnalyze(scanId: number): Promise<void> {
    await apiClient.post(`/scans/${scanId}/analyze`)
}

/** GET /scans/{scanId} — 스캔 결과 조회 (폴링용) */
export async function getScanResult(scanId: number): Promise<ScanResultResponse> {
    const res = await apiClient.get<ScanResultResponse>(`/scans/${scanId}`)
    return res.data
}

/** GET /scans/latest — 최근 완료된 스캔 조회 */
export async function getLatestScanResult(): Promise<ScanResultResponse> {
    const res = await apiClient.get<ScanResultResponse>('/scans/latest')
    return res.data
}

/** POST /scans/{scanId}/generate-stl — STL 생성 요청
 *  tipExtensionMm을 생략하면 서버(파이썬)가 쉐입별 기본 연장 길이를 그대로 사용한다. */
export async function generateStl(scanId: number, shape: string, tipExtensionMm?: number): Promise<void> {
    await apiClient.post(`/scans/${scanId}/generate-stl`, { shape, tipExtensionMm })
}
// ─── 마이페이지: 손 스캔 이력 ───────────────────────────────────────────────

export interface ScanHistoryItem {
    scanId: number
    // 같은 스캔에서 짝으로 찍은 반대 손의 scanId. 아직 반대 손을 안 찍었거나 이 필드가 생기기 전의 예전 스캔은 null
    pairedScanId?: number | null
    handSide: string | null
    status: string | null
    shape: string | null
    recommendedShape: string | null
    skinToneHex: string | null
    recommendedColors: string[]
    tone: string | null
    warmness: number | null
    brightness: number | null
    saturation: number | null
    avgLengthMm: number | null
    avgWidthMm: number | null
    avgCurve: number | null
    // 손톱이 손가락 살 끝보다 평균 몇 mm 나와 있는지 (스캔 사진 기준). 이 측정 전의 예전 스캔은 null
    avgFreeEdgeMm?: number | null
    scannedAt: string
}

/** GET /users/me/scan-sessions — 내 손 분석 기록.
 *  양손 최종 measurements.json 하나가 한 줄이다. 왼손/오른손 기록을 시각으로 다시 짝지어 만들지 않는다. */
export async function getMyScanSessions(): Promise<ScanSession[]> {
    const res = await apiClient.get<ScanSession[]>('/users/me/scan-sessions')
    return res.data
}

/** GET /users/me/scans — 내 손 스캔 전체 이력 */
export async function getMyScans(): Promise<ScanHistoryItem[]> {
    const res = await apiClient.get<ScanHistoryItem[]>('/users/me/scans')
    return res.data
}