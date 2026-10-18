import { useSyncExternalStore } from 'react'
import { AUTH_CHANGE_EVENT, isLoggedIn } from '@/shared/utils/auth'
import {
    isConversationDeleted,
    type ConversationAnalysis,
    type ConversationSnapshot,
    type ConversationStatus,
    type RegenerateNavState,
} from '@/features/nail-design/hooks/useNailDesignChatPage'

// 디자인 채팅의 채팅들을 채팅 화면(페이지) 밖에서 살려 두는 곳.
// 채팅 컴포넌트는 페이지가 아니라 앱 맨 위의 DesignChatHost가 그리고, 채팅 화면은 지금 채팅을 자기 자리(DesignChatSlot)에
// 붙여 보여 주기만 한다. 그래서 답변을 기다리거나 디자인을 만드는 중에 다른 채팅을 열거나 아예 다른 페이지로 옮겨도
// 그 채팅은 화면에서만 내려가(숨겨 둔 채) 그대로 계속 진행되고 저장된다. 새로고침·탭 닫기만 이 채팅들을 멈춘다.

export type HostedChat = {
    // 채팅 컴포넌트의 key — 같은 값이면 숨겼다 다시 보여 줘도 새로 마운트되지 않는다
    instanceKey: string
    // 이력에서 연 채팅·뒤로가기로 돌아온 채팅의 스냅샷 (새 채팅이면 null)
    snapshot: ConversationSnapshot | null
    regenerate: RegenerateNavState | null
}

// 채팅 화면이 지금 보여 주는 채팅과 그 채팅에 넘길 값 (채팅 화면이 렌더될 때마다 새로 알려 준다)
export type ForegroundChat = {
    chat: HostedChat
    sessionId: number | null
    scanKey: string | null
    isContextReady: boolean
    userName: string
    canSelectSession: boolean
    analysis: ConversationAnalysis
    onSessionReady: (sessionId: number) => void
    onStartNewChat: () => void
}

// 화면에서 내렸지만 숨겨 둔 채 계속 진행하는 채팅 — 내릴 때의 닉네임·손 분석 기록을 그대로 쓴다
// (다 만든 뒤에도 이력에서 다시 열 때까지 남겨 둔다 — 다시 열면 첨부 사진까지 그대로 보인다)
export type BackgroundChat = {
    chat: HostedChat
    sessionId: number
    scanKey: string | null
    userName: string
    canSelectSession: boolean
    analysis: ConversationAnalysis
}

// 사이드바 채팅 이력의 상태 점 — 디자인을 만드는 중(분홍, 깜빡임) / 보지 않는 동안 다 만듦(초록)
export type ChatDesignStatus = 'generating' | 'done'

type RuntimeState = {
    foreground: ForegroundChat | null
    backgroundChats: BackgroundChat[]
    // 채팅(instanceKey)마다 알려 온 진행 상황
    statusByKey: ReadonlyMap<string, ConversationStatus>
    // 화면에서 보지 않는 동안 디자인을 다 만든 채팅 — 그 채팅을 열면 지운다
    finishedSessionIds: ReadonlySet<number>
    // 위 두 값으로 만든 채팅별 상태 점
    designStatusBySession: ReadonlyMap<number, ChatDesignStatus>
}

let state: RuntimeState = {
    foreground: null,
    backgroundChats: [],
    statusByKey: new Map(),
    finishedSessionIds: new Set(),
    designStatusBySession: new Map(),
}

// 디자인을 만들기 시작할 때의 디자인 수 — 다 만든 뒤 늘었으면 성공한 것이다
const designCountAtStart = new Map<string, number>()

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

