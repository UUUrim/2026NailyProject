import { useDesignChatWorkspace } from '@/features/nail-design/hooks/useDesignChatWorkspace'
import { DesignChatSidebar } from '@/features/nail-design/components/DesignChatSidebar'
import { DesignChatSlot } from '@/features/nail-design/components/DesignChatHost'
import { HandAnalysisPanel } from '@/features/nail-design/components/HandAnalysisPanel'
import { useAuth } from '@/shared/hooks/useAuth'
import '@/styles/design-chat.css'
import '@/styles/design-chat-workspace.css'
import '@/styles/nail-design.css'
import '@/styles/mypage.css'

// 디자인 채팅 화면 — 공통 헤더 아래를 화면 높이에 맞춰 쓴다 (푸터는 그 아래). 왼쪽은 사이드바(접기·새 채팅·손 분석·채팅 이력),
// 가운데는 채팅, 오른쪽은 "분석 결과 상세 보기"로 여는 손 분석 결과 패널.
export function NailDesignChatPageContent() {
    const workspace = useDesignChatWorkspace()
    const { logout } = useAuth()
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
                onGoToMyPage={() => workspace.goTo('/mypage')}
                onGoToDesigns={() => workspace.goTo('/mypage/designs')}
                onLogout={() => {
                    // 마이페이지 로그아웃과 같게 — 토큰을 지우고 홈으로
                    logout()
                    workspace.goTo('/')
                }}
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
                fixedScanKey={workspace.fixedScanKey}
                viewingRecordKey={workspace.viewingRecordKey}
                onViewRecord={workspace.viewRecord}
                historyGroups={workspace.historyGroups}
                isHistoryLoading={workspace.isHistoryLoading}
                activeSessionId={workspace.activeSessionId}
                designStatusBySession={workspace.designStatusBySession}
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

                {/* 지금 채팅 — 채팅은 앱 맨 위의 DesignChatHost가 그리고 여기에 붙여 보여 준다. 답변·디자인을 기다리는 채팅은
                    다른 채팅을 열거나 이 화면을 떠나도 숨겨 둔 채 계속 진행된다 */}
                <DesignChatSlot instanceKey={workspace.activeChat.instanceKey} />
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
                        // 보통은 지금 채팅에 반영 중인 기록 — 손 촬영에서 이어 온 진입에서 다른 기록 줄을 누르면 그 기록
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
