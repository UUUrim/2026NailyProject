import { apiClient } from '@/utils/apiClient'

// ─── 응답 타입 (ScanStartResponseDto, ScanResultResponseDto) ─────────────────
export interface ScanStartResponse {
    scanId: number
}

export interface FingerResult {
    finger: string
    imageUrl: string
    stlUrl: string
    measurements: string // JSON 문자열
    size: string
}

export interface ScanResultResponse {
    scanId: number
    handSide: string
    status: string // 'PENDING' | 'MEASURED' | 'COMPLETED'
    shape: string
    skinToneHex: string
    recommendedColors: string[]
    overallSize: string
    fingers: FingerResult[]
    scannedAt: string
}

// ─── 스캔 API ─────────────────────────────────────────────────────────────────

/** POST /scans — 스캔 세션 시작 */
export async function startScan(handSide: 'LEFT' | 'RIGHT'): Promise<ScanStartResponse> {
    const res = await apiClient.post<ScanStartResponse>('/api/scans', { handSide })
    return res.data
}

/** POST /scans/{scanId}/images?finger=THUMB — 손가락 이미지 업로드 */
export async function uploadFingerImage(
    scanId: number,
    finger: 'THUMB' | 'INDEX' | 'MIDDLE' | 'RING' | 'PINKY',
    blob: Blob,
): Promise<string> {
    const formData = new FormData()
    formData.append('file', blob, `${finger.toLowerCase()}.jpg`)

    // upload()는 Content-Type을 자동으로 multipart로 처리
    const token = localStorage.getItem('token')
    const res = await fetch(`/api/scans/${scanId}/images?finger=${finger}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
    })
    const body = await res.json()
    if (!body.ok) throw new Error(body.message)
    return body.data.imageUrl as string
}

/** POST /scans/{scanId}/analyze — 분석 요청 */
export async function requestAnalyze(scanId: number): Promise<void> {
    await apiClient.post(`/api/scans/${scanId}/analyze`)
}

/** GET /scans/{scanId} — 스캔 결과 조회 (폴링용) */
export async function getScanResult(scanId: number): Promise<ScanResultResponse> {
    const res = await apiClient.get<ScanResultResponse>(`/api/scans/${scanId}`)
    return res.data
}

/** GET /scans/latest — 최근 완료된 스캔 조회 */
export async function getLatestScanResult(): Promise<ScanResultResponse> {
    const res = await apiClient.get<ScanResultResponse>('/api/scans/latest')
    return res.data
}

/** POST /scans/{scanId}/generate-stl — STL 생성 요청 */
export async function generateStl(scanId: number, shape: string): Promise<void> {
    await apiClient.post(`/api/scans/${scanId}/generate-stl`, { shape })
}