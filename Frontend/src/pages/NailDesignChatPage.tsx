import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { getMyProfile } from '@/apis/user'
import { getLatestScanResult, getScanResult, type ScanResultResponse } from '@/apis/scan'
import {
    createChatSession,
    sendChatMessage,
    savePreferences,
    refineKeywords,
} from '@/apis/chat'
import { generateDesign, generateDesignFromImage, type DesignExtractedDetails } from '@/apis/design'
import { getNailShape, type NailShapeId } from '@/constants/nailShapes'
import { NailPreview3D } from '@/components/nail3d/NailPreview3D'
import {
    INITIAL_PREFERENCES,
    PREFERENCE_OPTIONS,
    PREFERENCE_SECTION_LABELS,
    PERSONAL_COLOR_SWATCHES,
    SEASON_ROWS,
    SHAPE_PREVIEW_IMAGES,
    type NailDesignPreferences,
    type PreferenceKey,
} from '@/constants/designPreferences'
import { ApiError } from '@/utils/apiClient'
import { registerChatSessionGuard, confirmLeaveChatIfNeeded } from '@/utils/chatSessionGuard'
import '@/styles/design-chat.css'
import '@/styles/nail-design.css'

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

type GeneratedDesign = {
    designId: number
    imageUrls: string[]
    prompt: string
    preferences: NailDesignPreferences
    source: GenerationSource
    shapeId: NailShapeId
    details?: DesignExtractedDetails
}

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
                    </div>,
                    document.body,
                )}
        </div>
    )
}

