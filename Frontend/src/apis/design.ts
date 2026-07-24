import { apiClient, BASE_URL } from '@/utils/apiClient'

// ─── 응답 타입 ────────────────────────────────────────────────────────────────
export interface DesignGenerateResponse {
    designId: number
    status: string
    generatedPrompt: string
    imageUrls: string[] // 3장
}

export interface DesignImageResponse {
    designId: number
    imageUrl: string
    createdAt: string
}

export interface SavedDesignResponse {
    designId: number
    imageUrl: string
    savedAt: string
    folder: {
        folderId: number
        name: string
    } | null
}

// ─── 디자인 생성 ──────────────────────────────────────────────────────────────

/** POST /designs/generate — 디자인 생성 요청 */
export async function generateDesign(params: {
    sessionId: number
    scanId: number
}): Promise<DesignGenerateResponse> {
    const res = await apiClient.post<DesignGenerateResponse>('/designs/generate', params)
    return res.data
}

/**
 * POST /designs/generate-from-image — 업로드한 참고 이미지 기반 디자인 생성 요청
 * ⚠️ 백엔드에 아직 이 엔드포인트가 구현되어 있지 않습니다. 프론트 흐름만 먼저 만들어둔 상태예요.
 */
export async function generateDesignFromImage(params: {
    sessionId: number
    scanId?: number | null
    image: Blob
}): Promise<DesignGenerateResponse> {
    const formData = new FormData()
    formData.append('sessionId', String(params.sessionId))
    if (params.scanId != null) formData.append('scanId', String(params.scanId))
    formData.append('image', params.image, 'reference.jpg')

    const token = localStorage.getItem('token')
    const res = await fetch(`${BASE_URL}/designs/generate-from-image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
    })
    const body = await res.json()
    if (!body.ok) throw new Error(body.message)
    return body.data as DesignGenerateResponse
}

// ─── 내 디자인 목록 ───────────────────────────────────────────────────────────

/** GET /users/me/designs — 내 디자인 전체 목록 */
export async function getMyDesigns(): Promise<DesignImageResponse[]> {
    const res = await apiClient.get<DesignImageResponse[]>('/users/me/designs')
    return res.data
}

// ─── 찜하기 ───────────────────────────────────────────────────────────────────

/** POST /designs/{designId}/likes — 찜하기 */
export async function likeDesign(designId: number, imageUrl: string): Promise<void> {
    await apiClient.post(`/designs/${designId}/likes`, { imageUrl })
}

/** DELETE /designs/{designId}/likes — 찜 취소 */
export async function unlikeDesign(designId: number, imageUrl: string): Promise<void> {
    await apiClient.delete(`/designs/${designId}/likes`, { imageUrl })
}

/** GET /users/me/liked-designs — 찜 목록 조회 */
export async function getLikedDesigns(): Promise<SavedDesignResponse[]> {
    const res = await apiClient.get<SavedDesignResponse[]>('/users/me/liked-designs')
    return res.data
}