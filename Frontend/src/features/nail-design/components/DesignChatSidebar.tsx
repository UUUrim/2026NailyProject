import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import type { UserProfileResponse } from '@/entities/user/api'
import { searchChats, type ChatSummary } from '@/features/nail-design/api/chat'
import type { ChatHistoryGroup } from '@/features/nail-design/hooks/useDesignChatWorkspace'
import type { ChatDesignStatus } from '@/features/nail-design/hooks/designChatRuntime'
import { formatRecordDate, type HandRecordPreview } from '@/features/nail-design/utils/handAnalysisSummary'
import { HandIcon } from '@/features/nail-design/components/ChatBubbleParts'
import { SkinBaseTag } from '@/shared/components/SkinBaseTag'

// 디자인 채팅 사이드바 — 위에서부터 검색·접기/펼치기, 반영 중인 손 분석(결과 보기·다른 기록 안내), 새 채팅,
// 손 분석 기록별 채팅 이력(기록 줄: 결과 보기 · 화살표: 펼치기/접기 · +: 새 채팅), 맨 아래 프로필. 넓은 화면에서는 접으면 아이콘만 남는 좁은 줄이 되고,
// 좁은 화면에서는 채팅 위로 덮어 여는 서랍이 된다.

type IconName =
    | 'search'
    | 'add'
    | 'sidebar'
    | 'close'
    | 'lock'
    | 'chevron'
    | 'pencil'
    | 'trash'
    | 'arrow'
    | 'more'
    | 'user'
    | 'image'
    | 'logout'

function SidebarIcon({ name, size = 20 }: { name: IconName; size?: number }) {
    const stroke = {
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
        fill: 'none',
    }
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            {name === 'search' && (
                // 돋보기 — 채팅 검색
                <>
                    <circle cx="11" cy="11" r="6.2" {...stroke} />
                    <path d="m15.6 15.6 4.4 4.4" {...stroke} />
                </>
            )}
            {/* + — 새 채팅 */}
            {name === 'add' && <path d="M12 5.5v13M5.5 12h13" {...stroke} />}
            {name === 'sidebar' && (
                // 왼쪽 칸이 나뉜 창 — 사이드바 접기/펼치기
                <>
                    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" {...stroke} />
                    <path d="M9.5 4.5v15" {...stroke} />
                </>
            )}
            {name === 'close' && <path d="M6 6l12 12M18 6 6 18" {...stroke} />}
            {name === 'lock' && (
                <>
                    <rect x="5" y="10.5" width="14" height="9.5" rx="2.2" {...stroke} />
                    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" {...stroke} />
                </>
            )}
            {name === 'chevron' && <path d="M6 9l6 6 6-6" {...stroke} />}
            {name === 'pencil' && (
                <>
                    <path d="M4.5 19.5 5.6 15 15.4 5.2a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L9 18.4l-4.5 1.1Z" {...stroke} />
                    <path d="m13.8 6.8 3.4 3.4" {...stroke} />
                </>
            )}
            {name === 'trash' && (
                // 휴지통 — 채팅 삭제
                <>
                    <path d="M4.5 7h15" {...stroke} />
                    <path d="M9.5 7V5.2c0-.66.54-1.2 1.2-1.2h2.6c.66 0 1.2.54 1.2 1.2V7" {...stroke} />
                    <path d="M6.5 7l.8 11.3c.07.96.86 1.7 1.82 1.7h5.76c.96 0 1.75-.74 1.82-1.7L17.5 7" {...stroke} />
                    <path d="M10.2 11v5M13.8 11v5" {...stroke} />
                </>
            )}
            {name === 'arrow' && <path d="M5 12h12M13 6l6 6-6 6" {...stroke} />}
            {name === 'more' && (
                // 가로 점 셋 — 프로필 옆 계정 메뉴
                <>
                    <circle cx="5.5" cy="12" r="1.5" fill="currentColor" />
                    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                    <circle cx="18.5" cy="12" r="1.5" fill="currentColor" />
                </>
            )}
            {name === 'user' && (
                <>
                    <circle cx="12" cy="8.5" r="3.8" {...stroke} />
                    <path d="M5 19.5c1.4-3.2 4-4.8 7-4.8s5.6 1.6 7 4.8" {...stroke} />
                </>
            )}
            {name === 'image' && (
                // 액자 — 디자인 이력
                <>
                    <rect x="4" y="5" width="16" height="14" rx="2.5" {...stroke} />
                    <circle cx="9" cy="10" r="1.5" {...stroke} />
                    <path d="m4.5 17 4.5-4 3.5 3 3-2.5 4 3.5" {...stroke} />
                </>
            )}
            {name === 'logout' && (
                <>
                    <path d="M10 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3" {...stroke} />
                    <path d="M14 8l4 4-4 4M18 12H9.5" {...stroke} />
                </>
            )}
        </svg>
    )
}

// 손 분석 기록 미리보기 — 대표 피부색 동그라미 옆에 베이스(마이페이지 손 분석 목록과 같은 베이스 색 알약)와 추천 컬러 6개,
// 오른쪽 끝에 작은 날짜
function RecordPreviewView({ preview, size = 'md' }: { preview: HandRecordPreview; size?: 'sm' | 'md' }) {
    return (
        <span className={`dcw-record dcw-record--${size}`}>
            <span className="dcw-record__swatch" style={{ background: preview.skinToneHex ?? '#de869f' }} aria-hidden="true" />
            <span className="dcw-record__body">
                {/* 큰 카드(사이드바 위 손 분석)는 베이스 옆에 대표 피부색 헥스값도 쓴다 */}
                {(preview.toneLabel || (size === 'md' && preview.skinToneHex)) && (
                    <span className="dcw-record__head">
                        {/* 사이드바 폭에는 '뉴트럴 베이스' 전체가 헥스값·추천 컬러·날짜·고정 배지와 같이 들어가지 않아서
                            '베이스'를 뗀 핑크/뉴트럴/옐로우만 쓰고, 전체 이름은 title로 보여 준다 */}
                        {preview.toneLabel && (
                            <SkinBaseTag kind={preview.baseKind} title={preview.toneLabel} className="dcw-record__tone">
                                {preview.toneLabel.replace(/\s*베이스$/, '')}
                            </SkinBaseTag>
                        )}
                        {size === 'md' && preview.skinToneHex && (
                            <span className="dcw-record__hex">{preview.skinToneHex.toUpperCase()}</span>
                        )}
                    </span>
                )}
                {preview.palette.length > 0 && (
                    <span className="dcw-record__palette" aria-label="추천 컬러">
                        {preview.palette.map((hex, i) => (
                            <i key={`${hex}-${i}`} style={{ background: hex }} />
                        ))}
                    </span>
                )}
            </span>
            {preview.dateLabel && <span className="dcw-record__date">{preview.dateLabel}</span>}
        </span>
    )
}

