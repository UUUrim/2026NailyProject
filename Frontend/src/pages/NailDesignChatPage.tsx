import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { WarningIcon } from '@/components/icons/WarningIcon'
import { getMyProfile } from '@/apis/user'
import { getMyScans, getScanResult, type ScanResultResponse } from '@/apis/scan'
import { buildScanSessions, isFullyAnalyzedSession, parseDateFlexible, type ScanSession } from '@/utils/scanDetail'
import { analyzeSkinTone, generateSkinTonePalette } from '@/utils/skinTone'
import { NAIL_BASELINE, percentileAgainstBaseline, labelByPercentile } from '@/utils/nailMetrics'
import {
    createChatSession,
    sendChatMessage,
    savePreferences,
    refineKeywords,
} from '@/apis/chat'
import { generateDesign, generateDesignFromImage, confirmDesign, type DesignExtractedDetails } from '@/apis/design'
import { getNailShape, type NailShapeId } from '@/constants/nailShapes'
import { NailPreview3D } from '@/components/nail3d/NailPreview3D'
import {
    INITIAL_PREFERENCES,
    PREFERENCE_OPTIONS,
    PREFERENCE_OPTION_INFO,
    PREFERENCE_SECTION_LABELS,
    PERSONAL_COLOR_SWATCHES,
    SEASON_ROWS,
    SHAPE_PREVIEW_IMAGES,
    type NailDesignPreferences,
    type PreferenceKey,
    type PreferenceOptionInfo,
} from '@/constants/designPreferences'
import { ApiError } from '@/utils/apiClient'
import { AUTH_CHANGE_EVENT } from '@/utils/auth'
import { registerChatSessionGuard, confirmLeaveChatIfNeeded, shouldBypassBeforeUnload } from '@/utils/chatSessionGuard'
import '@/styles/design-chat.css'
import '@/styles/nail-design.css'
import '@/styles/mypage.css'

// ── 타입 ──────────────────────────────────────────────────────────────────

type ChatBubble = {
    id: string
    role: 'assistant' | 'user'
    text: string
    imageUrls?: string[]
    colorSwatches?: string[]
    isDesignResult?: boolean
}

type QuickReplyOption = {
    value: string
    label: string
    colorHexes?: string[]
}

type QuickReply = {
    id: string
    question: string
    options: QuickReplyOption[]
    multi: boolean
    limit: number | null // null = 개수 제한 없음
    layout: 'list' | 'grid3'
}

type Mode = 'menu' | 'preference' | 'freeform' | 'scan-auto' | 'photo' | 'revise'

type GenerationSource = 'preference' | 'freeform' | 'scan-auto' | 'photo'

// 결과 페이지에서 "이 디자인이 어떻게 만들어졌는지" 보여주기 위한 생성 맥락 정보.
type GenerationContext = {
    source: GenerationSource
    keywords: string[] // 선택지/자유입력 대화에서 뽑은 키워드 (scan-auto·photo는 비움)
    referenceImageUrl: string | null // 사진 기반 생성일 때, 사용자가 업로드한 참고 사진
    handSummary: {
        seasonNameKo: string
        shapeLabel: string
        avgLength: number
        avgWidth: number
        avgCurve: number
    } | null // 손 스캔 기반 자동 생성일 때, 참고한 손 분석 정보
    revisionKeywords: string[] // 생성 방식에 상관없이, "수정하고 싶어요" 흐름에서 추가로 요청한 내용
}

type GeneratedDesign = {
    designId: number
    imageUrls: string[]
    prompt: string
    preferences: NailDesignPreferences
    source: GenerationSource
    shapeId: NailShapeId
    details?: DesignExtractedDetails
    context: GenerationContext
}

// 채팅 진행 상태를 컴포넌트 바깥(모듈 스코프)에 스냅샷으로 저장해 둔다.
// 결과 페이지로 이동했다가(브라우저 뒤로가기 포함) 다시 이 페이지로 돌아오면, 여기서 그대로
// 복원해서 채팅 세션·대화 내역·진행 상태가 전혀 초기화되지 않도록 한다.
// 탭이 살아있는 동안만 메모리에 남고, 새로고침하거나 새 탭에서 열면 사라진다(=새 세션으로 시작).
type ChatSessionSnapshot = {
    userName: string
    sessionId: number | null
    scanId: number | null
    scanHandSide: 'LEFT' | 'RIGHT' | null
    leftAnalysis: ScanResultResponse | null
    rightAnalysis: ScanResultResponse | null
    canSelectSession: boolean
    scanSessions: ScanSession[]
    selectedSessionKey: string | null
    bubbles: ChatBubble[]
    activeQuickReply: QuickReply | null
    selectedInQuickReply: string[]
    mode: Mode
    preferenceStepIndex: number
    preferenceStepBubbleIds: Record<number, string>
    collectedPreferences: NailDesignPreferences
    freeformLog: string[]
    reviseLog: string[]
    lastDesign: GeneratedDesign | null
    generationSource: GenerationSource
    selectedPhotoFile: File | null
    selectedPhotoPreviewUrl: string | null
    manualSeasonCode: string
    inputValue: string
    showAnalysisPanel: boolean
    isQuickReplyCollapsed: boolean
}

let chatSessionSnapshot: ChatSessionSnapshot | null = null

// 로그인/로그아웃(계정 전환)이 일어나면 이전 계정의 채팅 진행 상황이 다음 계정에게
// 보이지 않도록 스냅샷을 비운다. 실제 서버에 저장된 디자인 이력은 계정별로 분리되어 있어 영향 없음.
window.addEventListener(AUTH_CHANGE_EVENT, () => {
    chatSessionSnapshot = null
})

const DESIGN_FEEDBACK_QUICK_REPLY: QuickReply = {
    id: 'design-feedback',
    question: '이 디자인 마음에 드시나요?',
    options: [
        { value: 'accept', label: '네, 이 디자인으로 할게요 🎉' },
        { value: 'revise', label: '수정하고 싶어요 ✏️' },
    ],
    multi: false,
    limit: 1,
    layout: 'list',
}

const PHOTO_UPLOAD_QUICK_REPLY: QuickReply = {
    id: 'photo-upload',
    question: '참고하고 싶은 사진을 선택해 주세요',
    options: [],
    multi: false,
    limit: 1,
    layout: 'list',
}

const MENU_OPTIONS: QuickReplyOption[] = [
    { value: 'preference', label: '선택지 기반으로 만들기' },
    { value: 'freeform', label: '자유 입력으로 만들기' },
    { value: 'photo', label: '사진 기반으로 만들기' },
    { value: 'scan-auto', label: '내 스캔 정보 기반으로 자동 생성' },
]

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

const MENU_QUICK_REPLY: QuickReply = {
    id: 'menu',
    question: '디자인 생성을 어떤 방식으로 진행하고 싶으신가요?',
    options: MENU_OPTIONS,
    multi: false,
    limit: 1,
    layout: 'list',
}

// 분위기 → 디자인 타입 → 모티프 → 계절감 → 네일 쉐입 → 컬러
const PREFERENCE_STEPS: PreferenceKey[] = ['mood', 'designType', 'motif', 'season', 'shape', 'color']

// 계절감/네일 쉐입만 1개, 나머지는 개수 제한 없음
const STEP_LIMIT: Record<PreferenceKey, number | null> = {
    mood: null,
    designType: null,
    motif: null,
    season: 1,
    shape: 1,
    color: null,
}

// mood/designType/motif/shape: 가로 3칸 그리드, season: 세로 리스트, color: 전용 UI
const STEP_LAYOUT: Record<PreferenceKey, 'list' | 'grid3'> = {
    mood: 'grid3',
    designType: 'grid3',
    motif: 'grid3',
    season: 'list',
    shape: 'grid3',
    color: 'list',
}

const STEP_QUESTIONS: Record<PreferenceKey, string> = {
    mood: '원하시는 분위기를 선택해 주세요.',
    designType: '원하시는 디자인 타입을 선택해 주세요.',
    motif: '포인트로 넣고 싶은 모티프를 선택해 주세요.',
    season: '원하시는 계절감을 선택해 주세요.',
    shape: '원하시는 네일 쉐입을 선택해 주세요.',
    color: '원하시는 컬러를 선택해 주세요.',
}

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

const QMARK_TOKEN = '{{qicon}}'

