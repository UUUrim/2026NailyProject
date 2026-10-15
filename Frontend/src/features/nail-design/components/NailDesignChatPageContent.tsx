import { Fragment, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { AppShell } from '@/shared/layout/AppShell'
import { WarningIcon } from '@/shared/components/icons/WarningIcon'
import { DesignImageDetailModal } from '@/features/mypage/components/DesignImageDetailModal'
import { parseDateFlexible, type ScanSession } from '@/shared/utils/scanDetail'
import {
    PREFERENCE_OPTIONS,
    PREFERENCE_OPTION_INFO,
    SHAPE_PREVIEW_IMAGES,
    type PreferenceKey,
} from '@/shared/constants/designPreferences'
import {
    useNailDesignChatPage,
    ANALYSIS_BUTTON_TOKEN,
    PREFERENCE_NOTE_MAX_LENGTH,
    PREFERENCE_STEPS,
} from '@/features/nail-design/hooks/useNailDesignChatPage'
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
        icon: <HandIcon size={26} strokeWidth={1.5} />,
    },
]
// 손 모양 아이콘 — '내 스캔 정보로 자동' 카드와 입력창의 '손 분석 결과' 버튼이 같이 쓴다
// (손 그림이 24칸 안에서 왼쪽 위로 치우쳐 있어서(가로 중심 11, 세로 11.5) viewBox를 옮겨 한가운데에 놓는다)
function HandIcon({ size = 16, strokeWidth = 1.8 }: { size?: number; strokeWidth?: number }) {
    return (
        <svg width={size} height={size} viewBox="-1 -0.5 24 24" fill="none" aria-hidden="true">
            <path
                d="M8 12.5V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11.5V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6.5 7C6.7 20 5 17 5 14.2v-2a1.4 1.4 0 0 1 2.8 0"
                stroke="currentColor"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}
// 말풍선 글 — 줄마다 <p>로 나누고, 손 분석 버튼 자리표시자는 손 아이콘으로 그린다
function renderBubbleText(text: string) {
    return text.split('\n').map((line, i) => (
        <p key={i}>
            {line.split(ANALYSIS_BUTTON_TOKEN).map((part, j, arr) => (
                <span key={j}>
                    {part}
                    {j < arr.length - 1 && (
                        <span className="design-chat__analysis-icon-inline">
                            <HandIcon size={17} />
                        </span>
                    )}
                </span>
            ))}
        </p>
    ))
}

// 디자인 카드 — 생성 중엔 반짝이·진행 막대를 보여 주다가, 완성 이미지가 들어오면 같은 자리에서 이미지로 바뀐다
function DesignResultCard({
    imageUrl,
    isGenerating,
    onOpen,
    onLoad,
}: {
    imageUrl: string | null
    isGenerating: boolean
    onOpen: (url: string) => void
    onLoad: () => void
}) {
    const [isLoaded, setIsLoaded] = useState(false)
    // 처음부터 완성된 채로 그려진 카드(대화 복원 등)는 생성 중 표시 없이 이미지만 보여 준다
    const [startedGenerating] = useState(isGenerating)
    const showLoading = isGenerating || (startedGenerating && !isLoaded)

    return (
        <div className={`design-chat__design-card${isLoaded ? ' is-loaded' : ''}`}>
            {imageUrl && (
                <img
                    src={imageUrl}
                    alt="생성된 네일 디자인"
                    onLoad={() => {
                        setIsLoaded(true)
                        onLoad()
                    }}
                    onError={() => setIsLoaded(true)}
                    onClick={() => onOpen(imageUrl)}
                />
            )}
            <div
                className={`design-chat__design-card-loading${showLoading ? '' : ' is-hidden'}`}
                role={showLoading ? 'status' : undefined}
                aria-hidden={!showLoading}
            >
                <span className="design-chat__design-card-sparkles" aria-hidden="true">
                    {[0, 1, 2].map((i) => (
                        <svg key={i} viewBox="0 0 24 24">
                            <path d="M12 2C12.6 7.4 16.6 11.4 22 12C16.6 12.6 12.6 16.6 12 22C11.4 16.6 7.4 12.6 2 12C7.4 11.4 11.4 7.4 12 2Z" />
                        </svg>
                    ))}
                </span>
                <span className="design-chat__design-card-label">디자인 생성 중</span>
                <span className="design-chat__design-card-bar" aria-hidden="true" />
            </div>
        </div>
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

// 분위기/디자인 타입/모티프 단계의 "기타" 입력란 안내 문구
const PREFERENCE_NOTE_PLACEHOLDERS: Partial<Record<PreferenceKey, string>> = {
    mood: '찾으시는 분위기가 없다면 직접 입력해 주세요(예: 몽환적인). 덧붙이고 싶으신 의견을 입력해도 좋아요.',
    designType: '찾으시는 디자인 타입이 없다면 직접 입력해 주세요(예: 체크 패턴). 덧붙이고 싶으신 의견을 입력해도 좋아요.',
    motif: '찾으시는 모티프가 없다면 직접 입력해 주세요(예: 나비). 덧붙이고 싶으신 의견을 입력해도 좋아요.',
}
// 컬러 단계의 "기타" 입력란 안내 문구 (색 이름을 적거나, 어울리는 색을 추천해 달라고 해도 된다)
const COLOR_NOTE_PLACEHOLDER = '컬러를 고르기 어려우시다면 원하시는 요청 사항을 입력해 주세요.'
export function NailDesignChatPageContent() {
    const {
        navigate,
        canSelectSession,
        userName,
        isInitReady,
        bubbles,
        activeQuickReply,
        isAwaitingGenerateConfirm,
        isPreferenceInputLocked,
        selectedInQuickReply,
        freeformSelectedColors,
        activeNoteStep,
        activeNote,
        hasActiveNote,
        setPreferenceNote,
        colorNote,
        setColorNote,
        submitColorNote,
        preferenceStepIndex,
        selectedPhotoPreviewUrl,
        photoInputRef,
        inputValue,
        setInputValue,
        isSending,
        isGeneratingDesign,
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
        zoomedImage,
        leftAnalysis,
        rightAnalysis,
        scanSessions,
        selectedSessionKey,
        messagesRef,
        chatContainerRef,
        textareaRef,
        inputbarRef,
        scrollMessagesToBottom,
        hasScanColorPalette,
        colorPickerPalette,
        sidebarColorPalette,
        isMultiConfirmVisible,
        analysisSummary,
        MOTIF_NONE_VALUE,
        handleMenuSelect,
        toggleQuickReplyValue,
        confirmPreferenceStep,
        goToPreviousPreferenceStep,
        handlePhotoFileChange,
        removeSelectedPhoto,
        hasPhotoAttachment,
        isPhotoInputLocked,
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
        adjustTextareaHeight,
    } = useNailDesignChatPage()

    // "사진 변경하기"를 눌러 파일 고르기 창이 떠 있는 동안 브라우저는 마우스 위치를 모른다. 창을 닫고 돌아오면
    // 마지막으로 누른 자리(= 이 버튼 위)에 마우스가 있다고 보고 호버 모양을 띄워 두므로, 눌렀을 때부터
    // 마우스가 실제로 버튼 위에서 움직이기 전까지는 호버 모양을 끈다.
    const [isPhotoChangeHoverSuppressed, setIsPhotoChangeHoverSuppressed] = useState(false)
    // 지금 반영 중인 손 분석 기록의 촬영 날짜 (예: 10월 12일)
    const scanDateLabel = formatMonthDay(leftAnalysis?.scannedAt ?? rightAnalysis?.scannedAt ?? '')
    // 선택지 기반 생성에서 지금 선택 창이 몇 번째 단계인지 (1부터, 선택지 단계가 아니면 0)
    const preferenceStepNumber = activeQuickReply?.id.startsWith('pref-')
        ? PREFERENCE_STEPS.indexOf(activeQuickReply.id.slice(5) as PreferenceKey) + 1
        : 0
    // 입력 칸 안내 문구 — 칸이 좁으면 말줄임표로 줄이도록 textarea 위에 따로 그린다
    const inputPlaceholder = isPreferenceInputLocked
        ? '위 선택지에서 골라 주세요.'
        : isAwaitingGenerateConfirm
            ? '위 버튼을 눌러 주세요.'
            : isPhotoInputLocked
                ? '사진을 첨부해 주세요.'
                : hasPhotoAttachment
                    ? '추가적인 요청 사항이 있다면 함께 입력해 주세요.'
                    : '또는 원하시는 디자인을 바로 입력해 주세요.'

    return (
        <AppShell mainClassName="design-chat-page">
            <div className="design-chat-layout">
                {showAnalysisPanel && (
                    <aside className="design-chat-sidebar">
                        <div className="design-chat-sidebar__header">
                            <div className="design-chat-sidebar__header-main">
                                <p className="design-chat-sidebar__eyebrow">Hand Analysis</p>
                                <div className="design-chat-sidebar__title-row">
                                    <h2>{userName ? `${userName}님의 손 분석` : '손 분석 결과'}</h2>
                                    {analysisSummary &&
                                        (canSelectSession ? (
                                            scanSessions.length > 0 && (
                                                <SessionDropdown
                                                    sessions={scanSessions}
                                                    selectedKey={selectedSessionKey}
                                                    currentDateLabel={scanDateLabel}
                                                    onSelect={(session) => void handleSelectSession(session)}
                                                />
                                            )
                                        ) : (
                                            <span className="design-chat-sidebar__session-static">
                                                {scanDateLabel}
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
                                        {userName ? `${userName}님의` : '회원님의'} 손 정보를 바탕으로 맞춤 디자인을 생성하려면,
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

                                    {sidebarColorPalette.length > 0 && (
                                        <div className="design-chat-sidebar__card">
                                            <span className="design-chat-sidebar__card-label">추천 컬러</span>
                                            <div className="design-chat-sidebar__palette">
                                                {sidebarColorPalette.map((hex, idx) => (
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
                                                    <span className="design-chat-sidebar__metric-value">{analysisSummary.avgCurve}mm</span>
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
                        {bubbles.map((bubble) =>
                            bubble.isGenerating || bubble.isDesignResult ? (
                                // 디자인 카드 — 생성 중 카드가 완성되면 같은 자리에 이미지가 뜨고, 글은 그 아래 별도 말풍선으로
                                <Fragment key={bubble.id}>
                                    <div className="design-chat__row design-chat__row--assistant">
                                        <img src="/images/logo.png" alt="" className="design-chat__avatar" />
                                        <div className="design-chat__design-cards">
                                            {(bubble.imageUrls && bubble.imageUrls.length > 0 ? bubble.imageUrls : [null]).map(
                                                (url, i) => (
                                                    <DesignResultCard
                                                        key={i}
                                                        imageUrl={url}
                                                        isGenerating={Boolean(bubble.isGenerating)}
                                                        onOpen={(imageUrl) => openZoomedImage(imageUrl, true)}
                                                        onLoad={scrollMessagesToBottom}
                                                    />
                                                ),
                                            )}
                                        </div>
                                    </div>
                                    {bubble.text && (
                                        <div className="design-chat__row design-chat__row--assistant">
                                            <img src="/images/logo.png" alt="" className="design-chat__avatar" />
                                            <div className="design-chat__bubble design-chat__bubble--assistant">
                                                {renderBubbleText(bubble.text)}
                                            </div>
                                        </div>
                                    )}
                                </Fragment>
                            ) : (
                            <div key={bubble.id} className={`design-chat__row design-chat__row--${bubble.role}`}>
                                {bubble.role === 'assistant' && (
                                    <img src="/images/logo.png" alt="" className="design-chat__avatar" />
                                )}
                                <div
                                    className={`design-chat__bubble design-chat__bubble--${bubble.role}${
                                        !bubble.text && bubble.imageUrls?.length ? ' design-chat__bubble--image-only' : ''
                                    }`}
                                >
                                    {bubble.text && renderBubbleText(bubble.text)}
                                    {/* 사용자가 올린 참고 사진 */}
                                    {bubble.imageUrls && bubble.imageUrls.length > 0 && (
                                        <div className="design-chat__bubble-images design-chat__bubble-images--user-photo">
                                            {bubble.imageUrls.map((url, i) => (
                                                <div key={i} className="design-chat__bubble-image-wrap">
                                                    <img
                                                        src={url}
                                                        alt="업로드한 참고 사진"
                                                        onClick={() => openZoomedImage(url, false)}
                                                        onLoad={scrollMessagesToBottom}
                                                        style={{ cursor: 'zoom-in' }}
                                                    />
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
                            ),
                        )}
                        {/* 채팅 답변을 기다리는 중 — 디자인을 만드는 중엔 대화 안의 생성 중 카드가 대신 보인다 */}
                        {isSending && !isGeneratingDesign && (
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

                    {/* 사진을 첨부하면 사진 선택 창은 숨긴다 — 사진은 입력창에서 보고 "사진 변경하기"로 바꾼다 */}
                    {activeQuickReply && !hasPhotoAttachment && (
                        <div className={`design-chat__quickreply${isQuickReplyCollapsed ? ' is-collapsed' : ''}`}>
                            <div
                                className={`design-chat__quickreply-header${
                                    preferenceStepNumber > 0 ? ' design-chat__quickreply-header--with-steps' : ''
                                }`}
                            >
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

                                {preferenceStepNumber > 0 && (
                                    <span
                                        className="design-chat__step-bar"
                                        role="img"
                                        aria-label={`${PREFERENCE_STEPS.length}단계 중 ${preferenceStepNumber}단계`}
                                    >
                                        <span className="design-chat__step-bar-track" aria-hidden="true">
                                            {PREFERENCE_STEPS.map((step, i) => (
                                                <span
                                                    key={step}
                                                    className={`design-chat__step-bar-seg${
                                                        i < preferenceStepNumber - 1 ? ' is-done' : i === preferenceStepNumber - 1 ? ' is-current' : ''
                                                    }`}
                                                />
                                            ))}
                                        </span>
                                    </span>
                                )}

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
                                                <p className="design-chat__color-picker-label">이달의 컬러</p>
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
                                            <button
                                                type="button"
                                                className="design-chat__photo-upload-dropzone"
                                                onClick={() => photoInputRef.current?.click()}
                                                disabled={isSending}
                                            >
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                                    <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
                                                    <circle cx="8.5" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.6" />
                                                    <path d="M3 16l5-4 4 3 4-5 5 6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                                                </svg>
                                                사진 선택하기
                                            </button>
                                        </div>
                                    ) : activeQuickReply.id.startsWith('freeform-actions') && freeformColorPickerOpen ? (
                                        <div className="design-chat__color-picker">
                                            {hasScanColorPalette ? (
                                                <p className="design-chat__color-picker-label">{userName ? `${userName}님과 어울리는 컬러` : '회원님과 어울리는 컬러'}</p>
                                            ) : (
                                                <p className="design-chat__color-picker-label">이달의 컬러</p>
                                            )}

                                            <div className="design-chat__color-main">
                                                <div className="design-chat__color-grid">
                                                    {colorPickerPalette.map((hex, idx) => {
                                                        const selected = freeformSelectedColors.includes(hex)
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

                                            {freeformSelectedColors.length > 0 && (
                                                <div className="design-chat__color-selected">
                                                    {freeformSelectedColors.map((hex) => (
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
                                                disabled={isSending || freeformSelectedColors.length === 0}
                                                aria-label={`선택한 컬러 ${freeformSelectedColors.length}개로 선택`}
                                            >
                                                <span className="design-chat__quickreply-confirm-swatches" aria-hidden="true">
                                                    {freeformSelectedColors.map((hex) => (
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

                                                // motif 단계에서 "없음"과 다른 모티프(기타 입력 포함)는 서로 배타적이므로,
                                                // 반대쪽이 이미 선택되어 있으면 클릭 자체를 막아 헷갈리지 않게 한다.
                                                const isMotifMutuallyExclusiveBlocked =
                                                    activeQuickReply.id === 'pref-motif' &&
                                                    !selected &&
                                                    ((option.value === MOTIF_NONE_VALUE &&
                                                            (selectedInQuickReply.length > 0 || hasActiveNote)) ||
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

                                    {activeNoteStep && (
                                        <label className="design-chat__quickreply-note">
                                            <span className="design-chat__quickreply-note-label">기타 입력</span>
                                            <input
                                                type="text"
                                                className="design-chat__quickreply-note-input"
                                                value={activeNote}
                                                maxLength={PREFERENCE_NOTE_MAX_LENGTH}
                                                placeholder={
                                                    activeNoteStep === 'motif' && selectedInQuickReply.includes(MOTIF_NONE_VALUE)
                                                        ? "'없음'을 선택하시면 기타 모티프는 입력하실 수 없어요."
                                                        : PREFERENCE_NOTE_PLACEHOLDERS[activeNoteStep]
                                                }
                                                onChange={(e) => setPreferenceNote(activeNoteStep, e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
                                                    e.preventDefault()
                                                    if (isMultiConfirmVisible && !isSending) confirmPreferenceStep(selectedInQuickReply)
                                                }}
                                                disabled={
                                                    isSending ||
                                                    (activeNoteStep === 'motif' && selectedInQuickReply.includes(MOTIF_NONE_VALUE))
                                                }
                                            />
                                        </label>
                                    )}

                                    {activeQuickReply.id === 'pref-color' && (
                                        <>
                                            <label className="design-chat__quickreply-note">
                                                <span className="design-chat__quickreply-note-label">기타 입력</span>
                                                <input
                                                    type="text"
                                                    className="design-chat__quickreply-note-input"
                                                    value={colorNote}
                                                    maxLength={100}
                                                    placeholder={COLOR_NOTE_PLACEHOLDER}
                                                    onChange={(e) => setColorNote(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
                                                        e.preventDefault()
                                                        submitColorNote()
                                                    }}
                                                    disabled={isSending}
                                                />
                                            </label>
                                        </>
                                    )}

                                    {(isMultiConfirmVisible ||
                                        (activeQuickReply.id === 'pref-color' && colorNote.trim().length > 0)) && (
                                        <button
                                            type="button"
                                            className="design-chat__quickreply-confirm"
                                            onClick={() => {
                                                // 컬러 단계에서 기타 입력을 적어 둔 채 누르면, 고른 색과 기타 입력을 함께 보낸다
                                                if (activeQuickReply.id === 'pref-color' && colorNote.trim()) submitColorNote()
                                                else confirmPreferenceStep(selectedInQuickReply)
                                            }}
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
                                                `${[
                                                    ...selectedInQuickReply
                                                        .map(
                                                            (value) =>
                                                                activeQuickReply.options.find((o) => o.value === value)?.label ?? value,
                                                        )
                                                        .map((label) => `'${label}'`),
                                                    ...(hasActiveNote ? ['기타 의견'] : []),
                                                ].join(', ')} `
                                            )}
                                            {activeQuickReply.id === 'pref-color' && colorNote.trim()
                                                ? selectedInQuickReply.length > 0
                                                    ? '함께 보내기'
                                                    : '이 내용으로 색상 추천받기'
                                                : '선택'}
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

                                </>
                            )}
                        </div>
                    )}

                    {/* 사진 기반 흐름의 파일 고르기 — 선택 창의 "사진 선택하기"와 입력창의 "사진 변경하기"가 함께 쓴다 */}
                    <input
                        ref={photoInputRef}
                        type="file"
                        accept="image/*"
                        className="design-chat__photo-upload-input"
                        onChange={(e) => handlePhotoFileChange(e.target.files?.[0] ?? null)}
                    />

                    <div
                        ref={inputbarRef}
                        className={`design-chat__inputbar${hasPhotoAttachment ? ' design-chat__inputbar--with-attachment' : ''}`}
                    >
                        {/* 사진 기반 흐름에서 고른 참고 사진 — 보내기 전까지 입력 칸 위에 첨부된 채로 보인다.
                            ×로 빼거나, 옆의 "사진 변경하기"로 다른 사진으로 바꾼다 */}
                        {hasPhotoAttachment && selectedPhotoPreviewUrl && (
                            <div className="design-chat__input-attachment-row">
                                <div className="design-chat__input-attachment">
                                    <img
                                        src={selectedPhotoPreviewUrl}
                                        alt="첨부한 참고 사진"
                                        onClick={() => openZoomedImage(selectedPhotoPreviewUrl, false)}
                                    />
                                    <button
                                        type="button"
                                        className="design-chat__input-attachment-remove"
                                        aria-label="첨부한 사진 빼기"
                                        onClick={removeSelectedPhoto}
                                        disabled={isSending}
                                    >
                                        <svg viewBox="0 0 24 24" aria-hidden="true">
                                            <path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                                        </svg>
                                    </button>
                                </div>
                                <button
                                    type="button"
                                    className={`design-chat__input-attachment-change${
                                        isPhotoChangeHoverSuppressed ? ' is-hover-suppressed' : ''
                                    }`}
                                    onClick={() => {
                                        setIsPhotoChangeHoverSuppressed(true)
                                        photoInputRef.current?.click()
                                    }}
                                    onPointerMove={() => setIsPhotoChangeHoverSuppressed(false)}
                                    onPointerLeave={() => setIsPhotoChangeHoverSuppressed(false)}
                                    disabled={isSending}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                        <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
                                        <circle cx="8.5" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.6" />
                                        <path d="M3 16l5-4 4 3 4-5 5 6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                                    </svg>
                                    사진 변경하기
                                </button>
                            </div>
                        )}
                        <button
                            type="button"
                            className={`design-chat__analysis-btn${showAnalysisPanel ? ' is-active' : ''}`}
                            aria-label="손 분석 결과 기록 보기"
                            aria-expanded={showAnalysisPanel}
                            title={showAnalysisPanel ? '손 분석 결과 닫기' : '손 분석 결과 기록 보기'}
                            onClick={handleToggleAnalysisPanel}
                        >
                            <HandIcon size={22} strokeWidth={1.7} />
                        </button>

                        <textarea
                            ref={textareaRef}
                            className="design-chat__input"
                            rows={1}
                            // 화면엔 아래 .design-chat__input-placeholder가 보이고, 이 값은 스크린 리더용으로 남겨 둔다
                            placeholder={inputPlaceholder}
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
                            disabled={isSending || isAwaitingGenerateConfirm || isPreferenceInputLocked || isPhotoInputLocked}
                        />
                        {!inputValue && (
                            <span className="design-chat__input-placeholder" aria-hidden="true">
                                {inputPlaceholder}
                            </span>
                        )}

                        {/* 메인 디자인 섹션 채팅 데모(.chat-demo__send)와 같은 분홍 배경 + 위쪽 화살표, 모양은 둥근 사각형 */}
                        <button
                            type="button"
                            className="design-chat__send"
                            aria-label="전송"
                            onClick={handleSubmitInput}
                            disabled={
                                isSending ||
                                isAwaitingGenerateConfirm ||
                                isPreferenceInputLocked ||
                                isPhotoInputLocked ||
                                (!inputValue.trim() && !hasPhotoAttachment)
                            }
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path
                                    d="M12 19V5M6 11l6-6 6 6"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            {zoomedImage && (
                <DesignImageDetailModal
                    image={{ designId: null, imageUrl: zoomedImage.url, liked: false, folder: null }}
                    onClose={closeZoomedImage}
                    showDelete={false}
                    showChatHistoryToggle={false}
                    showDesignDetailsToggle={false}
                    showLike={false}
                    showShare={false}
                    showAr={false}
                    showDownload={zoomedImage.isDesignResult}
                />
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