import { PREFERENCE_OPTIONS } from '@/shared/constants/designPreferences'

// 사이드바 채팅 이력의 채팅 이름 — 그 채팅에서 만든 네일의 분위기로 짓는다 (사용자가 직접 바꾸면 그 이름을 쓴다)

const TITLE_KEYWORD_COUNT = 3
const TITLE_MAX_LENGTH = 30

// 쉐입 이름은 분위기가 아니라서 이름에 넣지 않는다
const SHAPE_WORDS = new Set([...PREFERENCE_OPTIONS.shape.map((option) => option.label), '스퀘어오벌', '코핀'])

/**
 * 디자인 키워드(서버가 분위기 → 디자인 기법 → 모티프 → 계절 → 쉐입 → 컬러 순으로 한글로 정리한 것)에서
 * 앞의 몇 개로 "러블리 프렌치 하트 네일" 같은 이름을 만든다. 쓸 키워드가 없으면 null.
 */
export function buildDesignChatTitle(keywords: string[] | null | undefined): string | null {
    const picked: string[] = []
    for (const raw of keywords ?? []) {
        const keyword = raw.trim()
        if (!keyword || SHAPE_WORDS.has(keyword) || /^#[0-9A-Fa-f]{3,6}$/.test(keyword)) continue
        if (picked.includes(keyword)) continue
        picked.push(keyword)
        if (picked.length >= TITLE_KEYWORD_COUNT) break
    }
    if (picked.length === 0) return null
    const body = picked.join(' ')
    return clampTitle(/네일$/.test(body) ? body : `${body} 네일`)
}

/** 디자인을 만들기 전, 선택지 기반에서 고른 분위기로 지은 이름 ("러블리·내추럴 네일") */
export function buildMoodChatTitle(moodLabels: string[]): string | null {
    const labels = moodLabels.map((label) => label.trim()).filter((label) => label && label !== '상관없음')
    if (labels.length === 0) return null
    return clampTitle(`${labels.slice(0, TITLE_KEYWORD_COUNT).join('·')} 네일`)
}

/** 디자인을 만들기 전, 자유 입력 첫 문장으로 지은 이름 */
export function buildMessageChatTitle(message: string): string | null {
    const text = message.replace(/\s+/g, ' ').trim()
    return text ? clampTitle(text) : null
}

function clampTitle(title: string): string {
    return title.length > TITLE_MAX_LENGTH ? `${title.slice(0, TITLE_MAX_LENGTH - 1)}…` : title
}
