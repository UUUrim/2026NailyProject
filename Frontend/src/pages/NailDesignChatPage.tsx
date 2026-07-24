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
    const [selectedInQuickReply, setSelectedInQuickReply] = useState<string[]>([])

    const [mode, setMode] = useState<Mode>('menu')
    const [preferenceStepIndex, setPreferenceStepIndex] = useState(0)
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
        setBubbles((prev) => [...prev, { id: makeId(), role: 'user', text }])
    }
    const pushUserColors = (text: string, colorSwatches: string[]) => {
        setBubbles((prev) => [...prev, { id: makeId(), role: 'user', text, colorSwatches }])
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
    const toggleQuickReplyValue = (value: string) => {
        if (!activeQuickReply) return
        if (!activeQuickReply.multi) {
            handlePreferenceSingleSelect(value)
            return
        }
        setSelectedInQuickReply((prev) => {
            if (prev.includes(value)) return prev.filter((v) => v !== value)
            if (activeQuickReply.limit != null && prev.length >= activeQuickReply.limit) {
                return [...prev.slice(1), value]
            }
            return [...prev, value]
        })
    }

    const handlePreferenceSingleSelect = (value: string) => {
        confirmPreferenceStep([value])
    }

    const confirmPreferenceStep = (values: string[]) => {
        const step = PREFERENCE_STEPS[preferenceStepIndex]
        if (step === 'color') {
            pushUserColors(`${PREFERENCE_SECTION_LABELS.color}:`, values)
        } else {
            const labels = values
                .map((v) => PREFERENCE_OPTIONS[step].find((o) => o.value === v)?.label ?? v)
                .join(', ')
            pushUser(`${PREFERENCE_SECTION_LABELS[step]}: ${labels || '선택 안 함'}`)
        }
        setSelectedInQuickReply([])

        const updated: NailDesignPreferences = {
            ...collectedPreferences,
            [step]: values,
        }
        setCollectedPreferences(updated)

        const nextIndex = preferenceStepIndex + 1
        if (nextIndex < PREFERENCE_STEPS.length) {
            setPreferenceStepIndex(nextIndex)
            setActiveQuickReply(buildPreferenceQuickReply(PREFERENCE_STEPS[nextIndex]))
        } else {
            setActiveQuickReply(null)
            pushAssistant('선택 감사해요! 이 내용으로 디자인을 생성할게요.')
            void finalizePreferenceDesign(updated)
        }
    }

    const finalizePreferenceDesign = async (preferences: NailDesignPreferences) => {
        if (!sessionId) {
            pushAssistant('채팅 세션이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.')
            return
        }
        try {
            await savePreferences(sessionId, {
                mood: preferences.mood,
                designType: preferences.designType,
                season: preferences.season[0] ?? '',
                motif: preferences.motif,
                shape: preferences.shape[0] ?? '',
                color: preferences.color,
            })
        } catch {
            // 선호도 저장 실패해도 스캔 기반 기본값으로 계속 진행
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
        void (async () => {
            if (sessionId && freeText.trim()) {
                try {
                    await refineKeywords(sessionId, freeText)
                } catch {
                    // 키워드 추출 실패해도 계속 진행 (스캔 기본값으로 생성됨)
                }
            }
            await runGenerateDesign({ ...INITIAL_PREFERENCES, freeText }, 'freeform')
        })()
    }

    const sendFreeformMessage = async (text: string) => {
        if (!sessionId) {
            pushAssistant('채팅 세션이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.')
            return
        }
        freeformLogRef.current.push(text)
        setIsSending(true)
        try {
            const reply = await sendChatMessage(sessionId, text)
            pushAssistant(reply)
            setActiveQuickReply({
                id: `freeform-generate-${makeId()}`,
                question: '준비되면 아래 버튼을 눌러 디자인을 생성해 주세요',
                options: [{ value: 'generate', label: '🎨 이 내용으로 디자인 생성하기' }],
                multi: false,
                limit: 1,
                layout: 'list',
            })
        } catch (e) {
            const msg = e instanceof ApiError ? e.message : '메시지 전송에 실패했어요. 다시 시도해 주세요.'
            pushAssistant(msg)
        } finally {
            setIsSending(false)
        }
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
                                        <div className="design-chat__bubble-images">
                                            {bubble.imageUrls.map((url, i) => (
                                                <div key={i} className="design-chat__bubble-image-wrap">
                                                    <img src={url} alt={`생성된 네일 디자인 ${i + 1}`} />
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
                                <button
                                    type="button"
                                    className="design-chat__quickreply-header-toggle"
                                    onClick={() => setIsQuickReplyCollapsed((prev) => !prev)}
                                    aria-expanded={!isQuickReplyCollapsed}
                                >
                                    <p className="design-chat__quickreply-question">{activeQuickReply.question}</p>
                                </button>

                                {activeQuickReply.id === 'pref-color' && !detectedSeasonCode && (
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
                                                    <label className="design-chat__color-custom-picker">
                                                        <input
                                                            type="color"
                                                            value={customColor}
                                                            onChange={(e) => setCustomColor(e.target.value)}
                                                            disabled={isSending}
                                                        />
                                                    </label>
                                                    <button
                                                        type="button"
                                                        className="design-chat__color-custom-add"
                                                        onClick={() => toggleQuickReplyValue(customColor.toUpperCase())}
                                                        disabled={isSending}
                                                    >
                                                        이 색상 추가하기
                                                    </button>
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
                                                return (
                                                    <button
                                                        key={option.value}
                                                        type="button"
                                                        className={`design-chat__quickreply-item${selected ? ' is-selected' : ''}`}
                                                        onClick={() => handleQuickReplyClick(option)}
                                                        disabled={isSending}
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
                                                        <span>{option.label}</span>
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
                placeholder="또는 원하는 디자인 직접 입력"
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
                disabled={isSending}
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
                                    disabled={isSending || !inputValue.trim()}
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