const isSkinToneHex = (hex: string | null): hex is string => !!hex && /^#[0-9a-f]{6}$/i.test(hex)

// 사이드바 위 손 분석 카드 — 배경은 마이페이지 손 분석 결과 모달(ScanDetailModal) 위 카드와 같은, 대표 피부색이 은은하게 번지는
// 그라데이션(모달은 흰 판 위라 같은 색이 나도록 맨 아래에 흰색을 깐다), 테두리는 배경처럼 연한 대표 피부색(.has-tone, 불투명도 30%).
// 헥스값이 없으면 원래 배경·테두리 그대로.
function skinToneCardStyle(hex: string | null): CSSProperties | undefined {
    if (!isSkinToneHex(hex)) return undefined
    return {
        background: `linear-gradient(145deg, ${hex}22 0%, #fff 48%, ${hex}14 100%), #fff`,
        '--dcw-record-border': `${hex}4d`,
    } as CSSProperties
}

const DESIGN_STATUS_LABELS: Record<ChatDesignStatus, string> = {
    generating: '디자인 생성 중',
    done: '디자인 생성 완료',
}

// 채팅 이력 한 줄 — 누르면 그 채팅을 열고, 연필(또는 두 번 누르기)로 이름을 바꾸고, 휴지통으로 지운다.
// 연필·휴지통은 줄에 마우스를 올렸을 때만 보이고, 그 밖엔 줄 오른쪽 끝에 디자인 상태 점(만드는 중 분홍 깜빡임 / 보지 않는 동안 다 만듦 초록)을 띄운다.
function ChatHistoryItem({
    chat,
    isActive,
    isOpening,
    designStatus,
    onOpen,
    onRename,
    onDelete,
}: {
    chat: ChatSummary
    isActive: boolean
    isOpening: boolean
    designStatus: ChatDesignStatus | undefined
    onOpen: () => void
    onRename: (title: string) => void
    onDelete: () => void
}) {
    const title = chat.title || '새 채팅'
    const [isEditing, setIsEditing] = useState(false)
    const [draft, setDraft] = useState(title)
    const inputRef = useRef<HTMLInputElement | null>(null)

    useEffect(() => {
        if (!isEditing) return
        inputRef.current?.focus()
        inputRef.current?.select()
    }, [isEditing])

    const startEditing = () => {
        setDraft(title)
        setIsEditing(true)
    }
    const finishEditing = (save: boolean) => {
        setIsEditing(false)
        if (save && draft.trim() && draft.trim() !== title) onRename(draft)
    }

    if (isEditing) {
        return (
            <li className="dcw-chat-item is-editing">
                <input
                    ref={inputRef}
                    className="dcw-chat-item__input"
                    value={draft}
                    maxLength={100}
                    aria-label="채팅 이름"
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => finishEditing(true)}
                    onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing) return
                        if (e.key === 'Enter') {
                            e.preventDefault()
                            finishEditing(true)
                        } else if (e.key === 'Escape') {
                            e.preventDefault()
                            finishEditing(false)
                        }
                    }}
                />
            </li>
        )
    }

    return (
        <li
            className={`dcw-chat-item${isActive ? ' is-active' : ''}${isOpening ? ' is-opening' : ''}${
                designStatus ? ' has-status' : ''
            }`}
        >
            <button
                type="button"
                className="dcw-chat-item__open"
                onClick={onOpen}
                onDoubleClick={startEditing}
                aria-current={isActive ? 'page' : undefined}
                title={title}
            >
                <span className="dcw-chat-item__title">{title}</span>
                {designStatus && <span className="dcw-sr-only"> ({DESIGN_STATUS_LABELS[designStatus]})</span>}
            </button>
            {designStatus && (
                <span
                    className={`dcw-chat-item__status is-${designStatus}`}
                    title={DESIGN_STATUS_LABELS[designStatus]}
                    aria-hidden="true"
                />
            )}
            <span className="dcw-chat-item__actions">
                <button type="button" className="dcw-chat-item__action" onClick={startEditing} aria-label={`'${title}' 채팅 이름 바꾸기`} title="이름 바꾸기">
                    <SidebarIcon name="pencil" size={15} />
                </button>
                <button
                    type="button"
                    className="dcw-chat-item__action dcw-chat-item__action--delete"
                    onClick={onDelete}
                    aria-label={`'${title}' 채팅 삭제`}
                    title="채팅 삭제"
                >
                    <SidebarIcon name="trash" size={15} />
                </button>
            </span>
        </li>
    )
}

