import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { AppShell } from '@/shared/layout/AppShell'
import { WarningIcon } from '@/shared/components/icons/WarningIcon'
import { getNailShape } from '@/shared/constants/nailShapes'
import { parseDateFlexible, type ScanSession } from '@/shared/utils/scanDetail'
import {
    PREFERENCE_OPTIONS,
    PREFERENCE_OPTION_INFO,
    SHAPE_PREVIEW_IMAGES,
    type PreferenceKey,
} from '@/shared/constants/designPreferences'
import { NailPreview3D } from '@/features/nail-design/components/NailPreview3D'
import { useNailDesignChatPage, QMARK_TOKEN, MENU_OPTIONS } from '@/features/nail-design/hooks/useNailDesignChatPage'
import '@/styles/design-chat.css'
import '@/styles/nail-design.css'
import '@/styles/mypage.css'

// 생성 방식 선택 화면(4분할 카드)에서 각 방식이 "어떻게" 디자인을 만드는지 한눈에 보여주기 위한 설명 + 아이콘
const MENU_ITEMS: {
    value: string
    label: string
    title: string
    desc: string
    icon: ReactElement
}[] = [
    {
        value: 'preference',
        label: '선택지 기반으로 만들기',
        title: '선택지로 빠르게',
        desc: '분위기·디자인 타입 등 준비된 선택지를 골라 순서대로 답하면 완성돼요.',
        icon: (
            <svg viewBox="0 0 24 24" fill="none" width="26" height="26">
                <path d="M8 6h11M8 12h11M8 18h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <path d="m4 5.3 1 1L6.5 4.5M4 11.3l1 1 1.5-1.8M4 17.3l1 1 1.5-1.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        ),
    },
    {
        value: 'freeform',
        label: '자유 입력으로 만들기',
        title: '채팅으로 자유롭게',
        desc: '원하는 느낌을 채팅으로 보내면 AI가 그대로 디자인해 줘요.',
        icon: (
            <svg viewBox="0 0 24 24" fill="none" width="26" height="26">
                {/* 뒤쪽(아래) 말풍선 — 몸통+꼬리가 이어진 완전히 닫힌 도형. 이 아이콘이 항상 놓이는
                    원형 배지 배경(--naily-pink-light)과 같은 색으로 채워서, 위에 그려지는 앞쪽 말풍선이
                    자연스럽게 겹치는 부분을 가리게 한다(수동으로 선을 잘라내지 않아도 됨). 꼬리는 왼쪽을 향한다 */}
                <path
                    d="M5.4 6 H11.6 A2.4 2.4 0 0 1 14 8.4 V12.6 A2.4 2.4 0 0 1 11.6 15 L8.5 15 4 18.5 6.5 15 H5.4 A2.4 2.4 0 0 1 3 12.6 V8.4 A2.4 2.4 0 0 1 5.4 6 Z"
                    fill="#fdf5f8"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
                {/* 앞쪽(위) 말풍선 — 몸통+꼬리가 이어진 완전히 닫힌 도형이며 가려지는 곳 없이 전부 보인다.
                    같은 배경색으로 채워서 뒤쪽 말풍선의 겹치는 부분을 가린다. 꼬리는 오른쪽을 향한다 */}
                <path
                    d="M11.4 3 H18.6 A2.4 2.4 0 0 1 21 5.4 V9.6 A2.4 2.4 0 0 1 18.6 12 H16.5 L19 15.5 13.5 12 H11.4 A2.4 2.4 0 0 1 9 9.6 V5.4 A2.4 2.4 0 0 1 11.4 3 Z"
                    fill="#fdf5f8"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
                <circle cx="12.5" cy="7.5" r="0.9" fill="currentColor" />
                <circle cx="15" cy="7.5" r="0.9" fill="currentColor" />
                <circle cx="17.5" cy="7.5" r="0.9" fill="currentColor" />
            </svg>
        ),
    },
    {
        value: 'photo',
        label: '사진 기반으로 만들기',
        title: '사진으로 참고',
        desc: '마음에 드는 레퍼런스 사진을 올리면 그 느낌으로 만들어 줘요.',
        icon: (
            <svg viewBox="0 0 24 24" fill="none" width="26" height="26">
                <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.6" />
                <path d="m8 14 2.5-3 2 2L16 9l2 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="9" cy="9" r="1.1" fill="currentColor" />
            </svg>
        ),
    },
    {
        value: 'scan-auto',
        label: '내 스캔 정보 기반으로 자동 생성',
        title: '내 스캔 정보로 자동',
        desc: '저장된 손 분석 결과를 바탕으로 어울리는 디자인을 알아서 추천해요.',
        icon: (
            <svg viewBox="0 0 24 24" fill="none" width="26" height="26">
                <path d="M8 12.5V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11.5V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6.5 7C6.7 20 5 17 5 14.2v-2a1.4 1.4 0 0 1 2.8 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        ),
    },
]
function QuestionMarkIcon({ className, size = 16 }: { className?: string; size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className={className}
            style={{ display: 'inline', verticalAlign: '-3px' }}
        >
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
            <path
                d="M9.5 9.2a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1.2.9-1.2 1.7v.4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
            <circle cx="12" cy="16.6" r="1" fill="currentColor" />
        </svg>
    )
}
// 사이드바 헤더의 "분석 결과 선택" 드롭다운 — 손 분석 이력(양손 다 촬영된 세션)을
// 대표 피부색 스와치 + 날짜 + 헥스값으로 보여주고 고를 수 있게 한다.
function SessionDropdown({
                              sessions,
                              selectedKey,
                              currentDateLabel,
                              onSelect,
                          }: {
    sessions: ScanSession[]
    selectedKey: string | null
    currentDateLabel: string
    onSelect: (session: ScanSession) => void
}) {
    const [open, setOpen] = useState(false)
    const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
    const [menuScrollable, setMenuScrollable] = useState(false)
    const wrapRef = useRef<HTMLDivElement | null>(null)
    const triggerRef = useRef<HTMLButtonElement | null>(null)
    const menuRef = useRef<HTMLDivElement | null>(null)
    const menuScrollRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        const handleOutsideClick = (e: MouseEvent) => {
            const target = e.target as Node
            if (wrapRef.current?.contains(target)) return
            if (menuRef.current?.contains(target)) return
            setOpen(false)
        }
        document.addEventListener('mousedown', handleOutsideClick)
        return () => document.removeEventListener('mousedown', handleOutsideClick)
    }, [])

    // 목록이 실제로 넘쳐서 스크롤될 때만 스크롤바 자리를 비워두고, 안 넘칠 땐 오른쪽 여백이 남지 않게 한다
    useEffect(() => {
        if (!open) return
        const el = menuScrollRef.current
        if (!el) return
        setMenuScrollable(el.scrollHeight > el.clientHeight + 1)
    }, [open, sessions])

    if (sessions.length === 0) return null

    const toggleOpen = (e: ReactMouseEvent) => {
        e.stopPropagation()
        const rect = triggerRef.current?.getBoundingClientRect()
        if (rect) {
            setMenuPos({ top: rect.bottom + 8, left: rect.right })
        }
        setOpen((prev) => !prev)
    }

    return (
        <div className="design-chat-sidebar__session-dropdown" ref={wrapRef}>
            <button
                ref={triggerRef}
                type="button"
                className={`design-chat-sidebar__session-trigger${open ? ' is-open' : ''}`}
                onClick={toggleOpen}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label="분석 결과 선택"
            >
                <span>{currentDateLabel}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>

            {open && menuPos &&
                createPortal(
                    <div
                        ref={menuRef}
                        className="design-chat-sidebar__session-menu"
                        role="listbox"
                        style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, transform: 'translateX(-100%)' }}
                    >
                        <div
                            ref={menuScrollRef}
                            className={`design-chat-sidebar__session-menu-scroll${menuScrollable ? ' is-scrollable' : ''}`}
                        >
                            {sessions.map((session) => (
                                <button
                                    key={session.key}
                                    type="button"
                                    role="option"
                                    aria-selected={session.key === selectedKey}
                                    className={`design-chat-sidebar__session-option${session.key === selectedKey ? ' is-active' : ''}`}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onSelect(session)
                                        setOpen(false)
                                    }}
                                >
                                    <span
                                        className="design-chat-sidebar__session-swatch"
                                        style={{ background: session.skinToneHex || '#eee' }}
                                        aria-hidden="true"
                                    />
                                    <span className="design-chat-sidebar__session-info">
                                        <span className="design-chat-sidebar__session-date">{formatMonthDay(session.scannedAt)}</span>
                                        <span className="design-chat-sidebar__session-hex">{session.skinToneHex ?? '-'}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>,
                    document.body,
                )}
        </div>
    )
}