function SeasonDropdown({
                            value,
                            onChange,
                            disabled,
                        }: {
    value: string
    onChange: (code: string) => void
    disabled?: boolean
}) {
    const [open, setOpen] = useState(false)
    const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
    const wrapRef = useRef<HTMLDivElement | null>(null)
    const triggerRef = useRef<HTMLButtonElement | null>(null)
    const menuRef = useRef<HTMLDivElement | null>(null)

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

    const current = SEASON_ROWS.find((row) => row.code === value)

    const toggleOpen = (e: ReactMouseEvent) => {
        e.stopPropagation()
        if (disabled) return
        const rect = triggerRef.current?.getBoundingClientRect()
        if (rect) {
            setMenuPos({ top: rect.bottom + 6, left: rect.right })
        }
        setOpen((prev) => !prev)
    }

    return (
        <div className="design-chat__season-dropdown" ref={wrapRef}>
            <button
                ref={triggerRef}
                type="button"
                className="design-chat__season-dropdown-trigger"
                onClick={toggleOpen}
                disabled={disabled}
            >
                <span>{current?.nameKo ?? '퍼스널컬러'}</span>
                <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                    className={`design-chat__season-dropdown-chevron${open ? ' is-open' : ''}`}
                >
                    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>

            {open && menuPos &&
                createPortal(
                    <div
                        ref={menuRef}
                        className="design-chat__season-dropdown-menu"
                        style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, transform: 'translateX(-100%)' }}
                    >
                        <div className="design-chat__season-dropdown-menu-scroll">
                            {SEASON_ROWS.map((row) => (
                                <button
                                    key={row.code}
                                    type="button"
                                    className={`design-chat__season-dropdown-option${row.code === value ? ' is-active' : ''}`}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onChange(row.code)
                                        setOpen(false)
                                    }}
                                >
                                    {row.nameKo}
                                </button>
                            ))}
                        </div>
                    </div>,
                    document.body,
                )}
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

