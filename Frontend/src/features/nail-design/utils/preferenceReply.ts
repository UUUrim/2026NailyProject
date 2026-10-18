// 선택지를 다 고른 뒤 네일리 답장의 화면 표시 — 서버에 저장된 답장은 그대로 두고 어디에 무엇을 보여 줄지만 정한다.
// - 채팅 화면: 늘 정해진 멘트(PREFERENCE_REPLY_MESSAGE) — chatOnly 말풍선
// - 마이페이지 채팅 이력: 서버(GPT)가 준 답장을 다듬어서(trimPreferenceReply) — historyOnly 말풍선
export const PREFERENCE_REPLY_MESSAGE = '선택 감사해요! 골라주신 내용을 반영하여 디자인을 만들어 드릴게요.'

// ── GPT 답장 다듬기 (마이페이지 이력) ─────────────────────────────────────────
// 바로 디자인을 만드는 흐름이라 "~진행할게요."로 끝나야 하고, 사용자에게 의견을 묻는 말은 답할 곳이 없어서 뺀다.
// - 의견을 묻는 문장("핑크와 빨강은 어떤 느낌이 더 마음에 드세요?" 등)은 어디에 있든 뺀다.
// - "진행할게요/맞춰 드릴게요/만들어 드릴게요" 같은 문장이 있으면 그 문장에서 끝낸다
//   (뒤의 "모든 준비가 완료되었습니다", "궁금하신 점 있으면 언제든 말씀해 주세요" 같은 말은 뺀다).
// - 그런 문장이 없으면 끝에 붙은 권유·안내 문장만 떼고, 진행한다는 문장을 붙인다.
// - 오류 안내뿐이면(서버가 답장을 못 만든 경우) 진행 문장만 보여 준다.
// 이미 다듬은 글에 다시 써도 결과가 같아서, 예전에 저장된 대화를 다시 보여 줄 때도 쓴다.

const PREFERENCE_REPLY_FALLBACK = '고르신 내용으로 디자인을 진행할게요.'
const PROCEED_SENTENCE_PATTERN =
    /(진행할게요|진행하겠습니다|진행해 ?드릴게요|만들어 ?드릴게요|만들어 볼게요|만들게요|디자인해 ?드릴게요|맞춰 ?드릴게요|맞춰 볼게요|반영해 ?드릴게요|반영할게요)/
const ASKING_WORDS_PATTERN =
    /(어떠세요|어떠신가요|마음에 드시|원하시나요|괜찮으세요|괜찮으신가요|골라 ?주세요|선택해 ?주세요|말씀해 ?주세요|알려 ?주세요)/
const CLOSING_SENTENCE_PATTERN =
    /(궁금|문의|언제든|요청 ?사항|도움이 필요|필요하시면|편하게|준비가 (다 )?(완료|끝)|완료되었습니다|기다려 ?주세요)/

// 의견을 묻는 문장 — 물음표로 끝나거나, 진행 문장이 아니면서 묻는 말이 들어 있는 문장
// ("마음에 드시는 디자인으로 진행할게요."처럼 진행 문장 안에 섞인 말은 묻는 문장으로 보지 않는다)
function isAskingSentence(sentence: string): boolean {
    if (/[?？]$/.test(sentence)) return true
    return !PROCEED_SENTENCE_PATTERN.test(sentence) && ASKING_WORDS_PATTERN.test(sentence)
}

export function trimPreferenceReply(reply: string): string {
    const sentences = reply
        .split(/(?<=[.!?？~…])\s+|\n+/)
        .map((sentence) => sentence.trim())
        .filter(Boolean)
        .filter((sentence) => !isAskingSentence(sentence))
        // 예전에 화면에서 붙였던 진행 문장은 빼고 다시 판단한다 (GPT의 진행 문장이 있으면 그걸로 끝나게)
        .filter((sentence) => sentence !== PREFERENCE_REPLY_FALLBACK)
    const lastProceedIndex = sentences.findLastIndex((sentence) => PROCEED_SENTENCE_PATTERN.test(sentence))
    if (lastProceedIndex >= 0) return sentences.slice(0, lastProceedIndex + 1).join(' ')

    const kept = [...sentences]
    while (kept.length > 0 && CLOSING_SENTENCE_PATTERN.test(kept[kept.length - 1])) kept.pop()
    if (kept.length === 0 || kept.some((sentence) => /오류|죄송/.test(sentence))) return PREFERENCE_REPLY_FALLBACK
    return `${kept.join(' ')} ${PREFERENCE_REPLY_FALLBACK}`
}

// ── 저장된 대화 다루기 ─────────────────────────────────────────────────────────

type SavedBubble = { role: string; historyOnly?: boolean | null; chatOnly?: boolean | null }

// 선택지 기반 답장 자리 — 서버로 보낸 요약 문장(historyOnly인 내 말풍선) 바로 다음의 네일리 말풍선.
// 지금은 여기에 GPT 답장(historyOnly)이 있고 그 다음에 정해진 멘트(chatOnly)가 온다.
// 예전 대화는 여기에 GPT 답장이나 정해진 멘트가 표시 없이 하나만 있다.
function isPreferenceReplySlot<T extends SavedBubble>(items: T[], index: number): boolean {
    const previous = items[index - 1]
    return items[index].role === 'assistant' && !!previous && previous.role === 'user' && !!previous.historyOnly
}

export type PreferenceReplyMarks = { historyOnly?: boolean; chatOnly?: boolean }

/**
 * 채팅을 다시 열 때 예전 대화의 선택지 기반 답장을 지금 구조로 맞춘다 — 채팅 화면엔 정해진 멘트, 마이페이지 이력엔 GPT 답장.
 * - 표시 없는 GPT 답장 → 다듬은 GPT 답장(historyOnly) + 정해진 멘트(chatOnly, 새 말풍선 — asNew가 true)
 * - 표시 없는 정해진 멘트 → chatOnly로 (GPT 답장은 저장돼 있지 않다)
 * 이미 지금 구조면 그대로 둔다.
 */
export function splitSavedPreferenceReplies<T extends SavedBubble>(
    items: T[],
    getText: (item: T) => string,
    withText: (item: T, text: string, marks: PreferenceReplyMarks, asNew: boolean) => T,
): T[] {
    return items.flatMap((item, i) => {
        if (!isPreferenceReplySlot(items, i) || item.historyOnly) return [item]
        const text = getText(item)
        if (text === PREFERENCE_REPLY_MESSAGE) return [withText(item, text, { chatOnly: true }, false)]
        return [
            withText(item, trimPreferenceReply(text), { historyOnly: true }, false),
            withText(item, PREFERENCE_REPLY_MESSAGE, { chatOnly: true }, true),
        ]
    })
}

/**
 * 마이페이지 채팅 이력에 보여 줄 선택지 기반 답장 — GPT 답장은 다듬어서 보여 주고, 정해진 멘트만 저장된 예전 대화는 그 멘트를 뺀다.
 * (지금 구조의 정해진 멘트는 chatOnly라 이력에서 따로 빠진다)
 */
export function prepareSavedPreferenceRepliesForHistory<T extends SavedBubble>(
    items: T[],
    getText: (item: T) => string,
    withText: (item: T, text: string) => T,
): T[] {
    return items.flatMap((item, i) => {
        if (!isPreferenceReplySlot(items, i)) return [item]
        const text = getText(item)
        if (text === PREFERENCE_REPLY_MESSAGE) return []
        return [withText(item, trimPreferenceReply(text))]
    })
}