// 로그아웃 확인 창 — 아래 채팅 삭제 확인 창과 같은 모양. 디자인을 만드는 중인 채팅이 있으면 그 사실도 알려 준다
// (로그아웃하면 숨겨 두고 진행하던 채팅을 모두 내린다 — designChatRuntime)
function LogoutConfirm({
    hasGeneratingDesign,
    onCancel,
    onConfirm,
}: {
    hasGeneratingDesign: boolean
    onCancel: () => void
    onConfirm: () => void
}) {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel()
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [onCancel])

    return createPortal(
        <div className="mypage-x__modal" role="dialog" aria-modal="true" aria-label="로그아웃 확인">
            <button type="button" className="mypage-x__modal-backdrop" aria-label="닫기" onClick={onCancel} />
            <div className="mypage-x__modal-panel mypage-x__confirm-panel">
                <button type="button" className="mypage-x__modal-close mypage-x__modal-close--plain" onClick={onCancel} aria-label="닫기">
                    ✕
                </button>
                <div className="mypage-x__confirm-icon" aria-hidden="true">
                    <SidebarIcon name="logout" size={24} />
                </div>
                <h2 className="mypage-x__confirm-title">로그아웃할까요?</h2>
                <p className="mypage-x__confirm-desc">
                    {hasGeneratingDesign ? (
                        <>
                            지금 디자인을 만들고 있는 채팅이 있어요.
                            <br />
                            로그아웃하면 이 화면에서 이어서 볼 수 없어요.
                        </>
                    ) : (
                        <>다시 로그인하면 채팅 이력에서 이어서 대화할 수 있어요.</>
                    )}
                </p>
                <div className="mypage-x__modal-actions">
                    <button type="button" onClick={onCancel}>
                        취소
                    </button>
                    <button type="button" className="mypage-x__modal-action--accent" onClick={onConfirm}>
                        <span>로그아웃</span>
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    )
}

// 맨 아래 프로필 — 아바타·이름은 마이페이지 프로필로, 오른쪽 ⋯는 계정 메뉴(마이페이지 · 디자인 이력 · 로그아웃).
// 메뉴는 프로필 줄 위로 열리고, 바깥을 누르거나 Esc를 누르면 닫힌다.
function SidebarProfile({
    nickname,
    email,
    avatarLetter,
    hasGeneratingDesign,
    onGoToProfile,
    onGoToMyPage,
    onGoToDesigns,
    onLogout,
}: {
    nickname: string
    email: string | null
    avatarLetter: string
    hasGeneratingDesign: boolean
    onGoToProfile: () => void
    onGoToMyPage: () => void
    onGoToDesigns: () => void
    onLogout: () => void
}) {
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        if (!isMenuOpen) return
        const handlePointerDown = (e: PointerEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setIsMenuOpen(false)
        }
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsMenuOpen(false)
        }
        document.addEventListener('pointerdown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [isMenuOpen])

    const choose = (action: () => void) => () => {
        setIsMenuOpen(false)
        action()
    }

    return (
        <div className={`dcw-profile${isMenuOpen ? ' is-menu-open' : ''}`} ref={rootRef}>
            <button type="button" className="dcw-profile__link" onClick={onGoToProfile} title="내 프로필">
                <span className="dcw-profile__avatar" aria-hidden="true">
                    {avatarLetter}
                </span>
                <span className="dcw-profile__text">
                    <span className="dcw-profile__name">{nickname || '회원'}</span>
                    {email && <span className="dcw-profile__email">{email}</span>}
                </span>
            </button>
            <button
                type="button"
                className="dcw-profile__more"
                onClick={() => setIsMenuOpen((prev) => !prev)}
                aria-label="계정 메뉴"
                aria-haspopup="menu"
                aria-expanded={isMenuOpen}
                title="계정 메뉴"
            >
                <SidebarIcon name="more" size={18} />
            </button>

            {isMenuOpen && (
                <div className="dcw-profile__menu" role="menu" aria-label="계정 메뉴">
                    <button type="button" role="menuitem" className="dcw-profile__menu-item" onClick={choose(onGoToMyPage)}>
                        <SidebarIcon name="user" size={17} />
                        마이페이지
                    </button>
                    <button type="button" role="menuitem" className="dcw-profile__menu-item" onClick={choose(onGoToDesigns)}>
                        <SidebarIcon name="image" size={17} />
                        디자인 이력
                    </button>
                    <span className="dcw-profile__menu-divider" role="separator" />
                    <button
                        type="button"
                        role="menuitem"
                        className="dcw-profile__menu-item dcw-profile__menu-item--logout"
                        onClick={choose(() => setIsLogoutConfirmOpen(true))}
                    >
                        <SidebarIcon name="logout" size={17} />
                        로그아웃
                    </button>
                </div>
            )}

            {isLogoutConfirmOpen && (
                <LogoutConfirm
                    hasGeneratingDesign={hasGeneratingDesign}
                    onCancel={() => setIsLogoutConfirmOpen(false)}
                    onConfirm={() => {
                        setIsLogoutConfirmOpen(false)
                        onLogout()
                    }}
                />
            )}
        </div>
    )
}

// 채팅 삭제 확인 창 — 마이페이지의 삭제 확인 창(mypage-x__confirm, 이 화면에서도 mypage.css를 불러 온다)과 같은 모양.
// 사이드바는 좁은 화면에서 옮겨 다니는 서랍이라 그 안에 두면 위치가 어긋나므로 body로 띄운다.
function DeleteChatConfirm({ chat, onCancel, onConfirm }: { chat: ChatSummary; onCancel: () => void; onConfirm: () => void }) {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel()
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [onCancel])

    return createPortal(
        <div className="mypage-x__modal" role="dialog" aria-modal="true" aria-label="채팅 삭제 확인">
            <button type="button" className="mypage-x__modal-backdrop" aria-label="닫기" onClick={onCancel} />
            <div className="mypage-x__modal-panel mypage-x__confirm-panel">
                <button type="button" className="mypage-x__modal-close mypage-x__modal-close--plain" onClick={onCancel} aria-label="닫기">
                    ✕
                </button>
                <div className="mypage-x__confirm-icon mypage-x__confirm-icon--danger" aria-hidden="true">
                    <SidebarIcon name="trash" size={24} />
                </div>
                <h2 className="mypage-x__confirm-title">
                    <strong>{chat.title || '새 채팅'}</strong> 채팅을 삭제할까요?
                </h2>
                <p className="mypage-x__confirm-desc">
                    삭제한 채팅은 채팅 이력에서 사라지고 되돌릴 수 없어요.
                    <br />
                    이 채팅에서 만든 디자인은 마이페이지에 그대로 남아요.
                </p>
                <div className="mypage-x__modal-actions">
                    <button type="button" onClick={onCancel}>
                        취소
                    </button>
                    <button type="button" className="mypage-x__modal-action--danger" onClick={onConfirm}>
                        <span>채팅 삭제</span>
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    )
}

