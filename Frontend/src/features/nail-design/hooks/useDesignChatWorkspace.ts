import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getMyProfile } from '@/entities/user/api'
import { useMyScanSessionsQuery } from '@/entities/scan/queries'
import { isFullyAnalyzedSession } from '@/shared/utils/scanDetail'
import { AUTH_CHANGE_EVENT } from '@/shared/utils/auth'
import {
    closeChatSession,
    getBackgroundChat,
    releaseForegroundChat,
    showForegroundChat,
    useChatDesignStatuses,
    useChatStatus,
    type HostedChat,
} from '@/features/nail-design/hooks/designChatRuntime'
import {
    CHAT_SUMMARIES_QUERY_KEY,
    deleteChat,
    getChatState,
    getChatSummaries,
    renameChat,
    type ChatSummary,
} from '@/features/nail-design/api/chat'
import {
    deserializeConversationSnapshot,
    getLiveConversationSnapshot,
    markConversationDeleted,
    unmarkConversationDeleted,
    type ConversationAnalysis,
    type ConversationSnapshot,
    type ConversationStatus,
    type RegenerateNavState,
} from '@/features/nail-design/hooks/useNailDesignChatPage'
import {
    buildHandAnalysisSummary,
    buildHandRecordPreview,
    buildHandRecordPreviewFromAnalysis,
    buildScanKey,
    fetchHandAnalysis,
    parseScanKey,
    type HandRecordPreview,
} from '@/features/nail-design/utils/handAnalysisSummary'

// 디자인 채팅 화면 전체(사이드바 + 채팅) — 어떤 채팅을 보여 줄지, 그 채팅에 어떤 손 분석 기록을 반영할지,
// 사이드바의 채팅 이력·프로필을 관리한다. 채팅 하나의 대화는 useNailDesignChatPage가 맡는다.
// 채팅 컴포넌트는 이 화면이 아니라 앱 맨 위의 DesignChatHost가 그린다 — 이 화면은 지금 채팅을 알려 주고(showForegroundChat)
// DesignChatSlot 자리에 붙여 보여 준다. 답변·디자인을 기다리는 채팅은 다른 채팅을 열거나 이 화면을 떠나도
// 숨겨 둔 채 계속 진행되고(designChatRuntime), 이력에서 다시 열면 그 채팅을 그대로 다시 보여 준다.

// 마이페이지 프로필과 같은 캐시를 쓴다 — 닉네임을 바꾸면 여기도 같이 바뀐다
const PROFILE_QUERY_KEY = ['mypage', 'profile'] as const

// 뒤로가기로 돌아왔을 때 되살릴 화면 상태 (탭이 살아 있는 동안만 메모리에 남는다)
type WorkspaceSnapshot = {
    canSelectSession: boolean
    fixedScanKey: string | null
    selectedScanKey: string | null | undefined
    activeSessionId: number | null
    isAnalysisPanelOpen: boolean
}

let workspaceSnapshot: WorkspaceSnapshot | null = null

// 로그인/로그아웃(계정 전환)이 일어나면 이전 계정의 채팅 화면이 다음 계정에게 되살아나지 않도록 비운다
window.addEventListener(AUTH_CHANGE_EVENT, () => {
    workspaceSnapshot = null
})

function makeInstanceKey() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const IDLE_STATUS: ConversationStatus = {
    sessionId: null,
    hasProgress: false,
    isBusy: false,
    isGeneratingDesign: false,
    designCount: 0,
}

// 사이드바 채팅 이력의 한 묶음 = 손 분석 기록 하나
export type ChatHistoryGroup = {
    key: string
    scanKey: string | null
    // 손 분석 기록 미리보기 (피부톤·추천 컬러 6개·날짜) — 기록 없이 만든 채팅 묶음이면 null
    preview: HandRecordPreview | null
    label: string | null
    chats: ChatSummary[]
    // 이 묶음의 + 버튼으로 이 기록을 반영한 새 채팅을 열 수 있는지 (단독 진입: 고를 수 있는 기록 / 손 촬영에서 이어 온 진입: 그 기록만)
    canStartChat: boolean
}

