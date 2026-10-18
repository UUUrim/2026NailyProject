import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ScanResultResponse } from '@/entities/scan/api'
import { sortRecommendedColors } from '@/shared/utils/colorSort'
import {
    createChatSession,
    sendChatMessage,
    refineKeywords,
    saveChatState,
    type ChatResponse,
    type ChatSummary,
} from '@/features/nail-design/api/chat'
import type { HandAnalysisSummary } from '@/features/nail-design/utils/handAnalysisSummary'
import { buildDesignChatTitle, buildMessageChatTitle, buildMoodChatTitle } from '@/features/nail-design/utils/chatTitle'
import {
    generateDesign,
    generateDesignFromImage,
    confirmDesign,
    getDesignChatHistory,
    REFERENCE_PHOTO_PLACEHOLDER,
    type ChatTranscriptEntry,
    type DesignExtractedDetails,
    type DesignChatMessage,
    type DesignGenerateResponse,
    type KeywordColor,
} from '@/entities/design/api'
import { koreanColorName } from '@/shared/utils/colorName'
import { extractNoteKeywords } from '@/features/nail-design/utils/noteKeywords'
import { buildPickedColorsContext } from '@/features/nail-design/utils/pickedColorsContext'
import {
    PREFERENCE_REPLY_MESSAGE,
    splitSavedPreferenceReplies,
    trimPreferenceReply,
} from '@/features/nail-design/utils/preferenceReply'
import type { NailShapeId } from '@/shared/constants/nailShapes'
import {
    INITIAL_PREFERENCES,
    PREFERENCE_OPTIONS,
    PREFERENCE_SECTION_LABELS,
    type NailDesignPreferences,
    type PreferenceKey,
    type PreferenceOptionInfo,
} from '@/shared/constants/designPreferences'

// 손 스캔 정보가 아예 없을 때(피부 톤 기반 "나와 어울리는 컬러"를 계산할 수 없을 때) 컬러
// 피커에 대신 보여주는 "이달의 컬러" 30색 — 특정 피부톤에 맞춘 팔레트가 아니라, 그 자체로
// 예쁘고 트렌디한 네일 컬러를 큐레이션한 고정 팔레트.
// 구성: 요즘 유행하는 민트·아쿠아 계열, 파스텔~쨍한 레몬 옐로우, 스테디한 누디 톤, MLBB 로즈,
// 블랙&화이트, 그리고 네일에 자주 쓰는 핑크·피치·버건디 등.
// 화면 순서는 추천 컬러와 같은 규칙(sortRecommendedColors: 가장 연한 색에서 출발해 비슷한 색끼리
// 잇는 TSP 경로)으로 모듈 로드 때 한 번만 정렬해 둔다 — 아래 나열 순서는 상관없다.
const MONTHLY_TRENDING_COLORS = sortRecommendedColors([
    '#FFFFFF', // 퓨어 화이트
    // 빨강 (연 → 진)
    '#E1A9A4', // MLBB 로즈
    '#CE908F', // 로지 모브
    '#B5746F', // 브릭 로즈
    // 주황 (연 → 진)
    '#F6F1E7', // 밀키 화이트
    '#F3E7DC', // 밀키 누드
    '#E6D2BE', // 크림 베이지
    '#FBC7AC', // 피치 퍼즈
    '#D9B79A', // 카멜 누드
    '#C99C82', // 모카 누드
    // 노랑 (연 → 진)
    '#FCFBAC', // 파스텔 레몬
    '#FAF875', // 소프트 레몬
    '#FCFA4C', // 비비드 레몬
    // 초록 (연 → 진)
    '#DCF2E8', // 아이스 민트
    '#D4FFC9', // 페일 라임
    '#B3FBE0', // 페일 민트
    // 파랑 (연 → 진)
    '#D3FCFE', // 아이스 아쿠아
    '#D6ECF7', // 아이스 블루
    '#6FF8EF', // 아쿠아 민트
    // 남색~보라 (연 → 진)
    '#E7DBF3', // 라벤더 헤이즈
    '#B79FD9', // 라일락 퍼플
    // 보라~핑크(마젠타) (연 → 진)
    '#F7DCE4', // 발레 핑크
    '#F4C9D4', // 베이비 핑크
    '#FEB3D6', // 캔디 핑크
    '#F1A9BE', // 피오니 핑크
    '#FC8DFC', // 네온 오키드
    // 어두운 네이비·플럼·버건디 → 블랙
    '#343B52', // 다크 네이비
    '#362E45', // 다크 플럼
    '#5D1519', // 다크 버건디
    '#1C1C1E', // 오닉스 블랙
])
import { ApiError } from '@/shared/utils/apiClient'
import { ensureSupportedImage } from '@/shared/utils/imageFormat'

// ── 타입 ──────────────────────────────────────────────────────────────────

type ChatBubble = {
    id: string
    role: 'assistant' | 'user'
    text: string
    imageUrls?: string[]
    colorSwatches?: string[]
    // true면 색 동그라미를 글 아래 줄이 아니라 글 바로 옆에 붙인다 (컬러 단계의 "컬러: ●●")
    colorsInline?: boolean
    // 색 동그라미 아래 줄에 따로 보여 줄 글 (컬러 단계에서 색을 고르고 기타 입력도 했을 때의 "기타(…)")
    textAfterColors?: string
    isDesignResult?: boolean
    // 디자인을 만드는 중인 카드 — 완성되면 같은 말풍선에 imageUrls가 채워지고 isDesignResult로 바뀐다
    isGenerating?: boolean
    // 채팅 화면엔 그리지 않고 마이페이지 채팅 이력에만 보이는 말풍선 (선택지 기반에서 서버로 보낸 요약 문장)
    historyOnly?: boolean
    // 채팅 화면에만 보이고 마이페이지 채팅 이력에서는 빼는 말풍선 (선택지 기반의 단계별 선택 — 이력에선 요약 문장 하나로 보여 준다)
    chatOnly?: boolean
    // 첫 인사·생성 방식 고르기에 속한 말풍선 — 마이페이지 채팅 이력은 마지막 이런 말풍선 다음부터 보여 준다
    historySection?: 'method'
    // 이 말풍선에서 해당 생성 방식이 시작됐다 — 마이페이지 채팅 이력의 "생성 방식" 표시에 쓴다
    generationMethod?: GenerationSource
}

// 선택지 라벨 앞에 붙는 아이콘 (이모지 대신 웹의 다른 아이콘과 같은 선 아이콘으로 그린다 — ChatOptionIcon)
export type QuickReplyIcon = 'palette' | 'nail' | 'check' | 'chat' | 'party' | 'pencil'