// 채팅 이력에서 접어 둔 분석 기록 묶음 — 다음에 와도 그대로 접혀 있게 기억한다
const COLLAPSED_GROUPS_STORAGE_KEY = 'naily.designChat.collapsedHistoryGroups'

function readCollapsedGroups(): Set<string> {
    try {
        const raw = window.localStorage.getItem(COLLAPSED_GROUPS_STORAGE_KEY)
        const keys = raw ? (JSON.parse(raw) as unknown) : []
        return new Set(Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : [])
    } catch {
        return new Set()
    }
}

// 검색어를 분홍 글자로 표시한다 (대소문자 구분 없이)
function HighlightedText({ text, query }: { text: string; query: string }) {
    const needle = query.toLowerCase()
    if (!needle) return <>{text}</>
    const lower = text.toLowerCase()
    const parts: ReactNode[] = []
    let from = 0
    let index = lower.indexOf(needle)
    while (index >= 0) {
        if (index > from) parts.push(text.slice(from, index))
        parts.push(<mark key={index}>{text.slice(index, index + needle.length)}</mark>)
        from = index + needle.length
        index = lower.indexOf(needle, from)
    }
    if (from < text.length) parts.push(text.slice(from))
    return <>{parts}</>
}

// 검색어 앞뒤 공백·연속 공백을 서버와 같은 방식으로 정리한다
const normalizeQuery = (query: string) => query.replace(/\s+/g, ' ').trim()

// 채팅 검색 결과 — 채팅 이름이나 대화 내용에 검색어가 들어간 채팅. 누르면 그 채팅을 연다.
function ChatSearchResults({
    query,
    activeSessionId,
    openingSessionId,
    recordPreviewByKey,
    onOpenChat,
}: {
    query: string
    activeSessionId: number | null
    openingSessionId: number | null
    recordPreviewByKey: Map<string, HandRecordPreview>
    onOpenChat: (chat: ChatSummary) => void
}) {
    const normalized = normalizeQuery(query)
    // 글자를 칠 때마다 묻지 않도록 잠깐 멈췄을 때 검색한다
    const [debouncedQuery, setDebouncedQuery] = useState(normalized)
    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedQuery(normalized), 250)
        return () => window.clearTimeout(timer)
    }, [normalized])

    const searchQuery = useQuery({
        queryKey: ['chats', 'search', debouncedQuery],
        queryFn: () => searchChats(debouncedQuery),
        enabled: debouncedQuery.length > 0,
    })

    if (!normalized) {
        return <p className="dcw-search__hint">채팅 이름이나 나눈 대화에 있는 단어로 찾아요.</p>
    }
    if (debouncedQuery !== normalized || searchQuery.isPending) {
        return (
            <div className="dcw-history__loading" aria-busy="true">
                <span className="dcw-skeleton dcw-skeleton--line" />
                <span className="dcw-skeleton dcw-skeleton--line" />
                <span className="dcw-skeleton dcw-skeleton--line dcw-skeleton--short" />
            </div>
        )
    }
    if (searchQuery.isError) {
        return <p className="dcw-search__hint">검색하지 못했어요. 잠시 후 다시 시도해 주세요.</p>
    }
    const results = searchQuery.data ?? []
    if (results.length === 0) {
        return <p className="dcw-search__hint">'{normalized}'이(가) 들어간 채팅이 없어요.</p>
    }

    return (
        <section className="dcw-search" aria-label="채팅 검색 결과">
            <p className="dcw-search__count">검색 결과 {results.length}개</p>
            <ul className="dcw-search__list">
                {results.map((result) => {
                    const preview = result.scanKey ? recordPreviewByKey.get(result.scanKey) : undefined
                    const isActive = result.sessionId === activeSessionId
                    return (
                        <li key={result.sessionId}>
                            <button
                                type="button"
                                className={`dcw-search-item${isActive ? ' is-active' : ''}${
                                    result.sessionId === openingSessionId ? ' is-opening' : ''
                                }`}
                                onClick={() => onOpenChat(result)}
                                aria-current={isActive ? 'page' : undefined}
                            >
                                <span className="dcw-search-item__head">
                                    {preview && (
                                        <span
                                            className="dcw-search-item__swatch"
                                            style={{ background: preview.skinToneHex ?? '#de869f' }}
                                            aria-hidden="true"
                                        />
                                    )}
                                    <span className="dcw-search-item__title">
                                        <HighlightedText text={result.title || '새 채팅'} query={normalized} />
                                    </span>
                                    <span className="dcw-search-item__date">{formatRecordDate(result.updatedAt)}</span>
                                </span>
                                {result.snippet && (
                                    <span className="dcw-search-item__snippet">
                                        <HighlightedText text={result.snippet} query={normalized} />
                                    </span>
                                )}
                            </button>
                        </li>
                    )
                })}
            </ul>
        </section>
    )
}

