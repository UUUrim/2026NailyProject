// 선택지 기반 흐름의 "기타" 입력란에 사용자가 적은 문장을, 선택지 값과 나란히 넘길 짧은 키워드로 다듬는다.
// 예) "몽환적인 느낌" → ["몽환적"], "나비랑 체리 넣어주세요" → ["나비", "체리"], "체크 패턴" → ["체크 패턴"]
//
// 규칙
//  1. "~말고/빼고/싫어요"처럼 부정이 섞인 문장은 키워드로 쪼개면 뜻이 뒤집힐 수 있어서(빼달라는 걸
//     넣어달라는 키워드로 바꿔버림) 원문 그대로 하나의 키워드로 넘긴다.
//  2. 끝에 붙은 요청 표현("넣어주세요", "해줘", "원해요" 등)을 떼어낸다.
//  3. 쉼표·슬래시·"그리고"·"랑/하고/와/과" 기준으로 여러 키워드로 나눈다.
//  4. 각 키워드 끝의 뜻 없는 말("느낌", "분위기", "스타일", "같은" 등)을 떼고, "~적인"은 "~적"으로 줄인다.
//  5. 다듬고 나서 아무것도 안 남으면 원문을 그대로 쓴다.

const NEGATION_PATTERN = /말고|빼고|빼줘|빼 줘|제외|싫|없이|아닌|않/

// 끝에 붙는 요청 표현. 목적격 조사(을/를)는 앞에 2글자 이상 붙어 있을 때만 같이 뗀다
// ("나비를 넣어주세요" → "나비"는 되고, "가을 넣어주세요"가 "가"로 잘리지는 않게).
const REQUEST_SUFFIX_PATTERNS = [
    /(?:(?<=[가-힣]{2})을|(?<=[가-힣])를)?\s*(?:넣어|추가해|그려|해|만들어|표현해|넣어서|해서)\s*(?:주세요|주셔요|줘요|줘|주라|주시면 좋겠어요)$/,
    /(?:(?<=[가-힣]{2})을|(?<=[가-힣])를)?\s*(?:넣고|하고|그리고)\s*싶(?:어요|어|습니다)$/,
    /\s*(?:주세요|줘요|줘)$/,
    /\s*(?:원해요|원해|원함|좋아요|좋겠어요|좋겠어|부탁해요|부탁드려요|부탁드립니다)$/,
    /\s*(?:추가|포함)$/,
]

// 여러 키워드를 나누는 구분자. "노랑/사랑", "사과/효과"처럼 '랑/과'로 끝나는 낱말이 잘리지 않도록
// 앞에 2글자 이상 붙은 경우만 조사로 본다("이랑"은 "별이랑"처럼 1글자 뒤도 허용).
const SPLIT_PATTERN =
    /[,，、/·+&\n]|\s+(?:그리고|및|또는|아니면)\s+|(?<=[가-힣])이랑\s+|(?<=[가-힣]{2})(?:랑|하고|와|과)\s+/

// 키워드 끝에 붙어도 뜻을 더하지 않는 말 (뒤에 "의/으로/로"가 붙은 꼴까지)
const FILLER_SUFFIX_PATTERNS = [
    /\s*(?:느낌|분위기|스타일|감성|무드|컨셉|콘셉트)(?:의|으로|로|이|가)?$/,
    /\s*(?:같은|같이|처럼)$/,
    /\s+(?:디자인|모양)(?:의|으로|로)?$/,
]

function stripRepeatedly(text: string, patterns: RegExp[]): string {
    let current = text
    let previous = ''
    while (current !== previous) {
        previous = current
        for (const pattern of patterns) {
            current = current.replace(pattern, '').trim()
        }
    }
    return current
}

export function extractNoteKeywords(note: string): string[] {
    const original = note.trim()
    if (!original) return []
    if (NEGATION_PATTERN.test(original)) return [original]

    const sentence = stripRepeatedly(original.replace(/[.!?~…]+$/, '').trim(), REQUEST_SUFFIX_PATTERNS)

    const keywords = sentence
        .split(SPLIT_PATTERN)
        .map((part) => stripRepeatedly(part.trim(), [...REQUEST_SUFFIX_PATTERNS, ...FILLER_SUFFIX_PATTERNS]))
        .map((part) => part.replace(/([가-힣]+)적인$/, '$1적'))
        .filter((part) => part.length > 0)

    const unique = Array.from(new Set(keywords))
    return unique.length > 0 ? unique : [original]
}
