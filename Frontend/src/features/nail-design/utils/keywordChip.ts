// 결과 화면 "How It Was Made" 키워드 칩을 그리기 직전의 마지막 정리 (화면 표시 전용).
// 어디서 온 칩이든(고른 선택지·서버 키워드·예전에 저장된 결과) 끝에 붙은 "느낌의/분위기로" 같은 군더더기를 떼고,
// 그것만 남은 칩("느낌의", "디자인")은 뺀다. 예) "청량한 느낌의" → "청량한", "봄느낌" → "봄"

const FILLER_WORDS = '느낌|분위기|스타일|감성|무드|컨셉|콘셉트|디자인|무늬|패턴|모양|네일'
const FILLER_PARTICLES = '의|을|를|이|가|은|는|으로|로|에|처럼'
// 띄어 쓴 "청량한 느낌의", 붙여 쓴 "봄느낌의", "하트모양" 모두
const TRAILING_FILLER_PATTERN = new RegExp(`\\s*(?:${FILLER_WORDS})(?:${FILLER_PARTICLES})?$`)
const ONLY_FILLER_PATTERN = new RegExp(`^(?:${FILLER_WORDS})(?:${FILLER_PARTICLES})?$`)

export function cleanKeywordChip(keyword: string): string | null {
    // 앞뒤에 붙은 기호·이모지·자모("느낌의～", "귀여운ㅎㅎ", "「맑은」")를 뗀다
    let chip = keyword.trim().replace(/^[^가-힣A-Za-z0-9]+|[^가-힣A-Za-z0-9]+$/g, '')
    for (let pass = 0; pass < 2; pass++) {
        const stripped = chip.replace(TRAILING_FILLER_PATTERN, '').trim()
        if (stripped && stripped !== chip) chip = stripped
    }
    if (!chip || ONLY_FILLER_PATTERN.test(chip)) return null
    return chip
}
