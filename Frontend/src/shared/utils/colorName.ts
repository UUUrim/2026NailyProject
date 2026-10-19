// hex 색을 한글 색 이름("페일 핑크", "애쉬 로즈" ...)으로 바꾼다.
// 백엔드 ColorNameService의 기준 색 표 + CIELAB 최근접 규칙을 그대로 옮기고, 이름은 백엔드가 결과 키워드를
// 한글로 바꿀 때(NailDesignService.localizeKeyword)와 같은 표기로 맞췄다 — 채팅에서 고른 색 이름과
// 완성 디자인 키워드 칩의 색 이름이 같게 보이도록. 백엔드 표를 고치면 여기도 같이 고친다.

type Lab = [number, number, number]

// [hex, 한글 이름] — 앞의 8개는 선택지 기본 컬러(정확히 일치하면 그 이름), 나머지는 근접 매칭용 기준 색
const ANCHOR_COLORS: [string, string][] = [
    ['FDE2EA', '페일 핑크'],
    ['FFC0D0', '라이트 핑크'],
    ['FF90B3', '비비드 핑크'],
    ['DE869F', '애쉬 로즈'],
    ['A98BFF', '라이트 라벤더'],
    ['7CD6D6', '라이트 민트'],
    ['FFF2A8', '페일 옐로'],
    ['E6E6E6', '라이트 그레이'],
    // neutral
    ['FFFFFF', '화이트'],
    ['FFF8E7', '아이보리'],
    ['F5EEDC', '크림'],
    ['9E9E9E', '그레이'],
    ['4A4A4A', '딥 그레이'],
    ['111111', '블랙'],
    // pink / rose / red
    ['D8A7B1', '애쉬 핑크'],
    ['E0607E', '로즈'],
    ['A8324F', '딥 로즈'],
    ['D81B60', '딥 핑크'],
    ['E0218A', '비비드 마젠타'],
    ['D32F2F', '레드'],
    ['FF1F1F', '비비드 레드'],
    ['7B1E2B', '딥 레드'],
    // peach / coral / orange
    ['FFE8DC', '페일 피치'],
    ['FFD3B6', '피치'],
    ['FF7F6B', '코랄'],
    ['D98A7C', '뮤트 코랄'],
    ['FF8C1A', '오렌지'],
    ['FF6A00', '비비드 오렌지'],
    ['B8500F', '딥 오렌지'],
    // yellow / beige / brown
    ['FFD93D', '옐로'],
    ['FFE600', '비비드 옐로'],
    ['FFD700', '골드'],
    ['D8C070', '뮤트 옐로'],
    ['B8931A', '딥 옐로'],
    ['F5EFE9', '밀키 베이지'],
    ['F3E7D3', '라이트 베이지'],
    ['E8D5B7', '베이지'],
    ['B98B6B', '라이트 브라운'],
    ['8B5A3C', '브라운'],
    ['4A2C1D', '딥 브라운'],
    // green / mint / teal
    ['DFF2D8', '페일 그린'],
    ['A8DDA0', '라이트 그린'],
    ['3FA55B', '그린'],
    ['17C24A', '비비드 그린'],
    ['8FA98F', '뮤트 그린'],
    ['1E5B36', '딥 그린'],
    ['7A7A2E', '올리브 그린'],
    ['4B4F1C', '딥 올리브 그린'],
    ['D5F3E8', '페일 민트'],
    ['98E0C0', '민트'],
    ['1E8A8A', '청록'],
    ['0F5257', '딥 청록'],
    // blue
    ['DCEBFA', '페일 블루'],
    ['A8CCF0', '라이트 블루'],
    ['3B7DD8', '블루'],
    ['1E5BFF', '비비드 블루'],
    ['7D93B5', '뮤트 블루'],
    ['1B3A80', '딥 블루'],
    ['1A2550', '네이비'],
    // purple / lavender
    ['ECE6FA', '페일 라벤더'],
    ['B9A2E6', '라벤더'],
    ['B3A6C9', '뮤트 라벤더'],
    ['C6A6E6', '라이트 퍼플'],
    ['8E44AD', '퍼플'],
    ['8A2BE2', '비비드 퍼플'],
    ['4B2A7B', '딥 퍼플'],
]

/** "#RRGGBB" / "RRGGBB" / "#RGB" → 소문자 6자리(# 없음), 아니면 null */
function normalizeHex(hex: string): string | null {
    let h = hex.trim().replace('#', '').toLowerCase()
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    return /^[0-9a-f]{6}$/.test(h) ? h : null
}

function linear(c: number) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function labF(t: number) {
    return t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116
}

function hexToLab(normalized: string): Lab {
    const rgb = parseInt(normalized, 16)
    const rl = linear(((rgb >> 16) & 0xff) / 255)
    const gl = linear(((rgb >> 8) & 0xff) / 255)
    const bl = linear((rgb & 0xff) / 255)
    const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / 0.95047
    const y = 0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl
    const z = (0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl) / 1.08883
    const fx = labF(x)
    const fy = labF(y)
    const fz = labF(z)
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

const ANCHORS = ANCHOR_COLORS.map(([hex, name]) => ({ name, lab: hexToLab(hex.toLowerCase()) }))

/** hex 하나를 가장 가까운 기준 색의 한글 이름으로. hex가 아니면 입력을 그대로 돌려준다. */
export function koreanColorName(hex: string): string {
    const normalized = normalizeHex(hex)
    if (!normalized) return hex.trim()
    const [l, a, b] = hexToLab(normalized)
    let best = ANCHORS[0]
    let bestDistance = Infinity
    for (const anchor of ANCHORS) {
        const distance = (l - anchor.lab[0]) ** 2 + (a - anchor.lab[1]) ** 2 + (b - anchor.lab[2]) ** 2
        if (distance < bestDistance) {
            bestDistance = distance
            best = anchor
        }
    }
    return best.name
}