const NO_RECORD_GROUP_KEY = '__no-record__'

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'naily.designChat.sidebarCollapsed'

function readSidebarCollapsed(): boolean {
    try {
        return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
    } catch {
        return false
    }
}

export function sortChatSummaries(chats: ChatSummary[]): ChatSummary[] {
    return [...chats].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
}

export function useDesignChatWorkspace() {
    const navigate = useNavigate()
    const location = useLocation()
    const navigationType = useNavigationType()
    const queryClient = useQueryClient()

    const navState = (location.state as
        | {
        leftScanId?: number | null
        rightScanId?: number | null
        scanId?: number | null
        regenerate?: RegenerateNavState | null
    }
        | null) ?? null

    // 브라우저 뒤로/앞으로가기(POP)로 돌아온 경우에만 직전 화면(보던 채팅·고른 기록)을 되살린다.
    // 앱 안의 링크/버튼으로 들어온 경우(PUSH/REPLACE)엔 항상 새 채팅으로 시작한다. 마운트 때 한 번만 정한다.
    // 떠날 때 답변·디자인을 기다리던 채팅은 숨겨 둔 채 계속 진행 중이므로 그 채팅을 그대로 다시 띄운다.
    const [entry] = useState(() => {
        const liveSnapshot = getLiveConversationSnapshot()
        if (navigationType === 'POP' && workspaceSnapshot) {
            const restoredSessionId = workspaceSnapshot.activeSessionId
            const background = restoredSessionId !== null ? getBackgroundChat(restoredSessionId) ?? null : null
            if (background || liveSnapshot) return { restored: workspaceSnapshot, liveSnapshot, background }
        }
        workspaceSnapshot = null
        return { restored: null, liveSnapshot: null, background: null }
    })

    // 손 촬영 → 출력에서 scanId를 콕 집어 넘겨준 경우(= 메인 "시작하기"로 이어진 흐름)엔 그때 분석한 기록에 고정하고,
    // 단독으로 들어온 경우(사이드바·헤더 링크 등)에만 반영할 손 분석 기록을 고를 수 있다.
    const [canSelectSession] = useState(
        () => entry.restored?.canSelectSession ?? !(navState?.leftScanId || navState?.rightScanId || navState?.scanId),
    )
    const [fixedScanKey] = useState<string | null>(() =>
        entry.restored
            ? entry.restored.fixedScanKey
            : canSelectSession
                ? null
                : buildScanKey(navState?.leftScanId ?? navState?.scanId ?? null, navState?.rightScanId ?? null),
    )

    // ── 데이터 ──────────────────────────────────────────────────────────────
    const profileQuery = useQuery({ queryKey: PROFILE_QUERY_KEY, queryFn: getMyProfile })
    const userName = profileQuery.data ? profileQuery.data.nickname || profileQuery.data.name : ''

    const scanSessionsQuery = useMyScanSessionsQuery()
    // 고를 수 있는 기록은 마이페이지 이력과 동일하게 실제로 분석이 다 끝난 기록만
    const selectableSessions = useMemo(
        () => (scanSessionsQuery.data ?? []).filter(isFullyAnalyzedSession),
        [scanSessionsQuery.data],
    )

    const chatSummariesQuery = useQuery({ queryKey: CHAT_SUMMARIES_QUERY_KEY, queryFn: getChatSummaries })

    // 최근에 사용한 손 분석 기록 — 가장 최근에 이어 한 채팅(이력은 최근 순)에 반영한 기록.
    // 그런 채팅이 없으면(아직 채팅 전·기록 없이만 채팅함) 가장 최근에 촬영한 기록. 고를 수 없는(지워진 등) 기록은 건너뛴다.
    const pickRecentlyUsedScanKey = (chats: ChatSummary[]) => {
        const selectableKeys = new Set(selectableSessions.map((session) => session.key))
        const recentChat = chats.find((chat) => chat.scanKey && selectableKeys.has(chat.scanKey))
        return recentChat?.scanKey ?? selectableSessions[0]?.key ?? null
    }
    const recentlyUsedScanKey = pickRecentlyUsedScanKey(chatSummariesQuery.data ?? [])

    // ── 지금 채팅에 반영 중인 손 분석 기록 ───────────────────────────────────
    // undefined = 아직 정하지 못함 (단독 진입에서 기록 목록을 불러오는 중), null = 반영할 기록 없음
    const [selectedScanKey, setSelectedScanKey] = useState<string | null | undefined>(() =>
        entry.restored ? entry.restored.selectedScanKey : canSelectSession ? undefined : fixedScanKey,
    )

    // 결과 화면 "디자인 다시 생성하기"로 들어왔으면 그 디자인을 만든 채팅에 반영했던 기록을 그대로 쓴다
    const [regenerateEntry] = useState(() => (entry.restored ? null : navState?.regenerate ?? null))

    // 단독 진입의 새 채팅은 "새 채팅" 버튼과 같이 최근에 사용한 기록을 기본으로 반영한다 — 기록 목록과 채팅 이력을
    // 다 불러오면 한 번 정한다 (렌더 중에 정해서 첫 화면부터 바로 쓴다)
    if (selectedScanKey === undefined && scanSessionsQuery.isFetched && chatSummariesQuery.isFetched) {
        const regeneratedChat = regenerateEntry?.sessionId
            ? chatSummariesQuery.data?.find((chat) => chat.sessionId === regenerateEntry.sessionId)
            : undefined
        setSelectedScanKey(regeneratedChat ? regeneratedChat.scanKey ?? null : recentlyUsedScanKey)
    }

    const analysisQuery = useQuery({
        queryKey: ['scans', 'hand-analysis', selectedScanKey],
        queryFn: () => fetchHandAnalysis(selectedScanKey as string),
        enabled: !!selectedScanKey,
        staleTime: Infinity,
    })
    const analysisData = selectedScanKey ? analysisQuery.data : undefined
    const leftAnalysis = analysisData?.leftAnalysis ?? null
    const rightAnalysis = analysisData?.rightAnalysis ?? null
    const analysisSummary = useMemo(() => buildHandAnalysisSummary(leftAnalysis, rightAnalysis), [leftAnalysis, rightAnalysis])
    const isAnalysisReady = selectedScanKey === null || (!!selectedScanKey && !analysisQuery.isPending)

    const analysis = useMemo<ConversationAnalysis>(() => {
        const { leftScanId, rightScanId } = parseScanKey(selectedScanKey)
        return {
            leftAnalysis,
            rightAnalysis,
            scanId: leftScanId ?? rightScanId ?? null,
            scanKey: selectedScanKey ?? null,
            summary: analysisSummary,
        }
    }, [leftAnalysis, rightAnalysis, selectedScanKey, analysisSummary])

    // 새 채팅 인사말은 닉네임과 반영할 기록을 다 불러온 뒤에 만든다
    const isContextReady = !profileQuery.isPending && isAnalysisReady

    // 손 분석 기록 미리보기 — 목록에 있는 기록은 목록 값으로, 없는 기록(이력에서 연 예전 채팅 등)은 불러온 분석 결과로
    const recordPreviewByKey = useMemo(() => {
        const map = new Map<string, HandRecordPreview>()
        for (const session of scanSessionsQuery.data ?? []) map.set(session.key, buildHandRecordPreview(session))
        return map
    }, [scanSessionsQuery.data])
    const currentRecordPreview = useMemo(() => {
        if (!selectedScanKey) return null
        return (
            recordPreviewByKey.get(selectedScanKey) ??
            buildHandRecordPreviewFromAnalysis({ leftAnalysis, rightAnalysis })
        )
    }, [selectedScanKey, recordPreviewByKey, leftAnalysis, rightAnalysis])

    // ── 지금 보여 주는 채팅 ─────────────────────────────────────────────────
    const [activeChat, setActiveChat] = useState<HostedChat>(
        () =>
            entry.background?.chat ?? {
                instanceKey: makeInstanceKey(),
                snapshot: entry.liveSnapshot,
                regenerate: entry.restored ? null : navState?.regenerate ?? null,
            },
    )
    const [activeSessionId, setActiveSessionId] = useState<number | null>(
        () => entry.restored?.activeSessionId ?? entry.liveSnapshot?.sessionId ?? null,
    )
    // 지금 채팅이 알려 온 진행 상황 — 아직 알려 오기 전이면 이력에서 연 채팅은 진행한 채팅으로, 새 채팅은 아무것도 안 한 채팅으로 본다
    const reportedStatus = useChatStatus(activeChat.instanceKey)
    const status: ConversationStatus =
        reportedStatus ?? (activeSessionId ? { ...IDLE_STATUS, sessionId: activeSessionId, hasProgress: true } : IDLE_STATUS)
    // 사이드바 채팅 이력의 상태 점 (디자인을 만드는 중 / 보지 않는 동안 다 만듦)
    const designStatusBySession = useChatDesignStatuses()
    const [openingSessionId, setOpeningSessionId] = useState<number | null>(null)
    const [chatError, setChatError] = useState<string | null>(null)
    const openRequestRef = useRef(0)

    // 이 화면에서 오간 채팅의 마지막 상태 — 다시 열면 서버에 묻지 않고 바로 (첨부 사진까지 그대로) 보여 준다
    const localChatsRef = useRef(new Map<number, { snapshot: ConversationSnapshot; scanKey: string | null }>())

    const [isAnalysisPanelOpen, setIsAnalysisPanelOpen] = useState(entry.restored?.isAnalysisPanelOpen ?? false)
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(readSidebarCollapsed)
    // 좁은 화면에서는 사이드바가 채팅 위로 덮어 열리는 서랍이 된다
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)

    useEffect(() => {
        try {
            window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, isSidebarCollapsed ? '1' : '0')
        } catch {
            // 저장 못 해도 이번 화면에서는 그대로 동작한다
        }
    }, [isSidebarCollapsed])

    // 뒤로가기 복원용 — 렌더될 때마다 지금 화면 상태를 남긴다 (채팅 대화는 useNailDesignChatPage가 따로 남긴다)
    useEffect(() => {
        workspaceSnapshot = {
            canSelectSession,
            fixedScanKey,
            selectedScanKey,
            activeSessionId,
            isAnalysisPanelOpen,
        }
    })

    // 지금 채팅을 화면에서 내리기 전에 마지막 상태를 기억해 둔다 (다시 열 때 바로 보여 주기 위함).
    // 답변·디자인을 기다리는 채팅은 숨겨 둔 채 계속 진행되고, 다시 열면 그 채팅을 그대로 보여 주므로 기억하지 않는다.
    const rememberActiveChat = () => {
        const snapshot = getLiveConversationSnapshot()
        if (activeSessionId && snapshot?.sessionId === activeSessionId && status.hasProgress && !status.isBusy) {
            localChatsRef.current.set(activeSessionId, { snapshot, scanKey: selectedScanKey ?? null })
        }
    }

    const showChat = (chat: Omit<HostedChat, 'instanceKey'>, sessionId: number | null) => {
        setActiveChat({ ...chat, instanceKey: makeInstanceKey() })
        setActiveSessionId(sessionId)
        setChatError(null)
        setIsMobileSidebarOpen(false)
    }

    // 지금 채팅이 아무것도 안 한 새 채팅인지 — 이때 "새 채팅"을 다시 누르면 세션을 또 만들지 않는다
    const isFreshChat = !status.hasProgress && !activeChat.snapshot && !activeChat.regenerate

    /**
     * 새 채팅 — 지금 채팅은 그대로 이력에 남는다 (답변·디자인을 기다리는 중이면 숨겨 둔 채 계속 진행된다).
     * 새 채팅을 열었거나 이미 새 채팅이면 true
     */
    const startNewChat = (options: { scanKey?: string | null } = {}) => {
        // 기록을 정해 주지 않은 새 채팅(사이드바 "새 채팅")은 단독 진입이면 최근에 사용한 기록으로, 손 촬영에서 이어 온 진입이면 그때 고른 기록으로
        const nextScanKey = options.scanKey !== undefined ? options.scanKey : canSelectSession ? recentlyUsedScanKey : fixedScanKey
        if (isFreshChat && nextScanKey === selectedScanKey) {
            setIsMobileSidebarOpen(false)
            return true
        }
        openRequestRef.current += 1
        setOpeningSessionId(null)
        rememberActiveChat()
        setSelectedScanKey(nextScanKey)
        showChat({ snapshot: null, regenerate: null }, null)
        return true
    }

    /** 이력의 채팅 열기 — 지금 채팅은 그 채팅을 실제로 띄울 때 화면에서 내려간다 (불러오다 실패하면 지금 채팅이 그대로 보인다) */
    const openChat = async (summary: ChatSummary) => {
        if (summary.sessionId === activeSessionId) {
            setIsMobileSidebarOpen(false)
            return
        }
        rememberActiveChat()

        const requestId = ++openRequestRef.current
        // 숨겨 둔 채 진행하던 채팅이면 그대로 다시 보여 준다 (아직 만드는 중이면 생성 중 카드로, 다 만들었으면 결과까지)
        const background = getBackgroundChat(summary.sessionId)
        if (background) {
            setOpeningSessionId(null)
            setSelectedScanKey(background.scanKey)
            setActiveChat(background.chat)
            setActiveSessionId(background.sessionId)
            setChatError(null)
            setIsMobileSidebarOpen(false)
            return
        }

        const local = localChatsRef.current.get(summary.sessionId)
        if (local) {
            setOpeningSessionId(null)
            setSelectedScanKey(local.scanKey)
            showChat({ snapshot: local.snapshot, regenerate: null }, summary.sessionId)
            return
        }

        setOpeningSessionId(summary.sessionId)
        try {
            const res = await getChatState<unknown>(summary.sessionId)
            if (requestId !== openRequestRef.current) return
            const snapshot = deserializeConversationSnapshot(res.state)
            if (!snapshot) {
                setChatError('이 채팅을 불러오지 못했어요.')
                return
            }
            setSelectedScanKey(res.scanKey ?? null)
            showChat({ snapshot: { ...snapshot, sessionId: summary.sessionId }, regenerate: null }, summary.sessionId)
        } catch {
            if (requestId === openRequestRef.current) setChatError('채팅을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
        } finally {
            if (requestId === openRequestRef.current) setOpeningSessionId(null)
        }
    }

    /**
     * 채팅 이력의 분석 기록 묶음에 있는 + — 그 기록을 반영한 새 채팅을 연다.
     * 손 촬영에서 이어 온 진입은 그때 고른 기록으로만 새 채팅을 열 수 있다 (다른 기록은 고를 수 없다).
     * 새 채팅을 열면 인사말도 그 기록에 맞춰 새로 붙는다 (아무것도 안 한 채팅에서 같은 기록을 누르면 그대로 둔다).
     */
    const startChatWithRecord = (scanKey: string) => {
        if (!canSelectSession && scanKey !== fixedScanKey) return false
        return startNewChat({ scanKey })
    }

    /**
     * 채팅 이력에서 지우기 — 이 채팅으로 만든 디자인은 마이페이지에 그대로 남는다.
     * 지금 보고 있는 채팅이면 (최근에 사용한 기록으로) 새 채팅으로 옮긴 뒤 지운다 (만들던 디자인이 있어도 함께 멈춘다).
     */
    const deleteChatById = async (sessionId: number) => {
        const isActive = sessionId === activeSessionId
        // 화면을 옮기며 마지막 상태를 저장하거나 늦게 끝난 저장이 이 채팅을 되살리지 않게 막는다
        // (화면에서 내려도 숨겨 둔 채 계속하지 않고 그대로 내린다 — designChatRuntime)
        markConversationDeleted(sessionId)
        const previous = queryClient.getQueryData<ChatSummary[]>(CHAT_SUMMARIES_QUERY_KEY)
        const remaining = (previous ?? []).filter((chat) => chat.sessionId !== sessionId)
        queryClient.setQueryData<ChatSummary[]>(CHAT_SUMMARIES_QUERY_KEY, remaining)
        if (isActive) {
            startNewChat({ scanKey: canSelectSession ? pickRecentlyUsedScanKey(remaining) : fixedScanKey })
        }
        localChatsRef.current.delete(sessionId)
        // 숨겨 둔 채 진행하던 채팅이면 함께 내린다
        closeChatSession(sessionId)
        try {
            await deleteChat(sessionId)
            void queryClient.invalidateQueries({ queryKey: ['chats', 'search'] })
        } catch {
            unmarkConversationDeleted(sessionId)
            queryClient.setQueryData(CHAT_SUMMARIES_QUERY_KEY, previous)
            window.alert('채팅을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.')
        }
    }

    /** 채팅 이름 직접 바꾸기 */
    const renameChatTitle = async (sessionId: number, title: string) => {
        const trimmed = title.replace(/\s+/g, ' ').trim()
        const previous = queryClient.getQueryData<ChatSummary[]>(CHAT_SUMMARIES_QUERY_KEY)
        if (!trimmed || previous?.find((chat) => chat.sessionId === sessionId)?.title === trimmed) return
        queryClient.setQueryData<ChatSummary[]>(CHAT_SUMMARIES_QUERY_KEY, (prev) =>
            prev?.map((chat) => (chat.sessionId === sessionId ? { ...chat, title: trimmed } : chat)),
        )
        try {
            const updated = await renameChat(sessionId, trimmed)
            queryClient.setQueryData<ChatSummary[]>(CHAT_SUMMARIES_QUERY_KEY, (prev) =>
                prev?.map((chat) => (chat.sessionId === sessionId ? { ...chat, title: updated.title } : chat)),
            )
        } catch {
            queryClient.setQueryData(CHAT_SUMMARIES_QUERY_KEY, previous)
            window.alert('채팅 이름을 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.')
        }
    }

    const handleSessionReady = (sessionId: number) => setActiveSessionId(sessionId)

    // 지금 채팅을 DesignChatHost에 알린다 (렌더될 때마다 — 닉네임·손 분석 기록 등 넘길 값이 바뀔 수 있다).
    // 채팅이 바뀌면 앞 채팅은 화면에서 내려가고, 답변·디자인을 기다리는 중이면 숨겨 둔 채 계속 진행된다.
    // 레이아웃 이펙트라 채팅이 화면에 그려지기 전에 알린다 (DesignChatSlot이 먼저 자리를 붙여 둔다).
    const activeInstanceKeyRef = useRef(activeChat.instanceKey)
    useLayoutEffect(() => {
        activeInstanceKeyRef.current = activeChat.instanceKey
        showForegroundChat({
            chat: activeChat,
            sessionId: activeSessionId,
            scanKey: selectedScanKey ?? null,
            isContextReady,
            userName,
            canSelectSession,
            recordCount: selectableSessions.length,
            analysis,
            onSessionReady: handleSessionReady,
            onStartNewChat: () => startNewChat(),
        })
    })
    // 채팅 화면을 떠나면(헤더 등으로 다른 페이지로 옮기면) 지금 채팅도 내린다 — 답변·디자인을 기다리는 중이면 숨겨 둔 채 계속 진행된다
    useLayoutEffect(() => () => releaseForegroundChat(activeInstanceKeyRef.current), [])

    /** 사이드바의 다른 화면 이동 (손 촬영·마이페이지 프로필) — 진행 중인 채팅은 숨겨 둔 채 계속된다 */
    const goTo = (path: string) => navigate(path)

    // ── 사이드바 채팅 이력: 손 분석 기록별로 묶는다 ──────────────────────────────
    const historyGroups = useMemo<ChatHistoryGroup[]>(() => {
        const chats = chatSummariesQuery.data ?? []
        const sessions = scanSessionsQuery.data ?? []
        const selectableKeys = new Set(selectableSessions.map((session) => session.key))
        const groups = new Map<string, ChatHistoryGroup>()
        const ensureGroup = (scanKey: string | null) => {
            const groupKey = scanKey ?? NO_RECORD_GROUP_KEY
            let group = groups.get(groupKey)
            if (!group) {
                const preview = scanKey ? recordPreviewByKey.get(scanKey) ?? null : null
                group = {
                    key: groupKey,
                    scanKey,
                    preview,
                    label: !scanKey ? '분석 기록 없이 만든 채팅' : preview ? null : '이전 분석 기록',
                    chats: [],
                    canStartChat: !!scanKey && !!preview && (canSelectSession ? selectableKeys.has(scanKey) : scanKey === fixedScanKey),
                }
                groups.set(groupKey, group)
            }
            return group
        }
        for (const chat of chats) ensureGroup(chat.scanKey).chats.push(chat)
        // 아직 채팅이 없는 기록도 + 로 새 채팅을 열 수 있게 묶음을 둔다 (손 촬영에서 이어 온 진입은 그 기록만)
        if (canSelectSession) selectableSessions.forEach((session) => ensureGroup(session.key))
        else if (fixedScanKey) ensureGroup(fixedScanKey)
        // 분석 기록 순서(최근 촬영 먼저) → 목록에 없는 기록 → 기록 없이 만든 채팅
        const order = (group: ChatHistoryGroup) => {
            if (!group.scanKey) return Number.MAX_SAFE_INTEGER
            const index = sessions.findIndex((session) => session.key === group.scanKey)
            return index >= 0 ? index : Number.MAX_SAFE_INTEGER - 1
        }
        return [...groups.values()]
            .map((group) => ({ ...group, chats: sortChatSummaries(group.chats) }))
            .sort((a, b) => order(a) - order(b))
    }, [chatSummariesQuery.data, scanSessionsQuery.data, recordPreviewByKey, selectableSessions, canSelectSession, fixedScanKey])

    // ── 분석 결과 상세 패널: 지금 채팅에 반영 중인 기록 ──────────────────────────────────────────────
    // 사이드바의 '분석 결과 상세 보기'(접힌 줄에서는 손 아이콘)로만 열고 닫는다 — 채팅 이력의 기록 줄은 그 기록의 채팅을 연다.
    // 다른 기록의 채팅을 열면 지금 채팅의 기록이 바뀌므로, 열려 있던 패널도 그 기록으로 바뀐다.
    const panelRecord = {
        isFixedRecord: !canSelectSession && selectedScanKey === fixedScanKey,
        summary: analysisSummary,
        preview: currentRecordPreview,
    }

    const closeAnalysisPanel = () => setIsAnalysisPanelOpen(false)

    /** 사이드바 위 '분석 결과 상세 보기' — 지금 채팅의 기록을 열고 닫는다 */
    const toggleCurrentRecordPanel = () => {
        setIsMobileSidebarOpen(false)
        setIsAnalysisPanelOpen((prev) => !prev)
    }

    return {
        navigate,
        userName,
        profile: profileQuery.data ?? null,
        canSelectSession,
        // 손 촬영 → 출력에서 이어 온 이번 촬영 기록을 보고 있는지 (고정 진입에서 이력의 다른 기록 채팅을 열면 false)
        isFixedRecord: !canSelectSession && selectedScanKey === fixedScanKey,
        recordPreviewByKey,
        isRecordLoading: selectedScanKey === undefined || (!!selectedScanKey && analysisQuery.isPending),
        currentScanKey: selectedScanKey ?? null,
        currentRecordPreview,
        analysis,
        analysisSummary,
        isContextReady,
        activeChat,
        activeSessionId,
        status,
        designStatusBySession,
        isFreshChat,
        openingSessionId,
        chatError,
        dismissChatError: () => setChatError(null),
        historyGroups,
        isHistoryLoading: chatSummariesQuery.isPending,
        isAnalysisPanelOpen,
        // 패널을 열어 두었는지 (사이드바 위 버튼이 '분석 결과 상세 닫기'가 된다)
        isCurrentRecordPanelOpen: isAnalysisPanelOpen,
        panelRecord,
        toggleCurrentRecordPanel,
        closeAnalysisPanel,
        isSidebarCollapsed,
        setIsSidebarCollapsed,
        isMobileSidebarOpen,
        setIsMobileSidebarOpen,
        startNewChat,
        openChat,
        startChatWithRecord,
        renameChatTitle,
        deleteChatById,
        goTo,
    }
}