type DesignChatSidebarProps = {
    profile: UserProfileResponse | null
    userName: string
    isCollapsed: boolean
    isMobileOpen: boolean
    onToggleCollapsed: () => void
    onCloseMobile: () => void
    // 손 분석 기록이 없을 때 "손 촬영하러 가기"
    onGoToScan: () => void
    // 맨 아래 프로필 — 아바타·이름은 마이페이지 프로필로, ⋯ 메뉴는 마이페이지 · 디자인 이력 · 로그아웃
    onGoToProfile: () => void
    onGoToMyPage: () => void
    onGoToDesigns: () => void
    onLogout: () => void
    onNewChat: () => void
    isFreshChat: boolean
    // 손 분석
    canSelectSession: boolean
    // 손 촬영 → 출력에서 이어 온 이번 촬영 기록을 보고 있는지
    isFixedRecord: boolean
    isRecordLoading: boolean
    // 지금 채팅에 반영 중인 분석 기록 (없으면 null)
    currentScanKey: string | null
    currentRecordPreview: HandRecordPreview | null
    recordPreviewByKey: Map<string, HandRecordPreview>
    // 분석 결과 상세 패널을 열어 두었는지 — 위쪽 버튼이 '분석 결과 상세 닫기'가 된다
    isCurrentRecordPanelOpen: boolean
    onToggleAnalysisPanel: () => void
    // 손 촬영에서 이어 온 진입의 이번 촬영 기록 (단독 진입이면 null) — 이 진입에서는 다른 기록 줄을 누르면 그 기록의 채팅을 보기만 한다
    fixedScanKey: string | null
    // 채팅 이력
    historyGroups: ChatHistoryGroup[]
    isHistoryLoading: boolean
    activeSessionId: number | null
    // 채팅별 디자인 상태 점 — 만드는 중(지금 보는 채팅 포함) / 보지 않는 동안 다 만듦
    designStatusBySession: ReadonlyMap<number, ChatDesignStatus>
    openingSessionId: number | null
    onOpenChat: (chat: ChatSummary) => void
    onRenameChat: (sessionId: number, title: string) => void
    // 채팅 이력에서 지우기 (확인 창에서 "채팅 삭제"를 누른 뒤)
    onDeleteChat: (sessionId: number) => void
    // 분석 기록 묶음의 + — 그 기록을 반영한 새 채팅
    onStartChatWithRecord: (scanKey: string) => void
}

