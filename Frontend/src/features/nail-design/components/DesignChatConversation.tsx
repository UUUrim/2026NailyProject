import { Fragment, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { DesignImageDetailModal } from '@/features/mypage/components/DesignImageDetailModal'
import {
    PREFERENCE_OPTIONS,
    PREFERENCE_OPTION_INFO,
    SHAPE_PREVIEW_IMAGES,
    type PreferenceKey,
} from '@/shared/constants/designPreferences'
import {
    useNailDesignChatPage,
    PREFERENCE_STEPS,
    getPreferenceNoteMaxLength,
    type QuickReplyIcon,
} from '@/features/nail-design/hooks/useNailDesignChatPage'
import { BubbleText, ChatMessageRow, HandIcon } from '@/features/nail-design/components/ChatBubbleParts'
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
// 선택지 라벨 앞에 붙는 아이콘 — 생성 방식 카드·손 아이콘과 같은 24칸 선 아이콘(선 굵기 1.6, 둥근 끝)
function ChatOptionIcon({ name, size = 18 }: { name: QuickReplyIcon; size?: number }) {
    const stroke = {
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
    }
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            {name === 'palette' && (
                // 팔레트 — 컬러피커에서 직접 고르기
                <>
                    <path
                        d="M12 3.5a8.5 8.5 0 0 0 0 17c1.1 0 1.8-.75 1.8-1.7 0-.45-.17-.85-.47-1.17a1.7 1.7 0 0 1-.46-1.18c0-.97.78-1.75 1.75-1.75h2.03A3.85 3.85 0 0 0 20.5 10.85C20.5 6.8 16.7 3.5 12 3.5Z"
                        {...stroke}
                    />
                    <circle cx="7.6" cy="11.4" r="1.05" fill="currentColor" />
                    <circle cx="9.6" cy="7.6" r="1.05" fill="currentColor" />
                    <circle cx="14.2" cy="7.4" r="1.05" fill="currentColor" />
                </>
            )}
            {name === 'nail' && (
                // 손가락 끝 + 손톱 — 쉐입 이미지로 직접 고르기
                <>
                    <path d="M7 21v-10a5 5 0 0 1 10 0v10" {...stroke} />
                    <path d="M9.6 13.4V9.6a2.4 2.4 0 0 1 4.8 0v3.8c0 .55-.45 1-1 1h-2.8c-.55 0-1-.45-1-1Z" {...stroke} />
                </>
            )}
            {name === 'check' && (
                // 동그라미 체크 — 바로 생성해 주세요
                <>
                    <circle cx="12" cy="12" r="8.5" {...stroke} />
                    <path d="m8.4 12.3 2.5 2.5 4.8-5.1" {...stroke} />
                </>
            )}
            {name === 'chat' && (
                // 말풍선 — 아직 더 얘기하고 싶어요 (생성 방식 카드의 말풍선과 같은 모양)
                <>
                    <path
                        d="M6.4 4.5h11.2a2.4 2.4 0 0 1 2.4 2.4v7.2a2.4 2.4 0 0 1-2.4 2.4H11l-4.5 3.5 1-3.5H6.4A2.4 2.4 0 0 1 4 14.1V6.9a2.4 2.4 0 0 1 2.4-2.4Z"
                        {...stroke}
                    />
                    <circle cx="8.5" cy="10.5" r="0.95" fill="currentColor" />
                    <circle cx="12" cy="10.5" r="0.95" fill="currentColor" />
                    <circle cx="15.5" cy="10.5" r="0.95" fill="currentColor" />
                </>
            )}
            {name === 'party' && (
                // 축하 폭죽 — 좋아요! 이 디자인으로 할게요
                <>
                    <path d="M4.5 19.5 8.7 8.7l6.6 6.6-10.8 4.2Z" {...stroke} />
                    <path d="M7 13.2c1.4 1.5 2.4 2.4 3.8 3.6" {...stroke} />
                    <path d="M13.5 10.5c1.2-2.1 3.1-3 5.5-2.6M12.6 7.2c.5-1.2.3-2.3-.5-3.2" {...stroke} />
                    <circle cx="16" cy="4.3" r="1" fill="currentColor" />
                    <circle cx="20" cy="12.2" r="1" fill="currentColor" />
                    <circle cx="19.2" cy="4.8" r="0.8" fill="currentColor" />
                </>
            )}
            {name === 'pencil' && (
                // 연필 — 수정하고 싶어요
                <>
                    <path d="M4.5 19.5 5.6 15 15.4 5.2a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L9 18.4l-4.5 1.1Z" {...stroke} />
                    <path d="m13.8 6.8 3.4 3.4" {...stroke} />
                </>
            )}
        </svg>
    )
}

// 완성 이미지가 서서히 나타나는 시간 — design-chat.css의 .design-chat__design-card img transition(opacity 0.6s)과 같게 둔다
const DESIGN_CARD_FADE_MS = 600

