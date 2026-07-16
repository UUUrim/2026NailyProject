import { apiClient } from '@/utils/apiClient'

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