export function DesignChatSidebar({
    profile,
    userName,
    isCollapsed,
    isMobileOpen,
    onToggleCollapsed,
    onCloseMobile,
    onGoToScan,
    onGoToProfile,
    onGoToMyPage,
    onGoToDesigns,
    onLogout,
    onNewChat,
    isFreshChat,
    canSelectSession,
    isFixedRecord,
    isRecordLoading,
    currentScanKey,
    currentRecordPreview,
    recordPreviewByKey,
    isCurrentRecordPanelOpen,
    onToggleAnalysisPanel,
    fixedScanKey,
    historyGroups,
    isHistoryLoading,
    activeSessionId,
    designStatusBySession,
    openingSessionId,
    onOpenChat,
    onRenameChat,
    onDeleteChat,
    onStartChatWithRecord,
}: DesignChatSidebarProps) {
    // 삭제할지 묻고 있는 채팅
    const [chatToDelete, setChatToDelete] = useState<ChatSummary | null>(null)

    // 분석 기록별 채팅 이력 펼치기/접기
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(readCollapsedGroups)

    // 지금 채팅의 기록이 다른 기록으로 바뀌면(이력에서 다른 기록의 채팅을 연 때 등) 위쪽 손 분석 카드를 한 번 반짝여 바뀐 걸 알린다.
    // 처음 기록을 정할 때(기록 없음 → 기록)는 반짝이지 않는다. 반짝임이 끝나면 지워서, 카드를 다시 그려도(검색을 닫는 등) 또 반짝이지 않게 한다.
    const [shownScanKey, setShownScanKey] = useState(currentScanKey)
    const [changedScanKey, setChangedScanKey] = useState<string | null>(null)
    if (currentScanKey !== shownScanKey) {
        setShownScanKey(currentScanKey)
        setChangedScanKey(shownScanKey && currentScanKey ? currentScanKey : null)
    }
    // collapsed를 주지 않으면 지금과 반대로 바꾼다
    const toggleGroup = (groupKey: string, collapsed?: boolean) => {
        setCollapsedGroups((prev) => {
            const shouldCollapse = collapsed ?? !prev.has(groupKey)
            if (shouldCollapse === prev.has(groupKey)) return prev
            const next = new Set(prev)
            if (shouldCollapse) next.add(groupKey)
            else next.delete(groupKey)
            try {
                window.localStorage.setItem(COLLAPSED_GROUPS_STORAGE_KEY, JSON.stringify([...next]))
            } catch {
                // 저장 못 해도 이번 화면에서는 그대로 동작한다
            }
            return next
        })
    }

    // 아직 채팅이 없는 분석 기록 — 4개 이상 쌓이고 채팅이 있는 묶음도 있으면 이력 맨 아래 '채팅 없는 분석 기록 N개'로 접어 둔다
    // (채팅이 하나도 없을 때는 기록이 이력의 전부라 접지 않는다). 펼침은 이번 화면에서만 기억한다.
    // 지금 채팅에 반영 중인 기록은 채팅이 없어도 접어 두지 않는다 — 어느 기록을 반영 중인지 늘 보이게
    const [isEmptyRecordsOpen, setIsEmptyRecordsOpen] = useState(false)
    const isBundlable = (group: ChatHistoryGroup) => group.chats.length === 0 && !(group.scanKey && group.scanKey === currentScanKey)
    const emptyRecordGroups = historyGroups.filter(isBundlable)
    const shouldBundleEmptyRecords = emptyRecordGroups.length >= 4 && emptyRecordGroups.length < historyGroups.length
    const listedGroups = shouldBundleEmptyRecords ? historyGroups.filter((group) => !isBundlable(group)) : historyGroups

    // 새 채팅 옆 '다른 분석 기록으로 새 채팅' — + 로 새 채팅을 열 수 있는 분석 기록이 2개 이상일 때만 보인다
    // (분석 기록 없이 만든 채팅은 기록으로 세지 않는다).
    // 누르면 접어 둔 기록까지 펼치고, 다른 기록의 + 를 잠깐 깜빡여 어디서 고르는지 알려 준다.
    const hasOtherRecords = canSelectSession && historyGroups.filter((group) => group.canStartChat).length >= 2
    const [recordHintId, setRecordHintId] = useState(0)
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const pointToOtherRecords = () => {
        setIsEmptyRecordsOpen(true)
        setRecordHintId((id) => id + 1)
    }

    useEffect(() => {
        if (!recordHintId) return
        // 깜빡이는 기록들이 사이드바 안에서 가려져 있으면 다 보이도록 사이드바만 스크롤한다 (페이지는 그대로).
        // 한 화면에 다 안 들어가면 첫 기록을 위에 맞춘다.
        const scroller = scrollRef.current
        const heads = scroller ? [...scroller.querySelectorAll<HTMLElement>('.dcw-history__group-head.is-hinted')] : []
        if (scroller && heads.length > 0) {
            const margin = 12
            const boxTop = scroller.getBoundingClientRect().top
            const top = heads[0].getBoundingClientRect().top - boxTop + scroller.scrollTop - margin
            const bottom = heads[heads.length - 1].getBoundingClientRect().bottom - boxTop + scroller.scrollTop + margin
            const viewTop = scroller.scrollTop
            let next = viewTop
            if (bottom - top > scroller.clientHeight || top < viewTop) next = top
            else if (bottom > viewTop + scroller.clientHeight) next = bottom - scroller.clientHeight
            if (next !== viewTop) scroller.scrollTo({ top: next, behavior: 'smooth' })
        }
        const timer = window.setTimeout(() => setRecordHintId(0), 2000)
        return () => window.clearTimeout(timer)
    }, [recordHintId])

    // 채팅 검색 —맨 위 돋보기를 누르면 그 줄이 검색 칸이 되고, 아래에는 손 분석·이력 대신 검색 결과가 보인다
    const [isSearchOpen, setIsSearchOpen] = useState(false)
    const [searchText, setSearchText] = useState('')
    const searchInputRef = useRef<HTMLInputElement | null>(null)

    useEffect(() => {
        if (isSearchOpen && !isCollapsed) searchInputRef.current?.focus()
    }, [isSearchOpen, isCollapsed])

    const openSearch = () => {
        setIsSearchOpen(true)
        if (isCollapsed) onToggleCollapsed()
    }
    const closeSearch = () => {
        setIsSearchOpen(false)
        setSearchText('')
    }

    // 넓은 화면에서 접힌 상태 — 아이콘만 남는다 (좁은 화면의 서랍은 늘 펼친 모양)
    const collapsedClass = isCollapsed ? ' is-collapsed' : ''
    const nickname = profile?.nickname || profile?.name || userName
    const avatarLetter = (nickname || 'N').trim().charAt(0).toUpperCase()

    const railButton = (key: string, label: string, icon: ReactNode, onClick: () => void, isActive = false) => (
        <button
            key={key}
            type="button"
            className={`dcw-rail-btn${isActive ? ' is-active' : ''}`}
            onClick={onClick}
            aria-label={label}
            title={label}
        >
            {icon}
        </button>
    )

    // 채팅 이력의 분석 기록 묶음 하나 — 머리(기록 · 날짜 · 펼치기 화살표 · +)와 그 기록의 채팅 목록.
    // 다른 기록의 줄을 누르면 그 기록의 채팅 목록을 펼치고 가장 최근에 한 채팅을 연다 (채팅이 없으면 그 기록으로 새 채팅 — + 와 같다).
    // 그러면 지금 채팅의 기록이 바뀌어 사이드바 위 손 분석 카드도 그 기록으로 바뀐다. 지금 채팅에 반영 중인 기록의 줄은 접힌 채팅 목록을 펼친다.
    // 기록 줄은 채팅 목록을 펼치기만 하고, 접는 건 화살표 버튼으로만 한다.
    // (분석 결과 상세 패널은 기록 줄이 아니라 위쪽 '분석 결과 상세 보기'로만 연다 — 손 촬영에서 이어 온 진입에서
    //  이번 촬영이 아닌 기록 줄을 누르면 지금 채팅의 기록은 그대로 두고 그 기록의 최근 채팅을 보기 전용으로 연다)
    // 지금 채팅에 반영 중인 기록은 피부색 동그라미에 깜빡이는 핑크 고리를 두른다.
    const renderHistoryGroup = (group: ChatHistoryGroup) => {
        const hasChats = group.chats.length > 0
        const isGroupCollapsed = hasChats && collapsedGroups.has(group.key)
        const groupScanKey = group.scanKey
        const isHinted = recordHintId > 0 && group.canStartChat && groupScanKey !== currentScanKey
        const isCurrent = !!groupScanKey && groupScanKey === currentScanKey
        const isViewOnlyRecord = !canSelectSession && !!groupScanKey && groupScanKey !== fixedScanKey
        const foldLabel = isGroupCollapsed ? '채팅 목록 펼치기' : '채팅 목록 접기'
        // 손 촬영에서 이어 온 진입의 다른 기록 — 그 기록의 가장 최근 채팅을 보기 전용으로 연다 (지금 채팅의 기록은 이번 촬영 기록 그대로).
        // 열 때 그 기록의 채팅 목록도 펼친다 (접는 건 화살표로만)
        const viewOnlyAction =
            isViewOnlyRecord && hasChats
                ? {
                    label: '이 분석 기록의 최근 채팅 보기',
                    run: () => {
                        if (isGroupCollapsed) toggleGroup(group.key, false)
                        onOpenChat(group.chats[0])
                    },
                }
                : null
        // 기록 줄을 눌렀을 때 하는 일과 그 설명
        const recordAction =
            viewOnlyAction ??
            (isCurrent
                ? isGroupCollapsed
                    ? { label: '채팅 목록 펼치기', run: () => toggleGroup(group.key, false) }
                    : null
                : hasChats
                    ? {
                        label: '이 분석 기록의 최근 채팅 열기',
                        run: () => {
                            toggleGroup(group.key, false)
                            onOpenChat(group.chats[0])
                        },
                    }
                    : group.canStartChat && groupScanKey
                        ? { label: '이 분석 기록으로 새 채팅', run: () => onStartChatWithRecord(groupScanKey) }
                        : null)
        return (
            <div key={group.key} className={`dcw-history__group${isGroupCollapsed ? ' is-collapsed' : ''}`}>
                <div className={`dcw-history__group-head${isHinted ? ' is-hinted' : ''}${isCurrent ? ' is-current' : ''}`}>
                    {group.preview && groupScanKey ? (
                        <button
                            type="button"
                            className="dcw-history__group-main"
                            onClick={recordAction?.run}
                            disabled={!recordAction}
                            aria-expanded={isCurrent && hasChats && !isViewOnlyRecord ? !isGroupCollapsed : undefined}
                            aria-label={`${group.preview.dateLabel} 손 분석 기록${isCurrent ? ' (지금 채팅에 반영 중)' : ''}${
                                recordAction ? ` — ${recordAction.label}` : ''
                            }`}
                            title={recordAction?.label}
                        >
                            <RecordPreviewView preview={group.preview} size="sm" />
                        </button>
                    ) : (
                        // 기록 없이 만든 채팅·목록에 없는 기록 — 누르면 접힌 채팅 목록을 펼친다 (접는 건 화살표 버튼으로만)
                        <button
                            type="button"
                            className="dcw-history__group-main"
                            onClick={() => toggleGroup(group.key, false)}
                            disabled={!isGroupCollapsed}
                            aria-expanded={hasChats ? !isGroupCollapsed : undefined}
                            title={isGroupCollapsed ? '채팅 목록 펼치기' : undefined}
                        >
                            <span className="dcw-history__group-label">{group.label}</span>
                        </button>
                    )}
                    {hasChats ? (
                        <button
                            type="button"
                            className="dcw-history__group-fold"
                            onClick={() => toggleGroup(group.key)}
                            aria-expanded={!isGroupCollapsed}
                            aria-label={foldLabel}
                            title={foldLabel}
                        >
                            <span className="dcw-history__group-chevron" aria-hidden="true">
                                <SidebarIcon name="chevron" size={14} />
                            </span>
                        </button>
                    ) : (
                        // 채팅이 없는 기록도 화살표 자리는 둬서 날짜 위치를 맞춘다
                        <span className="dcw-history__group-fold" aria-hidden="true" />
                    )}
                    {/* 이 기록으로 바로 새 채팅 */}
                    {group.canStartChat && groupScanKey && (
                        <button
                            type="button"
                            className="dcw-history__group-add"
                            onClick={() => onStartChatWithRecord(groupScanKey)}
                            aria-label={`${group.preview?.dateLabel ?? ''} 손 분석 기록으로 새 채팅`}
                            title="이 분석 기록으로 새 채팅"
                        >
                            <SidebarIcon name="add" size={15} />
                        </button>
                    )}
                </div>
                {hasChats && !isGroupCollapsed && (
                    <ul className="dcw-history__list">
                        {group.chats.map((chat) => (
                            <ChatHistoryItem
                                key={chat.sessionId}
                                chat={chat}
                                isActive={chat.sessionId === activeSessionId}
                                isOpening={chat.sessionId === openingSessionId}
                                designStatus={designStatusBySession.get(chat.sessionId)}
                                onOpen={() => onOpenChat(chat)}
                                onRename={(title) => onRenameChat(chat.sessionId, title)}
                                onDelete={() => setChatToDelete(chat)}
                            />
                        ))}
                    </ul>
                )}
            </div>
        )
    }

    return (
        <aside
            className={`dcw-sidebar${collapsedClass}${isMobileOpen ? ' is-mobile-open' : ''}`}
            aria-label="디자인 채팅 메뉴"
        >
            <div className={`dcw-sidebar__top${isSearchOpen ? ' is-searching' : ''}`}>
                {isSearchOpen ? (
                    <label className="dcw-search-box">
                        <SidebarIcon name="search" size={17} />
                        <input
                            ref={searchInputRef}
                            type="search"
                            value={searchText}
                            maxLength={50}
                            placeholder="채팅 검색"
                            aria-label="채팅 검색"
                            onChange={(e) => setSearchText(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                    e.preventDefault()
                                    closeSearch()
                                }
                            }}
                        />
                        <button type="button" className="dcw-search-box__close" onClick={closeSearch} aria-label="검색 닫기">
                            <SidebarIcon name="close" size={15} />
                        </button>
                    </label>
                ) : (
                    <button type="button" className="dcw-sidebar__toggle" onClick={openSearch} aria-label="채팅 검색" title="채팅 검색">
                        <SidebarIcon name="search" />
                    </button>
                )}
                <button
                    type="button"
                    className="dcw-sidebar__toggle dcw-sidebar__toggle--desktop"
                    onClick={onToggleCollapsed}
                    aria-label={isCollapsed ? '사이드바 펼치기' : '사이드바 접기'}
                    aria-expanded={!isCollapsed}
                    title={isCollapsed ? '사이드바 펼치기' : '사이드바 접기'}
                >
                    <SidebarIcon name="sidebar" />
                </button>
                <button type="button" className="dcw-sidebar__toggle dcw-sidebar__toggle--mobile" onClick={onCloseMobile} aria-label="메뉴 닫기">
                    <SidebarIcon name="close" />
                </button>
            </div>

            {/* 접힌 줄 — 아이콘만 */}
            <div className="dcw-sidebar__rail">
                {railButton('search', '채팅 검색', <SidebarIcon name="search" />, openSearch)}
                {railButton(
                    'analysis',
                    '분석 결과 상세 보기',
                    <HandIcon size={20} strokeWidth={1.7} />,
                    onToggleAnalysisPanel,
                    isCurrentRecordPanelOpen,
                )}
                {railButton('new', '새 채팅', <SidebarIcon name="add" />, onNewChat, isFreshChat)}
            </div>

            <div className="dcw-sidebar__main">
                <div className="dcw-sidebar__scroll" ref={scrollRef}>
                    {isSearchOpen ? (
                        <ChatSearchResults
                            query={searchText}
                            activeSessionId={activeSessionId}
                            openingSessionId={openingSessionId}
                            recordPreviewByKey={recordPreviewByKey}
                            onOpenChat={onOpenChat}
                        />
                    ) : (
                    <>
                    {/* 지금 채팅에 반영 중인 손 분석과 분석 결과 상세 보기 — 다른 기록으로 만들려면 채팅 이력의 + 를 쓴다 (새 채팅 옆 '다른 분석 기록으로 새 채팅'이 그곳을 알려 준다) */}
                    <section className="dcw-analysis" aria-label="손 분석">
                        {isRecordLoading ? (
                            <div className="dcw-analysis__card dcw-analysis__card--loading" aria-busy="true">
                                <span className="dcw-skeleton dcw-skeleton--dot" />
                                <span className="dcw-skeleton dcw-skeleton--line" />
                            </div>
                        ) : currentRecordPreview ? (
                            <div className="dcw-analysis__record">
                                <div
                                    // 기록이 바뀌면 새로 그려 반짝임을 처음부터 다시 보여 준다
                                    key={currentScanKey ?? undefined}
                                    className={`dcw-analysis__card${isSkinToneHex(currentRecordPreview.skinToneHex) ? ' has-tone' : ''}${
                                        changedScanKey && changedScanKey === currentScanKey ? ' is-changed' : ''
                                    }`}
                                    style={skinToneCardStyle(currentRecordPreview.skinToneHex)}
                                    onAnimationEnd={(e) => {
                                        if (e.animationName.startsWith('dcw-record-changed')) setChangedScanKey(null)
                                    }}
                                >
                                    <RecordPreviewView preview={currentRecordPreview} />
                                    {/* 바꿀 수 없는 기록 — 이유는 마우스를 올리면 보이는 설명(title)으로만 알려 준다 */}
                                    {!canSelectSession && (
                                        <span
                                            className="dcw-analysis__badge"
                                            title={isFixedRecord ? '이번 촬영 기록으로 고정돼 있어요' : '이 채팅에 반영한 기록이에요'}
                                        >
                                            <SidebarIcon name="lock" size={12} />
                                            고정
                                        </span>
                                    )}
                                </div>

                                <button
                                    type="button"
                                    className={`dcw-analysis__result-btn${isCurrentRecordPanelOpen ? ' is-active' : ''}`}
                                    onClick={onToggleAnalysisPanel}
                                    aria-expanded={isCurrentRecordPanelOpen}
                                >
                                    <span>{isCurrentRecordPanelOpen ? '분석 결과 상세 닫기' : '분석 결과 상세 보기'}</span>
                                    <SidebarIcon name="arrow" size={16} />
                                </button>
                            </div>
                        ) : (
                            <div className="dcw-analysis__empty">
                                <p>
                                    아직 손 분석 기록이 없어요.
                                    <br />
                                    손을 촬영하면 {userName ? `${userName}님` : '회원님'}께 어울리는 컬러와 쉐입으로 디자인해 드려요.
                                </p>
                                <button type="button" className="dcw-analysis__scan-btn" onClick={onGoToScan}>
                                    손 촬영하러 가기
                                    <SidebarIcon name="arrow" size={15} />
                                </button>
                            </div>
                        )}
                    </section>

                    {/* 새 채팅(위 손 분석 카드의 기록 — 지금 채팅의 기록, 손 촬영에서 이어 온 진입은 고정 기록) · 같은 줄 오른쪽에 '다른 분석 기록으로 새 채팅' */}
                    <div className="dcw-new-chat-row">
                        <button type="button" className={`dcw-new-chat${isFreshChat ? ' is-current' : ''}`} onClick={onNewChat}>
                            <SidebarIcon name="add" size={18} />
                            새 채팅
                        </button>
                        {hasOtherRecords && (
                            <button type="button" className="dcw-new-chat-row__other" onClick={pointToOtherRecords}>
                                다른 분석 기록으로 새 채팅
                                <SidebarIcon name="chevron" size={13} />
                            </button>
                        )}
                    </div>

                    {/* 채팅 이력 — 손 분석 기록별로 묶는다 */}
                    <section className="dcw-history" aria-label="채팅 이력">
                        {isHistoryLoading ? (
                            <div className="dcw-history__loading" aria-busy="true">
                                <span className="dcw-skeleton dcw-skeleton--line" />
                                <span className="dcw-skeleton dcw-skeleton--line" />
                                <span className="dcw-skeleton dcw-skeleton--line dcw-skeleton--short" />
                            </div>
                        ) : historyGroups.length === 0 ? (
                            <p className="dcw-history__empty">아직 채팅 이력이 없어요. 디자인을 만들면 여기에 쌓여요.</p>
                        ) : (
                            <>
                                {listedGroups.map(renderHistoryGroup)}
                                {shouldBundleEmptyRecords && (
                                    <div className={`dcw-history__group dcw-history__bundle${isEmptyRecordsOpen ? '' : ' is-collapsed'}`}>
                                        <div className="dcw-history__group-head">
                                            <button
                                                type="button"
                                                className="dcw-history__group-main"
                                                onClick={() => setIsEmptyRecordsOpen((prev) => !prev)}
                                                aria-expanded={isEmptyRecordsOpen}
                                                title={isEmptyRecordsOpen ? '채팅 없는 분석 기록 접기' : '채팅 없는 분석 기록 펼치기'}
                                            >
                                                <span className="dcw-history__group-label">채팅 없는 분석 기록 {emptyRecordGroups.length}개</span>
                                                <span className="dcw-history__group-chevron" aria-hidden="true">
                                                    <SidebarIcon name="chevron" size={14} />
                                                </span>
                                            </button>
                                        </div>
                                        {isEmptyRecordsOpen && <div className="dcw-history__bundle-list">{emptyRecordGroups.map(renderHistoryGroup)}</div>}
                                    </div>
                                )}
                            </>
                        )}
                    </section>
                    </>
                    )}
                </div>
            </div>

            {chatToDelete && (
                <DeleteChatConfirm
                    chat={chatToDelete}
                    onCancel={() => setChatToDelete(null)}
                    onConfirm={() => {
                        onDeleteChat(chatToDelete.sessionId)
                        setChatToDelete(null)
                    }}
                />
            )}

            <SidebarProfile
                nickname={nickname}
                email={profile?.email ?? null}
                avatarLetter={avatarLetter}
                hasGeneratingDesign={[...designStatusBySession.values()].includes('generating')}
                onGoToProfile={onGoToProfile}
                onGoToMyPage={onGoToMyPage}
                onGoToDesigns={onGoToDesigns}
                onLogout={onLogout}
            />
        </aside>
    )
}
