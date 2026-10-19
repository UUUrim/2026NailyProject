// 컬러 "기타 입력"과 함께 서버로 보내는, 고른 색을 순서 번호와 함께 알려 주는 문장 — "2번째 색상은 포인트 색으로만 써줘" 같은
// 기타 입력이 어떤 색을 가리키는지 GPT가 알 수 있게 한다. 선택지 기반 컬러 단계와 자유 입력 컬러피커가 같이 쓴다.

// GPT에게만 필요한 안내라, 마이페이지 채팅 이력에 이 문장이 담긴 말풍선을 보여 줄 때는 숨긴다 (hidePickedColorsRoleNote)
export const PICKED_COLORS_ROLE_NOTE = '(직접 고른 색이며, 아래 요청이 색의 역할(예: 포인트 색)을 정하면 따라 주세요.)'

// 고른 색이 없으면 ''
export function buildPickedColorsContext(hexes: string[]): string {
    if (hexes.length === 0) return ''
    return `컬러는 선택한 순서대로 ${hexes.map((hex, i) => `${i + 1}번째 ${hex}`).join(', ')}로 해주세요. ${PICKED_COLORS_ROLE_NOTE}`
}

export function hidePickedColorsRoleNote(text: string): string {
    return text.replaceAll(` ${PICKED_COLORS_ROLE_NOTE}`, '').replaceAll(PICKED_COLORS_ROLE_NOTE, '')
}
