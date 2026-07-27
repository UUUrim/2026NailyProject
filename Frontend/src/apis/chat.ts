import { apiClient } from '@/utils/apiClient'

// ─── 응답 타입 ────────────────────────────────────────────────────────────────
export interface UserPreferences {
    mood: string[]        // 최대 2개
    designType: string[]  // 최대 2개
    season: string        // 1개
    motif: string[]       // 최대 2개
    shape: string         // 1개
    color: string[]       // 최대 2개
}

// ─── 채팅 세션 ────────────────────────────────────────────────────────────────

/** POST /chats/session — 채팅 세션 생성 */
export async function createChatSession(): Promise<number> {
    const res = await apiClient.post<{ sessionId: number }>('/chats/session')
    return res.data.sessionId
}

/** POST /chats/{sessionId}/messages — 채팅 메시지 전송 */
export async function sendChatMessage(
    sessionId: number,
    message: string,
): Promise<string> {
    const res = await apiClient.post<{ aiMessage: string }>(
        `/chats/${sessionId}/messages`,
        { message },
    )
    return res.data.aiMessage
}

// ─── 선호도 ───────────────────────────────────────────────────────────────────

/** POST /chats/{sessionId}/preferences — 선호도 저장 */
export async function savePreferences(
    sessionId: number,
    preferences: UserPreferences,
): Promise<void> {
    await apiClient.post(`/chats/${sessionId}/preferences`, preferences)
}

/** GET /chats/{sessionId}/preferences — 선호도 조회 */
export async function getPreferences(sessionId: number): Promise<UserPreferences> {
    const res = await apiClient.get<UserPreferences>(`/chats/${sessionId}/preferences`)
    return res.data
}

// ─── 자유 입력 키워드 추출 ────────────────────────────────────────────────────

/** POST /chats/{sessionId}/refine — 자유입력 키워드 추출 */
export async function refineKeywords(
    sessionId: number,
    message: string,
): Promise<string[]> {
    const res = await apiClient.post<string[]>(`/chats/${sessionId}/refine`, { message })
    return res.data
}