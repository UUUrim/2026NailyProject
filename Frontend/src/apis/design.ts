import { apiClient, BASE_URL } from '@/utils/apiClient'

// ─── 응답 타입 ────────────────────────────────────────────────────────────────

/**
 * 컬러팔레트 / 질감·텍스처 / 네일 파츠 배열의 각 원소.
 * - 지금처럼 라벨/hex 문자열만 오는 것(레거시)도 그대로 지원하고,
 * - 이미지 생성 모델 쪽 담당자가 실제 생성 이미지에서 추출한 미리보기 이미지(imageUrl)를
 *   함께 내려주기 시작하면 별도 프론트 변경 없이 바로 그 이미지를 보여준다.
 * imageUrl은 http(s) URL, data URI 등 <img>가 로드할 수 있는 값이면 형식 상관없이 동작한다.
 */
export type DesignDetailItem =
    | string
    | {
          label?: string
          hex?: string
          imageUrl?: string | null
      }

/**
 * 디자인 생성 모델이 이미지와 함께 추출해서 내려주는 세부 요소.
 * (컬러팔레트 / 질감·텍스처 / 네일 파츠는 모델 쪽에서 추출 — 프론트는 받아서 표시만 함)
 */
export interface DesignExtractedDetails {
    colorPalette: DesignDetailItem[] // 디자인에 사용된 컬러 (예: ["#FDE2EA", "#DE869F"])
    textures: DesignDetailItem[]     // 디자인의 질감/텍스처 (예: ["글리터", "그라데이션"])
    nailParts: DesignDetailItem[]    // 디자인에 사용된 네일 파츠 (예: ["펄", "하트 스톤"])
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
    createdAt: string // "yyyy. M. d. HH:mm:ss"
    shared?: boolean
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

export interface SavedFolderResponse {
    folderId: number
    name: string
    sortOrder: number
    isDefault?: boolean
    createdAt: string
    lastSavedAt: string | null
    itemCount: number
    recentImageUrls: string[]
}

export type LikeDesignOptions = {
    folderId?: number | null
    newFolderName?: string | null
}

export interface CommunityDesignResponse {
    designId: number
    imageUrl: string
    createdAt: string
    likeCount?: number
    likedByMe?: boolean
    details?: DesignExtractedDetails
}

export interface DesignLikeResponse {
    designId: number
    likeCount: number
    liked: boolean
}

export interface DesignDetailResponse {
    designId: number
    imageUrl: string
    createdAt: string
    shared: boolean
    owner: boolean
    details?: DesignExtractedDetails
    imageUrls?: string[]
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

/** GET /designs/{designId} — 디자인 상세 (공유본은 비로그인 가능, 로그인 시 토큰 포함) */
export async function getDesignDetail(designId: number): Promise<DesignDetailResponse> {
    const res = await apiClient.get<DesignDetailResponse>(`/designs/${designId}`)
    return res.data
}

/** POST /designs/{designId}/share — 둘러보기에 공유 */
export async function shareDesign(designId: number): Promise<DesignDetailResponse> {
    const res = await apiClient.post<DesignDetailResponse>(`/designs/${designId}/share`)
    return res.data
}

/** DELETE /designs/{designId}/share — 둘러보기 공유 해제 */
export async function unshareDesign(designId: number): Promise<DesignDetailResponse> {
    const res = await apiClient.delete<DesignDetailResponse>(`/designs/${designId}/share`)
    return res.data
}

/** POST /designs/{designId}/reactions — 둘러보기 좋아요 (찜과 분리) */
export async function addDesignReaction(designId: number): Promise<DesignLikeResponse> {
    const res = await apiClient.post<DesignLikeResponse>(`/designs/${designId}/reactions`, {})
    return res.data
}

/** DELETE /designs/{designId}/reactions — 둘러보기 좋아요 취소 */
export async function removeDesignReaction(designId: number): Promise<DesignLikeResponse> {
    const res = await apiClient.delete<DesignLikeResponse>(`/designs/${designId}/reactions`)
    return res.data
}

// ─── 찜하기 ───────────────────────────────────────────────────────────────────

/** POST /designs/{designId}/likes — 찜하기 */
export async function likeDesign(
    designId: number,
    imageUrl: string,
    options?: LikeDesignOptions,
): Promise<SavedDesignResponse> {
    const res = await apiClient.post<SavedDesignResponse>(`/designs/${designId}/likes`, {
        imageUrl,
        folderId: options?.folderId ?? null,
        newFolderName: options?.newFolderName ?? null,
    })
    return res.data
}

/** DELETE /designs/{designId}/likes — 찜 취소 */
export async function unlikeDesign(designId: number, imageUrl: string): Promise<void> {
    await apiClient.delete(`/designs/${designId}/likes`, { imageUrl })
}

/** PATCH /designs/{designId}/likes — 찜 저장 위치 변경 */
export async function moveLikedDesign(
    designId: number,
    imageUrl: string,
    options: LikeDesignOptions,
): Promise<SavedDesignResponse> {
    const res = await apiClient.patch<SavedDesignResponse>(`/designs/${designId}/likes`, {
        imageUrl,
        folderId: options.folderId ?? null,
        newFolderName: options.newFolderName ?? null,
    })
    return res.data
}

/** GET /users/me/liked-designs — 찜 목록 조회 */
export async function getLikedDesigns(): Promise<SavedDesignResponse[]> {
    const res = await apiClient.get<SavedDesignResponse[]>('/users/me/liked-designs')
    return res.data
}

/** GET /users/me/saved-folders — 찜 폴더 목록 */
export async function getSavedFolders(): Promise<SavedFolderResponse[]> {
    const res = await apiClient.get<SavedFolderResponse[]>('/users/me/saved-folders')
    return res.data
}

/** POST /users/me/saved-folders — 찜 폴더 생성 */
export async function createSavedFolder(name: string): Promise<SavedFolderResponse> {
    const res = await apiClient.post<SavedFolderResponse>('/users/me/saved-folders', { name })
    return res.data
}

/** PATCH /users/me/saved-folders/reorder — 폴더 사용자 지정 순서 저장 */
export async function reorderSavedFolders(folderIds: number[]): Promise<void> {
    await apiClient.patch('/users/me/saved-folders/reorder', { folderIds })
}

/**
 * DELETE /users/me/saved-folders/{folderId} — 찜 폴더 삭제
 * 폴더 자체만 삭제되며, 폴더 안에 있던 찜 이미지는 자동으로 '기본' 폴더로 이동된다.
 */
export async function deleteSavedFolder(folderId: number): Promise<void> {
    await apiClient.delete(`/users/me/saved-folders/${folderId}`)
}

// ─── 둘러보기(커뮤니티 갤러리) ─────────────────────────────────────────────────

/** GET /designs/community — 메인페이지 '둘러보기': 전체 사용자가 생성한 디자인 목록 */
export async function getCommunityDesigns(): Promise<CommunityDesignResponse[]> {
    // 로그인 토큰이 있으면 함께 보내 likedByMe를 받는다 (토큰 없어도 조회는 가능)
    const res = await apiClient.get<CommunityDesignResponse[]>('/designs/community')
    return res.data
}