// 드롭다운 목록에 보여줄 "n월 nn일" 형식(연도 없이)
function formatMonthDay(raw: string): string {
    const d = parseDateFlexible(raw)
    if (!d) return ''
    return `${d.getMonth() + 1}월 ${d.getDate()}일`
}

// 선택지 라벨 옆에 작게 병기할 영문 표기 (계절/컬러 단계는 값 자체가 영단어가 아니라서 제외).
// mood/designType/motif/shape의 value는 이미 영단어(예: lovely, polka dot)라 그대로 타이틀케이스로 바꿔 쓴다.
const ENGLISH_SUBLABEL_STEPS: PreferenceKey[] = ['mood', 'designType', 'motif', 'shape']

function toEnglishTitleCase(value: string): string {
    return value.replace(/\b\w/g, (c) => c.toUpperCase())
}
export function NailDesignChatPageContent() {
    const {
        navigate,
        canSelectSession,
        userName,
        isInitReady,
        scanId,
        bubbles,
        activeQuickReply,
        isAwaitingGenerateConfirm,
        selectedInQuickReply,
        preferenceStepIndex,
        lastDesign,
        selectedPhotoFile,
        selectedPhotoPreviewUrl,
        photoInputRef,
        inputValue,
        setInputValue,
        isSending,
        customColor,
        setCustomColor,
        isQuickReplyCollapsed,
        setIsQuickReplyCollapsed,
        tooltipAnchor,
        setTooltipAnchor,
        tooltipImgError,
        setTooltipImgError,
        pinnedTooltipKey,
        setPinnedTooltipKey,
        freeformColorPickerOpen,
        freeformShapePickerOpen,
        showAnalysisPanel,
        setShowAnalysisPanel,
        preview3DImage,
        setPreview3DImage,
        zoomedImage,
        imageZoom,
        imagePan,
        isImageDragging,
        zoomedImageViewportRef,
        leftAnalysis,
        rightAnalysis,
        scanSessions,
        selectedSessionKey,
        messagesRef,
        chatContainerRef,
        textareaRef,
        hasScanColorPalette,
        colorPickerPalette,
        isMultiConfirmVisible,
        analysisSummary,
        MOTIF_NONE_VALUE,
        handleMenuSelect,
        toggleQuickReplyValue,
        confirmPreferenceStep,
        goToPreviousPreferenceStep,
        handlePhotoFileChange,
        handlePhotoConfirm,
        handleSubmitInput,
        handleQuickReplyClick,
        closeFreeformPicker,
        toggleFreeformColor,
        handleFreeformColorPickerConfirm,
        handleFreeformShapeSelect,
        handleToggleAnalysisPanel,
        handleSelectSession,
        showOptionTooltip,
        hideOptionTooltip,
        toggleOptionTooltip,
        openZoomedImage,
        closeZoomedImage,
        handleZoomedImagePointerDown,
        handleZoomedImagePointerMove,
        stopZoomedImageDragging,
        adjustTextareaHeight,
    } = useNailDesignChatPage()

    return (
        <AppShell mainClassName="design-chat-page">
            <div className="design-chat-layout">
                {showAnalysisPanel && (
                    <aside className="design-chat-sidebar">
                        <div className="design-chat-sidebar__header">
                            <div className="design-chat-sidebar__header-main">
                                <p className="design-chat-sidebar__eyebrow">Hand Analysis</p>
                                <div className="design-chat-sidebar__title-row">
                                    <h2>{userName ? `${userName} 님의 손 분석` : '손 분석 결과'}</h2>
                                    {analysisSummary &&
                                        (canSelectSession ? (
                                            scanSessions.length > 0 && (
                                                <SessionDropdown
                                                    sessions={scanSessions}
                                                    selectedKey={selectedSessionKey}
                                                    currentDateLabel={formatMonthDay(leftAnalysis?.scannedAt ?? rightAnalysis?.scannedAt ?? '')}
                                                    onSelect={(session) => void handleSelectSession(session)}
                                                />
                                            )
                                        ) : (
                                            <span className="design-chat-sidebar__session-static">
                                                {formatMonthDay(leftAnalysis?.scannedAt ?? rightAnalysis?.scannedAt ?? '')}
                                            </span>
                                        ))}
                                </div>
                            </div>
                            <button
                                type="button"
                                className="design-chat-sidebar__close"
                                aria-label="분석 결과 닫기"
                                onClick={() => setShowAnalysisPanel(false)}
                            >
                                ×
                            </button>
                        </div>

                        <div className="design-chat-sidebar__scroll">
                            {!analysisSummary ? (
                                <div className="design-chat-sidebar__empty">
                                    <span className="design-chat-sidebar__empty-icon" aria-hidden="true">
                                        <WarningIcon />
                                    </span>
                                    <p className="design-chat-sidebar__empty-text">
                                        손 스캔 정보가 없습니다.
                                        <br />
                                        {userName ? `${userName} 님의` : '회원님의'} 손 정보를 바탕으로 맞춤 디자인을 생성하려면,
                                        먼저 손을 촬영해 주세요.
                                    </p>
                                    <button
                                        type="button"
                                        className="design-chat-sidebar__scan-cta"
                                        onClick={() => navigate('/scan/hand')}
                                    >
                                        손 촬영하러 가기
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                            <path
                                                d="M5 12h12M13 6l6 6-6 6"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            />
                                        </svg>
                                    </button>
                                </div>
                            ) : (
                                <>
                                    {analysisSummary.skinToneHex && analysisSummary.skinToneAnalysis && (
                                        <div className="design-chat-sidebar__card">
                                            <span className="design-chat-sidebar__card-label">대표 피부색</span>
                                            <div className="design-chat-sidebar__tone-row">
                                                <span
                                                    className="design-chat-sidebar__tone-dot"
                                                    style={{ background: analysisSummary.skinToneHex }}
                                                    aria-hidden="true"
                                                />
                                                <p className="design-chat-sidebar__tone-name">{analysisSummary.skinToneHex}</p>
                                            </div>

                                            <div className="design-chat-sidebar__tone-bars">
                                                <div className="design-chat-sidebar__tone-bar">
                                                    <div className="design-chat-sidebar__tone-bar-head">
                                                        <span>톤</span>
                                                        <span>{analysisSummary.skinToneAnalysis.tone.label}</span>
                                                    </div>
                                                    <div className="design-chat-sidebar__tone-bar-track design-chat-sidebar__tone-bar-track--tone">
                                                        <span style={{ left: `${analysisSummary.skinToneAnalysis.tone.percent}%` }} />
                                                    </div>
                                                </div>
                                                <div className="design-chat-sidebar__tone-bar">
                                                    <div className="design-chat-sidebar__tone-bar-head">
                                                        <span>명도</span>
                                                        <span>{analysisSummary.skinToneAnalysis.brightness.label}</span>
                                                    </div>
                                                    <div className="design-chat-sidebar__tone-bar-track design-chat-sidebar__tone-bar-track--brightness">
                                                        <span style={{ left: `${analysisSummary.skinToneAnalysis.brightness.percent}%` }} />
                                                    </div>
                                                </div>
                                                <div className="design-chat-sidebar__tone-bar">
                                                    <div className="design-chat-sidebar__tone-bar-head">
                                                        <span>채도 (혈색)</span>
                                                        <span>{analysisSummary.skinToneAnalysis.saturation.label}</span>
                                                    </div>
                                                    <div className="design-chat-sidebar__tone-bar-track design-chat-sidebar__tone-bar-track--saturation">
                                                        <span style={{ left: `${analysisSummary.skinToneAnalysis.saturation.percent}%` }} />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {analysisSummary.skinTonePalette.length > 0 && (
                                        <div className="design-chat-sidebar__card">
                                            <span className="design-chat-sidebar__card-label">추천 컬러</span>
                                            <div className="design-chat-sidebar__palette">
                                                {analysisSummary.skinTonePalette.map((hex, idx) => (
                                                    <span
                                                        key={`${hex}-${idx}`}
                                                        className="design-chat-sidebar__palette-chip"
                                                        style={{ background: hex }}
                                                        title={hex}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <div className="design-chat-sidebar__card">
                                        <span className="design-chat-sidebar__card-label">추천 네일 쉐입</span>
                                        <div className="design-chat-sidebar__shape-row">
                                            <p className="design-chat-sidebar__shape-name">{analysisSummary.shapeLabel}</p>
                                            {analysisSummary.shapeImage && (
                                                <img
                                                    src={analysisSummary.shapeImage}
                                                    alt=""
                                                    className="design-chat-sidebar__shape-img"
                                                />
                                            )}
                                        </div>
                                    </div>

                                    <div className="design-chat-sidebar__card">
                                        <span className="design-chat-sidebar__card-label">손톱 측정값 평균</span>
                                        <ul className="design-chat-sidebar__metric-list">
                                            <li className="design-chat-sidebar__metric-row">
                                                <div className="design-chat-sidebar__metric-top">
                                                    <span className="design-chat-sidebar__metric-name">길이</span>
                                                    <span className="design-chat-sidebar__metric-value">{analysisSummary.avgLength}mm</span>
                                                </div>
                                                <span className="design-chat-sidebar__metric-bar" aria-hidden="true">
                                                    <span style={{ width: `${analysisSummary.lengthPct}%` }} />
                                                </span>
                                                <p className="design-chat-sidebar__metric-compare">{analysisSummary.lengthCompareLabel}</p>
                                            </li>
                                            <li className="design-chat-sidebar__metric-row">
                                                <div className="design-chat-sidebar__metric-top">
                                                    <span className="design-chat-sidebar__metric-name">너비</span>
                                                    <span className="design-chat-sidebar__metric-value">{analysisSummary.avgWidth}mm</span>
                                                </div>
                                                <span className="design-chat-sidebar__metric-bar" aria-hidden="true">
                                                    <span style={{ width: `${analysisSummary.widthPct}%` }} />
                                                </span>
                                                <p className="design-chat-sidebar__metric-compare">{analysisSummary.widthCompareLabel}</p>
                                            </li>
                                            <li className="design-chat-sidebar__metric-row">
                                                <div className="design-chat-sidebar__metric-top">
                                                    <span className="design-chat-sidebar__metric-name">곡률 (C-curve)</span>
                                                    <span className="design-chat-sidebar__metric-value">{analysisSummary.avgCurve}</span>
                                                </div>
                                                <span className="design-chat-sidebar__metric-bar" aria-hidden="true">
                                                    <span style={{ width: `${analysisSummary.curvePct}%` }} />
                                                </span>
                                                <p className="design-chat-sidebar__metric-compare">{analysisSummary.curveCompareLabel}</p>
                                            </li>
                                        </ul>
                                    </div>
                                </>
                            )}
                        </div>
                    </aside>
                )}

                <div className="design-chat" ref={chatContainerRef}>
                    <div className="design-chat__messages" ref={messagesRef}>
                        {!isInitReady && (
                            <div className="design-chat__row design-chat__row--assistant">
                                <img src="/images/logo.png" alt="" className="design-chat__avatar" />
                                <div className="design-chat__bubble design-chat__bubble--assistant design-chat__bubble--typing">
                                    <span />
                                    <span />
                                    <span />
                                </div>
                            </div>
                        )}
                        {bubbles.map((bubble) => (
                            <div key={bubble.id} className={`design-chat__row design-chat__row--${bubble.role}`}>
                                {bubble.role === 'assistant' && (
                                    <img src="/images/logo.png" alt="" className="design-chat__avatar" />
                                )}
                                <div className={`design-chat__bubble design-chat__bubble--${bubble.role}`}>
                                    {bubble.text.split('\n').map((line, i) => (
                                        <p key={i}>
                                            {line.split(QMARK_TOKEN).map((part, j, arr) => (
                                                <span key={j}>
                                {part}
                                                    {j < arr.length - 1 && <QuestionMarkIcon />}
                              </span>
                                            ))}
                                        </p>
                                    ))}
                                    {bubble.imageUrls && bubble.imageUrls.length > 0 && (
                                        <div
                                            className={
                                                bubble.isDesignResult
                                                    ? 'design-chat__bubble-images'
                                                    : 'design-chat__bubble-images design-chat__bubble-images--user-photo'
                                            }
                                        >
                                            {bubble.imageUrls.map((url, i) => (
                                                <div key={i} className="design-chat__bubble-image-wrap">
                                                    <img
                                                        src={url}
                                                        alt={bubble.isDesignResult ? `생성된 네일 디자인 ${i + 1}` : '업로드한 참고 사진'}
                                                        onClick={() => openZoomedImage(url)}
                                                        style={{ cursor: 'zoom-in' }}
                                                    />
                                                    {bubble.isDesignResult && (
                                                        <button
                                                            type="button"
                                                            className="design-chat__bubble-3d-badge"
                                                            onClick={() => setPreview3DImage(url)}
                                                        >
                                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                                                <path
                                                                    d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"
                                                                    stroke="currentColor"
                                                                    strokeWidth="1.6"
                                                                    strokeLinejoin="round"
                                                                />
                                                                <path d="M12 12v9M12 12L4 7.5M12 12l8-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                                                            </svg>
                                                            3D
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {bubble.colorSwatches && bubble.colorSwatches.length > 0 && (
                                        <div className="design-chat__bubble-colors">
                                            {bubble.colorSwatches.map((hex, i) => (
                                                <span key={i} className="design-chat__bubble-color-dot" style={{ background: hex }} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {isSending && (
                            <div className="design-chat__row design-chat__row--assistant">
                                <img src="/images/logo.png" alt="" className="design-chat__avatar" />
                                <div className="design-chat__bubble design-chat__bubble--assistant design-chat__bubble--typing">
                                    <span />
                                    <span />
                                    <span />
                                </div>
                            </div>
                        )}
                    </div>

                    {activeQuickReply && (
                        <div className="design-chat__quickreply">
                            <div className="design-chat__quickreply-header">
                                {activeQuickReply.id.startsWith('pref-') && preferenceStepIndex > 0 && (
                                    <button
                                        type="button"
                                        className="design-chat__quickreply-back-btn"
                                        onClick={goToPreviousPreferenceStep}
                                        disabled={isSending}
                                        aria-label="이전 질문으로 돌아가기"
                                    >
                                        ←
                                    </button>
                                )}

                                {activeQuickReply.id.startsWith('freeform-actions') &&
                                    (freeformColorPickerOpen || freeformShapePickerOpen) && (
                                        <button
                                            type="button"
                                            className="design-chat__quickreply-back-btn"
                                            onClick={closeFreeformPicker}
                                            disabled={isSending}
                                            aria-label="추천 선택지로 돌아가기"
                                        >
                                            ←
                                        </button>
                                    )}

                                <button
                                    type="button"
                                    className="design-chat__quickreply-header-toggle"
                                    onClick={() => setIsQuickReplyCollapsed((prev) => !prev)}
                                    aria-expanded={!isQuickReplyCollapsed}
                                >
                                    <p className="design-chat__quickreply-question">{activeQuickReply.question}</p>
                                </button>

                                <button
                                    type="button"
                                    className="design-chat__quickreply-chevron-btn"
                                    onClick={() => setIsQuickReplyCollapsed((prev) => !prev)}
                                    aria-expanded={!isQuickReplyCollapsed}
                                    aria-label={isQuickReplyCollapsed ? '펼치기' : '접기'}
                                >
                                    <svg
                                        width="16"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        aria-hidden="true"
                                        className={`design-chat__quickreply-chevron${isQuickReplyCollapsed ? ' is-collapsed' : ''}`}
                                    >
                                        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </button>
                            </div>

                            {!isQuickReplyCollapsed && (
                                <>
                                    {activeQuickReply.id === 'pref-color' ? (
                                        <div className="design-chat__color-picker">
                                            {hasScanColorPalette ? (
                                                <p className="design-chat__color-picker-label">{userName ? `${userName}님과 어울리는 컬러` : '회원님과 어울리는 컬러'}</p>
                                            ) : (
                                                <p className="design-chat__color-picker-label">추천 컬러 팔레트</p>
                                            )}

                                            <div className="design-chat__color-main">
                                                <div className="design-chat__color-grid">
                                                    {colorPickerPalette.map((hex, idx) => {
                                                        const selected = selectedInQuickReply.includes(hex)
                                                        return (
                                                            <button
                                                                key={`${hex}-${idx}`}
                                                                type="button"
                                                                className={`design-chat__color-swatch${selected ? ' is-selected' : ''}`}
                                                                style={{ background: hex }}
                                                                aria-label={hex}
                                                                onClick={() => toggleQuickReplyValue(hex)}
                                                                disabled={isSending}
                                                            />
                                                        )
                                                    })}
                                                </div>

                                                <div className="design-chat__color-custom">
                                                    <button
                                                        type="button"
                                                        className="design-chat__color-custom-add"
                                                        onClick={() => toggleQuickReplyValue(customColor.toUpperCase())}
                                                        disabled={isSending}
                                                    >
                                                        아래 색상 추가하기
                                                    </button>
                                                    <label className="design-chat__color-custom-picker">
                                                        <input
                                                            type="color"
                                                            value={customColor}
                                                            onChange={(e) => setCustomColor(e.target.value)}
                                                            disabled={isSending}
                                                        />
                                                    </label>
                                                </div>
                                            </div>

                                            {selectedInQuickReply.length > 0 && (
                                                <div className="design-chat__color-selected">
                                                    {selectedInQuickReply.map((hex) => (
                                                        <span key={hex} className="design-chat__color-chip">
                                        <span className="design-chat__color-chip-swatch" style={{ background: hex }} />
                                        <button
                                            type="button"
                                            aria-label={`${hex} 선택 해제`}
                                            onClick={() => toggleQuickReplyValue(hex)}
                                            disabled={isSending}
                                        >
                                          ×
                                        </button>
                                      </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ) : activeQuickReply.id === 'photo-upload' ? (
                                        <div className="design-chat__photo-upload">
                                            <input
                                                ref={photoInputRef}
                                                type="file"
                                                accept="image/*"
                                                className="design-chat__photo-upload-input"
                                                onChange={(e) => handlePhotoFileChange(e.target.files?.[0] ?? null)}
                                            />

                                            {selectedPhotoPreviewUrl ? (
                                                <div className="design-chat__photo-upload-preview">
                                                    <img src={selectedPhotoPreviewUrl} alt="선택한 참고 사진" />
                                                    <button
                                                        type="button"
                                                        className="design-chat__photo-upload-change"
                                                        onClick={() => photoInputRef.current?.click()}
                                                        disabled={isSending}
                                                    >
                                                        다른 사진 선택하기
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className="design-chat__photo-upload-dropzone"
                                                    onClick={() => photoInputRef.current?.click()}
                                                    disabled={isSending}
                                                >
                                                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                                        <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
                                                        <circle cx="8.5" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.6" />
                                                        <path d="M3 16l5-4 4 3 4-5 5 6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                                                    </svg>
                                                    사진 선택하기
                                                </button>
                                            )}

                                            {scanId && (
                                                <p className="design-chat__photo-upload-note">✓ 내 손 스캔 정보도 함께 반영돼요</p>
                                            )}
                                        </div>
                                    ) : activeQuickReply.id.startsWith('freeform-actions') && freeformColorPickerOpen ? (
                                        <div className="design-chat__color-picker">
                                            {hasScanColorPalette ? (
                                                <p className="design-chat__color-picker-label">{userName ? `${userName}님과 어울리는 컬러` : '회원님과 어울리는 컬러'}</p>
                                            ) : (
                                                <p className="design-chat__color-picker-label">추천 컬러 팔레트</p>
                                            )}

                                            <div className="design-chat__color-main">
                                                <div className="design-chat__color-grid">
                                                    {colorPickerPalette.map((hex, idx) => {
                                                        const selected = selectedInQuickReply.includes(hex)
                                                        return (
                                                            <button
                                                                key={`${hex}-${idx}`}
                                                                type="button"
                                                                className={`design-chat__color-swatch${selected ? ' is-selected' : ''}`}
                                                                style={{ background: hex }}
                                                                aria-label={hex}
                                                                onClick={() => toggleFreeformColor(hex)}
                                                                disabled={isSending}
                                                            />
                                                        )
                                                    })}
                                                </div>

                                                <div className="design-chat__color-custom">
                                                    <button
                                                        type="button"
                                                        className="design-chat__color-custom-add"
                                                        onClick={() => toggleFreeformColor(customColor.toUpperCase())}
                                                        disabled={isSending}
                                                    >
                                                        아래 색상 추가하기
                                                    </button>
                                                    <label className="design-chat__color-custom-picker">
                                                        <input
                                                            type="color"
                                                            value={customColor}
                                                            onChange={(e) => setCustomColor(e.target.value)}
                                                            disabled={isSending}
                                                        />
                                                    </label>
                                                </div>
                                            </div>

                                            {selectedInQuickReply.length > 0 && (
                                                <div className="design-chat__color-selected">
                                                    {selectedInQuickReply.map((hex) => (
                                                        <span key={hex} className="design-chat__color-chip">
                                                            <span className="design-chat__color-chip-swatch" style={{ background: hex }} />
                                                            <button
                                                                type="button"
                                                                aria-label={`${hex} 선택 해제`}
                                                                onClick={() => toggleFreeformColor(hex)}
                                                                disabled={isSending}
                                                            >
                                                                ×
                                                            </button>
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            <button
                                                type="button"
                                                className="design-chat__quickreply-confirm"
                                                onClick={handleFreeformColorPickerConfirm}
                                                disabled={isSending || selectedInQuickReply.length === 0}
                                                aria-label={`선택한 컬러 ${selectedInQuickReply.length}개로 선택`}
                                            >
                                                <span className="design-chat__quickreply-confirm-swatches" aria-hidden="true">
                                                    {selectedInQuickReply.map((hex) => (
                                                        <span
                                                            key={hex}
                                                            className="design-chat__quickreply-confirm-swatch"
                                                            style={{ background: hex }}
                                                        />
                                                    ))}
                                                </span>
                                                선택
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                                    <path
                                                        d="M5 12h12M13 6l6 6-6 6"
                                                        stroke="currentColor"
                                                        strokeWidth="2"
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                    />
                                                </svg>
                                            </button>
                                        </div>
                                    ) : activeQuickReply.id.startsWith('freeform-actions') && freeformShapePickerOpen ? (
                                        <div className="design-chat__quickreply-list design-chat__quickreply-list--grid3">
                                            {PREFERENCE_OPTIONS.shape.map((option) => {
                                                // 자유입력 흐름의 쉐입 선택도, 선택지 기반 흐름과 동일하게 현재 적용된
                                                // 분석 결과의 AI 추천 쉐입 카드에 "추천" 배지를 띄운다
                                                const isRecommendedShape =
                                                    analysisSummary?.shapeId != null && option.value === analysisSummary.shapeId
                                                return (
                                                    <button
                                                        key={option.value}
                                                        type="button"
                                                        className="design-chat__quickreply-item"
                                                        onClick={() => handleFreeformShapeSelect(option.label)}
                                                        disabled={isSending}
                                                    >
                                                        {isRecommendedShape && (
                                                            <span className="design-chat__quickreply-recommend-badge">
                                                                <svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" aria-hidden="true">
                                                                    <path d="M12 2.5l2.9 6.02 6.6.85-4.85 4.6 1.27 6.53L12 17.9l-5.92 2.6 1.27-6.53-4.85-4.6 6.6-.85z" />
                                                                </svg>
                                                                추천
                                                            </span>
                                                        )}
                                                        {SHAPE_PREVIEW_IMAGES[option.value] && (
                                                            <img
                                                                src={SHAPE_PREVIEW_IMAGES[option.value]}
                                                                alt=""
                                                                className="design-chat__quickreply-shape-img"
                                                            />
                                                        )}
                                                        <span>{option.label}</span>
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    ) : activeQuickReply.id === 'menu' ? (
                                        <div className="design-chat__menu-grid">
                                            {MENU_ITEMS.map((item) => (
                                                <button
                                                    key={item.value}
                                                    type="button"
                                                    className="design-chat__menu-item"
                                                    onClick={() => handleMenuSelect({ value: item.value, label: item.label })}
                                                    disabled={isSending}
                                                >
                                                  <span className="design-chat__menu-icon" aria-hidden="true">
                                                    {item.icon}
                                                  </span>
                                                    <span className="design-chat__menu-title">{item.title}</span>
                                                    <span className="design-chat__menu-desc">{item.desc}</span>
                                                </button>
                                            ))}
                                        </div>
                                    ) : (
                                        <div
                                            className={`design-chat__quickreply-list${
                                                activeQuickReply.layout === 'grid3' ? ' design-chat__quickreply-list--grid3' : ''
                                            }`}
                                        >
                                            {activeQuickReply.options.map((option, idx) => {
                                                const selected = selectedInQuickReply.includes(option.value)
                                                const shapeImage =
                                                    activeQuickReply.id === 'pref-shape' ? SHAPE_PREVIEW_IMAGES[option.value] : undefined
                                                // 선택된 분석 결과의 AI 추천 쉐입과 같은 카드에 "추천" 배지를 띄운다
                                                const isRecommendedShape =
                                                    activeQuickReply.id === 'pref-shape' &&
                                                    analysisSummary?.shapeId != null &&
                                                    option.value === analysisSummary.shapeId

                                                // motif 단계에서 "없음"과 다른 모티프는 서로 배타적이므로,
                                                // 반대쪽이 이미 선택되어 있으면 클릭 자체를 막아 헷갈리지 않게 한다.
                                                const isMotifMutuallyExclusiveBlocked =
                                                    activeQuickReply.id === 'pref-motif' &&
                                                    !selected &&
                                                    ((option.value === MOTIF_NONE_VALUE && selectedInQuickReply.length > 0) ||
                                                        (option.value !== MOTIF_NONE_VALUE && selectedInQuickReply.includes(MOTIF_NONE_VALUE)))

                                                // 라벨 전체가 hex인지가 아니라, 라벨 안에 hex가 포함되어 있는지로 검사
                                                const hexInLabelMatch = option.label.match(/#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/)
                                                const isExactHex = /^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/.test(option.label.trim())


                                                // mood/designType/motif처럼 처음 보면 감이 잘 안 오는 선택지는
                                                // 호버(웹) 또는 "i" 배지 탭(모바일) 시 색감/질감 예시 + 짧은 설명을 보여준다.
                                                const step = activeQuickReply.id.startsWith('pref-')
                                                    ? (activeQuickReply.id.slice(5) as PreferenceKey)
                                                    : null
                                                const optionInfo = step ? PREFERENCE_OPTION_INFO[step]?.[option.value] : undefined
                                                // 계절/컬러를 제외한 선택지 단계에서, value가 순수 영단어일 때만 툴팁 제목에 괄호로 영문을 병기한다.
                                                const englishSubLabel =
                                                    step && ENGLISH_SUBLABEL_STEPS.includes(step) && /^[A-Za-z\s]+$/.test(option.value)
                                                        ? toEnglishTitleCase(option.value)
                                                        : null
                                                const tooltipTitle = englishSubLabel ? `${option.label} (${englishSubLabel})` : option.label
                                                const tooltipKey = `${activeQuickReply.id}:${option.value}`
                                                const isTooltipOpen = tooltipAnchor?.key === tooltipKey
                                                const isTooltipPinned = pinnedTooltipKey === tooltipKey

                                                const itemBody = (
                                                    <>
                                                        {(activeQuickReply.id === 'pref-season' || activeQuickReply.id === 'menu') && (
                                                            <span className="design-chat__quickreply-index">{idx + 1}</span>
                                                        )}
                                                        {shapeImage && (
                                                            <img
                                                                src={shapeImage}
                                                                alt=""
                                                                className="design-chat__quickreply-shape-img"
                                                            />
                                                        )}
                                                        {option.colorHexes && option.colorHexes.length > 0 ? (
                                                            // Gemini가 이 텍스트 선택지에 대해 알려준 대표 색상들을
                                                            // hex 텍스트 노출 없이 작은 동그라미로만 보여준다.
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                                                {option.label}
                                                                <span style={{ display: 'inline-flex', gap: '2px' }}>
                                                                    {option.colorHexes.map((hex, hexIdx) => (
                                                                        <span
                                                                            key={`${hex}-${hexIdx}`}
                                                                            className="design-chat__quickreply-color-swatch design-chat__quickreply-color-swatch--inline"
                                                                            style={{ background: hex }}
                                                                            aria-label={hex}
                                                                        />
                                                                    ))}
                                                                </span>
                                                            </span>
                                                        ) : isExactHex ? (
                                                            // 기존 케이스: 라벨이 hex값 하나뿐일 때 (컬러피커 등)
                                                            <span
                                                                className="design-chat__quickreply-color-swatch"
                                                                style={{ background: option.label.trim() }}
                                                                aria-label={option.label.trim()}
                                                            />
                                                        ) : hexInLabelMatch ? (
                                                            // 텍스트 + hex가 섞인 경우 (예: "시원한 블루 계열 (#00A3FF)")
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                                                {option.label}
                                                                <span
                                                                    className="design-chat__quickreply-color-swatch design-chat__quickreply-color-swatch--inline"
                                                                    style={{ background: hexInLabelMatch[0] }}
                                                                    aria-label={hexInLabelMatch[0]}
                                                                />
                                                            </span>
                                                        ) : (
                                                            <span className="design-chat__quickreply-item-label">{option.label}</span>
                                                        )}
                                                    </>
                                                )

                                                if (optionInfo) {
                                                    return (
                                                        <div key={option.value} className="design-chat__quickreply-item-wrap">
                                                            <button
                                                                type="button"
                                                                className={`design-chat__quickreply-item${selected ? ' is-selected' : ''}`}
                                                                onClick={() => {
                                                                    setTooltipAnchor(null)
                                                                    setPinnedTooltipKey(null)
                                                                    handleQuickReplyClick(option)
                                                                }}
                                                                onMouseEnter={(e) => showOptionTooltip(e, tooltipKey, tooltipTitle, optionInfo)}
                                                                onMouseLeave={() => hideOptionTooltip(tooltipKey)}
                                                                onFocus={(e) => showOptionTooltip(e, tooltipKey, tooltipTitle, optionInfo)}
                                                                onBlur={() => hideOptionTooltip(tooltipKey)}
                                                                disabled={isSending || isMotifMutuallyExclusiveBlocked}
                                                            >
                                                                {itemBody}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className={`design-chat__option-info-badge${isTooltipPinned ? ' is-pinned' : ''}`}
                                                                onMouseEnter={(e) => showOptionTooltip(e, tooltipKey, tooltipTitle, optionInfo)}
                                                                onMouseLeave={() => hideOptionTooltip(tooltipKey)}
                                                                onFocus={(e) => showOptionTooltip(e, tooltipKey, tooltipTitle, optionInfo)}
                                                                onBlur={() => hideOptionTooltip(tooltipKey)}
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    toggleOptionTooltip(e, tooltipKey, tooltipTitle, optionInfo)
                                                                }}
                                                                aria-label={`${option.label} 설명 ${isTooltipPinned ? '닫기' : '고정해서 보기'}`}
                                                                aria-expanded={isTooltipOpen}
                                                                aria-pressed={isTooltipPinned}
                                                            >
                                                                i
                                                            </button>
                                                        </div>
                                                    )
                                                }

                                                return (
                                                    <button
                                                        key={option.value}
                                                        type="button"
                                                        className={`design-chat__quickreply-item${selected ? ' is-selected' : ''}`}
                                                        onClick={() => handleQuickReplyClick(option)}
                                                        disabled={isSending || isMotifMutuallyExclusiveBlocked}
                                                    >
                                                        {isRecommendedShape && (
                                                            <span className="design-chat__quickreply-recommend-badge">
                                                                <svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" aria-hidden="true">
                                                                    <path d="M12 2.5l2.9 6.02 6.6.85-4.85 4.6 1.27 6.53L12 17.9l-5.92 2.6 1.27-6.53-4.85-4.6 6.6-.85z" />
                                                                </svg>
                                                                추천
                                                            </span>
                                                        )}
                                                        {itemBody}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    )}

                                    {isMultiConfirmVisible && (
                                        <button
                                            type="button"
                                            className="design-chat__quickreply-confirm"
                                            onClick={() => confirmPreferenceStep(selectedInQuickReply)}
                                            disabled={isSending}
                                            aria-label={
                                                activeQuickReply.id === 'pref-color'
                                                    ? `선택한 컬러 ${selectedInQuickReply.length}개로 선택`
                                                    : undefined
                                            }
                                        >
                                            {activeQuickReply.id === 'pref-color' ? (
                                                <span className="design-chat__quickreply-confirm-swatches" aria-hidden="true">
                                                    {selectedInQuickReply.map((hex) => (
                                                        <span
                                                            key={hex}
                                                            className="design-chat__quickreply-confirm-swatch"
                                                            style={{ background: hex }}
                                                        />
                                                    ))}
                                                </span>
                                            ) : (
                                                `${selectedInQuickReply
                                                    .map(
                                                        (value) =>
                                                            activeQuickReply.options.find((o) => o.value === value)?.label ?? value,
                                                    )
                                                    .map((label) => `'${label}'`)
                                                    .join(', ')} `
                                            )}
                                            선택
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                                <path
                                                    d="M5 12h12M13 6l6 6-6 6"
                                                    stroke="currentColor"
                                                    strokeWidth="2"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                />
                                            </svg>
                                        </button>
                                    )}

                                    {activeQuickReply.id === 'photo-upload' && selectedPhotoFile && (
                                        <button
                                            type="button"
                                            className="design-chat__quickreply-confirm"
                                            onClick={handlePhotoConfirm}
                                            disabled={isSending}
                                        >
                                            🎨 이 사진으로 생성하기
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    <div className="design-chat__inputbar">
            <textarea
                ref={textareaRef}
                className="design-chat__input"
                placeholder={isAwaitingGenerateConfirm ? '위 버튼 중 하나를 선택해 주세요' : '또는 원하는 디자인 직접 입력'}
                value={inputValue}
                onChange={(e) => {
                    setInputValue(e.target.value)
                    adjustTextareaHeight()
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSubmitInput()
                    }
                }}
                disabled={isSending || isAwaitingGenerateConfirm}
            />
                        <div className="design-chat__inputbar-row">
                            <button
                                type="button"
                                className="design-chat__icon-btn"
                                aria-label="분석 결과 다시 보기"
                                onClick={handleToggleAnalysisPanel}
                            >
                                <QuestionMarkIcon size={20} />
                            </button>

                            <div className="design-chat__inputbar-actions">
                                <button
                                    type="button"
                                    className="design-chat__icon-btn"
                                    aria-label="사진 첨부"
                                    onClick={() => handleMenuSelect(MENU_OPTIONS[2])}
                                >
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                                    </svg>
                                </button>
                                <button
                                    type="button"
                                    className="design-chat__icon-btn design-chat__icon-btn--send"
                                    aria-label="전송"
                                    onClick={handleSubmitInput}
                                    disabled={isSending || isAwaitingGenerateConfirm || !inputValue.trim()}
                                >
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                        <path
                                            d="M4 12l16-7-6.5 16-2.5-6.5L4 12z"
                                            stroke="currentColor"
                                            strokeWidth="1.6"
                                            strokeLinejoin="round"
                                        />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {preview3DImage && lastDesign && (
                <div className="design-3d-modal" role="dialog" aria-modal="true">
                    <button
                        type="button"
                        className="design-3d-modal__backdrop"
                        aria-label="닫기"
                        onClick={() => setPreview3DImage(null)}
                    />
                    <div className="design-3d-modal__panel">
                        <header className="design-3d-modal__header">
                            <h2>3D 미리보기</h2>
                            <button type="button" onClick={() => setPreview3DImage(null)} aria-label="닫기">
                                ×
                            </button>
                        </header>
                        <p className="design-3d-modal__desc">
                            {getNailShape(lastDesign.shapeId)?.labelKo ?? lastDesign.shapeId} 쉐입에 디자인을 입힌 모습이에요.
                        </p>
                        <NailPreview3D textureUrl={preview3DImage} shapeId={lastDesign.shapeId} />
                    </div>
                </div>
            )}

    {zoomedImage && (
        <div className="mypage-x__modal" role="dialog" aria-modal="true">
            <button
                type="button"
                className="mypage-x__modal-backdrop"
                aria-label="닫기"
                onClick={closeZoomedImage}
            />
            <div className="mypage-x__modal-panel design-chat__image-zoom-panel">
                <button
                    type="button"
                    className="mypage-x__modal-close"
                    onClick={closeZoomedImage}
                    aria-label="닫기"
                >
                    ✕
                </button>

                <div
                    ref={zoomedImageViewportRef}
                    className={`mypage-x__modal-image-viewport design-chat__image-zoom-viewport${imageZoom > 1 ? ' is-zoomed' : ''}${isImageDragging ? ' is-dragging' : ''}`}
                    onMouseUp={stopZoomedImageDragging}
                    onMouseLeave={stopZoomedImageDragging}
                >
                    <img
                        src={zoomedImage}
                        alt="확대된 이미지"
                        className="mypage-x__modal-image"
                        draggable={false}
                        style={{ transform: `translate(${imagePan.x}px, ${imagePan.y}px) scale(${imageZoom})` }}
                        onMouseDown={handleZoomedImagePointerDown}
                        onMouseMove={handleZoomedImagePointerMove}
                    />

                    <div className="mypage-x__modal-zoom-controls">
                        <span className="mypage-x__modal-zoom-value">{Math.round(imageZoom * 100)}%</span>
                    </div>
                </div>
            </div>
        </div>
    )}

    {tooltipAnchor &&
        createPortal(
            <div
                className="design-chat__option-tooltip"
                style={{ top: tooltipAnchor.top - 8, left: tooltipAnchor.left }}
                role="tooltip"
            >
                {tooltipAnchor.info.image && !tooltipImgError ? (
                    <img
                        src={tooltipAnchor.info.image}
                        alt=""
                        className="design-chat__option-tooltip-img"
                        onError={() => setTooltipImgError(true)}
                    />
                ) : (
                    <div className="design-chat__option-tooltip-img design-chat__option-tooltip-img--placeholder" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" width="28" height="28">
                            <rect x="3" y="4" width="18" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
                            <path d="m6.5 15 3.5-4 3 3 3.5-4.5 4 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                            <circle cx="8.5" cy="9" r="1.3" fill="currentColor" />
                        </svg>
                    </div>
                )}
                <strong className="design-chat__option-tooltip-title">{tooltipAnchor.label}</strong>
                <span className="design-chat__option-tooltip-desc">{tooltipAnchor.info.desc}</span>
            </div>,
            document.body,
        )}
        </AppShell>
    )
}
