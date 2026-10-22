import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CHAT_SUMMARIES_QUERY_KEY, type ChatSummary } from '@/features/nail-design/api/chat'
import { DesignChatConversation } from '@/features/nail-design/components/DesignChatConversation'
import { reportChatStatus, useHostedChats } from '@/features/nail-design/hooks/designChatRuntime'
import { sortChatSummaries } from '@/features/nail-design/hooks/useDesignChatWorkspace'
import { isConversationDeleted } from '@/features/nail-design/hooks/useNailDesignChatPage'

// 디자인 채팅의 채팅들을 페이지 밖(앱 맨 위)에서 그린다 — 채팅 화면을 떠나도 답변·디자인을 기다리던 채팅이
// 계속 진행되고 저장되게 (designChatRuntime). 채팅마다 따로 둔 상자(.dcw-conversation)에 포털로 그리고,
// 채팅 화면은 지금 채팅의 상자를 DesignChatSlot 자리로 옮겨 붙여 보여 준다. 상자째 옮기므로 채팅이 새로 마운트되지 않는다.
// 화면에 없는 채팅의 상자는 숨긴 보관 칸(body 맨 끝)에 둔다.

const containers = new Map<string, HTMLDivElement>()
const containerUsers = new Map<string, number>()
let parking: HTMLDivElement | null = null

function getParking() {
    if (!parking) {
        parking = document.createElement('div')
        parking.hidden = true
        parking.setAttribute('data-design-chat-parking', '')
        document.body.appendChild(parking)
    }
    return parking
}

function getChatContainer(instanceKey: string) {
    let container = containers.get(instanceKey)
    if (!container) {
        container = document.createElement('div')
        container.className = 'dcw-conversation'
        containers.set(instanceKey, container)
        getParking().appendChild(container)
    }
    return container
}

function retainChatContainer(instanceKey: string) {
    containerUsers.set(instanceKey, (containerUsers.get(instanceKey) ?? 0) + 1)
}

// 채팅이 언마운트되면 상자도 치운다 — 개발 모드(StrictMode)에서 이펙트를 껐다 바로 다시 켤 때 치우지 않도록 한 박자 뒤에 본다
function releaseChatContainer(instanceKey: string) {
    containerUsers.set(instanceKey, (containerUsers.get(instanceKey) ?? 1) - 1)
    window.setTimeout(() => {
        if ((containerUsers.get(instanceKey) ?? 0) > 0) return
        containerUsers.delete(instanceKey)
        containers.get(instanceKey)?.remove()
        containers.delete(instanceKey)
    }, 0)
}

type HostedConversationProps = Parameters<typeof DesignChatConversation>[0] & { instanceKey: string }

function HostedConversation({ instanceKey, ...props }: HostedConversationProps) {
    const [container] = useState(() => getChatContainer(instanceKey))
    useEffect(() => {
        retainChatContainer(instanceKey)
        return () => releaseChatContainer(instanceKey)
    }, [instanceKey])
    return createPortal(<DesignChatConversation {...props} />, container)
}

export function DesignChatHost() {
    const { foreground, backgroundChats } = useHostedChats()
    const queryClient = useQueryClient()

    // 채팅이 저장되면 사이드바 이력에 바로 반영한다 (목록을 다시 받아오지 않는다).
    // 이력을 아직 안 불러왔으면(채팅 화면 밖에서 오래 있어 캐시가 비었으면) 그대로 둔다 — 화면에 들어오면 새로 받는다.
    // 지운 채팅이 늦게 끝난 저장으로 되살아나지 않게 한다.
    const handleSaved = (summary: ChatSummary) => {
        if (isConversationDeleted(summary.sessionId)) return
        queryClient.setQueryData<ChatSummary[]>(CHAT_SUMMARIES_QUERY_KEY, (prev) =>
            prev ? sortChatSummaries([summary, ...prev.filter((chat) => chat.sessionId !== summary.sessionId)]) : prev,
        )
    }

    const foregroundKey = foreground?.chat.instanceKey
    // 한 배열에 key로 그린다 — 지금 채팅이 숨긴 채팅이 되거나(화면을 떠날 때) 그 반대가 되어도 같은 채팅 컴포넌트가 그대로 산다
    // (배열을 나눠 그리면 자리가 바뀌는 순간 새로 마운트되어 진행 중이던 답변·디자인을 잃는다)
    const conversations = [
        // 숨겨 둔 채 계속 진행하는 채팅 — 사이드바에 알리지 않고, 내릴 때의 닉네임·손 분석 기록을 그대로 쓴다
        ...backgroundChats
            .filter((background) => background.chat.instanceKey !== foregroundKey)
            .map((background) => (
                <HostedConversation
                    key={background.chat.instanceKey}
                    instanceKey={background.chat.instanceKey}
                    initialSnapshot={background.chat.snapshot}
                    regenerate={background.chat.regenerate}
                    isContextReady
                    userName={background.userName}
                    canSelectSession={background.canSelectSession}
                    analysis={background.analysis}
                    onSaved={handleSaved}
                    onStatusChange={(status) => reportChatStatus(background.chat.instanceKey, status)}
                    isBackground
                />
            )),
        // 채팅 화면이 지금 보여 주는 채팅
        ...(foreground
            ? [
                  <HostedConversation
                      key={foreground.chat.instanceKey}
                      instanceKey={foreground.chat.instanceKey}
                      initialSnapshot={foreground.chat.snapshot}
                      regenerate={foreground.chat.regenerate}
                      isContextReady={foreground.isContextReady}
                      userName={foreground.userName}
                      canSelectSession={foreground.canSelectSession}
                      recordCount={foreground.recordCount}
                      analysis={foreground.analysis}
                      onSessionReady={foreground.onSessionReady}
                      onSaved={handleSaved}
                      onStatusChange={(status) => reportChatStatus(foreground.chat.instanceKey, status)}
                      onStartNewChat={foreground.onStartNewChat}
                      isBackground={false}
                  />,
              ]
            : []),
    ]
    return <>{conversations}</>
}

/** 채팅 화면에서 지금 채팅이 들어갈 자리 — DesignChatHost가 그린 그 채팅의 상자를 여기로 옮겨 붙인다 */
export function DesignChatSlot({ instanceKey }: { instanceKey: string }) {
    const slotRef = useRef<HTMLDivElement | null>(null)
    // 채팅 화면이 지금 채팅을 DesignChatHost에 알리기(부모의 레이아웃 이펙트) 전에 상자를 먼저 붙여 둔다 —
    // 채팅이 마운트될 때 이미 화면에 붙어 있어야 입력창 높이·스크롤을 제대로 잰다
    useLayoutEffect(() => {
        const slot = slotRef.current
        if (!slot) return
        slot.appendChild(getChatContainer(instanceKey))
        return () => {
            const container = containers.get(instanceKey)
            if (container) getParking().appendChild(container)
        }
    }, [instanceKey])
    return <div ref={slotRef} className="dcw-chat-slot" />
}
