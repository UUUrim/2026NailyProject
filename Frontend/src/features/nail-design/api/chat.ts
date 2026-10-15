import { apiClient } from '@/shared/utils/apiClient'
import type { DesignGenerateResponse } from '@/entities/design/api'

// ─── 채팅 세션 ────────────────────────────────────────────────────────────────

/** POST /chats/session — 채팅 세션 생성 */
export async function createChatSession(): Promise<number> {
    const res = await apiClient.post<{ sessionId: number }>('/chats/session')
    return res.data.sessionId
}

export interface ChatResponse {
    reply: string
    nextQuestionTarget: string | null
    showOptions: boolean
    options: string[]
    optionColors?: Record<string, string[]>
    isComplete: boolean
}

/** POST /chats/{sessionId}/messages — 채팅 메시지 전송 */
export async function sendChatMessage(
    sessionId: number,
    message: string,
): Promise<ChatResponse> {
    const res = await apiClient.post<ChatResponse>(
        `/chats/${sessionId}/messages`,
        { message },
    )
    return res.data
}

// ─── 자유 입력 키워드 추출 ────────────────────────────────────────────────────

/** POST /chats/{sessionId}/refine — 수정 요청 처리 + inpaint 이미지 생성 */
export async function refineKeywords(
    sessionId: number,
    message: string,
): Promise<DesignGenerateResponse> {  // string[] → DesignGenerateResponse
    const res = await apiClient.post<DesignGenerateResponse>(
        `/chats/${sessionId}/refine`,
        { message },
    )
    return res.data
}