function buildDesignStatus(
    statusByKey: ReadonlyMap<string, ConversationStatus>,
    finishedSessionIds: ReadonlySet<number>,
    previous: ReadonlyMap<number, ChatDesignStatus>,
): ReadonlyMap<number, ChatDesignStatus> {
    const next = new Map<number, ChatDesignStatus>()
    for (const status of statusByKey.values()) {
        if (status.sessionId && status.isGeneratingDesign) next.set(status.sessionId, 'generating')
    }
    for (const sessionId of finishedSessionIds) {
        if (!next.has(sessionId)) next.set(sessionId, 'done')
    }
    // 내용이 같으면 그대로 둔다 — 사이드바가 괜히 다시 그려지지 않게
    const isSame = next.size === previous.size && [...next].every(([sessionId, status]) => previous.get(sessionId) === status)
    return isSame ? previous : next
}

function setState(patch: Partial<Omit<RuntimeState, 'designStatusBySession'>>) {
    const next = { ...state, ...patch }
    next.designStatusBySession = buildDesignStatus(next.statusByKey, next.finishedSessionIds, state.designStatusBySession)
    state = next
    listeners.forEach((listener) => listener())
}

function withoutSession(sessionIds: ReadonlySet<number>, sessionId: number | null): ReadonlySet<number> {
    if (!sessionId || !sessionIds.has(sessionId)) return sessionIds
    const next = new Set(sessionIds)
    next.delete(sessionId)
    return next
}

function withoutKeys(statusByKey: ReadonlyMap<string, ConversationStatus>, keys: string[]) {
    if (!keys.some((key) => statusByKey.has(key))) return statusByKey
    const next = new Map(statusByKey)
    keys.forEach((key) => {
        next.delete(key)
        designCountAtStart.delete(key)
    })
    return next
}

function isHosted(instanceKey: string) {
    return (
        state.foreground?.chat.instanceKey === instanceKey ||
        state.backgroundChats.some((background) => background.chat.instanceKey === instanceKey)
    )
}

/**
 * 화면에서 내려가는 채팅 — 답변·디자인을 기다리는 중이면 숨겨 둔 채 계속하고, 아니면 내린다
 * (내린 채팅은 언마운트되며 기다리던 저장을 바로 보낸다). 지운 채팅·로그아웃한 뒤엔 숨기지 않는다.
 */
function settleLeavingChat(leaving: ForegroundChat, backgroundChats: BackgroundChat[]) {
    const key = leaving.chat.instanceKey
    const status = state.statusByKey.get(key)
    const sessionId = status?.sessionId ?? leaving.sessionId
    if (status?.isBusy && sessionId && !isConversationDeleted(sessionId) && isLoggedIn()) {
        const background: BackgroundChat = {
            chat: leaving.chat,
            sessionId,
            scanKey: leaving.scanKey,
            userName: leaving.userName,
            canSelectSession: leaving.canSelectSession,
            analysis: leaving.analysis,
        }
        return {
            backgroundChats: [...backgroundChats.filter((chat) => chat.chat.instanceKey !== key), background],
            statusByKey: state.statusByKey,
        }
    }
    return { backgroundChats, statusByKey: withoutKeys(state.statusByKey, [key]) }
}

/** 채팅 화면이 지금 보여 주는 채팅을 알린다 — 다른 채팅으로 바뀌면 앞 채팅은 settleLeavingChat대로 내려간다 */
export function showForegroundChat(next: ForegroundChat) {
    const previous = state.foreground
    const settled =
        previous && previous.chat.instanceKey !== next.chat.instanceKey
            ? settleLeavingChat(previous, state.backgroundChats)
            : { backgroundChats: state.backgroundChats, statusByKey: state.statusByKey }
    const { statusByKey } = settled
    let { backgroundChats } = settled
    // 숨겨 두었던 채팅을 다시 보여 주면 숨긴 목록에서 뺀다
    if (backgroundChats.some((background) => background.chat.instanceKey === next.chat.instanceKey)) {
        backgroundChats = backgroundChats.filter((background) => background.chat.instanceKey !== next.chat.instanceKey)
    }
    // 열어 본 채팅은 다 만들었다는 표시를 지운다
    const finishedSessionIds = withoutSession(state.finishedSessionIds, next.sessionId)
    setState({ foreground: next, backgroundChats, statusByKey, finishedSessionIds })
}