// 디자인 카드 — 생성 중엔 번지는 오로라 위에 "디자인 생성 중"·진행 막대를 보여 주다가, 완성 이미지가 들어오면 같은 자리에서 이미지로 바뀐다
function DesignResultCard({
    imageUrl,
    isGenerating,
    onOpen,
    onLoad,
    onShown,
}: {
    imageUrl: string | null
    isGenerating: boolean
    onOpen: (url: string) => void
    onLoad: () => void
    // 이미지가 카드에 다 나타났을 때(불러온 뒤 서서히 나타나기까지 끝난 때) — 불러오기에 실패했으면 바로
    onShown: () => void
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
                        window.setTimeout(onShown, DESIGN_CARD_FADE_MS)
                    }}
                    onError={() => {
                        setIsLoaded(true)
                        onShown()
                    }}
                    onClick={() => onOpen(imageUrl)}
                />
            )}
            <div
                className={`design-chat__design-card-loading${showLoading ? '' : ' is-hidden'}`}
                role={showLoading ? 'status' : undefined}
                aria-hidden={!showLoading}
            >
                {/* 메인 히어로처럼 — 핑크·라일락·민트 빛이 번졌다 흐려졌다 하는 오로라 위에 점 그리드와 옅은 질감 */}
                <span className="design-chat__design-card-backdrop" aria-hidden="true">
                    <span className="design-chat__design-card-aurora">
                        <span className="design-chat__design-card-blob design-chat__design-card-blob--pink" />
                        <span className="design-chat__design-card-blob design-chat__design-card-blob--lilac" />
                        <span className="design-chat__design-card-blob design-chat__design-card-blob--mint" />
                    </span>
                    <span className="design-chat__design-card-grid" />
                    <span className="design-chat__design-card-grain" />
                </span>
                <span className="design-chat__design-card-label">디자인 생성 중</span>
                <span className="design-chat__design-card-bar" aria-hidden="true" />
            </div>
        </div>
    )
}

// 선택지 라벨 옆에 작게 병기할 영문 표기 (계절/컬러 단계는 값 자체가 영단어가 아니라서 제외).
// mood/designType/motif/shape의 value는 이미 영단어(예: lovely, polka dot)라 그대로 타이틀케이스로 바꿔 쓴다.
const ENGLISH_SUBLABEL_STEPS: PreferenceKey[] = ['mood', 'designType', 'motif', 'shape']

function toEnglishTitleCase(value: string): string {
    return value.replace(/\b\w/g, (c) => c.toUpperCase())
}

// 분위기/디자인 타입/모티프/컬러 단계의 "기타" 입력란 안내 문구
// (컬러는 색 이름을 적거나, 어울리는 색을 추천해 달라고 해도 된다)
const PREFERENCE_NOTE_PLACEHOLDERS: Partial<Record<PreferenceKey, string>> = {
    mood: '찾으시는 분위기가 없다면 직접 입력해 주세요(예: 몽환적인). 덧붙이고 싶으신 의견을 입력해도 좋아요.',
    designType: '찾으시는 디자인 타입이 없다면 직접 입력해 주세요(예: 체크 패턴). 덧붙이고 싶으신 의견을 입력해도 좋아요.',
    motif: '찾으시는 모티프가 없다면 직접 입력해 주세요(예: 나비). 덧붙이고 싶으신 의견을 입력해도 좋아요.',
    color: '컬러를 고르기 어려우시다면 원하시는 요청 사항을 입력해 주세요.',
}
type DesignChatConversationProps = Parameters<typeof useNailDesignChatPage>[0]

