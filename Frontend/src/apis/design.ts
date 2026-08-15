import { apiClient, BASE_URL } from '@/utils/apiClient'

// ─── 응답 타입 ────────────────────────────────────────────────────────────────

/**
 * 디자인 생성 모델이 이미지와 함께 추출해서 내려주는 세부 요소.
 * (컬러팔레트 / 질감·텍스처 / 네일 파츠는 모델 쪽에서 추출 — 프론트는 받아서 표시만 함)
 */
export interface DesignExtractedDetails {
    colorPalette: string[] // 디자인에 사용된 컬러 hex 코드 목록 (예: ["#FDE2EA", "#DE869F"])
    textures: string[]     // 디자인의 질감/텍스처 라벨 목록 (예: ["글리터", "그라데이션"])
    nailParts: string[]    // 디자인에 사용된 네일 파츠 라벨 목록 (예: ["펄", "하트 스톤"])
}

export interface DesignGenerateResponse {
    designId: number
    status: string
    generatedPrompt: string
    imageUrls: string[] // 1장
    details?: DesignExtractedDetails
}

export interface DesignImageResponse {
    designId: number
    sessionId: number | null
    imageUrl: string
    promptSummary: string
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

export interface CommunityDesignResponse {
    designId: number
    imageUrl: string
    createdAt: string
}

// ─── 디자인 생성 ──────────────────────────────────────────────────────────────

/** POST /designs/generate-detailed — 상세 디자인 생성 요청 (STEP1~4 오케스트레이션) */
export async function generateDesign(params: {
    sessionId: number
    scanId?: number | null
}): Promise<DesignGenerateResponse> {
    const res = await apiClient.post<DesignGenerateResponse>('/designs/generate-detailed', params)
    return res.data
}

/**
 * POST /designs/generate-detailed-from-image — 업로드한 참고 이미지 기반 상세 디자인 생성 요청
 * multipart/form-data: image(파일), sessionId(선택), scanId(선택)
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
    const res = await fetch(`${BASE_URL}/designs/generate-detailed-from-image`, {
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
        throw new Error(body.message || `디자인 생성에 실패했습니다. (status ${res.status})`)
    }
    return body.data as DesignGenerateResponse
}

// ─── 내 디자인 목록 ───────────────────────────────────────────────────────────

/** GET /users/me/designs — 내 디자인 전체 목록 */
export async function getMyDesigns(): Promise<DesignImageResponse[]> {
    const res = await apiClient.get<DesignImageResponse[]>('/users/me/designs')
    return res.data
}

/** DELETE /designs/{designId} — 내 디자인 삭제 */
export async function deleteDesign(designId: number): Promise<void> {
    await apiClient.delete(`/designs/${designId}`)
}

/** PATCH /designs/{designId}/confirm — "네, 이 디자인으로 할게요" 눌렀을 때 확정. 이때부터 마이페이지 이력에 노출됨 */
export async function confirmDesign(designId: number): Promise<void> {
    await apiClient.patch(`/designs/${designId}/confirm`)
}

export interface DesignChatMessage {
    role: 'user' | 'assistant'
    content: string
    sentAt: string
    imageUrls?: string[]
    designId?: number
}

/** GET /designs/{designId}/chat-history — 이 디자인이 만들어진 채팅 세션의 대화 내역 */
export async function getDesignChatHistory(designId: number): Promise<DesignChatMessage[]> {
    const res = await apiClient.get<DesignChatMessage[]>(`/designs/${designId}/chat-history`)
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

// ─── 둘러보기(커뮤니티 갤러리) ─────────────────────────────────────────────────

/** GET /designs/community — 메인페이지 '둘러보기': 전체 사용자가 생성한 디자인 목록 (로그인 불필요) */
export async function getCommunityDesigns(): Promise<CommunityDesignResponse[]> {
    const res = await apiClient.get<CommunityDesignResponse[]>('/designs/community', false)
    return res.data
}