type QuickReplyOption = {
    value: string
    label: string
    colorHexes?: string[]
    icon?: QuickReplyIcon
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
    keywords: string[] // 선택지에서 고른 값 / 자유입력·사진은 서버 키워드 (scan-auto는 비움). 컬러는 colors로 따로
    colors?: KeywordColor[] // 컬러 키워드 — 결과 화면이 색 스와치 + 색 이름 칩으로 보여준다
    referenceImageUrl: string | null // 사진 기반 생성일 때, 사용자가 업로드한 참고 사진
    handSummary: {
        toneLabel: string
        shapeLabel: string
        avgLength: number
        avgWidth: number
        avgCurve: number
        // scan-auto 전용: 대표 피부색 / 쉐입 이미지 + 추천 팔레트 전체 + 그 중 실제 반영된 색 + 반영된 무드/디자인 타입
        skinToneHex?: string | null
        shapeImage?: string | null
        recommendedColors?: string[]
        usedColors?: string[]
        reflectedMood?: string | null
        reflectedDesignType?: string | null
        reflectedMotif?: string | null
        reflectedSeason?: string | null
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
// 채팅 하나의 진행 상태 스냅샷 — 두 곳에 쓴다.
// 1) 서버 저장(사이드바 채팅 이력): 이력에서 이 채팅을 다시 열면 이 상태 그대로 이어서 한다
//    (serializeConversationSnapshot으로 파일·사진 미리보기 같은 큰 값은 빼고 보낸다).
// 2) 메모리(뒤로가기 복원): 결과 페이지로 이동했다가 브라우저 뒤로가기로 돌아오면 첨부 사진까지 그대로 되살린다
//    (useDesignChatWorkspace가 getLiveConversationSnapshot으로 가져가 둔다).
export type ConversationSnapshot = {
    sessionId: number | null
    bubbles: ChatBubble[]
    activeQuickReply: QuickReply | null
    selectedInQuickReply: string[]
    mode: Mode
    preferenceStepIndex: number
    preferenceStepBubbleIds: Record<number, string>
    collectedPreferences: NailDesignPreferences
    preferenceNotes: Partial<Record<PreferenceKey, string>>
    freeformSelectedColors: string[]
    freeformLog: string[]
    reviseLog: string[]
    lastDesign: GeneratedDesign | null
    generationSource: GenerationSource
    selectedPhotoFile: File | null
    selectedPhotoPreviewUrl: string | null
    inputValue: string
    isQuickReplyCollapsed: boolean
    // 마지막으로 만든 디자인의 분위기로 지은 채팅 이름 (아직 디자인을 안 만들었으면 null)
    designTitle: string | null
}

// 서버에 저장하는 채팅 상태의 형식 버전 — 형식이 바뀌면 올리고, 복원할 때 맞지 않는 상태는 버린다
const CONVERSATION_STATE_VERSION = 1

type SerializedConversation = Omit<ConversationSnapshot, 'selectedPhotoFile' | 'selectedPhotoPreviewUrl'> & {
    version: number
}

// 아직 서버에 올라가지 않은 참고 사진 미리보기(data/blob URL, 수 MB)는 저장하지 않는다 — 다시 열면 그 사진만 빠진다
const isLocalImageUrl = (url: string | null | undefined) => !!url && /^(data|blob):/.test(url)

function serializeConversationSnapshot(snapshot: ConversationSnapshot): SerializedConversation {
    return {
        version: CONVERSATION_STATE_VERSION,
        sessionId: snapshot.sessionId,
        activeQuickReply: snapshot.activeQuickReply,
        selectedInQuickReply: snapshot.selectedInQuickReply,
        mode: snapshot.mode,
        preferenceStepIndex: snapshot.preferenceStepIndex,
        preferenceStepBubbleIds: snapshot.preferenceStepBubbleIds,
        collectedPreferences: snapshot.collectedPreferences,
        preferenceNotes: snapshot.preferenceNotes,
        freeformSelectedColors: snapshot.freeformSelectedColors,
        freeformLog: snapshot.freeformLog,
        reviseLog: snapshot.reviseLog,
        generationSource: snapshot.generationSource,
        isQuickReplyCollapsed: snapshot.isQuickReplyCollapsed,
        designTitle: snapshot.designTitle,
        // 생성 중 카드는 다시 열었을 때 이어받을 수 없으므로 저장하지 않는다
        bubbles: snapshot.bubbles
            .filter((bubble) => !bubble.isGenerating)
            .map((bubble) =>
                bubble.imageUrls?.some(isLocalImageUrl)
                    ? { ...bubble, imageUrls: bubble.imageUrls.filter((url) => !isLocalImageUrl(url)) }
                    : bubble,
            )
            .filter((bubble) => bubble.text || bubble.imageUrls?.length || bubble.colorSwatches?.length),
        lastDesign: snapshot.lastDesign && isLocalImageUrl(snapshot.lastDesign.context.referenceImageUrl)
            ? { ...snapshot.lastDesign, context: { ...snapshot.lastDesign.context, referenceImageUrl: null } }
            : snapshot.lastDesign,
        // 입력하던 글은 저장하지 않는다 — 글자를 칠 때마다 저장되지 않게 (뒤로가기 복원은 메모리 스냅샷이 맡는다)
        inputValue: '',
    }
}

// 디자인을 만들기 전 채팅 이름 — 선택지에서 고른 분위기 → 자유 입력 첫 문장 → 생성 방식 순으로 짓는다
const METHOD_CHAT_TITLES: Record<GenerationSource, string> = {
    preference: '선택지로 만드는 네일',
    freeform: '자유 입력으로 만드는 네일',
    photo: '사진을 참고한 네일',
    'scan-auto': '내 손에 맞춘 네일',
}

function buildProvisionalChatTitle(snapshot: ConversationSnapshot): string | null {
    const moodLabels = snapshot.collectedPreferences.mood.map(
        (value) => PREFERENCE_OPTIONS.mood.find((option) => option.value === value)?.label ?? value,
    )
    const latestMethod = [...snapshot.bubbles].reverse().find((bubble) => bubble.generationMethod)?.generationMethod
    return (
        buildMoodChatTitle(moodLabels) ??
        (snapshot.freeformLog[0] ? buildMessageChatTitle(snapshot.freeformLog[0]) : null) ??
        (latestMethod ? METHOD_CHAT_TITLES[latestMethod] : null)
    )
}

/** 서버에 저장해 둔 채팅 상태를 스냅샷으로 되돌린다. 형식이 맞지 않으면 null */
export function deserializeConversationSnapshot(raw: unknown): ConversationSnapshot | null {
    if (!raw || typeof raw !== 'object') return null
    const state = raw as Partial<SerializedConversation>
    if (state.version !== CONVERSATION_STATE_VERSION || !Array.isArray(state.bubbles)) return null
    return {
        sessionId: state.sessionId ?? null,
        // 선택지 기반 답장은 예전에 저장된 채팅이라도 지금 구조로 (채팅엔 정해진 멘트, 마이페이지 이력엔 GPT 답장)
        bubbles: splitRestoredPreferenceReplies(state.bubbles),
        activeQuickReply: state.activeQuickReply ?? null,
        selectedInQuickReply: state.selectedInQuickReply ?? [],
        mode: state.mode ?? 'menu',
        preferenceStepIndex: state.preferenceStepIndex ?? 0,
        preferenceStepBubbleIds: state.preferenceStepBubbleIds ?? {},
        collectedPreferences: state.collectedPreferences ?? INITIAL_PREFERENCES,
        preferenceNotes: state.preferenceNotes ?? {},
        freeformSelectedColors: state.freeformSelectedColors ?? [],
        freeformLog: state.freeformLog ?? [],
        reviseLog: state.reviseLog ?? [],
        lastDesign: state.lastDesign ?? null,
        generationSource: state.generationSource ?? 'scan-auto',
        selectedPhotoFile: null,
        selectedPhotoPreviewUrl: null,
        inputValue: state.inputValue ?? '',
        isQuickReplyCollapsed: state.isQuickReplyCollapsed ?? false,
        designTitle: state.designTitle ?? null,
    }
}

// 지금 화면에 떠 있는 채팅의 최신 스냅샷 — 렌더할 때마다 갱신된다 (useDesignChatWorkspace의 뒤로가기 복원용)
let liveConversationSnapshot: ConversationSnapshot | null = null

// 이력에서 지운 채팅 — 화면을 옮기며 마지막 상태를 저장하거나 늦게 끝난 저장이 그 채팅을 이력에 되살리지 않게 막는다
const deletedSessionIds = new Set<number>()

export function markConversationDeleted(sessionId: number) {
    deletedSessionIds.add(sessionId)
}

/** 삭제에 실패해 이력에 되돌렸을 때 다시 저장되게 한다 */
export function unmarkConversationDeleted(sessionId: number) {
    deletedSessionIds.delete(sessionId)
}

export function isConversationDeleted(sessionId: number) {
    return deletedSessionIds.has(sessionId)
}

export function getLiveConversationSnapshot(): ConversationSnapshot | null {
    return liveConversationSnapshot
}
// "수정하고 싶어요" / "이어서 수정할게요"를 골랐을 때 네일리가 보내는 안내
const REVISE_PROMPT_MESSAGE = '컬러, 스타일, 모티프 등 수정하고 싶으신 부분을 자유롭게 말씀해 주세요!'
// 디자인 확정 — 누르면 이 답을 채팅에 남기고 결과 화면으로 넘어간다
const DESIGN_ACCEPT_LABEL = '좋아요! 이 디자인으로 할게요.'
// 수정 제안 선택지 안에서 띄우는 확정 선택지 — 수정하려다 "그냥 방금 디자인으로 할래"로 마음을 바꾼 사용자를 위한 것.
// 누르면 DESIGN_ACCEPT_LABEL과 똑같이 확정하고 결과 화면으로 넘어간다.
const DESIGN_CONFIRM_FROM_REVISE_LABEL = '방금 디자인으로 확정할게요.'
const DESIGN_CONFIRM_FROM_REVISE_VALUE = '__confirm_current_design__'
// 확정 답으로 보는 말풍선 문장들 (확정 뒤 다시 연 채팅인지 판단할 때 쓴다)
const DESIGN_ACCEPT_LABELS = [DESIGN_ACCEPT_LABEL, DESIGN_CONFIRM_FROM_REVISE_LABEL]
const DESIGN_FEEDBACK_QUICK_REPLY: QuickReply = {
    id: 'design-feedback',
    question: '이 디자인 마음에 드시나요?',
    options: [
        { value: 'accept', label: DESIGN_ACCEPT_LABEL, icon: 'party' },
        { value: 'revise', label: '수정하고 싶어요.', icon: 'pencil' },
    ],
    multi: false,
    limit: 1,
    layout: 'list',
}
const PHOTO_UPLOAD_QUICK_REPLY: QuickReply = {
    id: 'photo-upload',
    question: '참고하고 싶은 사진을 첨부해 주세요.',
    options: [],
    multi: false,
    limit: 1,
    layout: 'list',
}
export const MENU_OPTIONS: QuickReplyOption[] = [
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
// 결과 화면 "디자인 다시 생성하기"로 돌아왔을 때, 채팅 내역을 복원한 뒤 물어보는 선택지.
const REGENERATE_CHOICE_QUICK_REPLY: QuickReply = {
    id: 'regenerate-choice',
    question: '이 디자인을 이어서 수정할까요, 아니면 처음부터 새로 만들까요?',
    options: [
        { value: 'continue', label: '이어서 수정할게요.' },
        { value: 'restart', label: '처음부터 새로 만들게요.' },
    ],
    multi: false,
    limit: 1,
    layout: 'list',
}
// 분위기 → 디자인 타입 → 모티프 → 계절감 → 네일 쉐입 → 컬러
export const PREFERENCE_STEPS: PreferenceKey[] = ['mood', 'designType', 'motif', 'season', 'shape', 'color']

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

// 주어진 선택지 외에 "기타" 의견을 직접 적을 수 있는 단계 (분위기/디자인 타입/모티프/컬러)
export const PREFERENCE_NOTE_STEPS: PreferenceKey[] = ['mood', 'designType', 'motif', 'color']
export const PREFERENCE_NOTE_MAX_LENGTH = 50
// 컬러 기타 입력은 "2번째 색은 포인트로만 써 주세요"처럼 문장으로 적는 경우가 많아 더 길게 받는다
export const COLOR_NOTE_MAX_LENGTH = 100

export function getPreferenceNoteMaxLength(step: PreferenceKey): number {
    return step === 'color' ? COLOR_NOTE_MAX_LENGTH : PREFERENCE_NOTE_MAX_LENGTH
}

const STEP_QUESTIONS: Record<PreferenceKey, string> = {
    mood: '원하시는 분위기를 선택해 주세요.',
    designType: '원하시는 디자인 타입을 선택해 주세요.',
    motif: '포인트로 넣고 싶은 모티프를 선택해 주세요.',
    season: '원하시는 계절감을 선택해 주세요.',
    shape: '원하시는 네일 쉐입을 선택해 주세요.',
    color: '원하시는 컬러를 선택해 주세요.',
}
// 디자인 생성 후 완성 멘트 — 모든 생성 방식(선택지·자유 입력·사진·스캔 자동)이 같이 쓴다 (수정 후 멘트는 따로)
const DESIGN_COMPLETE_MESSAGE = '네일을 완성했어요! 이런 디자인은 어떠세요?'
const REVISE_COMPLETE_MESSAGE = '말씀하신 대로 수정했어요! 어떠세요?'
// 디자인을 만들던 중에 페이지를 떠나(새로고침·탭 닫기) 생성이 멈춘 채팅을 다시 열었을 때
const GENERATION_INTERRUPTED_MESSAGE = '디자인 생성이 중단됐어요. 원하시는 생성 방식을 다시 선택해 주세요.'

// 채팅 화면의 대화를 확정 때 저장할 형태로 바꾼다 — 생성 중 카드는 빼고, 참고 사진 미리보기(data URL, 수 MB)는
// 자리표시자로 보낸다(서버가 실제로 올라간 사진 URL로 바꿔 저장한다)
function buildChatTranscript(bubbles: ChatBubble[]): ChatTranscriptEntry[] {
    return bubbles
        .filter((bubble) => !bubble.isGenerating)
        .map((bubble) => ({
            role: bubble.role,
            content: bubble.text,
            imageUrls: bubble.imageUrls?.map((url) => (/^(data|blob):/.test(url) ? REFERENCE_PHOTO_PLACEHOLDER : url)),
            colorSwatches: bubble.colorSwatches,
            colorsInline: bubble.colorsInline,
            textAfterColors: bubble.textAfterColors,
            // 항상 true/false로 보낸다 — 이력을 받는 쪽이 "확정 때 저장한 대화"인지 이 값으로 알아본다
            designResult: !!bubble.isDesignResult,
            historyOnly: bubble.historyOnly,
            chatOnly: bubble.chatOnly,
            historySection: bubble.historySection,
            generationMethod: bubble.generationMethod,
        }))
}

// 자유 입력 대화에서 서버가 확인하는 필수 항목(분위기·디자인 기법·컬러·계절·모티프·쉐입)을 다 모았는지 —
// 이때만 "바로 생성해 드릴까요?" 확인 창을 띄운다. 서버가 완료라고 알려 오거나, 남은 항목이 하나도 없을 때.
function isFreeformCollectionComplete(res: ChatResponse): boolean {
    return res.isComplete || res.remainingCategories?.length === 0
}

// 자유 입력 제안 선택지가 네일 쉐입 이름인지 (서버가 다음 질문 대상을 쉐입으로 적지 않았을 때 알아보는 용도)
const SHAPE_OPTION_WORDS = [
    ...PREFERENCE_OPTIONS.shape.flatMap((option) => [option.label, option.value]),
    '스퀘어오벌',
    '코핀',
]
function isShapeOptionLabel(label: string): boolean {
    const normalized = label.toLowerCase()
    return SHAPE_OPTION_WORDS.some((word) => normalized.includes(word.toLowerCase()))
}

// 완성 이미지가 이 시간 안에 카드에 안 뜨면(불러오기 실패·아주 느린 네트워크) 완성 멘트를 그냥 띄운다
const CARD_REVEAL_TIMEOUT_MS = 15000

// 선택지 라벨이 문장(…요 / …니다)으로 끝나는데 문장부호가 없으면 붙인다 — 서버가 주는 제안 문장은 부호 없이 오는 경우가 많다.
// 묻는 말(…까요 / …나요 / …가요)은 물음표, 나머지는 마침표. 단어나 명사형("…하기")은 그대로 둔다.
function withSentencePunctuation(text: string): string {
    const trimmed = text.trim()
    if (!/(요|니다)$/.test(trimmed)) return trimmed
    return trimmed + (/(까요|나요|가요)$/.test(trimmed) ? '?' : '.')
}

function makeId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// 저장된 대화의 선택지 기반 답장을 지금 구조로 맞춘다 — 채팅 화면엔 정해진 멘트(chatOnly), 마이페이지 이력엔 GPT 답장(historyOnly)
function splitRestoredPreferenceReplies(bubbles: ChatBubble[]): ChatBubble[] {
    return splitSavedPreferenceReplies(
        bubbles,
        (bubble) => bubble.text,
        (bubble, text, marks, asNew) => ({
            ...bubble,
            id: asNew ? makeId() : bubble.id,
            text,
            historyOnly: marks.historyOnly,
            chatOnly: marks.chatOnly,
        }),
    )
}

// 답변·디자인을 기다리던 중에 새로고침·탭 닫기로 떠나 멈춘 채팅 — 다시 열었을 때 이어 갈 수 있게 멈춘 자리를 정리한다.
// 생성 중 카드는 빼고, 실패했을 때처럼 멈췄다고 알린 뒤 다시 고를 선택 창을 띄운다.
// (isGeneratingDesign: 디자인 이미지 생성·수정 요청을 보내 둔 상태였는지)
function buildInterruptedSnapshot(snapshot: ConversationSnapshot, isGeneratingDesign: boolean): ConversationSnapshot {
    const hasGeneratingCard = snapshot.bubbles.some((bubble) => bubble.isGenerating)
    const bubbles = snapshot.bubbles.filter((bubble) => !bubble.isGenerating)
    const withMessage = (text: string, marks?: Pick<ChatBubble, 'historySection'>): ChatBubble[] => [
        ...bubbles,
        { id: makeId(), role: 'assistant', text, ...marks },
    ]
    // 완성 이미지는 받아 카드에 채웠고 나타나기만 기다리던 때 — 디자인은 다 만들어졌다
    if (isGeneratingDesign && !hasGeneratingCard) {
        return {
            ...snapshot,
            bubbles: withMessage(snapshot.mode === 'revise' ? REVISE_COMPLETE_MESSAGE : DESIGN_COMPLETE_MESSAGE),
            activeQuickReply: DESIGN_FEEDBACK_QUICK_REPLY,
        }
    }
    // 수정하던 디자인은 그대로 두고, 이 디자인으로 할지 다시 수정할지 고르게 한다
    if (snapshot.mode === 'revise' && snapshot.lastDesign) {
        return { ...snapshot, bubbles: withMessage('디자인 수정이 중단됐어요.'), activeQuickReply: DESIGN_FEEDBACK_QUICK_REPLY }
    }
    // 새로 만들던 중 (선택지 기반에서 고른 내용을 보내고 답장을 기다리던 때 포함) — 생성 방식부터 다시 고른다
    if (isGeneratingDesign || snapshot.mode === 'preference') {
        return {
            ...snapshot,
            bubbles: withMessage(GENERATION_INTERRUPTED_MESSAGE, { historySection: 'method' }),
            activeQuickReply: MENU_QUICK_REPLY,
            mode: 'menu',
        }
    }
    // 자유 입력 답변을 기다리던 때
    return { ...snapshot, bubbles: withMessage('답변을 받기 전에 대화가 중단됐어요. 다시 말씀해 주세요.') }
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
// 결과 화면 "디자인 다시 생성하기"에서 넘어올 때 실어오는 정보 — 그 디자인을 만들 때 쓴
// 채팅 세션으로 이어서 수정할 수 있게, 세션 ID와 그 디자인을 그대로 lastDesign처럼 재구성할
// 수 있는 값들을 함께 받는다.
export type RegenerateNavState = {
    designId: number
    sessionId: number | null
    imageUrls: string[]
    preferences: NailDesignPreferences
    shapeId: NailShapeId
    details?: DesignExtractedDetails
    context: GenerationContext
}

// 이 채팅에 반영 중인 손 분석 기록 — 사이드바에서 고르고(useDesignChatWorkspace), 채팅은 받아서 쓰기만 한다
export type ConversationAnalysis = {
    leftAnalysis: ScanResultResponse | null
    rightAnalysis: ScanResultResponse | null
    scanId: number | null
    scanKey: string | null
    summary: HandAnalysisSummary | null
}

// 채팅이 알려 주는 진행 상황 (designChatRuntime이 모은다) — 채팅을 화면에서 내릴 때 숨겨 둔 채 계속할지, "새 채팅"을
// 다시 눌렀을 때 새로 열지 정하고, 사이드바 채팅 이력의 상태 점(디자인을 만드는 중 / 보지 않는 동안 다 만듦)을 띄우는 데 쓴다
export type ConversationStatus = {
    sessionId: number | null
    // 사용자가 한 번이라도 말했는지 (이때부터 채팅 이력에 저장된다)
    hasProgress: boolean
    // 답변을 기다리거나 디자인을 만드는 중인지
    isBusy: boolean
    // 디자인을 만드는 중인지 (선택지 기반에서 고른 내용을 보내고 답장을 기다리는 동안도 포함)
    isGeneratingDesign: boolean
    // 이 채팅에서 만든 디자인 수 — 다 만든 뒤 늘었으면 생성에 성공한 것이다
    designCount: number
}

type UseNailDesignChatPageParams = {
    // 이력에서 연 채팅이나 뒤로가기로 돌아온 채팅의 스냅샷 (새 채팅이면 null)
    initialSnapshot: ConversationSnapshot | null
    // 결과 화면 "디자인 다시 생성하기"로 들어온 경우
    regenerate: RegenerateNavState | null
    // 새 채팅 인사말에 쓸 닉네임·분석 기록을 다 불러왔는지
    isContextReady: boolean
    userName: string
    // 손 촬영 → 출력에서 이어 온 흐름이면 false (그때 분석한 기록에 고정)
    canSelectSession: boolean
    analysis: ConversationAnalysis
    onSessionReady?: (sessionId: number) => void
    onSaved?: (summary: ChatSummary) => void
    // 화면에 있든 숨겨 두었든 늘 알린다
    onStatusChange?: (status: ConversationStatus) => void
    // "처음부터 새로 만들게요" — 새 채팅을 연다
    onStartNewChat?: () => void
    // 답변·디자인을 기다리는 중에 다른 채팅·다른 페이지로 옮겨 화면에서만 숨긴 채팅 — 그대로 계속 진행하고 저장하되,
    // 채팅 화면(지금 채팅 표시)·뒤로가기 복원에는 끼어들지 않는다
    isBackground?: boolean
}

// 채팅 상태를 서버에 저장하기까지 기다리는 시간 — 그 사이에 또 바뀌면 마지막 상태만 한 번 저장한다
const SAVE_DEBOUNCE_MS = 700

export function useNailDesignChatPage({
                                          initialSnapshot,
                                          regenerate,
                                          isContextReady,
                                          userName,
                                          canSelectSession,
                                          analysis,
                                          onSessionReady,
                                          onSaved,
                                          onStatusChange,
                                          onStartNewChat,
                                          isBackground = false,
                                      }: UseNailDesignChatPageParams) {
    const navigate = useNavigate()

    // 이력에서 연 채팅·뒤로가기로 돌아온 채팅은 스냅샷 그대로 이어서 하고, 새 세션을 만들거나 인사말을 다시 붙이지 않는다.
    // 마운트 시점에 딱 한 번만 판단한다 (채팅을 바꾸면 이 훅을 쓰는 컴포넌트가 새로 마운트된다).
    const [chatSessionSnapshot] = useState(initialSnapshot)
    const wasRestored = !!chatSessionSnapshot

    // 결과 화면에서 "디자인 다시 생성하기"로 갓 들어온 경우에만 유효하다
    const [regenerateState] = useState(() => (!wasRestored ? regenerate : null))

    const { leftAnalysis, rightAnalysis, scanId, scanKey, summary: analysisSummary } = analysis

    const [isSessionReady, setIsSessionReady] = useState(wasRestored)
    const isInitReady = isSessionReady && (wasRestored || isContextReady)
    const [sessionId, setSessionId] = useState<number | null>(chatSessionSnapshot?.sessionId ?? null)

    // 선택지 기반으로 디자인을 만드는 도중 페이지를 떠났다 돌아온 경우 — 선택지 기반은 입력창으로 이어 갈 수 없어서
    // 그대로 두면 아무것도 할 수 없으므로 생성 방식 선택으로 되돌린다
    // (생성 중 카드가 남아 있었거나, 선택을 다 마치고 서버 답장을 기다리던 중 — 선택 창도 결과도 없는 상태 — 에 떠난 경우)
    const [wasPreferenceGenerationInterrupted] = useState(
        () =>
            chatSessionSnapshot?.mode === 'preference' &&
            (chatSessionSnapshot.bubbles.some((bubble) => bubble.isGenerating) ||
                (!chatSessionSnapshot.activeQuickReply && !chatSessionSnapshot.lastDesign)),
    )
    // 생성 도중 페이지를 떠났다 돌아오면 그 생성 결과는 이어받을 수 없으므로, 남아 있던 생성 중 카드는 버린다
    const [bubbles, setBubbles] = useState<ChatBubble[]>(() => {
        const restoredBubbles = (chatSessionSnapshot?.bubbles ?? []).filter((bubble) => !bubble.isGenerating)
        return wasPreferenceGenerationInterrupted
            ? [
                ...restoredBubbles,
                {
                    id: makeId(),
                    role: 'assistant',
                    text: GENERATION_INTERRUPTED_MESSAGE,
                    historySection: 'method',
                },
            ]
            : restoredBubbles
    })
    const [activeQuickReply, setActiveQuickReply] = useState<QuickReply | null>(
        wasPreferenceGenerationInterrupted ? MENU_QUICK_REPLY : chatSessionSnapshot?.activeQuickReply ?? null,
    )
    // "바로 생성해 주세요 / 아직 더 얘기하고 싶어요" 확인 화면이 떠 있는 동안엔
    // 자유 텍스트 입력을 막는다 — 안 그러면 아무 텍스트나 쳤을 때 "수정 요청"으로
    // 오인돼서 의도치 않게 디자인이 재생성되는 문제가 있었다.
    // "디자인 다시 생성하기"로 들어와 이어서 수정할지/새로 만들지 묻는 동안도 막는다 — 입력하면 선택 창이
    // 사라지고 이전 대화에 이어 자유 입력 채팅이 시작돼 버린다.
    const isAwaitingGenerateConfirm =
        activeQuickReply?.id === 'design-feedback' ||
        activeQuickReply?.id === 'regenerate-choice' ||
        !!activeQuickReply?.options?.some((o) => o.value === '__generate__')
    const [selectedInQuickReply, setSelectedInQuickReply] = useState<string[]>(chatSessionSnapshot?.selectedInQuickReply ?? [])

    const [mode, setMode] = useState<Mode>(wasPreferenceGenerationInterrupted ? 'menu' : chatSessionSnapshot?.mode ?? 'menu')
    const [preferenceStepIndex, setPreferenceStepIndex] = useState(chatSessionSnapshot?.preferenceStepIndex ?? 0)
    const [preferenceStepBubbleIds, setPreferenceStepBubbleIds] = useState<Record<number, string>>(
        chatSessionSnapshot?.preferenceStepBubbleIds ?? {},
    )
    const [collectedPreferences, setCollectedPreferences] = useState<NailDesignPreferences>(
        chatSessionSnapshot?.collectedPreferences ?? INITIAL_PREFERENCES,
    )
    // 분위기/디자인 타입/모티프 단계의 "기타" 입력란에 사용자가 직접 적은 의견 (단계별로 보관)
    const [preferenceNotes, setPreferenceNotes] = useState<Partial<Record<PreferenceKey, string>>>(
        chatSessionSnapshot?.preferenceNotes ?? {},
    )
    const freeformLogRef = useRef<string[]>(chatSessionSnapshot?.freeformLog ?? [])
    // 생성 방식과 무관하게, "수정하고 싶어요" 흐름에서 사용자가 채팅으로 추가 요청한 문장들을 모아둔다.
    const reviseLogRef = useRef<string[]>(chatSessionSnapshot?.reviseLog ?? [])
    const [lastDesign, setLastDesign] = useState<GeneratedDesign | null>(chatSessionSnapshot?.lastDesign ?? null)
    const [generationSource, setGenerationSource] = useState<GenerationSource>(chatSessionSnapshot?.generationSource ?? 'scan-auto')
    // 마지막으로 만든 디자인의 분위기로 지은 채팅 이름 (사이드바 채팅 이력)
    const [designTitle, setDesignTitle] = useState<string | null>(chatSessionSnapshot?.designTitle ?? null)
    const [selectedPhotoFile, setSelectedPhotoFile] = useState<File | null>(chatSessionSnapshot?.selectedPhotoFile ?? null)
    const [selectedPhotoPreviewUrl, setSelectedPhotoPreviewUrl] = useState<string | null>(
        chatSessionSnapshot?.selectedPhotoPreviewUrl ?? null,
    )
    const photoInputRef = useRef<HTMLInputElement | null>(null)

    const [inputValue, setInputValue] = useState(chatSessionSnapshot?.inputValue ?? '')
    const [isSending, setIsSending] = useState(false)
    // 보내는 중인 게 디자인 이미지 생성/수정이면 true — 채팅 답변 대기('…') 대신 이미지 크기의 생성 중 카드를 보여 준다
    const [isGeneratingDesign, setIsGeneratingDesign] = useState(false)
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
    // 자유입력 컬러피커에서 고른 색들. 선택지 기반 흐름의 selectedInQuickReply와 같은 상태를
    // 같이 쓰면, 선택지 기반 컬러 단계에서 눌러둔 색(예: 맨 앞의 화이트)이 자유입력으로
    // 넘어왔을 때 컬러피커에 이미 선택된 채로 남아 있었다 — 그래서 자유입력 전용으로 분리한다.
    const [freeformSelectedColors, setFreeformSelectedColors] = useState<string[]>(
        chatSessionSnapshot?.freeformSelectedColors ?? [],
    )
    // 자유입력 컬러피커의 "기타 입력" — 고른 색과 함께 보낸다 (handleFreeformColorPickerConfirm)
    const [freeformColorNote, setFreeformColorNote] = useState('')

    // 확대/이동은 공용 DesignImageDetailModal이 담당하므로, 여기서는 어떤 이미지를 확대해서 보여줄지만 들고 있는다.
    // 생성된 디자인 이미지면 다운로드 버튼만, 내가 첨부한 참고 사진이면 버튼 없이 사진만 보여준다.
    const [zoomedImage, setZoomedImage] = useState<{ url: string; isDesignResult: boolean } | null>(null)
    const openZoomedImage = (url: string, isDesignResult: boolean) => setZoomedImage({ url, isDesignResult })
    const closeZoomedImage = () => setZoomedImage(null)

    const messagesRef = useRef<HTMLDivElement | null>(null)
    const chatContainerRef = useRef<HTMLDivElement | null>(null)
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    const inputbarRef = useRef<HTMLDivElement | null>(null)

    // 한 줄 높이 (design-chat.css의 .design-chat__input 높이와 맞춘다)
    const INPUT_MIN_HEIGHT = 32

    const scrollMessagesToBottom = () => {
        const el = messagesRef.current
        if (el) el.scrollTop = el.scrollHeight
    }

    // 입력창 배치·높이 맞추기 — 평소엔 [손 분석][입력 칸][전송] 한 줄이고, 글이 그 칸에서 한 줄을 넘으면
    // 입력창에 data-expanded를 붙여 입력 칸을 위 줄 전체로 올리고 버튼은 아래 줄로 내린다 (design-chat.css)
    const fitTextarea = () => {
        const el = textareaRef.current
        const bar = inputbarRef.current
        if (!el || !bar) return
        // 한 줄 배치일 때의 입력 칸 너비 = 입력창 안쪽 너비 - 버튼들 - 사이 간격
        // (두 배치의 좌우 여백·간격·버튼 크기가 같아서 지금 어느 배치든 같은 값이 나온다.
        //  입력 칸 위에 겹쳐 그리는 안내 문구는 칸을 따로 차지하지 않으니 버튼만 센다)
        const barStyle = getComputedStyle(bar)
        const buttons = Array.from(bar.children).filter((child) => child instanceof HTMLButtonElement)
        const compactWidth =
            bar.clientWidth -
            parseFloat(barStyle.paddingLeft) -
            parseFloat(barStyle.paddingRight) -
            buttons.reduce((sum, button) => sum + button.offsetWidth + parseFloat(barStyle.columnGap), 0)
        el.style.width = `${compactWidth}px`
        el.style.height = 'auto'
        const expanded = el.scrollHeight > INPUT_MIN_HEIGHT + 1
        el.style.width = ''
        bar.toggleAttribute('data-expanded', expanded)

        el.style.height = 'auto'
        const containerHeight = chatContainerRef.current?.clientHeight ?? 600
        const maxHeight = Math.round(containerHeight * 0.3)
        const next = Math.min(Math.max(el.scrollHeight, INPUT_MIN_HEIGHT), maxHeight)
        el.style.height = `${next}px`
    }

    const adjustTextareaHeight = () => {
        fitTextarea()
        scrollMessagesToBottom()
    }

    // 입력을 비운 뒤 한 줄 배치로 되돌린다 (비워진 값이 화면에 반영된 다음 잰다)
    const clearInput = () => {
        setInputValue('')
        requestAnimationFrame(fitTextarea)
    }

    // 복원된 대화에 여러 줄 입력이 남아 있으면 처음부터 펼친 배치로 보여 준다
    useEffect(() => {
        fitTextarea()
    }, [])

    // marks: 생성 방식 고르기에 속한 말풍선/생성 방식이 시작된 말풍선/채팅 이력에만 남길 말풍선 표시
    type BubbleMarks = Pick<ChatBubble, 'historySection' | 'generationMethod' | 'historyOnly' | 'chatOnly'>
    const pushAssistant = (text: string, marks?: BubbleMarks) => {
        const id = makeId()
        setBubbles((prev) => [...prev, { id, role: 'assistant', text, ...marks }])
        return id
    }
    // 디자인 생성 중 카드 — 생성을 시작할 때 띄워 두고, 완성되면 같은 카드에 이미지를 채운다(실패하면 지운다)
    const pushGeneratingCard = () => {
        const id = makeId()
        setBubbles((prev) => [...prev, { id, role: 'assistant', text: '', isGenerating: true }])
        return id
    }
    const fillGeneratingCard = (id: string, imageUrls: string[]) => {
        setBubbles((prev) =>
            prev.map((bubble) =>
                bubble.id === id ? { ...bubble, isGenerating: false, isDesignResult: true, imageUrls } : bubble,
            ),
        )
    }
    const removeGeneratingCard = (id: string) => {
        setBubbles((prev) => prev.filter((bubble) => bubble.id !== id))
    }
    // 생성 중 카드에 완성 이미지를 채우고, 이미지가 카드에 다 나타난 뒤(handleDesignCardShown)에 완성 멘트와
    // "이 디자인 마음에 드시나요?" 선택 창을 띄운다. 그때까지는 생성 중 상태(입력 막힘, 기다려 달라는 안내)를 유지한다.
    // 이미지가 끝내 안 뜨는 경우에도 멈춰 있지 않도록 일정 시간이 지나면 그냥 띄운다.
    const pendingCardRevealsRef = useRef(new Map<string, () => void>())
    const completeGeneratingCard = (cardId: string, imageUrls: string[], message: string) => {
        let revealed = false
        const reveal = () => {
            if (revealed) return
            revealed = true
            pendingCardRevealsRef.current.delete(cardId)
            pushAssistant(message)
            setActiveQuickReply(DESIGN_FEEDBACK_QUICK_REPLY)
            setIsSending(false)
            setIsGeneratingDesign(false)
        }
        fillGeneratingCard(cardId, imageUrls)
        if (imageUrls.length === 0) {
            reveal()
            return
        }
        pendingCardRevealsRef.current.set(cardId, reveal)
        window.setTimeout(reveal, CARD_REVEAL_TIMEOUT_MS)
    }
    const handleDesignCardShown = (cardId: string) => {
        pendingCardRevealsRef.current.get(cardId)?.()
    }
    const pushUser = (text: string, marks?: BubbleMarks) => {
        const id = makeId()
        setBubbles((prev) => [...prev, { id, role: 'user', text, ...marks }])
        return id
    }
    const pushUserColors = (
        text: string,
        colorSwatches: string[],
        options: { colorsInline?: boolean; textAfterColors?: string; chatOnly?: boolean } = {},
    ) => {
        const id = makeId()
        setBubbles((prev) => [...prev, { id, role: 'user', text, colorSwatches, ...options }])
        return id
    }

    // ── 초기화 ─────────────────────────────────────────────────────────────
    // 닉네임·손 분석 기록은 사이드바(useDesignChatWorkspace)가 불러와 넘겨 주고, 여기서는 채팅 세션만 만든다.
    useEffect(() => {
        // 이력에서 연 채팅·뒤로가기로 돌아온 채팅은 세션·대화 내역이 다 남아 있으므로 그대로 이어서 쓴다.
        if (wasRestored) return

        let cancelled = false
        const initChatSession = async () => {
            // "디자인 다시 생성하기"로 들어온 경우, 그 디자인을 만든 세션을 그대로 이어써야
            // "이어서 수정하기"가 그 세션의 마지막 디자인을 기준으로 refine된다. 새 세션을
            // 만들면 서버가 이어서 수정할 대상을 찾지 못한다 — 세션 복원/초기 안내는 별도
            // 이펙트(아래 채팅 이력 복원)에서 처리하므로 여기서는 세션 생성만 건너뛴다.
            if (regenerateState) {
                setSessionId(regenerateState.sessionId ?? null)
                setIsSessionReady(true)
                return
            }
            try {
                const id = await createChatSession()
                if (!cancelled) setSessionId(id)
            } catch {
                if (!cancelled) {
                    pushAssistant('채팅 세션을 시작하지 못했어요. 새로고침 후 다시 시도해 주세요.')
                }
            } finally {
                if (!cancelled) setIsSessionReady(true)
            }
        }

        void initChatSession()
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const isMountedRef = useRef(true)
    useEffect(() => {
        isMountedRef.current = true
        return () => {
            isMountedRef.current = false
        }
    }, [])

    // 채팅 세션이 생기면 사이드바에 알려 지금 채팅을 이력에서 표시하게 한다
    const onSessionReadyRef = useRef(onSessionReady)
    useEffect(() => {
        onSessionReadyRef.current = onSessionReady
    })
    // 숨겨 둔 채팅은 사이드바에 알리지 않고, 다시 화면에 띄울 때 알린다
    useEffect(() => {
        if (sessionId && !isBackground) onSessionReadyRef.current?.(sessionId)
    }, [sessionId, isBackground])

    // 인사말은 한 번만 붙인다 — 인사 전에 사이드바에서 분석 기록을 바꾸면 준비 상태가 잠깐 풀렸다 다시 잡힐 수 있다
    const hasGreetedRef = useRef(false)
    useEffect(() => {
        // 복원된 마운트에서는 이미 인사말을 포함한 이전 대화가 남아있으므로 다시 붙이지 않는다.
        if (!isInitReady || wasRestored || hasGreetedRef.current) return
        hasGreetedRef.current = true

        // "디자인 다시 생성하기"로 들어온 경우 — 그 디자인을 만들 때 나눈 채팅 내역을 그대로
        // 불러와 복원하고, 이어서 수정할지 처음부터 새로 만들지 물어본다.
        if (regenerateState) {
            getDesignChatHistory(regenerateState.designId)
                .then((history: DesignChatMessage[]) => {
                    if (!isMountedRef.current) return
                    // 확정 때 저장한 채팅 화면 대화면 말풍선 모양(색 동그라미·이력에만 보이는 말풍선 등)까지 그대로 되살린다
                    const restoredBubbles: ChatBubble[] = history.map((msg) => ({
                        id: makeId(),
                        role: msg.role,
                        text: msg.content,
                        imageUrls: msg.imageUrls ?? undefined,
                        colorSwatches: msg.colorSwatches ?? undefined,
                        colorsInline: msg.colorsInline ?? undefined,
                        textAfterColors: msg.textAfterColors ?? undefined,
                        isDesignResult: msg.designResult ?? (msg.role === 'assistant' && !!msg.imageUrls?.length),
                        historyOnly: msg.historyOnly ?? undefined,
                        chatOnly: msg.chatOnly ?? undefined,
                        historySection: msg.historySection ?? undefined,
                        generationMethod: msg.generationMethod ?? undefined,
                    }))
                    // 선택지 기반 답장은 예전에 저장된 대화라도 지금 구조로 (채팅엔 정해진 멘트, 마이페이지 이력엔 GPT 답장)
                    const displayedBubbles = splitRestoredPreferenceReplies(restoredBubbles)
                    setBubbles((prev) => [...displayedBubbles, ...prev])
                })
                .catch(() => {
                    // 이력을 못 불러와도(옛 디자인 등) 계속/새로 만들기 선택 자체는 가능해야 한다.
                    if (isMountedRef.current) pushAssistant('이전 대화 내역을 불러오지 못했어요.')
                })
                .finally(() => {
                    if (!isMountedRef.current) return
                    setLastDesign({
                        designId: regenerateState.designId,
                        imageUrls: regenerateState.imageUrls,
                        prompt: '',
                        preferences: regenerateState.preferences,
                        source: (regenerateState.context.source as GenerationSource) ?? 'freeform',
                        shapeId: regenerateState.shapeId,
                        details: regenerateState.details,
                        context: regenerateState.context,
                    })
                    pushAssistant('이 디자인을 이어서 수정할까요, 아니면 처음부터 새로 만들까요?')
                    setActiveQuickReply(REGENERATE_CHOICE_QUICK_REPLY)
                })
            return
        }

        const greetingName = userName ? `${userName}님` : '회원님'
        // 마지막 줄은 진입 상황마다 다르다 —
        // 분석 결과를 못 불러왔으면(촬영/분석 기록 없음) 스캔을 권하고, 있으면 어느 기록을 반영하는지 알려 준 뒤
        // 단독으로 들어왔으면(기록을 고를 수 있음) 다른 기록으로 새 채팅을 여는 법(채팅 이력의 +)을,
        // 손 촬영 → 출력에서 이어 온 흐름(그때 분석한 결과에 고정)이면 결과 다시 보기(사이드바 '분석 결과 상세 보기')를 안내한다.
        const hasScanAnalysis = !!(leftAnalysis || rightAnalysis)
        // 반영하는 기록은 피부톤과 대표 피부색 헥스값으로 알려 준다 — 예: "웜톤(#E8C4A8) 결과에 맞춰…"
        const toneLabel = analysisSummary?.detectedToneLabel?.replace(/\s+/g, '') ?? null
        const toneHex = analysisSummary?.skinToneHex?.toUpperCase() ?? null
        const recordName = toneLabel && toneHex ? `${toneLabel}(${toneHex})` : toneLabel ?? toneHex
        const recordLine = recordName ? `${recordName} 결과에 맞춰 디자인해 드릴게요.` : '선택한 손 분석 결과에 맞춰 디자인해 드릴게요.'
        const guideLine = !hasScanAnalysis
            ? `손을 스캔하면 ${greetingName}의 손에 더욱 어울리는 디자인을 생성할 수 있어요.`
            : canSelectSession
                ? `${recordLine} 다른 분석 기록으로 만들고 싶다면 왼쪽 채팅 이력에서 그 기록의 + 버튼을 눌러 주세요.`
                : `${recordLine} 분석 결과는 왼쪽의 '분석 결과 상세 보기'에서 다시 확인할 수 있어요.`
        setBubbles((prev) => [
            {
                id: makeId(),
                role: 'assistant',
                text: `반가워요, ${greetingName}!\n원하시는 네일 디자인 생성 방식을 선택해 주세요.\n${guideLine}`,
                historySection: 'method',
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

    // ── 채팅 저장 (사이드바 채팅 이력) ──────────────────────────────────────
    // 사용자가 한 번이라도 말한 채팅부터 저장한다 — 인사만 보고 나간 채팅은 이력에 남기지 않는다.
    const hasProgress = bubbles.some((bubble) => bubble.role === 'user')

    const buildSnapshot = (): ConversationSnapshot => ({
        sessionId,
        bubbles,
        activeQuickReply,
        selectedInQuickReply,
        mode,
        preferenceStepIndex,
        preferenceStepBubbleIds,
        collectedPreferences,
        preferenceNotes,
        freeformSelectedColors,
        freeformLog: [...freeformLogRef.current],
        reviseLog: [...reviseLogRef.current],
        lastDesign,
        generationSource,
        selectedPhotoFile,
        selectedPhotoPreviewUrl,
        inputValue,
        isQuickReplyCollapsed,
        designTitle,
    })

    // 저장은 타이머·화면을 떠날 때에도 일어나므로 최신 값을 ref로 읽는다
    const scanKeyRef = useRef(scanKey)
    const onSavedRef = useRef(onSaved)
    useEffect(() => {
        scanKeyRef.current = scanKey
        onSavedRef.current = onSaved
    })
    const latestSnapshotRef = useRef<ConversationSnapshot | null>(null)
    const lastSavedPayloadRef = useRef<string | null>(null)
    const saveTimerRef = useRef<number | null>(null)

    const buildSavePayload = (snapshot: ConversationSnapshot) => {
        const payload = {
            state: serializeConversationSnapshot(snapshot),
            scanKey: scanKeyRef.current,
            autoTitle: snapshot.designTitle ?? buildProvisionalChatTitle(snapshot),
        }
        return { payload, payloadJson: JSON.stringify(payload) }
    }

    // 이력에서 연 채팅은 열기만 해서는 저장하지 않는다 — 저장하면 마지막 활동 시각이 바뀌어 이력 순서가 달라진다
    const isFirstSnapshotRef = useRef(wasRestored)

    const persistSnapshot = (snapshot: ConversationSnapshot, options: { keepalive?: boolean } = {}) => {
        if (!snapshot.sessionId || !snapshot.bubbles.some((bubble) => bubble.role === 'user')) return
        if (deletedSessionIds.has(snapshot.sessionId)) return
        const { payload, payloadJson } = buildSavePayload(snapshot)
        if (payloadJson === lastSavedPayloadRef.current) return
        lastSavedPayloadRef.current = payloadJson
        saveChatState(snapshot.sessionId, payload, options)
            .then((summary) => onSavedRef.current?.(summary))
            .catch((e) => {
                // 다음 변경 때 다시 저장되도록 기록을 지운다
                lastSavedPayloadRef.current = null
                console.error('채팅 저장 실패:', e)
            })
    }

    const flushPendingSave = (options: { keepalive?: boolean } = {}) => {
        if (saveTimerRef.current) {
            window.clearTimeout(saveTimerRef.current)
            saveTimerRef.current = null
        }
        if (latestSnapshotRef.current) persistSnapshot(latestSnapshotRef.current, options)
    }

    // 새로고침·탭 닫기로 떠날 때 멈춘 자리를 정리해 저장하는 데 쓴다 (handlePageHide)
    const busyRef = useRef({ isSending, isGeneratingDesign })

    // 렌더될 때마다 지금 상태를 스냅샷으로 남기고(뒤로가기 복원용), 잠시 뒤 서버에 저장한다
    useEffect(() => {
        const snapshot = buildSnapshot()
        // 뒤로가기 복원은 화면에 떠 있는 채팅만 — 숨겨 둔 채팅이 덮어쓰지 않게 한다 (서버 저장은 그대로 한다)
        if (!isBackground) liveConversationSnapshot = snapshot
        latestSnapshotRef.current = snapshot
        busyRef.current = { isSending, isGeneratingDesign }
        if (isFirstSnapshotRef.current) {
            isFirstSnapshotRef.current = false
            lastSavedPayloadRef.current = buildSavePayload(snapshot).payloadJson
            return
        }
        if (!snapshot.sessionId || !hasProgress) return
        if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = window.setTimeout(() => {
            saveTimerRef.current = null
            persistSnapshot(snapshot)
        }, SAVE_DEBOUNCE_MS)
    })

    // 채팅이 내려가면(언마운트) 기다리던 저장을 바로 보낸다. 페이지를 아예 떠날 때(새로고침·탭 닫기)는 keepalive로 보내고,
    // 답변·디자인을 기다리던 중이었으면 그 진행은 여기서 멈추므로 멈춘 자리를 정리해 저장한다 (buildInterruptedSnapshot)
    useEffect(() => {
        const handlePageHide = (e: PageTransitionEvent) => {
            const snapshot = latestSnapshotRef.current
            if (!snapshot) return
            if (saveTimerRef.current) {
                window.clearTimeout(saveTimerRef.current)
                saveTimerRef.current = null
            }
            const { isSending: wasSending, isGeneratingDesign: wasGenerating } = busyRef.current
            // 뒤로/앞으로 캐시(bfcache)에 남는 이동이면 페이지가 그대로 살아 돌아오므로 정리하지 않는다
            persistSnapshot(wasSending && !e.persisted ? buildInterruptedSnapshot(snapshot, wasGenerating) : snapshot, {
                keepalive: true,
            })
        }
        window.addEventListener('pagehide', handlePageHide)
        return () => {
            window.removeEventListener('pagehide', handlePageHide)
            flushPendingSave()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // 진행 상황을 알린다 — 화면에 있든 숨겨 두었든 늘 (designChatRuntime: 채팅을 내릴 때 숨겨 둔 채 계속할지,
    // "새 채팅"을 다시 눌렀을 때 새로 열지, 사이드바 채팅 이력의 상태 점)
    const onStatusChangeRef = useRef(onStatusChange)
    useEffect(() => {
        onStatusChangeRef.current = onStatusChange
    })
    const designCount = useMemo(() => bubbles.filter((bubble) => bubble.isDesignResult).length, [bubbles])
    // 선택지 기반에서 고른 내용을 보내고 답장을 기다리는 동안도 디자인을 만드는 과정이다 (입력창 안내 문구와 같은 기준)
    const isMakingDesign = isGeneratingDesign || (mode === 'preference' && isSending)
    useEffect(() => {
        onStatusChangeRef.current?.({
            sessionId,
            hasProgress,
            isBusy: isSending,
            isGeneratingDesign: isMakingDesign,
            designCount,
        })
    }, [sessionId, hasProgress, isSending, isMakingDesign, designCount])

    // 채팅은 계속 저장되고, 답변·디자인을 기다리는 채팅은 다른 채팅이나 다른 페이지로 옮겨도 숨겨 둔 채 계속 진행되므로
    // (designChatRuntime) 앱 안에서 옮길 때는 묻지 않는다. 그 진행을 멈추는 건 새로고침·탭 닫기뿐이라 그때만 확인한다.
    // (beforeunload의 커스텀 문구는 브라우저 보안 정책상 표시되지 않고 브라우저 기본 확인 문구만 뜬다.)
    useEffect(() => {
        if (!isSending) return
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault()
            e.returnValue = '' // 크롬 등 일부 브라우저는 빈 문자열 지정이 필요함
        }
        window.addEventListener('beforeunload', handleBeforeUnload)
        return () => window.removeEventListener('beforeunload', handleBeforeUnload)
    }, [isSending])

    // ── 공통: 디자인 생성 후 이동 ───────────────────────────────────────────
    const resolveShapeId = (preferences: NailDesignPreferences): NailShapeId => {
        const fromPrefs = preferences.shape[0]
        const fromScan = leftAnalysis?.shape || rightAnalysis?.shape
        return (fromPrefs || fromScan || 'oval') as NailShapeId
    }

    // 선택지 기반 결과 페이지 "키워드" 칩: 고른 선택지(한글 이름) + "기타"에 직접 적은 의견에서 나온 키워드.
    // "기타" 의견은 자유 입력과 같은 방식으로 보여 준다 — 서버(GPT)가 요약 문장에서 뽑아 둔 슬롯 값을 사전·번역으로
    // 한글로 바꾼 키워드(slotKeywords) 중 고른 선택지·컬러와 겹치지 않는 것. 기타 의견을 안 적었으면 고른 선택지만.
    // 플랜에서 나온 마감·패턴 등(서버 keywords)은 섞지 않는다. 컬러는 buildPreferenceColors로 따로.
    const buildPreferenceKeywords = (
        preferences: NailDesignPreferences,
        notes: Partial<Record<PreferenceKey, string>>,
        data: DesignGenerateResponse,
    ): string[] => {
        // 고른 순서(선택 단계 순서) 그대로 — 컬러는 마지막 단계라 결과 화면에서도 맨 뒤에 붙는다
        const keys = PREFERENCE_STEPS.filter((key) => key !== 'color')
        const chosenLabels = keys.flatMap((key) =>
            (preferences[key] ?? []).map((value) => PREFERENCE_OPTIONS[key].find((o) => o.value === value)?.label ?? value),
        )
        const hasNote = PREFERENCE_NOTE_STEPS.some((key) => notes[key]?.trim())
        const colorNames = new Set((data.keywordColors ?? []).map((color) => color.name))
        const noteKeywords = hasNote ? (data.slotKeywords ?? []).filter((keyword) => !colorNames.has(keyword)) : []
        return Array.from(new Set([...chosenLabels, ...noteKeywords])).filter(
            (label) => label && label !== '상관없음' && label !== '없음',
        )
    }

    // 선택지에서 고른 컬러 — 결과 화면에서 색 스와치 + 한글 색 이름 칩으로 보여준다
    const buildPreferenceColors = (preferences: NailDesignPreferences): KeywordColor[] =>
        (preferences.color ?? []).map((hex) => ({ hex, name: koreanColorName(hex) }))

    // 서버 키워드(자유입력·사진·수정) 중 컬러 키워드는 빼서 hex와 함께 colors로 따로 담는다 — 결과 화면이 색 스와치 칩으로 그린다
    const splitServerKeywords = (
        keywords: string[] | null | undefined,
        keywordColors: KeywordColor[] | null | undefined,
    ): { keywords: string[]; colors: KeywordColor[] } => {
        const colors = keywordColors ?? []
        const colorNames = new Set(colors.map((color) => color.name))
        return { keywords: (keywords ?? []).filter((keyword) => !colorNames.has(keyword)), colors }
    }

    // 수정(refine) 후 결과 화면 키워드 — 서버가 수정을 반영해 돌려준 키워드로 교체한다.
    // 선택지 기반은 플랜 키워드(마감·패턴 등)가 섞이지 않게 슬롯(고른 값)만으로 만든 키워드를 쓴다.
    // 서버 키워드가 비었으면 이전 키워드를 그대로 둔다.
    const buildRevisedKeywords = (
        data: DesignGenerateResponse,
        previous: GenerationContext | undefined,
    ): { keywords: string[]; colors: KeywordColor[] } => {
        const serverKeywords = previous?.source === 'preference' ? data.slotKeywords : data.keywords
        if (!serverKeywords || serverKeywords.length === 0) {
            return { keywords: previous?.keywords ?? [], colors: previous?.colors ?? [] }
        }
        return splitServerKeywords(serverKeywords, data.keywordColors)
    }

    // 자유입력 흐름에서 사용자가 실제로 입력한 문장들을 짧은 키워드 단위로 쪼갠다.
    const buildFreeformKeywords = (log: string[]): string[] => {
        const phrases = log
            .flatMap((message) => message.split(/[,，./!?\n]+/))
            .map((phrase) => phrase.trim())
            .filter((phrase) => phrase.length >= 2)
        return Array.from(new Set(phrases)).slice(0, 12)
    }

    const buildScanAutoIntro = (): string => {
        const toneLabel = analysisSummary?.detectedToneLabel ?? null
        // 분석 결과 패널과 동일하게 recommendedShape를 쓴다 (출력 신청 시 유저가 고른 쉐입으로
        // 덮어써지는 mutable shape가 아니라, 스캔 분석이 처음 추천한 값).
        const shapeLabel = analysisSummary?.detectedShapeLabel ?? null

        const name = userName ? `${userName}님` : '회원님'
        const tonePart = toneLabel ?? '피부톤'
        const shapePart = shapeLabel ? `${shapeLabel} 추천 쉐입` : '추천 쉐입'

        return `${name}의 스캔 정보를 기반으로 NAILY가 디자인을 추천해요. ${tonePart}에 어울리는 추천 컬러와 ${shapePart}을 반영해 ${name}께 어울리는 디자인을 만들어 드릴게요!`
    }

    // cardId: 선택지 흐름처럼 생성 전에 이미 생성 중 카드를 띄워 둔 경우 그 카드를 이어서 쓴다
    const runGenerateDesign = async (preferences: NailDesignPreferences, source: GenerationSource, cardId?: string) => {
        if (!sessionId) {
            if (cardId) removeGeneratingCard(cardId)
            pushAssistant('채팅 세션이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.')
            return
        }

        setGenerationSource(source)
        setIsSending(true)
        setIsGeneratingDesign(true)
        setActiveQuickReply(null)
        const generatingCardId = cardId ?? pushGeneratingCard()
        // 성공하면 생성 중 상태 해제를 completeGeneratingCard(이미지가 뜬 뒤)에 넘긴다
        let revealPending = false

        try {
            const data = await generateDesign({
                sessionId,
                scanId,
                // 스캔 자동 생성일 때만 서버에 알려서, "?" 패널에 보이는 추천 쉐입 +
                // 추천 컬러 팔레트만으로 (원컬러 아닌) 디자인을 만들게 한다.
                mode: source === 'scan-auto' ? 'scan-auto' : undefined,
            })

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
                                toneLabel: analysisSummary.toneLabel,
                                shapeLabel: analysisSummary.shapeLabel,
                                avgLength: analysisSummary.avgLength,
                                avgWidth: analysisSummary.avgWidth,
                                avgCurve: analysisSummary.avgCurve,
                                skinToneHex: analysisSummary.skinToneHex,
                                shapeImage: analysisSummary.shapeImage,
                                // 추천 팔레트는 "?" 패널과 동일하게 정렬해서, 실제 반영된 색을 강조 표시한다.
                                recommendedColors: sortRecommendedColors(
                                    data.scanAutoReflection?.recommendedColors ?? analysisSummary.skinTonePalette,
                                ),
                                usedColors: data.scanAutoReflection?.usedColors ?? [],
                                reflectedMood: data.scanAutoReflection?.mood ?? null,
                                reflectedDesignType: data.scanAutoReflection?.designType ?? null,
                                reflectedMotif: data.scanAutoReflection?.motif ?? null,
                                reflectedSeason: data.scanAutoReflection?.season ?? null,
                            }
                            : null,
                        revisionKeywords,
                    }
                    : source === 'freeform'
                        ? {
                            source,
                            // 서버가 슬롯(무드/타입/모티프/쉐입/컬러)과 플랜에서 뽑아 한글로 정리한 키워드를 우선 쓴다.
                            // 사용자가 친 문장을 쪼개 칩으로 쓰는 건 서버 키워드가 비었을 때의 폴백으로만 사용한다.
                            ...(data.keywords && data.keywords.length > 0
                                ? splitServerKeywords(data.keywords, data.keywordColors)
                                : { keywords: buildFreeformKeywords(freeformLogRef.current), colors: [] }),
                            referenceImageUrl: null,
                            handSummary: null,
                            revisionKeywords,
                        }
                        : {
                            source,
                            // 선택지 기반은 사용자가 고른 값만 보여준다 (서버 키워드를 쓰지 않는다)
                            keywords: buildPreferenceKeywords(preferences, preferenceNotes, data),
                            colors: buildPreferenceColors(preferences),
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
                // 스캔 자동 생성은 서버가 recommendedShape로 강제 고정하므로, 결과/AR 미리보기도
                // "?" 패널과 같은 recommendedShape 기준으로 맞춘다.
                shapeId:
                    source === 'scan-auto' && analysisSummary?.shapeId
                        ? (analysisSummary.shapeId as NailShapeId)
                        : resolveShapeId(preferences),
                details: data.details,
                context,
            })

            // 채팅 이름은 이번 디자인의 분위기로 다시 짓는다 (서버 키워드가 없으면 결과 화면 키워드로)
            setDesignTitle((prev) => buildDesignChatTitle(data.keywords?.length ? data.keywords : context.keywords) ?? prev)

            // 완성 멘트·선택 창과 생성 중 상태 해제는 이미지가 카드에 뜬 뒤 completeGeneratingCard가 맡는다
            completeGeneratingCard(generatingCardId, data.imageUrls, DESIGN_COMPLETE_MESSAGE)
            revealPending = true
        } catch (e) {
            console.error('디자인 생성 실패:', e)
            removeGeneratingCard(generatingCardId)
            pushAssistant('이미지 생성에 실패했어요. 다시 시도해 주세요.', { historySection: 'method' })
            setActiveQuickReply(MENU_QUICK_REPLY)
            setMode('menu')
        } finally {
            if (!revealPending) {
                setIsSending(false)
                setIsGeneratingDesign(false)
            }
        }
    }

    // 업로드한 참고 사진(+스캔 정보) 기반 생성
    // photoBubbleId: 내가 보낸 사진 말풍선 — 생성이 끝나면 사진 미리보기를 서버에 올라간 사진 주소로 바꿔
    // 채팅을 저장해도(사이드바 채팅 이력) 사진이 남게 한다
    const runGenerateDesignFromPhoto = async (file: File, note?: string, photoBubbleId?: string) => {
        if (!sessionId) {
            pushAssistant('채팅 세션이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.')
            return
        }

        setGenerationSource('photo')
        setIsSending(true)
        setIsGeneratingDesign(true)
        setActiveQuickReply(null)
        pushAssistant('좋아요! 업로드해 주신 사진을 참고해서 디자인을 만들어 드릴게요.')
        const generatingCardId = pushGeneratingCard()
        // 성공하면 생성 중 상태 해제를 completeGeneratingCard(이미지가 뜬 뒤)에 넘긴다
        let revealPending = false

        try {
            const data = await generateDesignFromImage({ sessionId, scanId, image: file, note })
            const uploadedPhotoUrl = data.referenceImageUrl ?? null
            if (uploadedPhotoUrl && photoBubbleId) {
                setBubbles((prev) =>
                    prev.map((bubble) => (bubble.id === photoBubbleId ? { ...bubble, imageUrls: [uploadedPhotoUrl] } : bubble)),
                )
            }
            setDesignTitle((prev) => buildDesignChatTitle(data.keywords) ?? prev)
            setLastDesign({
                designId: data.designId,
                imageUrls: data.imageUrls,
                prompt: data.generatedPrompt,
                preferences: INITIAL_PREFERENCES,
                source: 'photo',
                shapeId: resolveShapeId(INITIAL_PREFERENCES),
                details: data.details,
                context: {
                    source: 'photo',
                    ...splitServerKeywords(data.keywords, data.keywordColors), // 서버가 슬롯 + 플랜(마감/패턴/모티프/파츠)에서 뽑은 키워드
                    referenceImageUrl: uploadedPhotoUrl ?? selectedPhotoPreviewUrl,
                    handSummary: null,
                    revisionKeywords: buildFreeformKeywords(reviseLogRef.current),
                },
            })
            completeGeneratingCard(generatingCardId, data.imageUrls, DESIGN_COMPLETE_MESSAGE)
            revealPending = true
        } catch (e) {
            console.error('사진 기반 디자인 생성 실패:', e)
            removeGeneratingCard(generatingCardId)
            pushAssistant('이미지 생성에 실패했어요. 다시 시도해 주세요.', { historySection: 'method' })
            setActiveQuickReply(MENU_QUICK_REPLY)
            setMode('menu')
        } finally {
            if (!revealPending) {
                setIsSending(false)
                setIsGeneratingDesign(false)
            }
        }
    }

    // ── 메뉴 선택 ──────────────────────────────────────────────────────────
    const handleMenuSelect = (option: QuickReplyOption) => {
        pushUser(option.label, { historySection: 'method' })
        setActiveQuickReply(null)
        reviseLogRef.current = [] // 새 생성 방식을 고르는 시점 = 새 디자인 흐름 시작이므로, 이전 수정 요청 기록은 비운다

        switch (option.value) {
            case 'preference': {
                startPreferenceFlow()
                break
            }
            case 'freeform': {
                setMode('freeform')
                freeformLogRef.current = []
                setFreeformSelectedColors([]) // 새 자유입력 세션 시작 — 이전 세션에서 고르던 색이 섞이지 않게 초기화
                pushAssistant('원하시는 네일 디자인에 대해 자유롭게 이야기해 주세요! 원하는 분위기, 스타일, 색감 등 무엇이든 좋아요!', {
                    historySection: 'method',
                    generationMethod: 'freeform',
                })
                break
            }
            case 'photo': {
                // 사진 기반 생성에는 스캔 정보(추천 쉐입)가 반영되지 않으므로 스캔 유무와 상관없이 바로 사진을 받는다
                setMode('photo')
                setSelectedPhotoFile(null)
                setSelectedPhotoPreviewUrl(null)
                pushAssistant('원하시는 스타일의 참고 사진을 첨부해 주세요!', { historySection: 'method', generationMethod: 'photo' })
                setActiveQuickReply(PHOTO_UPLOAD_QUICK_REPLY)
                break
            }
            case 'scan-auto': {
                setMode('scan-auto')
                if (!scanId) {
                    pushAssistant('아직 손 스캔 정보가 없어서 이 방식으로는 디자인을 만들 수 없어요.', { historySection: 'method' })
                    setActiveQuickReply({
                        id: `scan-required-${makeId()}`,
                        question: '어떻게 하시겠어요?',
                        options: [
                            { value: '__go_to_scan__', label: '스캔하러 가기' },
                            { value: '__back_to_menu__', label: '다른 방식으로 생성하기' },
                        ],
                        multi: false,
                        limit: 1,
                        layout: 'list',
                    })
                    break
                }
                // 고르자마자 어떤 스캔 정보(피부톤 추천 컬러·추천 쉐입)를 반영하는지 알려 주고 바로 생성한다
                // 어떤 스캔 정보를 반영하는지 알려 주는 멘트라 마이페이지 채팅 이력에도 남긴다(생성 방식 고르기에 넣지 않는다)
                pushAssistant(buildScanAutoIntro(), { generationMethod: 'scan-auto' })
                void runGenerateDesign(INITIAL_PREFERENCES, 'scan-auto')
                break
            }
        }
    }

    // ── 선택지 기반 흐름 ───────────────────────────────────────────────────
    // 메뉴의 "선택지 기반으로 만들기"와, 자유입력 중 "선택지로 바꿔줘" 전환이 함께 쓰는 시작 처리.
    // 이전 흐름에서 눌러뒀던 선택값/기타 의견/입력창 글자가 첫 단계에 섞여 보이지 않게 모두 비운다.
    const startPreferenceFlow = () => {
        setMode('preference')
        setPreferenceStepIndex(0)
        setCollectedPreferences(INITIAL_PREFERENCES)
        setPreferenceNotes({})
        setSelectedInQuickReply([])
        clearInput()
        pushAssistant('좋아요! 몇 가지만 골라 주시면 바로 디자인을 만들어 드릴게요.', {
            historySection: 'method',
            generationMethod: 'preference',
        })
        setActiveQuickReply(buildPreferenceQuickReply(PREFERENCE_STEPS[0]))
    }

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
        const note = PREFERENCE_NOTE_STEPS.includes(step) ? preferenceNotes[step]?.trim() ?? '' : ''
        // 단계별 선택 말풍선은 채팅 화면에만 보이고, 마이페이지 채팅 이력에서는 서버로 보낸 요약 문장 하나로 대신한다
        const bubbleId =
            step === 'color'
                ? // 색을 골랐으면 "컬러: ●●" 한 줄 + 그 아래 줄에 "기타(…)", 기타 입력만 했으면 "컬러: 기타(…)" 한 줄
                values.length > 0
                    ? pushUserColors(`${PREFERENCE_SECTION_LABELS.color}:`, values, {
                        colorsInline: true,
                        textAfterColors: note ? `기타(${note})` : undefined,
                        chatOnly: true,
                    })
                    : pushUserColors(`${PREFERENCE_SECTION_LABELS.color}:${note ? ` 기타(${note})` : ''}`, values, {
                        chatOnly: true,
                    })
                : pushUser(
                    `${PREFERENCE_SECTION_LABELS[step]}: ${
                        [
                            ...values.map((v) => PREFERENCE_OPTIONS[step].find((o) => o.value === v)?.label ?? v),
                            ...(note ? [`기타(${note})`] : []),
                        ].join(', ') || '선택 안 함'
                    }`,
                    { chatOnly: true },
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
            // 고른 내용을 서버에 보내고, 정해진 네일리 멘트를 보여 준 뒤 디자인을 만든다
            void finalizePreferenceDesign(updated, preferenceNotes)
        }
    }

    const setPreferenceNote = (step: PreferenceKey, value: string) => {
        setPreferenceNotes((prev) => ({ ...prev, [step]: value.slice(0, getPreferenceNoteMaxLength(step)) }))
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

    // 선택지에서 고른 내용을 "무드는 …, 디자인 타입은 … 로 해주세요." 형태의 문장으로 만든다. 고른 게 없으면 ''.
    // "기타" 의견은 키워드로 다듬어서(예: "몽환적인 느낌" → "몽환적") 해당 카테고리의 선택값 바로 뒤에
    // 같은 값처럼 붙인다 — 채팅 쪽에서 슬롯으로 변환되고, 백엔드가 디자인 플랜 생성에 넘기는 "사용자
    // 원문"에도 그대로 실리게 하기 위함(원문이 길면 뒷부분이 잘리므로 기타 의견이 들어가는
    // 분위기/디자인 타입/모티프를 앞쪽에 둔다).
    // "무드는 …, 디자인 타입은 …, 컬러는 …" 부분만. 고른 게 없으면 ''.
    // 백엔드가 값 그대로 알아듣도록 원래 값(영문·hex)을 쓴다.
    const buildPreferenceSummaryBody = (
        preferences: NailDesignPreferences,
        notes: Partial<Record<PreferenceKey, string>> = {},
    ): string => {
        const describe = (key: PreferenceKey, prefix: string) => {
            const values = preferences[key] ?? []
            // 컬러 기타 입력은 "2번째 색은 포인트로만" 같은 문장이라 키워드로 쪼개지 않고,
            // buildPreferenceSummary가 따로 한 줄로 붙인다.
            const noteKeywords = key !== 'color' ? extractNoteKeywords(notes[key] ?? '') : []
            const parts = Array.from(new Set([...values, ...noteKeywords]))
            return parts.length ? `${prefix} ${parts.join(', ')}` : null
        }
        const parts = [
            describe('mood', '무드는'),
            describe('designType', '디자인 타입은'),
            describe('motif', '모티프는'),
            describe('season', '계절은'),
            describe('shape', '쉐입은'),
            describe('color', '컬러는'),
        ].filter(Boolean)
        return parts.join(', ')
    }

    const buildPreferenceSummary = (
        preferences: NailDesignPreferences,
        notes: Partial<Record<PreferenceKey, string>> = {},
    ): string => {
        const colorNote = notes.color?.trim() ?? ''
        if (!colorNote) {
            const body = buildPreferenceSummaryBody(preferences, notes)
            return body ? body + '로 해주세요.' : ''
        }
        // 컬러 기타 입력이 있으면 예전(기타 입력이 자유 입력으로 넘어가던 때)과 같은 형식으로 보낸다 —
        // 컬러를 뺀 요약 + 고른 색을 순서 번호와 함께 알려 주는 문장, 다음 줄에 기타 입력 문장 그대로.
        const body = buildPreferenceSummaryBody({ ...preferences, color: [] }, notes)
        const priorContext = [body ? body + '로 해주세요.' : '', buildPickedColorsContext(preferences.color)]
            .filter(Boolean)
            .join(' ')
        return priorContext ? `${priorContext}\n${colorNote}` : colorNote
    }

    const finalizePreferenceDesign = async (
        preferences: NailDesignPreferences,
        notes: Partial<Record<PreferenceKey, string>>,
    ) => {
        if (!sessionId) {
            pushAssistant('채팅 세션이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.')
            return
        }

        // 아래 요약 메시지 전송(GPT 응답 대기)부터 runGenerateDesign이 이어받을 때까지 입력창을 잠가 둔다.
        // 안 그러면 그 몇 초 사이에 채팅을 치면 자유 입력 흐름으로 넘어가 버린다.
        // 답장을 기다리는 동안은 채팅 답변 대기 표시('…')가 보이고, 답장이 온 뒤에 생성 중 카드를 띄운다.
        setIsSending(true)

        // 선택지에서 고른 내용을 자연어 문장으로 조립해서, 실제 Gemini와 연동된
        // /chats/{sessionId}/messages(sendChatMessage)로 전송한다.
        // 예전에는 /chats/{sessionId}/preferences(savePreferences, 레거시 API)를 호출했는데,
        // 이 엔드포인트는 더 이상 백엔드의 SlotData 기반 슬롯 시스템과 연결되어 있지 않아서
        // 여기서 고른 shape/color/season 등이 최종 프롬프트에 반영되지 않는 문제가 있었다.
        const summaryMessage = buildPreferenceSummary(preferences, notes) || '로 해주세요.'

        try {
            const res = await sendChatMessage(sessionId, summaryMessage)
            // 요약 문장과 서버(GPT) 답장은 채팅 화면엔 안 보이고, 마이페이지 채팅 이력에서 단계별 선택 대신 보여 준다.
            // 답장은 의견을 묻는 말처럼 흐름에 안 맞는 끝말을 떼고 "~진행할게요."로 끝나게 다듬는다.
            pushUser(summaryMessage, { historyOnly: true })
            pushAssistant(trimPreferenceReply(res.reply), { historyOnly: true })
        } catch {
            // 전송 실패해도 스캔 기반 기본값으로 계속 진행
        }
        // 채팅 화면엔 GPT 답장 대신 늘 같은 멘트를 보여 주고, 마이페이지 이력에서는 뺀다 (서버에 저장된 답장은 그대로)
        pushAssistant(PREFERENCE_REPLY_MESSAGE, { chatOnly: true })
        setIsGeneratingDesign(true)
        const generatingCardId = pushGeneratingCard()
        await runGenerateDesign(preferences, 'preference', generatingCardId)
    }

    // ── 자유 입력(Gemini 채팅) 흐름 ────────────────────────────────────────
    const handleDesignFeedback = (option: QuickReplyOption) => {
        pushUser(option.label)
        setActiveQuickReply(null)

        if (option.value === 'accept') {
            if (!lastDesign) return
            // 지금 채팅 화면에 보이는 대화(방금 누른 "좋아요! 이 디자인으로 할게요." 포함)를 함께 보내 이 디자인의 채팅 이력으로 저장한다
            // — "디자인 다시 생성하기"와 마이페이지 채팅 이력이 이 대화를 그대로 다시 그린다.
            const chatTranscript: ChatTranscriptEntry[] = [
                ...buildChatTranscript(bubbles),
                { role: 'user', content: option.label },
            ]
            // fire-and-forget — 결과 화면에서 폴링으로 채움
            confirmDesign(lastDesign.designId, chatTranscript).catch((err) => {
                // 확정 API가 실패해도 결과 화면 이동 자체는 막지 않되, 콘솔에는 남긴다
                console.error('디자인 확정(confirm) 실패:', err)
            })
            // 결과 화면으로 바로 넘어가 방금 누른 답이 화면에 그려지지 않으므로, 그 답까지 담아 채팅을 저장해 둔다
            // (사이드바 채팅 이력에서 다시 열면 "좋아요! 이 디자인으로 할게요."까지 보인다)
            const acceptedSnapshot: ConversationSnapshot = {
                ...buildSnapshot(),
                bubbles: [...bubbles, { id: makeId(), role: 'user', text: option.label }],
                activeQuickReply: null,
            }
            if (saveTimerRef.current) {
                window.clearTimeout(saveTimerRef.current)
                saveTimerRef.current = null
            }
            latestSnapshotRef.current = acceptedSnapshot
            persistSnapshot(acceptedSnapshot)
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
        pushAssistant(REVISE_PROMPT_MESSAGE)
    }

    // 진행 상태를 전부 비우고 새 채팅 세션을 만들어 생성 방식 선택 메뉴로 되돌아간다.
    // ("디자인 다시 생성하기"로 들어온 옛 디자인에 이어서 수정할 세션 정보가 없을 때 쓴다)
    const startFreshMenu = async () => {
        reviseLogRef.current = []
        freeformLogRef.current = []
        setCollectedPreferences(INITIAL_PREFERENCES)
        setPreferenceNotes({})
        setSelectedInQuickReply([])
        setFreeformSelectedColors([])
        setLastDesign(null)
        setMode('menu')
        try {
            const id = await createChatSession()
            setSessionId(id)
        } catch {
            pushAssistant('채팅 세션을 시작하지 못했어요. 새로고침 후 다시 시도해 주세요.')
            return
        }
        pushAssistant('알겠어요! 원하시는 네일 디자인 생성 방식을 선택해 주세요.', { historySection: 'method' })
        setActiveQuickReply(MENU_QUICK_REPLY)
    }

    // "디자인 다시 생성하기"로 복원된 채팅에서 "이어서 수정할게요" / "처음부터 새로 만들게요"를
    // 골랐을 때. sessionId가 그 디자인을 만든(=refine 대상 디자인이 들어있는) 세션 그대로이므로,
    // "이어서 수정"은 별도 처리 없이 바로 revise 모드로 들어가면 handleReviseSubmit이 그 세션
    // 기준으로 알아서 이어서 수정해준다.
    const handleRegenerateChoice = (option: QuickReplyOption) => {
        pushUser(option.label)
        setActiveQuickReply(null)

        if (option.value === 'continue') {
            if (!sessionId) {
                // 세션 정보 없는 옛 디자인 — 이어서 수정할 방법이 없으니 새로 시작한다.
                pushAssistant('이 디자인은 이어서 수정할 수 있는 세션 정보가 없어요. 처음부터 새로 만들어 드릴게요.')
                void startFreshMenu()
                return
            }
            setMode('revise')
            pushAssistant(REVISE_PROMPT_MESSAGE)
            return
        }

        // restart — 이 채팅은 그대로 이력에 두고 새 채팅을 연다
        if (onStartNewChat) {
            onStartNewChat()
            return
        }
        void startFreshMenu()
    }

    const handleReviseSubmit = async (text: string) => {
        if (!sessionId) {
            pushAssistant('채팅 세션이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.')
            return
        }
        reviseLogRef.current.push(text)
        setIsSending(true)
        setIsGeneratingDesign(true)
        // 수정 요청을 받았다고 먼저 알리고 그 아래에 생성 중 카드를 띄운다
        const acknowledgeBubbleId = pushAssistant('알겠어요! 말씀하신 내용을 반영해 드릴게요.')
        const generatingCardId = pushGeneratingCard()
        // 성공하면 생성 중 상태 해제를 completeGeneratingCard(이미지가 뜬 뒤)에 넘긴다
        let revealPending = false

        try {
            // ★ refine 결과(inpaint 이미지)를 바로 사용, runGenerateDesign 호출 안 함
            const data = await refineKeywords(sessionId, text)

            // 서버가 "수정 요청이 아니거나 이해하지 못했다"고 안내만 돌려준 경우:
            // 이미지는 그대로 두고(lastDesign 변경 없음) 안내 메시지만 채팅에 보여준다.
            // 반영하지 않았으므로 "반영해 드릴게요" 멘트도 생성 중 카드와 함께 거둔다.
            if (data.assistantMessage) {
                setBubbles((prev) => prev.filter((bubble) => bubble.id !== acknowledgeBubbleId))
                removeGeneratingCard(generatingCardId)
                pushAssistant(data.assistantMessage)
                // 서버가 준 "이렇게 말씀해 보세요" 선택지를 채팅 아래에 보여준다.
                // (직접 입력도 계속 가능 — mode가 'revise'로 유지된다)
                const suggestions = (data.assistantOptions ?? []).filter((s) => s.trim().length > 0)
                if (suggestions.length > 0) {
                    // 화면 라벨에만 문장부호를 붙이고, 수정 요청으로 보내는 값은 서버가 준 문장 그대로 둔다
                    const reviseOptions: QuickReplyOption[] = suggestions.map((s) => ({
                        value: s,
                        label: withSentencePunctuation(s),
                    }))
                    // 지금 디자인을 그대로 확정하는 선택지는 항상 함께 둔다.
                    // 사용자가 "방금 디자인으로 확정할래"처럼 말했으면(confirmSuggested) 맨 위에, 아니면 맨 아래에 둔다.
                    const confirmOption: QuickReplyOption = {
                        value: DESIGN_CONFIRM_FROM_REVISE_VALUE,
                        label: DESIGN_CONFIRM_FROM_REVISE_LABEL,
                        icon: 'party',
                    }
                    setActiveQuickReply({
                        id: 'revise-suggestions',
                        question: data.confirmSuggested
                            ? '이 디자인으로 확정할까요? 다른 수정을 원하시면 골라 주시거나 직접 입력하셔도 좋아요.'
                            : '다음과 같이 수정해 보는 건 어떠세요? 직접 입력하셔도 좋아요.',
                        options: data.confirmSuggested
                            ? [confirmOption, ...reviseOptions]
                            : [...reviseOptions, confirmOption],
                        multi: false,
                        limit: 1,
                        layout: 'list',
                    })
                } else {
                    setActiveQuickReply(DESIGN_FEEDBACK_QUICK_REPLY)
                }
                return
            }

            // 수정한 디자인의 분위기로 채팅 이름도 다시 짓는다
            setDesignTitle((prev) => buildDesignChatTitle(data.keywords) ?? prev)
            setLastDesign({
                designId: data.designId,
                imageUrls: data.imageUrls,
                prompt: data.generatedPrompt ?? '',
                preferences: lastDesign?.preferences ?? collectedPreferences,
                source: lastDesign?.source ?? 'freeform',
                shapeId: lastDesign?.shapeId ?? 'round',
                details: data.details,
                context: {
                    ...(lastDesign?.context ?? {
                        source: 'freeform',
                        keywords: [],
                        referenceImageUrl: null,
                        handSummary: null,
                    }),
                    // 결과 화면 키워드는 "마지막 결과 이미지"에 반영된 옵션만 보여준다:
                    // 서버(RefineService)가 수정을 반영한 슬롯 기준으로 돌려준 키워드로 교체하고
                    // (예: 쉐입을 스퀘어로 바꿨으면 처음 고른 스틸레토는 빠진다),
                    // "수정 요청 문장" 원문은 키워드 칩으로 쌓지 않는다.
                    ...buildRevisedKeywords(data, lastDesign?.context),
                    revisionKeywords: [],
                },
            })

            completeGeneratingCard(generatingCardId, data.imageUrls, REVISE_COMPLETE_MESSAGE)
            revealPending = true

        } catch (e) {
            console.error('수정 실패:', e)
            removeGeneratingCard(generatingCardId)
            pushAssistant('수정 중 문제가 생겼어요. 다시 말씀해 주세요.')
            setActiveQuickReply(DESIGN_FEEDBACK_QUICK_REPLY)
        } finally {
            if (!revealPending) {
                setIsSending(false)
                setIsGeneratingDesign(false)
            }
        }
        // ★ runGenerateDesign / runGenerateDesignFromPhoto 호출 완전히 제거
    }

    // ── 사진 기반 흐름 ─────────────────────────────────────────────────────
    const handlePhotoFileChange = async (originalFile: File | null) => {
        if (!originalFile) return
        // avif 등 생성 API가 받지 못하는 형식은 PNG로 바꿔서 쓴다.
        let file: File
        try {
            file = await ensureSupportedImage(originalFile)
        } catch (e) {
            console.error('사진 형식 변환 실패:', e)
            pushAssistant('이 사진 형식은 사용할 수 없어요. JPG, PNG, WEBP 사진으로 다시 선택해 주세요.')
            return
        }
        // 같은 파일을 빼고 다시 골라도 onChange가 다시 불리도록 파일 입력값을 비워 둔다
        if (photoInputRef.current) photoInputRef.current.value = ''
        // blob: URL은 이 페이지를 벗어났다가(뒤로가기 등) 다시 돌아왔을 때 무효화되어 이미지가
        // 안 보이는 문제가 있다. 히스토리를 넘나들어도 항상 그대로 보이는 data: URL로 미리보기를
        // 만들어서 디자인 결과 화면의 "참고 사진"에도 안전하게 재사용한다.
        // 사진과 미리보기는 새 사진을 다 읽은 뒤에 한 번에 바꾼다 — 중간에 미리보기를 비우면 입력창의
        // 첨부 사진·"사진 변경하기"가 잠깐 사라졌다 다시 생기며 화면이 깜빡인다.
        const reader = new FileReader()
        reader.onload = () => {
            if (typeof reader.result !== 'string') return
            setSelectedPhotoFile(file)
            setSelectedPhotoPreviewUrl(reader.result)
        }
        reader.readAsDataURL(file)
    }

    // 입력창에 첨부해 둔 참고 사진을 뺀다 (다시 고르려면 선택 창의 "사진 선택하기"를 누른다)
    const removeSelectedPhoto = () => {
        setSelectedPhotoFile(null)
        setSelectedPhotoPreviewUrl(null)
        if (photoInputRef.current) photoInputRef.current.value = ''
    }

    // 사진 기반 흐름에서 사진을 골라 두면 입력창에 첨부된 채로 보이고, 글 없이 사진만으로도 보낼 수 있다
    const hasPhotoAttachment =
        activeQuickReply?.id === PHOTO_UPLOAD_QUICK_REPLY.id && !!selectedPhotoFile && !!selectedPhotoPreviewUrl
    // 사진을 아직 고르지 않은 동안엔 입력 칸을 잠근다 — 사진부터 첨부하게 한다
    const isPhotoInputLocked = activeQuickReply?.id === PHOTO_UPLOAD_QUICK_REPLY.id && !hasPhotoAttachment

    // 사진 + (입력창에 적은) 추가 요청으로 생성. note가 비어 있으면 사진만 사용한다.
    // 내 말풍선은 사진만 담은 것 하나, 그 아래에 적은 글이 있으면 글 말풍선을 따로 하나 보낸다.
    const confirmPhotoWithNote = (note: string) => {
        if (!selectedPhotoFile || !selectedPhotoPreviewUrl || isSending) return
        setActiveQuickReply(null)
        clearInput()
        const photoBubbleId = makeId()
        setBubbles((prev) => [
            ...prev,
            { id: photoBubbleId, role: 'user', text: '', imageUrls: [selectedPhotoPreviewUrl] },
            ...(note ? [{ id: makeId(), role: 'user' as const, text: note }] : []),
        ])
        // 결과 화면 키워드에도 이 요청이 남도록 기록 (buildFreeformKeywords(reviseLogRef))
        if (note) reviseLogRef.current.push(note)
        void runGenerateDesignFromPhoto(selectedPhotoFile, note || undefined, photoBubbleId)
    }

    const handleFreeformGenerate = () => {
        setActiveQuickReply(null)
        const freeText = freeformLogRef.current.join('. ')
        // 대화 중에 백엔드(chat())가 이미 session.extractedPreferences를 채워두므로
        // 별도 refineKeywords 호출 없이 바로 생성 (buildFinalPrompt 1순위로 그대로 사용됨)
        void runGenerateDesign({ ...INITIAL_PREFERENCES, freeText }, 'freeform')
    }

    // priorContext: 서버에만 text 앞줄에 붙여 보낼 문장 (컬러피커 기타 입력과 함께 보내는 고른 색 안내).
    // 자유 입력 기록(freeformLog)에는 사용자가 적은 text만 남긴다.
    const sendFreeformMessage = async (text: string, priorContext = '') => {
        if (!sessionId) {
            pushAssistant('채팅 세션이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.')
            return
        }
        freeformLogRef.current.push(text)
        setIsSending(true)
        try {
            const res = await sendChatMessage(sessionId, priorContext ? `${priorContext}\n${text}` : text)
            pushAssistant(res.reply)

            const suggestionOptions =
                res.showOptions && res.options.length > 0
                    ? // 화면 라벨에만 문장부호를 붙이고, 고르면 보내는 값(value)은 서버가 준 선택지 그대로 둔다
                    res.options.map((label) => ({
                        value: label,
                        label: withSentencePunctuation(label),
                        colorHexes: res.optionColors?.[label],
                    }))
                    : []

            // 컬러/쉐입을 물어보는 차례라면, Gemini가 준 텍스트 선택지 뒤 맨 마지막에 "고정 UI로 직접 고르기"
            // 옵션을 항상 붙여준다. 서버가 다음 질문 대상(nextQuestionTarget)을 다르게 적어 보내도
            // 선택지 내용(쉐입 이름 / 색상 정보)으로 한 번 더 알아본다.
            const isShapeQuestion =
                res.nextQuestionTarget === 'shape' ||
                (res.nextQuestionTarget !== 'color' && res.options.some(isShapeOptionLabel))
            const isColorQuestion =
                !isShapeQuestion &&
                (res.nextQuestionTarget === 'color' ||
                    Object.keys(res.optionColors ?? {}).length > 0 ||
                    res.options.some((option) => /#[0-9A-Fa-f]{3,6}\b/.test(option)))
            const pickerOption = isShapeQuestion
                ? [{ value: '__shape_picker__', label: '쉐입 이미지로 직접 선택하기', icon: 'nail' as const }]
                : isColorQuestion
                    ? [{ value: '__color_picker__', label: '컬러 팔레트(피커)에서 직접 선택하기', icon: 'palette' as const }]
                    : []

            setFreeformColorPickerOpen(false)
            setFreeformShapePickerOpen(false)
            // 새 질문이 왔으니 컬러피커도 빈 상태에서 시작한다 — 지난 질문에서 담아두고 확정하지
            // 않은 색·기타 입력이 다음 컬러피커에 이미 들어간 채로 보이지 않게 한다.
            setFreeformSelectedColors([])
            setFreeformColorNote('')

            const combinedOptions = [...suggestionOptions, ...pickerOption]
            if (isFreeformCollectionComplete(res)) {
                // 서버가 확인하는 필수 항목을 다 모았을 때만, 바로 생성할지 더 얘기할지 고를 수 있게 한다
                // (예전에는 다 모이면 묻지 않고 곧바로 생성했다)
                setActiveQuickReply({
                    id: `freeform-actions-${makeId()}`,
                    question: '바로 생성해 드릴까요?',
                    options: [
                        { value: '__generate__', label: '바로 생성해 주세요.', icon: 'check' },
                        { value: '__continue__', label: '아직 더 얘기하고 싶어요.', icon: 'chat' },
                    ],
                    multi: false,
                    limit: 1,
                    layout: 'list',
                })
            } else if (combinedOptions.length > 0) {
                setActiveQuickReply({
                    id: `freeform-actions-${makeId()}`,
                    question: '이런 느낌은 어떠세요? 직접 입력하셔도 좋아요.',
                    options: combinedOptions,
                    multi: false,
                    limit: 1,
                    layout: 'list',
                })
            }
            // 아직 모으는 중이고 고를 선택지도 없으면 아무 창도 띄우지 않는다 — 챗봇의 질문에 바로 입력해서 답한다
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

    // ── 입력창 ─────────────────────────────────────────────────────────────
    // 선택지 기반 흐름은 자유 입력으로 넘어가지 않는다 — 선택지 창이 떠 있는 동안, 그리고 디자인이 나오기 전까지는
    // 채팅 입력을 막고, 선택지 외 의견은 선택지 창의 "기타" 입력란으로 받는다.
    // (디자인이 나온 뒤 입력하면 그 디자인의 수정 요청으로 받는다 — handleSubmitInput)
    const isPreferenceInputLocked =
        mode === 'preference' && (!!activeQuickReply?.id.startsWith('pref-') || !lastDesign)

    // 디자인을 확정하고 결과 화면으로 넘어간 뒤, 이력이나 뒤로가기로 이 채팅을 다시 연 상태 — 마지막 말풍선이 확정 답이다.
    // 이때 입력한 문장은 생성 방식과 상관없이 마지막 디자인의 수정 요청으로 받는다 (handleSubmitInput)
    const lastShownBubble = [...bubbles].reverse().find((bubble) => !bubble.historyOnly)
    const isReopenedAfterConfirm =
        !!lastDesign &&
        !activeQuickReply &&
        lastShownBubble?.role === 'user' &&
        DESIGN_ACCEPT_LABELS.includes(lastShownBubble.text)

    const handleSubmitInput = () => {
        const text = inputValue.trim()
        if ((!text && !hasPhotoAttachment) || isSending || isPreferenceInputLocked || isPhotoInputLocked) return
        // 참고 사진을 입력창에 첨부해 둔 상태에서 보내면, 사진 + 이 문장(없으면 사진만)으로 바로 생성한다.
        if (hasPhotoAttachment) {
            confirmPhotoWithNote(text)
            return
        }
        clearInput()
        setActiveQuickReply(null)

        // 선택지 기반으로 디자인이 나온 뒤에, 또는 디자인을 확정한 뒤 다시 연 채팅에서 입력한 문장은 자유 입력으로 넘기지 않고
        // 마지막 디자인의 수정 요청으로 받는다 ("수정하고 싶어요"를 누른 것과 같다)
        if (mode === 'preference' || isReopenedAfterConfirm) setMode('revise')
        if (mode === 'revise' || mode === 'preference' || isReopenedAfterConfirm) {
            pushUser(text)
            void handleReviseSubmit(text)
            return
        }

        // 생성 방식을 고르지 않고 바로 입력했으면 이 말풍선에서 자유 입력이 시작된다
        pushUser(text, mode !== 'freeform' ? { generationMethod: 'freeform' } : undefined)

        if (mode === 'freeform' && isPreferenceModeSwitchIntent(text)) {
            startPreferenceFlow()
            return
        }

        if (mode !== 'freeform') {
            setMode('freeform')
            setFreeformSelectedColors([])
        }
        void sendFreeformMessage(text)

    }

    const handleQuickReplyClick = (option: QuickReplyOption) => {
        if (isSending) return
        if (option.value === '__go_to_scan__') {
            navigate('/process')
            return
        }
        if (option.value === '__back_to_menu__') {
            pushUser(option.label, { historySection: 'method' })
            setMode('menu')
            pushAssistant('알겠어요! 다른 생성 방식을 선택해 주세요.', { historySection: 'method' })
            setActiveQuickReply(MENU_QUICK_REPLY)
            return
        }
        if (activeQuickReply?.id === 'menu') {
            handleMenuSelect(option)
            return
        }
        if (activeQuickReply?.id === 'regenerate-choice') {
            handleRegenerateChoice(option)
            return
        }
        if (activeQuickReply?.id === 'design-feedback') {
            handleDesignFeedback(option)
            return
        }
        if (activeQuickReply?.id === 'revise-suggestions') {
            // "방금 디자인으로 확정할게요" — "좋아요! 이 디자인으로 할게요."를 누른 것과 똑같이 확정한다
            if (option.value === DESIGN_CONFIRM_FROM_REVISE_VALUE) {
                handleDesignFeedback({ ...option, value: 'accept' })
                return
            }
            // 선택지를 눌렀으면 그 문장을 수정 요청으로 그대로 보낸다
            setActiveQuickReply(null)
            pushUser(option.label)
            void handleReviseSubmit(option.value)
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
                pushAssistant('좋아요! 더 원하시는 분위기나 디테일이 있다면 편하게 말씀해 주세요.')
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
            // 서버에는 받은 선택지 그대로 보낸다 (라벨엔 화면용 문장부호가 붙어 있을 수 있다)
            void sendFreeformMessage(option.value)
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
        setFreeformSelectedColors((prev) => (prev.includes(hex) ? prev.filter((v) => v !== hex) : [...prev, hex]))
    }

    // 지금까지 담은 색상들을 한 번에 확정해서 Gemini에게 전송한다.
    const handleFreeformColorPickerConfirm = () => {
        const note = freeformColorNote.trim()
        if (freeformSelectedColors.length === 0 && !note) return
        const hexes = [...freeformSelectedColors]
        setFreeformColorPickerOpen(false)
        setFreeformSelectedColors([])
        setFreeformColorNote('')
        setActiveQuickReply(null)
        if (!note) {
            pushUserColors('', hexes)
            void sendFreeformMessage(hexes.join(', '))
            return
        }
        // 기타 입력이 있으면 예전 선택지 기반 컬러 단계의 기타 입력처럼, 고른 색을 순서 번호와 함께 알려 주는 문장을
        // 앞줄에 붙여 기타 입력 문장과 함께 보낸다. 말풍선에는 색 동그라미와 그 아래 기타 입력 문장을 보여 준다.
        if (hexes.length > 0) pushUserColors('', hexes, { colorsInline: true, textAfterColors: note })
        else pushUser(note)
        void sendFreeformMessage(note, buildPickedColorsContext(hexes))
    }

    // 자유입력 흐름에서 쉐입 이미지로 직접 고른 값을 확정한다.
    const handleFreeformShapeSelect = (label: string) => {
        setFreeformShapePickerOpen(false)
        setActiveQuickReply(null)
        pushUser(label)
        void sendFreeformMessage(label)
    }

    // 컬러 선택 단계에서 실제로 보여줄 팔레트 — 스캔 정보(대표 피부색)가 있으면 거기서 뽑은
    // "나와 어울리는 컬러"를, 없으면(스캔 전) 이달의 컬러 30색을 쓴다.
    const scanColorPalette = useMemo(() => analysisSummary?.skinTonePalette ?? [], [analysisSummary])
    const hasScanColorPalette = scanColorPalette.length > 0

    // 컬러 선택 그리드(.design-chat__color-grid)는 sortRecommendedColors 순서를 그대로 흘려 넣는다 (스캔 팔레트는 이미 정렬됨).
    const colorPickerPalette = hasScanColorPalette ? scanColorPalette : MONTHLY_TRENDING_COLORS

    // 지금 떠 있는 선택지 단계가 "기타" 입력란을 받는 단계(분위기/디자인 타입/모티프/컬러)라면 그 단계 키
    const activeNoteStep = useMemo<PreferenceKey | null>(() => {
        if (!activeQuickReply?.id.startsWith('pref-')) return null
        const step = activeQuickReply.id.slice(5) as PreferenceKey
        return PREFERENCE_NOTE_STEPS.includes(step) ? step : null
    }, [activeQuickReply])
    const activeNote = activeNoteStep ? preferenceNotes[activeNoteStep] ?? '' : ''
    const hasActiveNote = activeNote.trim().length > 0

    // 선택지를 하나도 안 골랐어도 "기타" 의견만 적었다면 다음 단계로 넘어갈 수 있다.
    const isMultiConfirmVisible = useMemo(
        () => !!activeQuickReply?.multi && (selectedInQuickReply.length > 0 || hasActiveNote),
        [activeQuickReply, selectedInQuickReply, hasActiveNote],
    )


    return {
        navigate,
        sessionId,
        isInitReady,
        bubbles,
        activeQuickReply,
        mode,
        handleDesignCardShown,
        isAwaitingGenerateConfirm,
        isPreferenceInputLocked,
        isReopenedAfterConfirm,
        selectedInQuickReply,
        freeformSelectedColors,
        activeNoteStep,
        activeNote,
        hasActiveNote,
        setPreferenceNote,
        preferenceStepIndex,
        lastDesign,
        selectedPhotoFile,
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
    }
}