// 채팅 하나 — 메시지·선택 창·입력창. 다른 채팅으로 옮기면 useDesignChatWorkspace가 key를 바꿔 새로 마운트한다.
// 디자인을 만드는 중에 다른 채팅으로 옮긴 채팅은 언마운트하지 않고 화면에서만 숨겨(isBackground) 계속 만든다.
export function DesignChatConversation(props: DesignChatConversationProps) {
    const { userName, isBackground = false } = props
    const {
        isInitReady,
        bubbles,
        activeQuickReply,
        mode,
        handleDesignCardShown,
        isAwaitingGenerateConfirm,
        isPreferenceInputLocked,
        isReopenedAfterConfirm,
        isReadOnly,
        selectedInQuickReply,
        freeformSelectedColors,
        activeNoteStep,
        activeNote,
        hasActiveNote,
        setPreferenceNote,
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
        freeformColorNote,
        setFreeformColorNote,
        freeformShapePickerOpen,
        zoomedImage,
        messagesRef,
        chatContainerRef,
        textareaRef,
        inputbarRef,
        scrollMessagesToBottom,
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
        removeSelectedPhoto,
        hasPhotoAttachment,
        isPhotoInputLocked,
        handleSubmitInput,
        handleQuickReplyClick,
        closeFreeformPicker,
        toggleFreeformColor,
        handleFreeformColorPickerConfirm,
        handleFreeformShapeSelect,
        showOptionTooltip,
        hideOptionTooltip,
        toggleOptionTooltip,
        openZoomedImage,
        closeZoomedImage,
        adjustTextareaHeight,
    } = useNailDesignChatPage(props)

    // "사진 변경하기"를 눌러 파일 고르기 창이 떠 있는 동안 브라우저는 마우스 위치를 모른다. 창을 닫고 돌아오면
    // 마지막으로 누른 자리(= 이 버튼 위)에 마우스가 있다고 보고 호버 모양을 띄워 두므로, 눌렀을 때부터
    // 마우스가 실제로 버튼 위에서 움직이기 전까지는 호버 모양을 끈다.
    const [isPhotoChangeHoverSuppressed, setIsPhotoChangeHoverSuppressed] = useState(false)
    // 선택지 기반 생성에서 지금 선택 창이 몇 번째 단계인지 (1부터, 선택지 단계가 아니면 0)
    const preferenceStepNumber = activeQuickReply?.id.startsWith('pref-')
        ? PREFERENCE_STEPS.indexOf(activeQuickReply.id.slice(5) as PreferenceKey) + 1
        : 0
    // 고르거나 직접 입력할 수 있는 제안 선택 창 (자유 입력 추천 "이런 느낌은 어떠세요?" / 수정 제안)
    // — "바로 생성해 드릴까요?"도 freeform-actions지만 입력이 막히는 확인 창이라 아래에서 먼저 걸러진다
    const isSuggestionPanelOpen =
        !!activeQuickReply &&
        (activeQuickReply.id.startsWith('freeform-actions') || activeQuickReply.id === 'revise-suggestions')
    // 입력 칸 안내 문구 — 칸이 좁으면 말줄임표로 줄이도록 textarea 위에 따로 그린다
    // 디자인을 만드는 동안(생성·수정, 모든 생성 방식)은 입력이 막히므로 기다려 달라는 문구로 통일한다.
    // 골라야만 넘어가는 선택 창(선택지 기반 단계 / 디자인 확인 / 바로 생성 확인 / 이어서 수정·새로 만들기)은 같은 문구를 쓴다.
    // (선택지 기반은 디자인이 나오기 전까지 입력이 막혀 있지만, "위 선택지에서…"는 선택 창이 떠 있을 때만 보여 준다)
    // 디자인을 확정한 뒤 다시 연 채팅은 마지막 디자인을 수정할 수 있다고 안내하고,
    // 수정 요청을 받는 때(수정 모드, 선택지 기반으로 만든 뒤 돌아와 입력이 열린 때)는 수정 내용을 적으라고 안내하고,
    // 자유 입력으로 채팅하는 중(제안 선택 창이 없을 때)엔 안내 문구를 띄우지 않는다.
    // (선택지를 다 고른 뒤 서버 답장을 기다리는 동안도 디자인을 만드는 과정이라 같은 문구를 쓴다)
    // 보기만 하는 채팅(손 촬영에서 이어 온 진입에서 연 다른 분석 기록의 채팅)은 입력·전송·선택 창을 막고 그 이유를 안내한다.
    const inputPlaceholder = isReadOnly
        ? '다른 분석 기록의 채팅이라 보기만 할 수 있어요.'
        : isGeneratingDesign || (mode === 'preference' && isSending)
        ? '디자인을 만들고 있어요. 잠시만 기다려 주세요.'
        : (isPreferenceInputLocked && preferenceStepNumber > 0) || isAwaitingGenerateConfirm
            ? '위 선택지에서 골라 주세요.'
            : isPhotoInputLocked
                ? '사진을 첨부해 주세요.'
                : hasPhotoAttachment
                    ? '추가적인 요청 사항이 있다면 함께 입력해 주세요.'
                    : isSuggestionPanelOpen
                        ? '직접 입력하셔도 좋아요.'
                        : isReopenedAfterConfirm
                            ? '수정하고 싶으신 부분을 자유롭게 말씀해 주세요.'
                            : mode === 'revise' || (mode === 'preference' && !isPreferenceInputLocked)
                                ? '수정하고 싶은 내용을 입력해 주세요.'
                                : mode === 'freeform'
                                    ? ''
                                    : '또는 원하시는 디자인을 바로 입력해 주세요.'

    return (
        <>
            <div
                className="design-chat"
                ref={chatContainerRef}
                style={isBackground ? { display: 'none' } : undefined}
                aria-hidden={isBackground || undefined}
            >
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
                    {/* 채팅 이력에만 남기는 말풍선(선택지 기반에서 서버로 보낸 요약 문장)은 화면에 그리지 않는다 */}
                    {bubbles.filter((bubble) => !bubble.historyOnly).map((bubble) =>
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
                                                    onShown={() => handleDesignCardShown(bubble.id)}
                                                />
                                            ),
                                        )}
                                    </div>
                                </div>
                                {bubble.text && (
                                    <div className="design-chat__row design-chat__row--assistant">
                                        <img src="/images/logo.png" alt="" className="design-chat__avatar" />
                                        <div className="design-chat__bubble design-chat__bubble--assistant">
                                            <BubbleText text={bubble.text} />
                                        </div>
                                    </div>
                                )}
                            </Fragment>
                        ) : (
                            <ChatMessageRow
                                key={bubble.id}
                                role={bubble.role}
                                text={bubble.text}
                                imageUrls={bubble.imageUrls}
                                colorSwatches={bubble.colorSwatches}
                                colorsInline={bubble.colorsInline}
                                textAfterColors={bubble.textAfterColors}
                                onImageClick={(url) => openZoomedImage(url, false)}
                                onImageLoad={scrollMessagesToBottom}
                            />
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
                {activeQuickReply && !hasPhotoAttachment && !isReadOnly && (
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

                                        {/* 선택지 기반 컬러 단계와 같은 "기타 입력" — 고른 색과 함께 보낸다 */}
                                        <label className="design-chat__quickreply-note">
                                            <span className="design-chat__quickreply-note-label">기타 입력</span>
                                            <input
                                                type="text"
                                                className="design-chat__quickreply-note-input"
                                                value={freeformColorNote}
                                                maxLength={getPreferenceNoteMaxLength('color')}
                                                placeholder={PREFERENCE_NOTE_PLACEHOLDERS.color}
                                                onChange={(e) => setFreeformColorNote(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
                                                    e.preventDefault()
                                                    if (!isSending) handleFreeformColorPickerConfirm()
                                                }}
                                                disabled={isSending}
                                            />
                                        </label>

                                        <button
                                            type="button"
                                            className="design-chat__quickreply-confirm"
                                            onClick={handleFreeformColorPickerConfirm}
                                            disabled={isSending || (freeformSelectedColors.length === 0 && !freeformColorNote.trim())}
                                            aria-label={`선택한 컬러 ${freeformSelectedColors.length}개${
                                                freeformColorNote.trim() ? '와 기타 의견으' : ''
                                            }로 선택`}
                                        >
                                            {freeformSelectedColors.length > 0 && (
                                                <span className="design-chat__quickreply-confirm-swatches" aria-hidden="true">
                                                    {freeformSelectedColors.map((hex) => (
                                                        <span
                                                            key={hex}
                                                            className="design-chat__quickreply-confirm-swatch"
                                                            style={{ background: hex }}
                                                        />
                                                    ))}
                                                </span>
                                            )}
                                            {freeformColorNote.trim() ? '기타 의견 ' : ''}
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
                                                    {option.icon && (
                                                        <span className="design-chat__quickreply-option-icon">
                                                            <ChatOptionIcon name={option.icon} />
                                                        </span>
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
                                            maxLength={getPreferenceNoteMaxLength(activeNoteStep)}
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

                                {isMultiConfirmVisible && (
                                    <button
                                        type="button"
                                        className="design-chat__quickreply-confirm"
                                        // 기타 입력을 적어 뒀다면 고른 값과 함께 다음 단계로 넘어간다 (컬러 단계도 같다)
                                        onClick={() => confirmPreferenceStep(selectedInQuickReply)}
                                        disabled={isSending}
                                        aria-label={
                                            activeQuickReply.id === 'pref-color'
                                                ? `선택한 컬러 ${selectedInQuickReply.length}개${hasActiveNote ? '와 기타 의견으' : ''}로 선택`
                                                : undefined
                                        }
                                    >
                                        {activeQuickReply.id === 'pref-color' ? (
                                            <>
                                                {selectedInQuickReply.length > 0 && (
                                                    <span className="design-chat__quickreply-confirm-swatches" aria-hidden="true">
                                                        {selectedInQuickReply.map((hex) => (
                                                            <span
                                                                key={hex}
                                                                className="design-chat__quickreply-confirm-swatch"
                                                                style={{ background: hex }}
                                                            />
                                                        ))}
                                                    </span>
                                                )}
                                                {hasActiveNote ? '기타 의견 ' : ''}
                                            </>
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
                        disabled={isReadOnly || isSending || isAwaitingGenerateConfirm || isPreferenceInputLocked || isPhotoInputLocked}
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
                            isReadOnly ||
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

            {/* 숨겨 둔 채팅의 확대 보기·툴팁은 띄우지 않는다 (다시 화면에 띄우면 그대로 보인다) */}
            {zoomedImage && !isBackground && (
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
                !isBackground &&
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
        </>
    )
}