function makeId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

    const [userName, setUserName] = useState('')
    const [isInitReady, setIsInitReady] = useState(false)
    const [sessionId, setSessionId] = useState<number | null>(null)
    const [scanId, setScanId] = useState<number | null>(null)
    const [scanHandSide, setScanHandSide] = useState<'LEFT' | 'RIGHT' | null>(null)

    const [bubbles, setBubbles] = useState<ChatBubble[]>([])
    const [activeQuickReply, setActiveQuickReply] = useState<QuickReply | null>(null)
    // "네, 바로 생성해주세요 / 아직 더 얘기하고 싶어요" 확인 화면이 떠 있는 동안엔
    // 자유 텍스트 입력을 막는다 — 안 그러면 아무 텍스트나 쳤을 때 "수정 요청"으로
    // 오인돼서 의도치 않게 디자인이 재생성되는 문제가 있었다.
    const isAwaitingGenerateConfirm =
        activeQuickReply?.id === 'design-feedback' ||
        !!activeQuickReply?.options?.some((o) => o.value === '__generate__')
    const [selectedInQuickReply, setSelectedInQuickReply] = useState<string[]>([])

    const [mode, setMode] = useState<Mode>('menu')
    const [preferenceStepIndex, setPreferenceStepIndex] = useState(0)
    const [preferenceStepBubbleIds, setPreferenceStepBubbleIds] = useState<Record<number, string>>({})
    const [collectedPreferences, setCollectedPreferences] = useState<NailDesignPreferences>(
        INITIAL_PREFERENCES,
    )
    const freeformLogRef = useRef<string[]>([])
    const [lastDesign, setLastDesign] = useState<GeneratedDesign | null>(null)
    const [generationSource, setGenerationSource] = useState<GenerationSource>('scan-auto')
    const [selectedPhotoFile, setSelectedPhotoFile] = useState<File | null>(null)
    const [selectedPhotoPreviewUrl, setSelectedPhotoPreviewUrl] = useState<string | null>(null)
    const photoInputRef = useRef<HTMLInputElement | null>(null)

    const [inputValue, setInputValue] = useState('')
    const [isSending, setIsSending] = useState(false)
    const [customColor, setCustomColor] = useState('#DE869F')
    const [isQuickReplyCollapsed, setIsQuickReplyCollapsed] = useState(false)
    // 자유입력(Gemini) 흐름에서 "컬러/쉐입은 고정 UI로 고르고 싶을 때"를 위한 보조 픽커
    const [freeformColorPickerOpen, setFreeformColorPickerOpen] = useState(false)
    const [freeformShapePickerOpen, setFreeformShapePickerOpen] = useState(false)

    const [showAnalysisPanel, setShowAnalysisPanel] = useState(false)
    const [preview3DImage, setPreview3DImage] = useState<string | null>(null)
    const [leftAnalysis, setLeftAnalysis] = useState<ScanResultResponse | null>(null)
    const [rightAnalysis, setRightAnalysis] = useState<ScanResultResponse | null>(null)

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
        let cancelled = false

        const init = async () => {
            try {
                const profile = await getMyProfile()
                if (!cancelled) setUserName(profile.nickname || profile.name)
            } catch {
                // 이름 못 가져와도 진행
            }

            try {
                if (navState?.leftScanId || navState?.rightScanId) {
                    const [leftRes, rightRes] = await Promise.all([
                        navState.leftScanId ? getScanResult(navState.leftScanId).catch(() => null) : Promise.resolve(null),
                        navState.rightScanId ? getScanResult(navState.rightScanId).catch(() => null) : Promise.resolve(null),
                    ])
                    if (!cancelled) {
                        setLeftAnalysis(leftRes)
                        setRightAnalysis(rightRes)
                        const primaryScanId =
                            navState.scanId ?? navState.leftScanId ?? navState.rightScanId ?? leftRes?.scanId ?? rightRes?.scanId ?? null
                        setScanId(primaryScanId)
                        setScanHandSide(leftRes ? 'LEFT' : rightRes ? 'RIGHT' : null)
                    }
                } else {
                    const scan = await getLatestScanResult()
                    if (!cancelled) {
                        setScanId(scan.scanId)
                        setScanHandSide(scan.handSide === 'LEFT' ? 'LEFT' : 'RIGHT')
                        if (scan.handSide === 'LEFT') setLeftAnalysis(scan)
                        else setRightAnalysis(scan)
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
        if (!isInitReady) return
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

    // 채팅 중 새로고침/탭 닫기 방지: 세션이 있고 대화가 어느 정도 진행됐을 때만 경고
    // (주의: "지금 세션이 날라갑니다 괜찮나요?" 같은 커스텀 문구는 브라우저 보안 정책상
    //  최신 브라우저에서 표시가 안 되고, 브라우저 기본 확인 문구만 뜬다. 확인창 자체는 뜸.)
    useEffect(() => {
        if (!sessionId || !bubbles.some((b) => b.role === 'user')) return

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault()
            e.returnValue = '' // 크롬 등 일부 브라우저는 빈 문자열 지정이 필요함
        }

        window.addEventListener('beforeunload', handleBeforeUnload)
        return () => window.removeEventListener('beforeunload', handleBeforeUnload)
    }, [sessionId, bubbles])

    // 채팅 중 상단 nav(scan/design 등) 클릭으로 앱 내부 이동할 때 방지
    // — beforeunload와 달리 이건 우리가 직접 만든 확인창이라 문구를 자유롭게 쓸 수 있다.
    useEffect(() => {
        registerChatSessionGuard(() => {
            const hasUserActivity = bubbles.some((b) => b.role === 'user')
            if (!sessionId || !hasUserActivity) return true

            const hasGeneratedDesign = bubbles.some((b) => b.isDesignResult)
            const message = hasGeneratedDesign
                ? '이미 생성된 디자인은 저장돼요. 다만 지금 나가면 여기까지 나눈 대화 내용은 사라져요. 그래도 나가시겠어요?'
                : '지금 나가면 진행 중인 채팅 내용이 저장되지 않아요. 그래도 나가시겠어요?'

            return window.confirm(message)
        })
        return () => registerChatSessionGuard(null)
    }, [sessionId, bubbles])

    // 브라우저 기본 "뒤로가기" 버튼 방지
    // — 클릭 이벤트가 아니라 history의 popstate라서 위 두 방식과는 다른 트릭이 필요하다.
    // 활성화되는 순간 현재 URL을 한 번 더 쌓아둬서(더미 엔트리), 사용자가 뒤로가기를
    // 눌러도 처음엔 그 더미만 소비되고 실제 페이지 이동은 안 일어나게 만든 다음,
    // 그 시점에 발생하는 popstate 이벤트를 가로채서 확인창을 띄운다.
    const hasUserActivity = bubbles.some((b) => b.role === 'user') // 매 렌더 재계산되지만 boolean이라 값이 안 바뀌면 deps 비교상 그대로 취급됨
    useEffect(() => {
        if (!sessionId || !hasUserActivity) return

        window.history.pushState(null, '', window.location.href)

        const handlePopState = () => {
            if (confirmLeaveChatIfNeeded()) {
                // 진짜로 나가는 것을 허용 — 리스너를 먼저 떼어내고 한 번 더 뒤로가기를 보내서
                // 이번엔 우리가 아까 쌓아둔 더미 엔트리 말고 실제 이전 페이지로 이동시킨다.
                window.removeEventListener('popstate', handlePopState)
                window.history.back()
            } else {
                // 취소했으면 다시 더미 엔트리를 쌓아서, 다음 뒤로가기도 이 핸들러가 잡게 한다.
                window.history.pushState(null, '', window.location.href)
            }
        }

        window.addEventListener('popstate', handlePopState)
        return () => window.removeEventListener('popstate', handlePopState)
        // hasUserActivity가 false→true로 "바뀔 때"만 새로 설치되도록, bubbles 배열이 아니라
        // 이 boolean 값 자체를 deps로 둔다 (매 메시지마다 더미 엔트리가 계속 쌓이는 것 방지).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, hasUserActivity])

    // ── 공통: 디자인 생성 후 이동 ───────────────────────────────────────────
    const resolveShapeId = (preferences: NailDesignPreferences): NailShapeId => {
        const fromPrefs = preferences.shape[0]
        const fromScan = leftAnalysis?.shape || rightAnalysis?.shape
        return (fromPrefs || fromScan || 'oval') as NailShapeId
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
            setLastDesign({
                designId: data.designId,
                imageUrls: data.imageUrls,
                prompt: data.generatedPrompt,
                preferences,
                source,
                shapeId: resolveShapeId(preferences),
                details: data.details,
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
                shapeId: resolveShapeId(INITIAL_PREFERENCES),
                details: data.details,
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
                pushAssistant(
                    '원하는 스타일의 참고 사진을 올려주세요! 제 손 스캔 정보가 있다면 함께 반영해서 만들어드릴게요.',
                )
                setActiveQuickReply(PHOTO_UPLOAD_QUICK_REPLY)
                break
            }
            case 'scan-auto': {
                setMode('scan-auto')
                pushAssistant(
                    scanId
                        ? '내 손 스캔 정보를 바탕으로 어울리는 디자인을 자동으로 만들어드릴게요.'
                        : '아직 손 스캔 정보가 없어서, 기본 추천값으로 디자인을 만들어드릴게요.',
                )
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
            navigate('/design/result', {
                state: {
                    designId: lastDesign.designId,
                    imageUrls: lastDesign.imageUrls,
                    preferences: lastDesign.preferences,
                    prompt: lastDesign.prompt,
                    shapeId: lastDesign.shapeId,
                    details: lastDesign.details,
                    leftScanId: leftAnalysis?.scanId ?? null,
                    rightScanId: rightAnalysis?.scanId ?? null,
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

    const handleToggleAnalysisPanel = () => {
        if (!leftAnalysis && !rightAnalysis) {
            pushAssistant('아직 손 스캔 결과가 없어요. 먼저 손 촬영을 진행해 주세요.')
            return
        }
        setShowAnalysisPanel((prev) => !prev)
    }

    const analysisSummary = useMemo(() => {
        if (!leftAnalysis && !rightAnalysis) return null

        // 손 분석 결과 화면과 동일하게: 왼손 5손가락 + 오른손 5손가락 = 10손가락 실측 평균
        const combinedFingers = [...(leftAnalysis?.fingers ?? []), ...(rightAnalysis?.fingers ?? [])]

        const details = combinedFingers.map((finger) => {
            let measurements: { lengthMm?: number; length?: number; widthMm?: number; width?: number; cCurve?: number; curve?: number } = {}
            try {
                measurements = JSON.parse(finger.measurements ?? '{}') || {}
            } catch {
                measurements = {}
            }
            return {
                lengthMm: Number(measurements.lengthMm ?? measurements.length ?? 12),
                widthMm: Number(measurements.widthMm ?? measurements.width ?? 9),
                cCurve: Number(measurements.cCurve ?? measurements.curve ?? 0.55),
            }
        })

        const avg = (nums: number[]) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0)
        const avgLength = Number(avg(details.map((d) => d.lengthMm)).toFixed(1))
        const avgWidth = Number(avg(details.map((d) => d.widthMm)).toFixed(1))
        const avgCurve = Number(avg(details.map((d) => d.cCurve)).toFixed(2))

        const isLong = avgLength >= 12.5
        const isNarrow = avgWidth <= 10
        const isLowCurve = avgCurve <= 0.55

        // 시즌/쉐입은 왼손을 우선하고, 없으면 오른손 값을 사용
        const seasonNameKo = leftAnalysis?.seasonNameKo ?? rightAnalysis?.seasonNameKo ?? null
        const shapeId = leftAnalysis?.shape ?? rightAnalysis?.shape ?? null
        const shapeInfo = shapeId ? getNailShape(shapeId) : undefined

        return {
            seasonNameKo: seasonNameKo || '분석 중',
            shapeLabel: shapeInfo ? `${shapeInfo.labelKo} (${shapeInfo.id})` : shapeId || '분석 중',
            avgLength,
            avgWidth,
            avgCurve,
            comment: `손톱이 ${isLong ? '길고' : '짧고'} ${isNarrow ? '좁은' : '넓은'} 편이네요!\n곡률은 ${isLowCurve ? '작은' : '큰'} 편입니다.`,
            // TODO: 전체 사용자 모집단 통계 API 완성되면 실제 값으로 교체
            percentileNote: '23%의 사용자가 이런 느낌의 손톱을 가지고 있어요!',
        }
    }, [leftAnalysis, rightAnalysis])

    const [manualSeasonCode, setManualSeasonCode] = useState<string>('spring_light')

    const detectedSeasonCode = leftAnalysis?.seasonCode || rightAnalysis?.seasonCode || null
    const activeSeasonCode = detectedSeasonCode || manualSeasonCode

    const personalPalette = useMemo(() => {
        return PERSONAL_COLOR_SWATCHES[activeSeasonCode] ?? PERSONAL_COLOR_SWATCHES.spring_light
    }, [activeSeasonCode])

    const isMultiConfirmVisible = useMemo(
        () => !!activeQuickReply?.multi && selectedInQuickReply.length > 0,
        [activeQuickReply, selectedInQuickReply],
    )

    return (
        <AppShell mainClassName="design-chat-page">
            <div className="design-chat-layout">
                {showAnalysisPanel && analysisSummary && (
                    <aside className="design-chat-sidebar">
                        <div className="design-chat-sidebar__header">
                            <h2>{userName ? `${userName}님의 분석 결과` : '분석 결과'}</h2>
                            <button
                                type="button"
                                className="design-chat-sidebar__close"
                                aria-label="분석 결과 닫기"
                                onClick={() => setShowAnalysisPanel(false)}
                            >
                                ×
                            </button>
                        </div>

                        <div className="design-chat-sidebar__section">
                            <h3>Hand</h3>
                            <p>Tone: {analysisSummary.seasonNameKo}</p>
                        </div>

                        <div className="design-chat-sidebar__section">
                            <h3>Nail</h3>
                            <p>추천 팁 모양: {analysisSummary.shapeLabel}</p>
                        </div>

                        <div className="design-chat-sidebar__section">
                            <p className="design-chat-sidebar__label">상세 분석 결과:</p>
                            <ul className="design-chat-sidebar__list">
                                <li>곡률: {analysisSummary.avgCurve}</li>
                                <li>손톱길이: {analysisSummary.avgLength}mm</li>
                                <li>손톱너비: {analysisSummary.avgWidth}mm</li>
                            </ul>
                        </div>

                        <p className="design-chat-sidebar__comment">
                            {analysisSummary.comment.split('\n').map((line, i) => (
                                <span key={i}>
                    {line}
                                    <br />
                  </span>
                            ))}
                        </p>

                        <p className="design-chat-sidebar__percentile">{analysisSummary.percentileNote}</p>
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
                                                    <img src={url} alt={bubble.isDesignResult ? `생성된 네일 디자인 ${i + 1}` : '업로드한 참고 사진'} />
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
                                        ← 이전
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
                                            ← 이전
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
                                    !detectedSeasonCode && (
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
                                            {detectedSeasonCode && (
                                                <p className="design-chat__color-picker-label">내 퍼스널컬러 팔레트</p>
                                            )}

                                            <div className="design-chat__color-main">
                                                <div className="design-chat__color-grid">
                                                    {personalPalette.map((hex, idx) => {
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
                                                        이 색상 추가하기
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
                                            {detectedSeasonCode && (
                                                <p className="design-chat__color-picker-label">내 퍼스널컬러 팔레트</p>
                                            )}

                                            <div className="design-chat__color-main">
                                                <div className="design-chat__color-grid">
                                                    {personalPalette.map((hex, idx) => {
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
                                                        이 색상 추가하기
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
                                            >
                                                다음 ({selectedInQuickReply.length}개 선택)
                                            </button>
                                        </div>
                                    ) : activeQuickReply.id.startsWith('freeform-actions') && freeformShapePickerOpen ? (
                                        <div className="design-chat__quickreply-list design-chat__quickreply-list--grid3">
                                            {PREFERENCE_OPTIONS.shape.map((option) => (
                                                <button
                                                    key={option.value}
                                                    type="button"
                                                    className="design-chat__quickreply-item"
                                                    onClick={() => handleFreeformShapeSelect(option.label)}
                                                    disabled={isSending}
                                                >
                                                    {SHAPE_PREVIEW_IMAGES[option.value] && (
                                                        <img
                                                            src={SHAPE_PREVIEW_IMAGES[option.value]}
                                                            alt=""
                                                            className="design-chat__quickreply-shape-img"
                                                        />
                                                    )}
                                                    <span>{option.label}</span>
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

                                                return (
                                                    <button
                                                        key={option.value}
                                                        type="button"
                                                        className={`design-chat__quickreply-item${selected ? ' is-selected' : ''}`}
                                                        onClick={() => handleQuickReplyClick(option)}
                                                        disabled={isSending || isMotifMutuallyExclusiveBlocked}
                                                    >
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
                                                            <span>{option.label}</span>
                                                        )}
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
                                        >
                                            {activeQuickReply.limit == null
                                                ? `다음 (${selectedInQuickReply.length}개 선택)`
                                                : `다음 (${selectedInQuickReply.length}/${activeQuickReply.limit})`}
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
        </AppShell>
    )
}