import { useDesignChatWorkspace } from '@/features/nail-design/hooks/useDesignChatWorkspace'
import { DesignChatSidebar } from '@/features/nail-design/components/DesignChatSidebar'
import { DesignChatConversation } from '@/features/nail-design/components/DesignChatConversation'
import { HandAnalysisPanel } from '@/features/nail-design/components/HandAnalysisPanel'
import '@/styles/design-chat.css'
import '@/styles/design-chat-workspace.css'
import '@/styles/nail-design.css'
import '@/styles/mypage.css'

// 디자인 채팅 화면 — 공통 헤더 아래를 화면 높이에 맞춰 쓴다 (푸터는 그 아래). 왼쪽은 사이드바(접기·새 채팅·손 분석·채팅 이력),
// 가운데는 채팅, 오른쪽은 "분석 결과 상세 보기"로 여는 손 분석 결과 패널.
export function NailDesignChatPageContent() {
    const workspace = useDesignChatWorkspace()
    const {
        currentRecordPreview,
        isAnalysisPanelOpen,
        isMobileSidebarOpen,
        isSidebarCollapsed,
        panelRecord,
        setIsMobileSidebarOpen,
        setIsSidebarCollapsed,
        userName,
    } = workspace

    return (
        <div className={`dcw${isSidebarCollapsed ? ' is-sidebar-collapsed' : ''}${isAnalysisPanelOpen ? ' is-panel-open' : ''}`}>
            <DesignChatSidebar
                profile={workspace.profile}
                userName={userName}
                isCollapsed={isSidebarCollapsed}
                isMobileOpen={isMobileSidebarOpen}
                onToggleCollapsed={() => setIsSidebarCollapsed((prev) => !prev)}
                onCloseMobile={() => setIsMobileSidebarOpen(false)}
                onGoToScan={() => workspace.goTo('/scan/hand')}
                onGoToProfile={() => workspace.goTo('/mypage/profile')}
                onNewChat={() => workspace.startNewChat()}
                isFreshChat={workspace.isFreshChat}
                canSelectSession={workspace.canSelectSession}
                isFixedRecord={workspace.isFixedRecord}
                isRecordLoading={workspace.isRecordLoading}
                currentScanKey={workspace.currentScanKey}
                currentRecordPreview={currentRecordPreview}
                recordPreviewByKey={workspace.recordPreviewByKey}
                isCurrentRecordPanelOpen={workspace.isCurrentRecordPanelOpen}
                onToggleAnalysisPanel={workspace.toggleCurrentRecordPanel}
                panelRecordKey={workspace.panelRecordKey}
                onViewRecord={workspace.viewRecord}
                historyGroups={workspace.historyGroups}
                isHistoryLoading={workspace.isHistoryLoading}
                activeSessionId={workspace.activeSessionId}
                openingSessionId={workspace.openingSessionId}
                onOpenChat={(chat) => void workspace.openChat(chat)}
                onRenameChat={(sessionId, title) => void workspace.renameChatTitle(sessionId, title)}
                onDeleteChat={(sessionId) => void workspace.deleteChatById(sessionId)}
                onStartChatWithRecord={workspace.startChatWithRecord}
            />
            {isMobileSidebarOpen && (
                <button type="button" className="dcw-backdrop" aria-label="메뉴 닫기" onClick={() => setIsMobileSidebarOpen(false)} />
            )}

            <main className="dcw-main">
                {/* 좁은 화면 — 사이드바 대신 위쪽 줄에 채팅 목록 열기·새 채팅 */}
                <div className="dcw-mobile-bar">
                    <button
                        type="button"
                        className="dcw-mobile-bar__btn dcw-mobile-bar__btn--menu"
                        onClick={() => setIsMobileSidebarOpen(true)}
                    >
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                        채팅 목록 · 손 분석
                    </button>
                    <button type="button" className="dcw-mobile-bar__btn" onClick={() => workspace.startNewChat()} aria-label="새 채팅">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="M12 5.5v13M5.5 12h13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                        </svg>
                    </button>
                </div>

                {workspace.chatError && (
                    <div className="dcw-alert" role="alert">
                        <span>{workspace.chatError}</span>
                        <button type="button" onClick={workspace.dismissChatError} aria-label="알림 닫기">
                            ×
                        </button>
                    </div>
                )}

                {/* 디자인을 만드는 중에 다른 채팅으로 옮긴 채팅은 숨겨 둔 채(isBackground) 계속 만들고, 지금 채팅만 보인다.
                    숨겨 둔 채팅은 숨길 때의 손 분석 기록을 그대로 받고, 사이드바에 상태를 알리지 않는다 (저장 알림은 받는다). */}
                {workspace.conversations.map(({ chat, analysis, isBackground }) => (
                    <DesignChatConversation
                        key={chat.instanceKey}
                        initialSnapshot={chat.snapshot}
                        regenerate={chat.regenerate}
                        isContextReady={isBackground ? true : workspace.isContextReady}
                        userName={userName}
                        canSelectSession={workspace.canSelectSession}
                        analysis={analysis}
                        onSessionReady={isBackground ? undefined : workspace.handleSessionReady}
                        onSaved={workspace.handleChatSaved}
                        onStatusChange={isBackground ? undefined : workspace.setStatus}
                        onStartNewChat={() => workspace.startNewChat()}
                        isBackground={isBackground}
                    />
                ))}
            </main>

            {isAnalysisPanelOpen && (
                <>
                    <button
                        type="button"
                        className="dcw-panel-backdrop"
                        aria-label="분석 결과 상세 닫기"
                        onClick={workspace.closeAnalysisPanel}
                    />
                    <HandAnalysisPanel
                        userName={userName}
                        analysisSummary={panelRecord.summary}
                        dateLabel={panelRecord.preview?.dateLabel ?? ''}
                        isFixedRecord={panelRecord.isFixedRecord}
                        isOtherRecord={panelRecord.isOtherRecord}
                        isLoading={panelRecord.isLoading}
                        loadFailed={panelRecord.loadFailed}
                        onStartChat={panelRecord.canStartChat ? workspace.startChatWithPanelRecord : undefined}
                        onClose={workspace.closeAnalysisPanel}
                        onGoToScan={() => workspace.goTo('/scan/hand')}
                    />
                </>
            )}
        </div>
    )
}