/** 채팅 화면을 떠난다 — 지금 채팅도 settleLeavingChat대로 내려간다 */
export function releaseForegroundChat(instanceKey: string) {
    const previous = state.foreground
    if (!previous || previous.chat.instanceKey !== instanceKey) return
    const { backgroundChats, statusByKey } = settleLeavingChat(previous, state.backgroundChats)
    setState({ foreground: null, backgroundChats, statusByKey })
}

/** 채팅이 진행 상황을 알린다 — 화면에서 보지 않는 동안 디자인을 다 만들었으면 사이드바에 초록 점을 띄운다 */
export function reportChatStatus(instanceKey: string, status: ConversationStatus) {
    // 이미 내린 채팅이 늦게 알려 오는 건 무시한다
    if (!isHosted(instanceKey)) return
    const previous = state.statusByKey.get(instanceKey)
    let finishedSessionIds = state.finishedSessionIds
    if (status.isGeneratingDesign && !previous?.isGeneratingDesign) {
        designCountAtStart.set(instanceKey, status.designCount)
        finishedSessionIds = withoutSession(finishedSessionIds, status.sessionId)
    } else if (!status.isGeneratingDesign && previous?.isGeneratingDesign) {
        const startCount = designCountAtStart.get(instanceKey) ?? previous.designCount
        designCountAtStart.delete(instanceKey)
        const isViewing = state.foreground?.chat.instanceKey === instanceKey
        if (status.sessionId && status.designCount > startCount && !isViewing) {
            finishedSessionIds = new Set(finishedSessionIds).add(status.sessionId)
        }
    }
    setState({ statusByKey: new Map(state.statusByKey).set(instanceKey, status), finishedSessionIds })
}

/** 채팅을 지웠다 — 숨겨 둔 채 진행하던 채팅이면 함께 내리고 상태 점도 지운다 */
export function closeChatSession(sessionId: number) {
    const closing = state.backgroundChats.filter((background) => background.sessionId === sessionId)
    setState({
        backgroundChats: closing.length
            ? state.backgroundChats.filter((background) => background.sessionId !== sessionId)
            : state.backgroundChats,
        statusByKey: withoutKeys(
            state.statusByKey,
            closing.map((background) => background.chat.instanceKey),
        ),
        finishedSessionIds: withoutSession(state.finishedSessionIds, sessionId),
    })
}

/** 숨겨 둔 채 진행 중인(또는 다 만들고 아직 안 열어 본) 채팅 */
export function getBackgroundChat(sessionId: number): BackgroundChat | undefined {
    return state.backgroundChats.find((background) => background.sessionId === sessionId)
}

// 로그아웃하면 숨겨 둔 채팅은 모두 내린다 — 다음 계정에게 이어지지 않게 (화면의 채팅은 채팅 화면을 떠날 때 함께 내려간다)
window.addEventListener(AUTH_CHANGE_EVENT, () => {
    if (isLoggedIn() || (state.backgroundChats.length === 0 && state.finishedSessionIds.size === 0)) return
    setState({
        backgroundChats: [],
        statusByKey: withoutKeys(
            state.statusByKey,
            state.backgroundChats.map((background) => background.chat.instanceKey),
        ),
        finishedSessionIds: new Set(),
    })
})

/** DesignChatHost가 그릴 채팅들 */
export function useHostedChats() {
    const foreground = useSyncExternalStore(subscribe, () => state.foreground)
    const backgroundChats = useSyncExternalStore(subscribe, () => state.backgroundChats)
    return { foreground, backgroundChats }
}

/** 이 채팅이 알려 온 진행 상황 (아직 알려 오지 않았으면 undefined) */
export function useChatStatus(instanceKey: string): ConversationStatus | undefined {
    return useSyncExternalStore(subscribe, () => state.statusByKey.get(instanceKey))
}

/** 사이드바 채팅 이력의 상태 점 */
export function useChatDesignStatuses(): ReadonlyMap<number, ChatDesignStatus> {
    return useSyncExternalStore(subscribe, () => state.designStatusBySession)
}