function makeId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// 선택한 스캔 세션(왼손/오른손 scanId)의 실제 분석 결과를 서버에서 받아온다.
// 초기 진입 시(최근 세션 자동 선택)와 드롭다운으로 다른 세션을 고를 때 둘 다 이 함수를 쓴다.
async function fetchSessionAnalysis(session: ScanSession) {
    const [leftRes, rightRes] = await Promise.all([
        session.leftScanId ? getScanResult(session.leftScanId).catch(() => null) : Promise.resolve(null),
        session.rightScanId ? getScanResult(session.rightScanId).catch(() => null) : Promise.resolve(null),
    ])
    return { leftRes, rightRes }
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

function buildPreferenceQuickReply(step: PreferenceKey): QuickReply {
    const limit = STEP_LIMIT[step]
    return {
        id: `pref-${step}`,
        question: `${STEP_QUESTIONS[step]}${limit && limit > 1 ? ` (최대 ${limit}개)` : ''}`,
        options: PREFERENCE_OPTIONS[step],
        multi: limit !== 1,
        limit,
        layout: STEP_LAYOUT[step],
    }
}

export function NailDesignChatPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const navState = (location.state as
        | { leftScanId?: number | null; rightScanId?: number | null; scanId?: number | null }
        | null) ?? null

    // 브라우저 뒤로/앞으로가기(POP)로 돌아온 경우에만 이전 채팅 스냅샷을 복원한다. 앱 안의
    // 링크/버튼으로 들어온 경우(PUSH/REPLACE)엔 항상 새 채팅으로 시작하고, 남아있던 스냅샷은
    // 버려서 나중에 엉뚱하게 되살아나지 않게 한다. 마운트 시점에 딱 한 번만 판단해서, 이후
    // 아래 useState들의 초기값 복원과 초기화 로직 분기에 함께 쓴다.
    const navigationType = useNavigationType()
    const [wasRestored] = useState(() => {
        const restored = navigationType === 'POP' && !!chatSessionSnapshot
        if (!restored) chatSessionSnapshot = null
        return restored
    })

    // 헤더의 "디자인 채팅" 링크처럼 특정 스캔을 지정하지 않고 들어온 경우에만 분석 결과를
    // 골라볼 수 있게 한다. 인쇄 페이지에서 scanId를 콕 집어 넘겨준 경우(= 메인 "시작하기"로
    // 이어진 흐름)엔 그때 분석한 결과에 고정하고 드롭다운으로 다른 결과를 못 고르게 한다.
    const canSelectSession = wasRestored
        ? (chatSessionSnapshot?.canSelectSession ?? true)
        : !(navState?.leftScanId || navState?.rightScanId || navState?.scanId)

    const [userName, setUserName] = useState(chatSessionSnapshot?.userName ?? '')
    const [isInitReady, setIsInitReady] = useState(false)
    const [sessionId, setSessionId] = useState<number | null>(chatSessionSnapshot?.sessionId ?? null)
    const [scanId, setScanId] = useState<number | null>(chatSessionSnapshot?.scanId ?? null)
    const [scanHandSide, setScanHandSide] = useState<'LEFT' | 'RIGHT' | null>(chatSessionSnapshot?.scanHandSide ?? null)

    const [bubbles, setBubbles] = useState<ChatBubble[]>(chatSessionSnapshot?.bubbles ?? [])
    const [activeQuickReply, setActiveQuickReply] = useState<QuickReply | null>(chatSessionSnapshot?.activeQuickReply ?? null)
    // "네, 바로 생성해주세요 / 아직 더 얘기하고 싶어요" 확인 화면이 떠 있는 동안엔
    // 자유 텍스트 입력을 막는다 — 안 그러면 아무 텍스트나 쳤을 때 "수정 요청"으로
    // 오인돼서 의도치 않게 디자인이 재생성되는 문제가 있었다.
    const isAwaitingGenerateConfirm =
        activeQuickReply?.id === 'design-feedback' ||
        !!activeQuickReply?.options?.some((o) => o.value === '__generate__')
    const [selectedInQuickReply, setSelectedInQuickReply] = useState<string[]>(chatSessionSnapshot?.selectedInQuickReply ?? [])

    const [mode, setMode] = useState<Mode>(chatSessionSnapshot?.mode ?? 'menu')
    const [preferenceStepIndex, setPreferenceStepIndex] = useState(chatSessionSnapshot?.preferenceStepIndex ?? 0)
    const [preferenceStepBubbleIds, setPreferenceStepBubbleIds] = useState<Record<number, string>>(
        chatSessionSnapshot?.preferenceStepBubbleIds ?? {},
    )
    const [collectedPreferences, setCollectedPreferences] = useState<NailDesignPreferences>(
        chatSessionSnapshot?.collectedPreferences ?? INITIAL_PREFERENCES,
    )
    const freeformLogRef = useRef<string[]>(chatSessionSnapshot?.freeformLog ?? [])
    // 생성 방식과 무관하게, "수정하고 싶어요" 흐름에서 사용자가 채팅으로 추가 요청한 문장들을 모아둔다.
    const reviseLogRef = useRef<string[]>(chatSessionSnapshot?.reviseLog ?? [])
    const [lastDesign, setLastDesign] = useState<GeneratedDesign | null>(chatSessionSnapshot?.lastDesign ?? null)
    const [generationSource, setGenerationSource] = useState<GenerationSource>(chatSessionSnapshot?.generationSource ?? 'scan-auto')
    const [selectedPhotoFile, setSelectedPhotoFile] = useState<File | null>(chatSessionSnapshot?.selectedPhotoFile ?? null)
    // 사진 기반 흐름에서 스캔 없이 "랜덤 모양으로 진행하기"를 고르면, 3D 미리보기에라도
    // 실제로 랜덤하게 고른 쉐입을 보여주기 위한 값 (백엔드로 별도 전송되진 않음)
    const [randomPhotoShapeId, setRandomPhotoShapeId] = useState<NailShapeId | null>(null)
    const [selectedPhotoPreviewUrl, setSelectedPhotoPreviewUrl] = useState<string | null>(
        chatSessionSnapshot?.selectedPhotoPreviewUrl ?? null,
    )
    const photoInputRef = useRef<HTMLInputElement | null>(null)

    const [inputValue, setInputValue] = useState(chatSessionSnapshot?.inputValue ?? '')
    const [isSending, setIsSending] = useState(false)
    const [customColor, setCustomColor] = useState('#DE869F')
    const [isQuickReplyCollapsed, setIsQuickReplyCollapsed] = useState(chatSessionSnapshot?.isQuickReplyCollapsed ?? false)

    // 옵션 설명 툴팁: 웹은 호버로, 모바일(터치)에서는 "i" 배지를 탭했을 때 뜬다.
    // 선택지 창(overflow: auto)에 잘리지 않도록, DOM 트리 밖(document.body)으로 포탈해서
    // 뷰포트 좌표(getBoundingClientRect) 기준 고정 위치로 띄운다.
    const [tooltipAnchor, setTooltipAnchor] = useState<{
        key: string
        label: string
        info: PreferenceOptionInfo
        top: number
        left: number
    } | null>(null)
    const [tooltipImgError, setTooltipImgError] = useState(false)
    // i 버튼으로 "고정"해 둔 툴팁의 key. 고정된 동안은 마우스가 벗어나거나 포커스가 빠져도 안 닫힌다.
    const [pinnedTooltipKey, setPinnedTooltipKey] = useState<string | null>(null)

    const computeTooltipAnchor = (
        e: ReactMouseEvent<HTMLElement> | React.FocusEvent<HTMLElement>,
        key: string,
        label: string,
        info: PreferenceOptionInfo,
    ) => {
        const anchorEl = (e.currentTarget.closest('.design-chat__quickreply-item-wrap') as HTMLElement) ?? e.currentTarget
        const rect = anchorEl.getBoundingClientRect()
        return { key, label, info, top: rect.top, left: rect.left + rect.width / 2 }
    }

    const showOptionTooltip = (
        e: ReactMouseEvent<HTMLElement> | React.FocusEvent<HTMLElement>,
        key: string,
        label: string,
        info: PreferenceOptionInfo,
    ) => {
        // 다른 옵션이 이미 고정돼 있으면, 호버만으로 그 위에 다른 툴팁을 겹쳐 띄우지 않는다.
        if (pinnedTooltipKey && pinnedTooltipKey !== key) return
        setTooltipImgError(false)
        setTooltipAnchor(computeTooltipAnchor(e, key, label, info))
    }

    const hideOptionTooltip = (key: string) => {
        if (pinnedTooltipKey === key) return // 고정된 툴팁은 마우스/포커스가 벗어나도 유지
        setTooltipAnchor((prev) => (prev?.key === key ? null : prev))
    }

    // i 버튼 클릭: 안 고정된 상태면 고정하고, 이미 고정돼 있으면 고정을 풀고 닫는다.
    const toggleOptionTooltip = (
        e: ReactMouseEvent<HTMLElement>,
        key: string,
        label: string,
        info: PreferenceOptionInfo,
    ) => {
        if (pinnedTooltipKey === key) {
            setPinnedTooltipKey(null)
            setTooltipAnchor((prev) => (prev?.key === key ? null : prev))
            return
        }
        setPinnedTooltipKey(key)
        setTooltipImgError(false)
        setTooltipAnchor(computeTooltipAnchor(e, key, label, info))
    }

    // 다른 질문 단계로 넘어가면 이전 단계에서 열어둔(고정한) 툴팁은 자동으로 닫는다.
    useEffect(() => {
        setTooltipAnchor(null)
        setPinnedTooltipKey(null)
    }, [activeQuickReply?.id])

    // 스크롤/리사이즈가 일어나면 앵커 위치가 어긋나므로 열려 있던 툴팁을 닫는다.
    useEffect(() => {
        if (!tooltipAnchor) return
        const close = () => {
            setTooltipAnchor(null)
            setPinnedTooltipKey(null)
        }
        window.addEventListener('scroll', close, true)
        window.addEventListener('resize', close)
        return () => {
            window.removeEventListener('scroll', close, true)
            window.removeEventListener('resize', close)
        }
    }, [tooltipAnchor])
    // 자유입력(Gemini) 흐름에서 "컬러/쉐입은 고정 UI로 고르고 싶을 때"를 위한 보조 픽커
    const [freeformColorPickerOpen, setFreeformColorPickerOpen] = useState(false)
    const [freeformShapePickerOpen, setFreeformShapePickerOpen] = useState(false)

    const [showAnalysisPanel, setShowAnalysisPanel] = useState(chatSessionSnapshot?.showAnalysisPanel ?? false)
    const [preview3DImage, setPreview3DImage] = useState<string | null>(null)
    const [zoomedImage, setZoomedImage] = useState<string | null>(null)

    // ── 확대 이미지 확대/축소/이동 (MyPage의 디테일 이미지 확대 방식과 동일) ──────
    const [imageZoom, setImageZoom] = useState(1)
    const [imagePan, setImagePan] = useState({ x: 0, y: 0 })
    const [isImageDragging, setIsImageDragging] = useState(false)
    const imageDragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
    const zoomedImageViewportRef = useRef<HTMLDivElement | null>(null)

    const IMAGE_ZOOM_MIN = 1
    const IMAGE_ZOOM_MAX = 4
    const IMAGE_WHEEL_ZOOM_SENSITIVITY = 0.0015

    const openZoomedImage = (url: string) => {
        setImageZoom(1)
        setImagePan({ x: 0, y: 0 })
        setZoomedImage(url)
    }

    const closeZoomedImage = () => {
        setZoomedImage(null)
        setImageZoom(1)
        setImagePan({ x: 0, y: 0 })
    }

    useEffect(() => {
        const viewport = zoomedImageViewportRef.current
        if (!viewport || !zoomedImage) return

        const onWheel = (e: WheelEvent) => {
            e.preventDefault()
            setImageZoom((z) => {
                const next = Math.min(
                    IMAGE_ZOOM_MAX,
                    Math.max(IMAGE_ZOOM_MIN, Number((z - e.deltaY * IMAGE_WHEEL_ZOOM_SENSITIVITY).toFixed(2))),
                )
                if (next === IMAGE_ZOOM_MIN) setImagePan({ x: 0, y: 0 })
                return next
            })
        }

        viewport.addEventListener('wheel', onWheel, { passive: false })
        return () => viewport.removeEventListener('wheel', onWheel)
    }, [zoomedImage])

    const handleZoomedImagePointerDown = (e: ReactMouseEvent<HTMLImageElement>) => {
        if (imageZoom <= IMAGE_ZOOM_MIN) return
        setIsImageDragging(true)
        imageDragStartRef.current.x = e.clientX
        imageDragStartRef.current.y = e.clientY
        imageDragStartRef.current.panX = imagePan.x
        imageDragStartRef.current.panY = imagePan.y
    }

    const handleZoomedImagePointerMove = (e: ReactMouseEvent<HTMLImageElement>) => {
        if (!isImageDragging) return
        const dx = e.clientX - imageDragStartRef.current.x
        const dy = e.clientY - imageDragStartRef.current.y
        setImagePan({ x: imageDragStartRef.current.panX + dx, y: imageDragStartRef.current.panY + dy })
    }

    const stopZoomedImageDragging = () => setIsImageDragging(false)
    const [leftAnalysis, setLeftAnalysis] = useState<ScanResultResponse | null>(chatSessionSnapshot?.leftAnalysis ?? null)
    const [rightAnalysis, setRightAnalysis] = useState<ScanResultResponse | null>(chatSessionSnapshot?.rightAnalysis ?? null)
    // 헤더로 단독 진입했을 때 드롭다운으로 고를 수 있는 과거 분석 결과 목록(양손 다 촬영된 세션만)
    const [scanSessions, setScanSessions] = useState<ScanSession[]>(chatSessionSnapshot?.scanSessions ?? [])
    const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(chatSessionSnapshot?.selectedSessionKey ?? null)

    const messagesRef = useRef<HTMLDivElement | null>(null)
    const chatContainerRef = useRef<HTMLDivElement | null>(null)
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)

    const INPUT_MIN_HEIGHT = 52

    const scrollMessagesToBottom = () => {
        const el = messagesRef.current
        if (el) el.scrollTop = el.scrollHeight
    }

    const adjustTextareaHeight = () => {
        const el = textareaRef.current
        if (!el) return
        el.style.height = 'auto'
        const containerHeight = chatContainerRef.current?.clientHeight ?? 600
        const maxHeight = Math.round(containerHeight * 0.3)
        const next = Math.min(Math.max(el.scrollHeight, INPUT_MIN_HEIGHT), maxHeight)
        el.style.height = `${next}px`
        scrollMessagesToBottom()
    }

    const pushAssistant = (text: string) => {
        setBubbles((prev) => [...prev, { id: makeId(), role: 'assistant', text }])
    }
    const pushAssistantImages = (text: string, imageUrls: string[]) => {
        setBubbles((prev) => [...prev, { id: makeId(), role: 'assistant', text, imageUrls, isDesignResult: true }])
    }
    const pushUser = (text: string) => {
        const id = makeId()
        setBubbles((prev) => [...prev, { id, role: 'user', text }])
        return id
    }
    const pushUserColors = (text: string, colorSwatches: string[]) => {
        const id = makeId()
        setBubbles((prev) => [...prev, { id, role: 'user', text, colorSwatches }])
        return id
    }

    // ── 초기화 ─────────────────────────────────────────────────────────────
    useEffect(() => {
        // 스냅샷에서 복원된 마운트라면(다른 페이지에 갔다가 뒤로가기 등으로 돌아온 경우),
        // 이미 세션·대화 내역이 다 남아있으므로 새 세션을 만들거나 프로필/스캔 정보를
        // 다시 불러오지 않는다 — 그대로 이어서 쓴다.
        if (wasRestored) {
            setIsInitReady(true)
            return
        }

        let cancelled = false

        const init = async () => {
            try {
                const profile = await getMyProfile()
                if (!cancelled) setUserName(profile.nickname || profile.name)
            } catch {
                // 이름 못 가져와도 진행
            }

            try {
                if (!canSelectSession) {
                    // 인쇄 페이지의 "디자인 생성하러 가기"로 넘어온 경우(= 메인 "시작하기"로 이어진 흐름).
                    // 그때 골랐던 scanId로 바로 조회해서 그 결과에 고정한다 — 세션 목록/드롭다운은 안 쓴다.
                    const [leftRes, rightRes] = await Promise.all([
                        navState?.leftScanId ? getScanResult(navState.leftScanId).catch(() => null) : Promise.resolve(null),
                        navState?.rightScanId ? getScanResult(navState.rightScanId).catch(() => null) : Promise.resolve(null),
                    ])
                    if (!cancelled) {
                        setLeftAnalysis(leftRes)
                        setRightAnalysis(rightRes)
                        const primaryScanId =
                            navState?.scanId ?? navState?.leftScanId ?? navState?.rightScanId ?? leftRes?.scanId ?? rightRes?.scanId ?? null
                        setScanId(primaryScanId)
                        setScanHandSide(leftRes ? 'LEFT' : rightRes ? 'RIGHT' : null)
                    }
                } else {
                    // 특정 스캔이 지정되지 않은 진입(헤더 링크 등) — 과거 분석 이력을 모두 불러와
                    // 최신 세션을 기본으로 보여주고, 드롭다운으로 다른 세션도 고를 수 있게 한다.
                    // 마이페이지 이력과 동일하게, 실제로 분석이 다 끝난(퍼스널 컬러+추천 쉐입+
                    // 길이/너비/곡률까지 전부 채워진) 세션만 대상으로 한다.
                    const historyItems = await getMyScans()
                    const sessions = buildScanSessions(historyItems).filter(isFullyAnalyzedSession)
                    if (!cancelled) setScanSessions(sessions)
                    const latest = sessions[0] ?? null
                    if (latest) {
                        const { leftRes, rightRes } = await fetchSessionAnalysis(latest)
                        if (!cancelled) {
                            setLeftAnalysis(leftRes)
                            setRightAnalysis(rightRes)
                            setScanId(latest.leftScanId ?? latest.rightScanId ?? null)
                            setScanHandSide(leftRes ? 'LEFT' : rightRes ? 'RIGHT' : null)
                            setSelectedSessionKey(latest.key)
                        }
                    }
                }
            } catch {
                // 스캔 이력 없으면 null로 유지
            }

            try {
                const id = await createChatSession()
                if (!cancelled) setSessionId(id)
            } catch {
                if (!cancelled) {
                    pushAssistant('채팅 세션을 시작하지 못했어요. 새로고침 후 다시 시도해 주세요.')
                }
            }

            if (!cancelled) setIsInitReady(true)
        }

        void init()
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        // 복원된 마운트에서는 이미 인사말을 포함한 이전 대화가 남아있으므로 다시 붙이지 않는다.
        if (!isInitReady || wasRestored) return
        const greetingName = userName ? `${userName}님` : '회원'
        setBubbles((prev) => [
            {
                id: makeId(),
                role: 'assistant',
                text: `반가워요, ${greetingName}!\n원하시는 네일 디자인 생성 방식을 선택해 주세요.\n분석 결과를 다시 확인하고 싶으시다면 하단의 ${QMARK_TOKEN}를 눌러주세요.`,
            },
            ...prev,
        ])
        setActiveQuickReply(MENU_QUICK_REPLY)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isInitReady])

    useEffect(() => {
        scrollMessagesToBottom()
    }, [bubbles, activeQuickReply])

    useEffect(() => {
        const el = messagesRef.current
        if (!el) return
        const observer = new ResizeObserver(() => {
            scrollMessagesToBottom()
        })
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        setIsQuickReplyCollapsed(false)
    }, [activeQuickReply?.id])

    // 렌더될 때마다 현재 채팅 진행 상태를 모듈 스코프 스냅샷에 그대로 반영해 둔다.
    // 이렇게 해야 이 페이지를 벗어났다가(결과 페이지 이동, 브라우저 뒤로가기 등) 다시 돌아왔을 때
    // 위 useState 초기값들이 이 스냅샷에서 그대로 복원된다.
    useEffect(() => {
        chatSessionSnapshot = {
            userName,
            sessionId,
            scanId,
            scanHandSide,
            leftAnalysis,
            rightAnalysis,
            canSelectSession,
            scanSessions,
            selectedSessionKey,
            bubbles,
            activeQuickReply,
            selectedInQuickReply,
            mode,
            preferenceStepIndex,
            preferenceStepBubbleIds,
            collectedPreferences,
            freeformLog: freeformLogRef.current,
            reviseLog: reviseLogRef.current,
            lastDesign,
            generationSource,
            selectedPhotoFile,
            selectedPhotoPreviewUrl,
            manualSeasonCode,
            inputValue,
            showAnalysisPanel,
            isQuickReplyCollapsed,
        }
    })

    // 채팅 중 새로고침/탭 닫기 방지: 세션이 있고 대화가 어느 정도 진행됐을 때만 경고
    // (주의: "지금 세션이 날라갑니다 괜찮나요?" 같은 커스텀 문구는 브라우저 보안 정책상
    //  최신 브라우저에서 표시가 안 되고, 브라우저 기본 확인 문구만 뜬다. 확인창 자체는 뜸.)
    useEffect(() => {
        if (!sessionId || !bubbles.some((b) => b.role === 'user')) return

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (shouldBypassBeforeUnload()) return // 이미 우리 확인창에서 동의받은 이동이면 중복으로 안 물어봄
            e.preventDefault()
            e.returnValue = '' // 크롬 등 일부 브라우저는 빈 문자열 지정이 필요함
        }

        window.addEventListener('beforeunload', handleBeforeUnload)
        return () => window.removeEventListener('beforeunload', handleBeforeUnload)
    }, [sessionId, bubbles])


    // 뒤로가기는 여전히 막지 않는다 — 채팅 진행 상태가 모듈 스코프 스냅샷으로 항상 보존되어
    // 뒤로가기로 돌아오면 그대로 복원된다. 다만 헤더의 scan/print/design 링크, 로그인/프로필
    // 메뉴 클릭 같은 "뒤로가기가 아닌" 앱 내부 이동은 beforeunload로 잡히지 않으므로, 전역
    // 네비게이션 가드에 등록해서 이동 직전에 동일하게 확인을 받고, 나가기로 하면 스냅샷을 비워서
    // 다음에 이 페이지로 다시 들어오면 처음부터 새로 시작하도록 한다.
    useEffect(() => {
        if (!sessionId || !bubbles.some((b) => b.role === 'user')) return

        registerChatSessionGuard(() => {
            const confirmed = window.confirm(
                '지금 나가면 채팅 내용이 저장되지 않고 사라져요. 그래도 나가시겠어요?',
            )
            if (confirmed) {
                chatSessionSnapshot = null
            }
            return confirmed
        })

        return () => registerChatSessionGuard(null)
    }, [sessionId, bubbles])

    // ── 공통: 디자인 생성 후 이동 ───────────────────────────────────────────
    const resolveShapeId = (preferences: NailDesignPreferences): NailShapeId => {
        const fromPrefs = preferences.shape[0]
        const fromScan = leftAnalysis?.shape || rightAnalysis?.shape
        return (fromPrefs || fromScan || 'oval') as NailShapeId
    }

    // 선택지 기반 흐름에서 고른 값들을 결과 페이지에 보여줄 "키워드" 칩으로 변환한다.
    // (색상은 팔레트 패널에서 이미 스와치로 보여주므로 여기서는 제외)
    const buildPreferenceKeywords = (preferences: NailDesignPreferences): string[] => {
        const keys: PreferenceKey[] = ['mood', 'designType', 'season', 'motif', 'shape']
        const labels = keys.flatMap((key) =>
            (preferences[key] ?? []).map((value) => PREFERENCE_OPTIONS[key].find((o) => o.value === value)?.label ?? value),
        )
        return Array.from(new Set(labels)).filter((label) => label && label !== '상관없음' && label !== '없음')
    }

    // 자유입력 흐름에서 사용자가 실제로 입력한 문장들을 짧은 키워드 단위로 쪼갠다.
    const buildFreeformKeywords = (log: string[]): string[] => {
        const phrases = log
            .flatMap((message) => message.split(/[,，./!?\n]+/))
            .map((phrase) => phrase.trim())
            .filter((phrase) => phrase.length >= 2)
        return Array.from(new Set(phrases)).slice(0, 12)
    }

    const buildScanAutoIntro = (): { text: string; colorSwatches: string[] } => {
        const seasonCode = leftAnalysis?.seasonCode || rightAnalysis?.seasonCode || null
        const seasonNameKo =
            leftAnalysis?.seasonNameKo || rightAnalysis?.seasonNameKo || SEASON_ROWS.find((r) => r.code === seasonCode)?.nameKo
        const shapeId = leftAnalysis?.shape || rightAnalysis?.shape || null
        const shapeLabel = shapeId ? getNailShape(shapeId)?.labelKo ?? shapeId : null
        const palette = seasonCode ? PERSONAL_COLOR_SWATCHES[seasonCode] : null
        const colorSwatches = palette ? palette.slice(0, 6) : []

        const seasonPart = seasonNameKo ? `${seasonNameKo} 퍼스널컬러` : '내 퍼스널컬러'
        const shapePart = shapeLabel ? `${shapeLabel} 쉐입` : '추천 쉐입'

        return {
            text: `${userName ? `${userName}님의` : '내'} 스캔 정보를 기반으로 Naily가 디자인을 추천해요.\n${seasonPart}, ${shapePart}에 어울리는 컬러와 무드를 골라 디자인을 생성해봤어요. 어떠신가요?\n3D 화면을 통해 확인해보세요!`,
            colorSwatches,
        }
    }

    const runGenerateDesign = async (preferences: NailDesignPreferences, source: GenerationSource) => {
        if (!sessionId) {
            pushAssistant('채팅 세션이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.')
            return
        }

        setGenerationSource(source)
        setIsSending(true)
        setActiveQuickReply(null)
        pushAssistant('디자인을 생성하고 있어요… 최대 1분 정도 걸릴 수 있어요 🎨')

        try {
            const data = await generateDesign({ sessionId, scanId })

            // "수정하고 싶어요" 흐름을 거쳐 재생성된 경우, 그동안 추가로 요청한 내용도 함께 담는다.
            const revisionKeywords = buildFreeformKeywords(reviseLogRef.current)

            const context: GenerationContext =
                source === 'scan-auto'
                    ? {
                          source,
                          keywords: [],
                          referenceImageUrl: null,
                          handSummary: analysisSummary
                              ? {
                                    seasonNameKo: analysisSummary.seasonNameKo,
                                    shapeLabel: analysisSummary.shapeLabel,
                                    avgLength: analysisSummary.avgLength,
                                    avgWidth: analysisSummary.avgWidth,
                                    avgCurve: analysisSummary.avgCurve,
                                }
                              : null,
                          revisionKeywords,
                      }
                    : source === 'freeform'
                      ? {
                            source,
                            keywords: buildFreeformKeywords(freeformLogRef.current),
                            referenceImageUrl: null,
                            handSummary: null,
                            revisionKeywords,
                        }
                      : {
                            source,
                            keywords: buildPreferenceKeywords(preferences),
                            referenceImageUrl: null,
                            handSummary: null,
                            revisionKeywords,
                        }

            setLastDesign({
                designId: data.designId,
                imageUrls: data.imageUrls,
                prompt: data.generatedPrompt,
                preferences,
                source,
                shapeId: resolveShapeId(preferences),
                details: data.details,
                context,
            })

            if (source === 'scan-auto') {
                const intro = buildScanAutoIntro()
                if (intro.colorSwatches.length > 0) {
                    setBubbles((prev) => [
                        ...prev,
                        { id: makeId(), role: 'assistant', text: intro.text, colorSwatches: intro.colorSwatches },
                    ])
                } else {
                    pushAssistant(intro.text)
                }
                pushAssistantImages('완성된 디자인이에요!', data.imageUrls)
            } else {
                pushAssistantImages('짜잔! 이런 디자인은 어떠세요?', data.imageUrls)
            }
            setActiveQuickReply(DESIGN_FEEDBACK_QUICK_REPLY)
        } catch (e) {
            console.error('디자인 생성 실패:', e)
            pushAssistant('이미지 생성에 실패했습니다. 다시 시도해 주세요.')
            setActiveQuickReply(MENU_QUICK_REPLY)
            setMode('menu')
        } finally {
            setIsSending(false)
        }
    }

    // 업로드한 참고 사진(+스캔 정보) 기반 생성
    const runGenerateDesignFromPhoto = async (file: File) => {
        if (!sessionId) {
            pushAssistant('채팅 세션이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.')
            return
        }

        setGenerationSource('photo')
        setIsSending(true)
        setActiveQuickReply(null)
        pushAssistant(
            scanId
                ? '업로드해주신 사진과 손 스캔 정보를 참고해서 디자인을 생성하고 있어요… 최대 1분 정도 걸릴 수 있어요 🎨'
                : '업로드해주신 사진을 참고해서 디자인을 생성하고 있어요… 최대 1분 정도 걸릴 수 있어요 🎨',
        )

        try {
            const data = await generateDesignFromImage({ sessionId, scanId, image: file })
            setLastDesign({
                designId: data.designId,
                imageUrls: data.imageUrls,
                prompt: data.generatedPrompt,
                preferences: INITIAL_PREFERENCES,
                source: 'photo',
                shapeId: randomPhotoShapeId ?? resolveShapeId(INITIAL_PREFERENCES),
                details: data.details,
                context: {
                    source: 'photo',
                    keywords: [],
                    referenceImageUrl: selectedPhotoPreviewUrl,
                    handSummary: null,
                    revisionKeywords: buildFreeformKeywords(reviseLogRef.current),
                },
            })
            pushAssistantImages('짜잔! 이런 디자인은 어떠세요?', data.imageUrls)
            setActiveQuickReply(DESIGN_FEEDBACK_QUICK_REPLY)
        } catch (e) {
            console.error('사진 기반 디자인 생성 실패:', e)
            pushAssistant('이미지 생성에 실패했습니다. 다시 시도해 주세요.')
            setActiveQuickReply(MENU_QUICK_REPLY)
            setMode('menu')
        } finally {
            setIsSending(false)
        }
    }

    // ── 메뉴 선택 ──────────────────────────────────────────────────────────
    const handleMenuSelect = (option: QuickReplyOption) => {
        pushUser(option.label)
        setActiveQuickReply(null)
        reviseLogRef.current = [] // 새 생성 방식을 고르는 시점 = 새 디자인 흐름 시작이므로, 이전 수정 요청 기록은 비운다

        switch (option.value) {
            case 'preference': {
                setMode('preference')
                setPreferenceStepIndex(0)
                setCollectedPreferences(INITIAL_PREFERENCES)
                pushAssistant('좋아요! 몇 가지만 골라주시면 바로 디자인을 만들어드릴게요.')
                setActiveQuickReply(buildPreferenceQuickReply(PREFERENCE_STEPS[0]))
                break
            }
            case 'freeform': {
                setMode('freeform')
                freeformLogRef.current = []
                setSelectedInQuickReply([]) // 새 자유입력 세션 시작 — 이전 세션에서 고르던 색이 섞이지 않게 초기화
                pushAssistant('네일 아트에 대해 자유롭게 이야기해주세요! 원하는 색감, 스타일, 무드 등 무엇이든 좋아요 😊')
                break
            }
            case 'photo': {
                setMode('photo')
                setSelectedPhotoFile(null)
                setSelectedPhotoPreviewUrl(null)
                setRandomPhotoShapeId(null)
                if (!scanId) {
                    pushAssistant(
                        '원하는 스타일의 참고 사진을 올려주세요!\n스캔 정보가 있으면 어울리는 네일팁 모양과 함께 만들 수 있어요! 스캔 싫으시면 랜덤 팁 모양으로 만들어드려요.',
                    )
                    setActiveQuickReply({
                        id: `photo-scan-choice-${makeId()}`,
                        question: '네일팁 모양은 어떻게 할까요?',
                        options: [
                            { value: '__go_to_scan__', label: '📷 스캔하러 가기' },
                            { value: '__continue_photo_random__', label: '🎲 랜덤 모양으로 진행하기' },
                        ],
                        multi: false,
                        limit: 1,
                        layout: 'list',
                    })
                    break
                }
                pushAssistant(
                    '원하는 스타일의 참고 사진을 올려주세요! 손 스캔 정보를 반영해서 어울리는 네일팁 모양과 함께 만들어드릴게요.',
                )
                setActiveQuickReply(PHOTO_UPLOAD_QUICK_REPLY)
                break
            }
            case 'scan-auto': {
                setMode('scan-auto')
                if (!scanId) {
                    pushAssistant('아직 손 스캔 정보가 없어서 이 방식으로는 디자인을 만들 수 없어요. 먼저 손 스캔을 진행해 주세요!')
                    setActiveQuickReply({
                        id: `scan-required-${makeId()}`,
                        question: '스캔 정보가 필요해요',
                        options: [
                            { value: '__go_to_scan__', label: '📷 스캔하러 가기' },
                            { value: '__back_to_menu__', label: '💬 다른 방법으로 진행하기' },
                        ],
                        multi: false,
                        limit: 1,
                        layout: 'list',
                    })
                    break
                }
                pushAssistant('내 손 스캔 정보를 바탕으로 어울리는 디자인을 자동으로 만들어드릴게요.')
                void runGenerateDesign(INITIAL_PREFERENCES, 'scan-auto')
                break
            }
        }
    }

    // ── 선택지 기반 흐름 ───────────────────────────────────────────────────
    // motif 단계의 "없음"은 다른 모티프와 동시에 선택될 수 없다.
    const MOTIF_NONE_VALUE = '없음' // designPreferences.ts의 motif "없음" 항목 value와 일치

    const toggleQuickReplyValue = (value: string) => {
        if (!activeQuickReply) return
        if (!activeQuickReply.multi) {
            handlePreferenceSingleSelect(value)
            return
        }

        const isMotifStep = activeQuickReply.id === 'pref-motif'

        setSelectedInQuickReply((prev) => {
            if (prev.includes(value)) return prev.filter((v) => v !== value)

            let next = prev
            if (isMotifStep) {
                if (value === MOTIF_NONE_VALUE) {
                    // "없음"을 고르면 기존에 골라둔 다른 모티프는 전부 해제한다.
                    return [MOTIF_NONE_VALUE]
                }
                if (prev.includes(MOTIF_NONE_VALUE)) {
                    // 이미 "없음"이 선택된 상태에서 다른 모티프를 고르면, "없음"부터 뺀다.
                    next = prev.filter((v) => v !== MOTIF_NONE_VALUE)
                }
            }

            if (activeQuickReply.limit != null && next.length >= activeQuickReply.limit) {
                return [...next.slice(1), value]
            }
            return [...next, value]
        })
    }

    const handlePreferenceSingleSelect = (value: string) => {
        confirmPreferenceStep([value])
    }

    // 특정 단계로 이동하면서, 그 단계에 이미 답한 값이 있으면 선택 상태를 복원한다.
    // (뒤로 갔다가 다시 앞으로 넘어올 때, 이미 골랐던 값이 사라지지 않도록 하기 위함)
    const goToPreferenceStep = (index: number, preferences: NailDesignPreferences) => {
        const step = PREFERENCE_STEPS[index]
        const quickReply = buildPreferenceQuickReply(step)
        const previousValues = preferences[step] ?? []

        setSelectedInQuickReply(quickReply.multi ? previousValues : [])
        setPreferenceStepIndex(index)
        setActiveQuickReply(quickReply)
    }

    const confirmPreferenceStep = (values: string[]) => {
        const step = PREFERENCE_STEPS[preferenceStepIndex]
        const bubbleId =
            step === 'color'
                ? pushUserColors(`${PREFERENCE_SECTION_LABELS.color}:`, values)
                : pushUser(
                    `${PREFERENCE_SECTION_LABELS[step]}: ${
                        values
                            .map((v) => PREFERENCE_OPTIONS[step].find((o) => o.value === v)?.label ?? v)
                            .join(', ') || '선택 안 함'
                    }`,
                )
        // 이 단계에서 만들어진 말풍선 id를 기록해 둔다 (뒤로가기 시 정확히 이 버블만 지우기 위함)
        setPreferenceStepBubbleIds((prev) => ({ ...prev, [preferenceStepIndex]: bubbleId }))

        const updated: NailDesignPreferences = {
            ...collectedPreferences,
            [step]: values,
        }
        setCollectedPreferences(updated)

        const nextIndex = preferenceStepIndex + 1
        if (nextIndex < PREFERENCE_STEPS.length) {
            goToPreferenceStep(nextIndex, updated)
        } else {
            setSelectedInQuickReply([])
            setActiveQuickReply(null)
            pushAssistant('선택 감사해요! 이 내용으로 디자인을 생성할게요.')
            void finalizePreferenceDesign(updated)
        }
    }

    // 선택지 기반 흐름에서 "뒤로가기" — 이전 단계로 돌아가서 그 단계의 답변을 다시 선택할 수 있게 한다.
    // 그때 남겼던 말풍선은 지우고, 다시 확인(confirmPreferenceStep)하면 새 말풍선과 새 값으로 덮어써진다.
    const goToPreviousPreferenceStep = () => {
        const targetIndex = preferenceStepIndex - 1
        if (targetIndex < 0) return

        const bubbleIdToRemove = preferenceStepBubbleIds[targetIndex]
        if (bubbleIdToRemove) {
            setBubbles((prev) => prev.filter((bubble) => bubble.id !== bubbleIdToRemove))
        }

        // 지금 단계에서 "다음"을 안 눌러도, 고르고 있던 값을 임시로 저장해서
        // 나중에 이 단계로 다시 돌아왔을 때 사라지지 않게 한다.
        const currentStep = PREFERENCE_STEPS[preferenceStepIndex]
        const updatedPreferences: NailDesignPreferences = {
            ...collectedPreferences,
            [currentStep]: selectedInQuickReply,
        }
        setCollectedPreferences(updatedPreferences)

        goToPreferenceStep(targetIndex, updatedPreferences)
    }

    const finalizePreferenceDesign = async (preferences: NailDesignPreferences) => {
        if (!sessionId) {
            pushAssistant('채팅 세션이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.')
            return
        }

        // 선택지에서 고른 내용을 자연어 문장으로 조립해서, 실제 Gemini와 연동된
        // /chats/{sessionId}/messages(sendChatMessage)로 전송한다.
        // 예전에는 /chats/{sessionId}/preferences(savePreferences, 레거시 API)를 호출했는데,
        // 이 엔드포인트는 더 이상 백엔드의 SlotData 기반 슬롯 시스템과 연결되어 있지 않아서
        // 여기서 고른 shape/color/season 등이 최종 프롬프트에 반영되지 않는 문제가 있었다.
        const summaryMessage = [
            preferences.mood?.length ? `무드는 ${preferences.mood.join(', ')}` : null,
            preferences.designType?.length ? `디자인 타입은 ${preferences.designType.join(', ')}` : null,
            preferences.season?.length ? `계절은 ${preferences.season.join(', ')}` : null,
            preferences.motif?.length ? `모티프는 ${preferences.motif.join(', ')}` : null,
            preferences.shape?.length ? `쉐입은 ${preferences.shape.join(', ')}` : null,
            preferences.color?.length ? `컬러는 ${preferences.color.join(', ')}` : null,
        ]
            .filter(Boolean)
            .join(', ') + '로 해주세요.'

        try {
            await sendChatMessage(sessionId, summaryMessage)
        } catch {
            // 전송 실패해도 스캔 기반 기본값으로 계속 진행
        }
        await runGenerateDesign(preferences, 'preference')
    }

    // ── 자유 입력(Gemini 채팅) 흐름 ────────────────────────────────────────
    const handleDesignFeedback = (option: QuickReplyOption) => {
        pushUser(option.label)
        setActiveQuickReply(null)

        if (option.value === 'accept') {
            if (!lastDesign) return
            confirmDesign(lastDesign.designId).catch((err) => {
                // 확정 API가 실패해도 결과 화면 이동 자체는 막지 않되, 콘솔에는 남긴다
                console.error('디자인 확정(confirm) 실패:', err)
            })
            navigate('/design/result', {
                state: {
                    designId: lastDesign.designId,
                    imageUrls: lastDesign.imageUrls,
                    preferences: lastDesign.preferences,
                    prompt: lastDesign.prompt,
                    shapeId: lastDesign.shapeId,
                    details: lastDesign.details,
                    context: lastDesign.context,
                },
            })
            return
        }

        // revise
        setMode('revise')
        pushAssistant(
            '어떤 부분을 수정하고 싶으신지 자유롭게 말씀해 주세요! 예) "컬러를 더 밝게 해줘", "글리터 대신 무광으로", "하트 모티프를 빼줘"',
        )
    }

    const handleReviseSubmit = async (text: string) => {
        if (!sessionId) {
            pushAssistant('채팅 세션이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.')
            return
        }
        reviseLogRef.current.push(text)
        setIsSending(true)
        try {
            await refineKeywords(sessionId, text)
        } catch {
            // 키워드 추출 실패해도 기존 선호도 기준으로 재생성 시도
        }

        if (lastDesign?.source === 'photo' && selectedPhotoFile) {
            await runGenerateDesignFromPhoto(selectedPhotoFile)
        } else {
            await runGenerateDesign(lastDesign?.preferences ?? collectedPreferences, lastDesign?.source ?? 'freeform')
        }
    }

    // ── 사진 기반 흐름 ─────────────────────────────────────────────────────
    const handlePhotoFileChange = (file: File | null) => {
        if (!file) return
        if (selectedPhotoPreviewUrl) URL.revokeObjectURL(selectedPhotoPreviewUrl)
        setSelectedPhotoFile(file)
        setSelectedPhotoPreviewUrl(URL.createObjectURL(file))
    }

    const handlePhotoConfirm = () => {
        if (!selectedPhotoFile || !selectedPhotoPreviewUrl) return
        setActiveQuickReply(null)
        setBubbles((prev) => [
            ...prev,
            { id: makeId(), role: 'user', text: '이 사진으로 만들어줘', imageUrls: [selectedPhotoPreviewUrl] },
        ])
        void runGenerateDesignFromPhoto(selectedPhotoFile)
    }

    const handleFreeformGenerate = () => {
        setActiveQuickReply(null)
        const freeText = freeformLogRef.current.join('. ')
        // 대화 중에 백엔드(chat())가 이미 session.extractedPreferences를 채워두므로
        // 별도 refineKeywords 호출 없이 바로 생성 (buildFinalPrompt 1순위로 그대로 사용됨)
        void runGenerateDesign({ ...INITIAL_PREFERENCES, freeText }, 'freeform')
    }

    const sendFreeformMessage = async (text: string) => {
        if (!sessionId) {
            pushAssistant('채팅 세션이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.')
            return
        }
        freeformLogRef.current.push(text)
        setIsSending(true)
        try {
            const res = await sendChatMessage(sessionId, text)
            pushAssistant(res.reply)

            if (res.isComplete) {
                // 취향 파악이 끝났다고 봇이 이미 안내했으니, 말한 대로 바로 생성 시작
                handleFreeformGenerate()
                return
            }

            const suggestionOptions =
                res.showOptions && res.options.length > 0
                    ? res.options.map((label) => ({ value: label, label, colorHexes: res.optionColors?.[label] }))
                    : []

            // 컬러/쉐입을 물어보는 차례라면, Gemini가 준 텍스트 선택지 뒤에
            // "고정 UI로 직접 고르기" 옵션을 하나 더 붙여준다.
            const pickerOption =
                res.nextQuestionTarget === 'color'
                    ? [{ value: '__color_picker__', label: '🎨 컬러피커에서 직접 선택하기' }]
                    : res.nextQuestionTarget === 'shape'
                        ? [{ value: '__shape_picker__', label: '💅 쉐입 이미지로 직접 선택하기' }]
                        : []

            setFreeformColorPickerOpen(false)
            setFreeformShapePickerOpen(false)

            const combinedOptions = [...suggestionOptions, ...pickerOption]
            if (combinedOptions.length > 0) {
                setActiveQuickReply({
                    id: `freeform-actions-${makeId()}`,
                    question: '이런 느낌은 어때요? 직접 입력하셔도 좋아요',
                    options: combinedOptions,
                    multi: false,
                    limit: 1,
                    layout: 'list',
                })
            } else {
                // Gemini의 답변 문구(완료됐다/시작할까요? 등)를 일일이 맞춰서 감지하는 대신,
                // "더 이상 보여줄 선택지가 없다" 그 자체를 신호로 삼는다.
                // isComplete가 true로 안 왔어도, 물어볼 게 없다는 건 사실상 대화가 끝났다는 뜻이므로
                // 사용자가 바로 생성할지 더 얘기할지 선택할 수 있게 한다.
                setActiveQuickReply({
                    id: `freeform-actions-${makeId()}`,
                    question: '바로 생성해드릴까요?',
                    options: [
                        { value: '__generate__', label: '✅ 네, 바로 생성해주세요' },
                        { value: '__continue__', label: '💬 아직 더 얘기하고 싶어요' },
                    ],
                    multi: false,
                    limit: 1,
                    layout: 'list',
                })
            }
        } catch (e) {
            const msg = e instanceof ApiError ? e.message : '메시지 전송에 실패했어요. 다시 시도해 주세요.'
            pushAssistant(msg)
        } finally {
            setIsSending(false)
        }
    }

    // 자유입력 중 "선택지 기반으로 바꿔줘" 같은 뉘앙스를 감지해서, Gemini에게 물어보지 않고
    // 곧바로 우리가 만든 선택지 기반(PREFERENCE_STEPS) 흐름으로 전환한다.
    const isPreferenceModeSwitchIntent = (text: string) => {
        const normalized = text.replace(/\s/g, '')
        return /선택지/.test(normalized) && /(기반|방식|으로|바꿔|바꾸|할래|하고싶)/.test(normalized)
    }

    // handleMenuSelect의 'preference' 케이스와 동일한 화면 전환 (사용자 말풍선은 이미 별도로 쌓았으므로 여기선 안 쌓음)
    const switchToPreferenceMode = () => {
        setMode('preference')
        setPreferenceStepIndex(0)
        setCollectedPreferences(INITIAL_PREFERENCES)
        pushAssistant('좋아요! 몇 가지만 골라주시면 바로 디자인을 만들어드릴게요.')
        setActiveQuickReply(buildPreferenceQuickReply(PREFERENCE_STEPS[0]))
    }

    // ── 입력창 ─────────────────────────────────────────────────────────────
    const handleSubmitInput = () => {
        const text = inputValue.trim()
        if (!text || isSending) return
        setInputValue('')
        setActiveQuickReply(null)
        requestAnimationFrame(() => {
            if (textareaRef.current) textareaRef.current.style.height = `${INPUT_MIN_HEIGHT}px`
        })

        if (mode === 'revise') {
            pushUser(text)
            void handleReviseSubmit(text)
            return
        }

        pushUser(text)

        if (mode === 'freeform' && isPreferenceModeSwitchIntent(text)) {
            switchToPreferenceMode()
            return
        }

        if (mode !== 'freeform') setMode('freeform')
        void sendFreeformMessage(text)
    }

    const handleQuickReplyClick = (option: QuickReplyOption) => {
        if (isSending) return
        if (option.value === '__go_to_scan__') {
            navigate('/process')
            return
        }
        if (option.value === '__back_to_menu__') {
            pushUser(option.label)
            setMode('menu')
            pushAssistant('알겠어요! 다른 방식으로 진행해볼까요?')
            setActiveQuickReply(MENU_QUICK_REPLY)
            return
        }
        if (option.value === '__continue_photo_random__') {
            pushUser(option.label)
            const shapeOptions = PREFERENCE_OPTIONS.shape
            const randomShape = shapeOptions[Math.floor(Math.random() * shapeOptions.length)]
            setRandomPhotoShapeId(randomShape.value as NailShapeId)
            pushAssistant('알겠어요! 팁 모양은 랜덤하게 정해서 만들어드릴게요. 참고하고 싶은 사진을 올려주세요 🎨')
            setActiveQuickReply(PHOTO_UPLOAD_QUICK_REPLY)
            return
        }
        if (activeQuickReply?.id === 'menu') {
            handleMenuSelect(option)
            return
        }
        if (activeQuickReply?.id === 'design-feedback') {
            handleDesignFeedback(option)
            return
        }
        if (activeQuickReply?.id.startsWith('pref-')) {
            toggleQuickReplyValue(option.value)
            return
        }
        if (activeQuickReply?.id.startsWith('freeform-generate')) {
            handleFreeformGenerate()
            return
        }
        if (activeQuickReply?.id.startsWith('freeform-actions')) {
            if (option.value === '__generate__') {
                setActiveQuickReply(null)
                pushUser(option.label)
                handleFreeformGenerate()
                return
            }
            if (option.value === '__continue__') {
                setActiveQuickReply(null)
                pushUser(option.label)
                return
            }
            if (option.value === '__color_picker__') {
                setFreeformColorPickerOpen(true)
                setIsQuickReplyCollapsed(false)
                return
            }
            if (option.value === '__shape_picker__') {
                setFreeformShapePickerOpen(true)
                setIsQuickReplyCollapsed(false)
                return
            }
            const isHexColor = /^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/.test(option.label.trim())
            setActiveQuickReply(null)
            if (isHexColor) {
                pushUserColors('', [option.label.trim()])
            } else {
                pushUser(option.label)
            }
            void sendFreeformMessage(option.label)
            return
        }
    }

    // 컬러피커/쉐입피커에서 "뒤로가기" — 처음 봤던 추천 선택지 목록으로 돌아간다.
    // 지금까지 고른 색상/쉐입은 그대로 유지한다 (뒤로갔다 다시 들어와도 선택 내용이 남아있도록).
    const closeFreeformPicker = () => {
        setFreeformColorPickerOpen(false)
        setFreeformShapePickerOpen(false)
    }

    const toggleFreeformColor = (hex: string) => {
        setSelectedInQuickReply((prev) => (prev.includes(hex) ? prev.filter((v) => v !== hex) : [...prev, hex]))
    }

    // 지금까지 담은 색상들을 한 번에 확정해서 Gemini에게 전송한다.
    const handleFreeformColorPickerConfirm = () => {
        if (selectedInQuickReply.length === 0) return
        const hexes = [...selectedInQuickReply]
        setFreeformColorPickerOpen(false)
        setSelectedInQuickReply([])
        setActiveQuickReply(null)
        pushUserColors('', hexes)
        void sendFreeformMessage(hexes.join(', '))
    }

    // 자유입력 흐름에서 쉐입 이미지로 직접 고른 값을 확정한다.
    const handleFreeformShapeSelect = (label: string) => {
        setFreeformShapePickerOpen(false)
        setActiveQuickReply(null)
        pushUser(label)
        void sendFreeformMessage(label)
    }

    // 손 스캔 정보가 없어도 패널은 열 수 있게 하고, 그 안에서 빈 상태(안내 + 촬영 CTA)를 보여준다.
    const handleToggleAnalysisPanel = () => {
        setShowAnalysisPanel((prev) => !prev)
    }

    // 사이드바 드롭다운에서 다른 분석 결과(세션)를 골랐을 때 — 그 세션의 실제 데이터를 다시 받아온다.
    const handleSelectSession = async (session: ScanSession) => {
        if (session.key === selectedSessionKey) return
        const { leftRes, rightRes } = await fetchSessionAnalysis(session)
        setLeftAnalysis(leftRes)
        setRightAnalysis(rightRes)
        setScanId(session.leftScanId ?? session.rightScanId ?? null)
        setScanHandSide(leftRes ? 'LEFT' : rightRes ? 'RIGHT' : null)
        setSelectedSessionKey(session.key)
    }

    const analysisSummary = useMemo(() => {
        if (!leftAnalysis && !rightAnalysis) return null

        // 손 분석 결과 화면과 동일하게: 왼손 5손가락 + 오른손 5손가락 = 10손가락 실측 평균
        const combinedFingers = [...(leftAnalysis?.fingers ?? []), ...(rightAnalysis?.fingers ?? [])]

        const details = combinedFingers.map((finger) => {
            let measurements: { lengthMm?: number; length?: number; widthMm?: number; width?: number; cCurveMm?: number; cCurve?: number; curve?: number } = {}
            try {
                measurements = JSON.parse(finger.measurements ?? '{}') || {}
            } catch {
                measurements = {}
            }
            // 실제 스캔 파이프라인(scan/server.py) 필드명은 cCurveMm — cCurve/curve는 옛 목업 호환용
            return {
                lengthMm: Number(measurements.lengthMm ?? measurements.length ?? 12),
                widthMm: Number(measurements.widthMm ?? measurements.width ?? 9),
                cCurve: Number(measurements.cCurveMm ?? measurements.cCurve ?? measurements.curve ?? 0.55),
            }
        })

        const avg = (nums: number[]) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0)
        const avgLength = Number(avg(details.map((d) => d.lengthMm)).toFixed(1))
        const avgWidth = Number(avg(details.map((d) => d.widthMm)).toFixed(1))
        const avgCurve = Number(avg(details.map((d) => d.cCurve)).toFixed(2))

        // 시즌/쉐입은 왼손을 우선하고, 없으면 오른손 값을 사용.
        // shape는 출력 신청 시 유저가 고른 쉐입으로 덮어써질 수 있어서, "추천" 배지/문구는
        // 반드시 recommendedShape를 써야 한다 (ScanResultResponse 타입 주석 참고)
        const seasonNameKo = leftAnalysis?.seasonNameKo ?? rightAnalysis?.seasonNameKo ?? null
        const seasonCode = leftAnalysis?.seasonCode ?? rightAnalysis?.seasonCode ?? null
        const shapeId = leftAnalysis?.recommendedShape ?? rightAnalysis?.recommendedShape ?? null
        const shapeInfo = shapeId ? getNailShape(shapeId) : undefined
        const skinToneHex = leftAnalysis?.skinToneHex ?? rightAnalysis?.skinToneHex ?? null

        // 손 분석 결과 화면과 동일한 기준값으로 막대 위치·비교 문구를 계산한다
        const lengthPct = percentileAgainstBaseline(avgLength, NAIL_BASELINE.length)
        const widthPct = percentileAgainstBaseline(avgWidth, NAIL_BASELINE.width)
        const curvePct = percentileAgainstBaseline(avgCurve, NAIL_BASELINE.cCurve)

        return {
            seasonNameKo: seasonNameKo || '분석 중',
            seasonCode,
            shapeId,
            shapeLabel: shapeInfo ? shapeInfo.labelKo : shapeId || '분석 중',
            shapeImage: shapeInfo?.image ?? null,
            avgLength,
            avgWidth,
            avgCurve,
            lengthPct,
            widthPct,
            curvePct,
            lengthCompareLabel: labelByPercentile(lengthPct, '평균보다 짧은 편', '평균보다 긴 편', '평균과 비슷함'),
            widthCompareLabel: labelByPercentile(widthPct, '좁은 편', '넓은 편', '평균과 비슷함'),
            curveCompareLabel: labelByPercentile(curvePct, '완만한 편', '뚜렷한 편', '평균 범위'),
            skinToneHex,
            skinToneAnalysis: skinToneHex ? analyzeSkinTone(skinToneHex) : null,
            skinTonePalette: skinToneHex ? generateSkinTonePalette(skinToneHex, 24) : [],
        }
    }, [leftAnalysis, rightAnalysis])

    const [manualSeasonCode, setManualSeasonCode] = useState<string>(chatSessionSnapshot?.manualSeasonCode ?? 'spring_light')

    const detectedSeasonCode = leftAnalysis?.seasonCode || rightAnalysis?.seasonCode || null
    const activeSeasonCode = detectedSeasonCode || manualSeasonCode

    const personalPalette = useMemo(() => {
        return PERSONAL_COLOR_SWATCHES[activeSeasonCode] ?? PERSONAL_COLOR_SWATCHES.spring_light
    }, [activeSeasonCode])

    // 컬러 선택 단계에서 실제로 보여줄 팔레트 — 스캔 정보(대표 피부색)가 있으면 거기서 뽑은
    // "나와 어울리는 컬러" 24색을, 없으면 퍼스널컬러(직접 고르거나 자동 감지된 계절)별 팔레트를 쓴다.
    const scanColorPalette = analysisSummary?.skinTonePalette ?? []
    const hasScanColorPalette = scanColorPalette.length > 0
    const colorPickerPalette = hasScanColorPalette ? scanColorPalette : personalPalette

    const isMultiConfirmVisible = useMemo(
        () => !!activeQuickReply?.multi && selectedInQuickReply.length > 0,
        [activeQuickReply, selectedInQuickReply],
    )

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
                                        {userName ? `${userName} 님의` : '회원님의'} 손 스캔 정보를 바탕으로 디자인을 생성하시고 싶다면,
                                        먼저 손 촬영을 진행해 주세요.
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

                                {(activeQuickReply.id === 'pref-color' ||
                                        (activeQuickReply.id.startsWith('freeform-actions') && freeformColorPickerOpen)) &&
                                    !hasScanColorPalette && (
                                        <SeasonDropdown value={manualSeasonCode} onChange={setManualSeasonCode} disabled={isSending} />
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
                                                detectedSeasonCode && (
                                                    <p className="design-chat__color-picker-label">내 퍼스널컬러 팔레트</p>
                                                )
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
                                                detectedSeasonCode && (
                                                    <p className="design-chat__color-picker-label">내 퍼스널컬러 팔레트</p>
                                                )
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