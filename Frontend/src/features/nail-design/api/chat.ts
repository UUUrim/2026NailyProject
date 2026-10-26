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
    // 아직 안 채워진 필수 항목 — 다 모였을 때만 "바로 생성해 드릴까요?" 창을 띄우는 데 쓴다 (예전 서버는 안 보낸다)
    remainingCategories?: string[] | null
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

// ─── 채팅 이력 (디자인 채팅 사이드바) ─────────────────────────────────────────

/** 사이드바 채팅 이력 한 줄 */
export interface ChatSummary {
    sessionId: number
    // 채팅 이름 — 그 채팅에서 만든 네일 분위기로 자동으로 짓고, 직접 바꿀 수도 있다 (아직 없으면 null)
    title: string | null
    // 이 채팅에 반영한 손 분석 기록 키 (ScanSession.key = "{왼손scanId}-{오른손scanId}", 없으면 null)
    scanKey: string | null
    createdAt: string | null
    updatedAt: string | null // ISO ("2026-10-15T14:30:12")
}

export interface ChatStateResponse<TState> {
    sessionId: number
    title: string | null
    scanKey: string | null
    state: TState | null
}

export const CHAT_SUMMARIES_QUERY_KEY = ['chats', 'summaries'] as const

/** GET /chats/sessions — 저장된 채팅 목록 (최근에 이어 한 순서) */
export async function getChatSummaries(): Promise<ChatSummary[]> {
    const res = await apiClient.get<ChatSummary[]>('/chats/sessions')
    return res.data
}

/** GET /chats/{sessionId}/state — 이력에서 다시 연 채팅의 화면 상태 */
export async function getChatState<TState>(sessionId: number): Promise<ChatStateResponse<TState>> {
    const res = await apiClient.get<ChatStateResponse<TState>>(`/chats/${sessionId}/state`)
    return res.data
}

/** PUT /chats/{sessionId}/state — 채팅 화면 상태 저장. autoTitle은 사용자가 이름을 직접 바꾼 적 없을 때만 반영된다 */
export async function saveChatState(
    sessionId: number,
    params: { state: unknown; scanKey: string | null; autoTitle: string | null },
    options: { keepalive?: boolean } = {},
): Promise<ChatSummary> {
    const res = await apiClient.put<ChatSummary>(`/chats/${sessionId}/state`, params, true, 'logout', options)
    return res.data
}

/** 채팅 검색 결과 한 줄 — snippet은 검색어가 들어간 말풍선 글 일부 (이름에만 들어갔으면 null) */
export interface ChatSearchResult extends ChatSummary {
    titleMatched: boolean
    snippet: string | null
}

/** GET /chats/search?q= — 채팅 이름이나 대화 내용에 검색어(단어)가 들어간 채팅 (이름이 맞는 채팅 먼저, 그다음 최근 순) */
export async function searchChats(query: string): Promise<ChatSearchResult[]> {
    const res = await apiClient.get<ChatSearchResult[]>(`/chats/search?q=${encodeURIComponent(query)}`)
    return res.data
}

/** DELETE /chats/{sessionId} — 채팅 이력에서 지우기 (이 채팅으로 만든 디자인은 마이페이지에 남는다) */
export async function deleteChat(sessionId: number): Promise<void> {
    await apiClient.delete(`/chats/${sessionId}`)
}

/** PATCH /chats/{sessionId}/title — 채팅 이름 직접 바꾸기 */
export async function renameChat(sessionId: number, title: string): Promise<ChatSummary> {
    const res = await apiClient.patch<ChatSummary>(`/chats/${sessionId}/title`, { title })
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