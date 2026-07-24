import { apiClient, BASE_URL } from '@/utils/apiClient'

// ─── 응답 타입 (ScanStartResponseDto, ScanResultResponseDto) ─────────────────
export interface ScanStartResponse {
    scanId: number
}

export interface FingerResult {
    finger: string
    imageUrl: string
    imageUrlSide: string
    stlUrl: string
    measurements: string // JSON 문자열
    size: string
}

export interface ScanResultResponse {
    scanId: number
    handSide: string
    status: string
    shape: string
    skinToneHex: string
    recommendedColors: string[]
    seasonCode: string        // ← 추가
    seasonNameKo: string      // ← 추가
    overallSize: string
    fingers: FingerResult[]
    scannedAt: string
}

// ─── 스캔 API ─────────────────────────────────────────────────────────────────

/** POST /scans — 스캔 세션 시작 */
export async function startScan(handSide: 'LEFT' | 'RIGHT'): Promise<ScanStartResponse> {
    const res = await apiClient.post<ScanStartResponse>('/scans', { handSide })
    return res.data
}

/** POST /scans/{scanId}/images?finger=THUMB — 손가락 탑뷰/측면뷰 이미지 2장 업로드 */
export async function uploadFingerImage(
    scanId: number,
    finger: 'THUMB' | 'INDEX' | 'MIDDLE' | 'RING' | 'PINKY',
    topBlob: Blob,
    sideBlob: Blob,
): Promise<{ imageUrlTop: string; imageUrlSide: string }> {
    const formData = new FormData()
    formData.append('fileTop', topBlob, `${finger.toLowerCase()}_top.jpg`)
    formData.append('fileSide', sideBlob, `${finger.toLowerCase()}_side.jpg`)

    // upload()는 Content-Type을 자동으로 multipart로 처리
    const token = localStorage.getItem('token')
    const res = await fetch(`${BASE_URL}/scans/${scanId}/images?finger=${finger}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
    })

    const raw = await res.text()
    let body: { ok?: boolean; message?: string; data?: unknown }
    try {
        body = raw ? JSON.parse(raw) : {}
    } catch {
        throw new Error(`서버 응답을 처리할 수 없습니다. (status ${res.status})`)
    }
    if (!res.ok || !body.ok) {
        throw new Error(body.message || `이미지 업로드에 실패했습니다. (status ${res.status})`)
    }
    return body.data as { imageUrlTop: string; imageUrlSide: string }
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

/** POST /scans/{scanId}/generate-stl — STL 생성 요청 */
export async function generateStl(scanId: number, shape: string): Promise<void> {
    await apiClient.post(`/scans/${scanId}/generate-stl`, { shape })
}
// ─── 마이페이지: 손 스캔 이력 ───────────────────────────────────────────────

export interface ScanHistoryItem {
    scanId: number
    handSide: string | null
    status: string | null
    shape: string | null
    seasonNameKo: string | null
    scannedAt: string
}

/** GET /users/me/scans — 내 손 스캔 전체 이력 */
export async function getMyScans(): Promise<ScanHistoryItem[]> {
    const res = await apiClient.get<ScanHistoryItem[]>('/users/me/scans')
    return res.data
}