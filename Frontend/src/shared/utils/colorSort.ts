// 분석 결과로 받아온 추천 컬러(보통 30색)를 화면에 보여주기 좋은 순서로 재정렬한다.
//
// 규칙
//  1. "완전 진한" 색(명도가 아주 낮은 색)은 따로 빼서 목록 맨 뒤에 모아 둔다.
//  2. 나머지(밝은 쪽) 색과, 뒤로 뺀 진한 색은 각각 그 안에서
//     - 색상값(hue)이 비슷한 것끼리 묶고,
//     - 채도가 거의 없는 무채색은 별도 묶음으로 모으고,
//     - 각 묶음 안에서는 밝은 색 → 어두운 색 순으로 정렬한다.
//  3. 색으로 해석할 수 없는 값(hex 아님)은 순서를 유지한 채 맨 끝에 붙인다.
//
// 백엔드(scan/skin_color.py)가 이미 hue 순으로 내려주긴 하지만, "밝은 것 우선 +
// 진한 것 후미"는 프론트 표시용 규칙이라 여기서 입력 순서와 무관하게 다시 정렬한다.
//
// ── 1차원 정렬 vs 그리드 배치 ────────────────────────────────────────
// sortRecommendedColors()는 1차원 목록만 만든다. 그런데 이 목록을 6열 그리드에
// 흘려넣을 때와 10열 그리드에 흘려넣을 때는 줄바꿈 위치가 달라서, 같은 배열이라도
// 한쪽에선 색상군이 세로줄로 맞고 다른 쪽에선 뒤죽박죽으로 보인다. 그래서 그리드에
// 렌더할 자리에서는 arrangeRecommendedColors(hexes, { columns })로 열 수에 맞춰
// 2차원(row-major) 배치를 만든다.
//  - 세로줄(열) = 하나의 색상군, 위(밝음) → 아래(어두움).
//  - 가로줄(행) = 하나의 명도 단계.
//  - 진한 색(L ≤ 40): 배치에 섞지 않고 통째로 뒤로 몰아 맨 아랫줄(들)에 모은다.

// 이 명도(HSL L, 0~100) 이하면 "완전 진한 색"으로 보고 목록 뒤쪽 묶음으로 보낸다.
const DEEP_LIGHTNESS_MAX = 40
// 채도(HSL S, 0~100)가 이보다 낮으면 hue가 사실상 의미 없는 무채색으로 보고 한 묶음으로 합친다.
const ACHROMATIC_SATURATION_MAX = 12
// 색상환에서 이 값보다 간격이 벌어진 지점을 "다른 색상 묶음"의 경계로 본다.
// (30도 같은 고정 그리드로 자르면 hue 179와 181처럼 사실상 같은 색이 갈라진다.)
const HUE_GAP_THRESHOLD = 28

type Hsl = { h: number; s: number; l: number }

function parseHexToHsl(value: string): Hsl | null {
    const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
    if (!match) return null

    const raw = match[1]
    const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
    const int = parseInt(full, 16)
    const r = ((int >> 16) & 255) / 255
    const g = ((int >> 8) & 255) / 255
    const b = (int & 255) / 255

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const l = (max + min) / 2
    const d = max - min
    if (d === 0) return { h: 0, s: 0, l: l * 100 }

    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    let h: number
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    return { h: ((h * 60) % 360 + 360) % 360, s: s * 100, l: l * 100 }
}

/**
 * 색상환(hue) 위에서 색들이 실제로 몰려 있는 구간끼리 묶는다. 색상값 순으로 원을 한 바퀴
 * 돌면서 "가장 크게 비어 있는 구간"을 이음매로 삼아 원을 펼치고(그래야 빨강 계열처럼 0도
 * 근처에 몰린 색이 이음매에 걸려 반으로 쪼개지지 않는다), 이어서 이웃한 색끼리 간격이
 * HUE_GAP_THRESHOLD보다 벌어지는 지점마다 새 묶음으로 자른다.
 */
function clusterBySimilarHue<T>(items: T[], hueOf: (item: T) => number): T[][] {
    if (items.length <= 1) return items.length === 1 ? [items] : []

    const sorted = [...items].sort((a, b) => hueOf(a) - hueOf(b))
    const n = sorted.length

    let seamIndex = 0
    let largestGap = -1
    for (let i = 0; i < n; i += 1) {
        const current = hueOf(sorted[i])
        const next = hueOf(sorted[(i + 1) % n])
        const gap = i === n - 1 ? 360 - current + next : next - current
        if (gap > largestGap) {
            largestGap = gap
            seamIndex = i
        }
    }
    const opened = [...sorted.slice(seamIndex + 1), ...sorted.slice(0, seamIndex + 1)]

    const groups: T[][] = [[opened[0]]]
    for (let i = 1; i < opened.length; i += 1) {
        const gap = (hueOf(opened[i]) - hueOf(opened[i - 1]) + 360) % 360
        if (gap > HUE_GAP_THRESHOLD) groups.push([opened[i]])
        else groups[groups.length - 1].push(opened[i])
    }
    return groups
}

type Swatch = { hex: string; hsl: Hsl }

/** 한 묶음(밝은 쪽 / 진한 쪽)을 색상별로 묶고 각 묶음 안에서 밝은 색 → 어두운 색 순으로 편다. */
function arrangeByHueThenLight(swatches: Swatch[]): string[] {
    if (swatches.length === 0) return []

    const chroma = swatches.filter((s) => s.hsl.s >= ACHROMATIC_SATURATION_MAX)
    const gray = swatches.filter((s) => s.hsl.s < ACHROMATIC_SATURATION_MAX)

    const byLightDesc = (a: Swatch, b: Swatch) => b.hsl.l - a.hsl.l

    const hueGroups = clusterBySimilarHue(chroma, (s) => s.hsl.h)
        .map((group) => [...group].sort(byLightDesc))

    const grayGroup = [...gray].sort(byLightDesc)

    return [...hueGroups.flat(), ...grayGroup].map((s) => s.hex)
}

/**
 * 추천 컬러 hex 배열을 화면 표시용 순서로 정렬해서 돌려준다.
 * 입력 길이/원소는 그대로 보존하고 순서만 바꾼다.
 */
export function sortRecommendedColors(hexes: string[]): string[] {
    const parsed = hexes.map((hex) => ({ hex, hsl: parseHexToHsl(hex) }))
    const valid: Swatch[] = parsed
        .filter((p): p is { hex: string; hsl: Hsl } => p.hsl !== null)
        .map((p) => ({ hex: p.hex, hsl: p.hsl }))
    const invalid = parsed.filter((p) => p.hsl === null).map((p) => p.hex)

    const normal = valid.filter((s) => s.hsl.l > DEEP_LIGHTNESS_MAX)
    const deep = valid.filter((s) => s.hsl.l <= DEEP_LIGHTNESS_MAX)

    return [...arrangeByHueThenLight(normal), ...arrangeByHueThenLight(deep), ...invalid]
}

export type GridArrangeOptions = {
    /** 목표 그리드의 열 수. 그리드는 기본 흐름(row-major, 왼→오 위→아래)으로 채워진다고 본다. */
    columns: number
}

/**
 * 추천 컬러를 열 수에 맞춰 2차원(row-major)으로 재배치한다.
 *
 *  - 세로줄(열) = 하나의 색상군, 위(밝음) → 아래(어두움).
 *  - 가로줄(행) = 하나의 명도 단계.
 *  - 진한 색(L ≤ 40)은 배치에 섞지 않고 통째로 뒤로 몰아 맨 아랫줄(들)에 모은다.
 *    색상군(열) 순서는 밝은 칸과 동일하게 맞춘다.
 *  - 무채색은 색상군 뒤(오른쪽 열)로, hex로 해석 못 하는 값은 맨 끝.
 *
 * 6열과 10열은 한 명도 단계에 들어가는 색 수가 달라 결과가 서로 다르다 — 의도된 동작.
 */
export function arrangeRecommendedColors(hexes: string[], options: GridArrangeOptions): string[] {
    const parsed = hexes.map((hex) => ({ hex, hsl: parseHexToHsl(hex) }))
    const valid: Swatch[] = parsed
        .filter((p): p is { hex: string; hsl: Hsl } => p.hsl !== null)
        .map((p) => ({ hex: p.hex, hsl: p.hsl }))
    const invalid = parsed.filter((p) => p.hsl === null).map((p) => p.hex)

    const columns = Math.max(1, Math.floor(options.columns))
    if (valid.length === 0) return [...invalid]
    if (columns <= 1) return [...sortRecommendedColors(hexes)]

    const byLightDesc = (a: Swatch, b: Swatch) => b.hsl.l - a.hsl.l

    // 색상환 순서는 진한 색까지 포함해 한 번만 잡는다 — 밝은 칸의 열과 진한 칸의 열이 어긋나지 않도록.
    const chroma = valid.filter((s) => s.hsl.s >= ACHROMATIC_SATURATION_MAX)
    const hueRank = new Map<Swatch, number>(
        clusterBySimilarHue(chroma, (s) => s.hsl.h).flat().map((s, i) => [s, i]),
    )
    const rankOf = (s: Swatch) => hueRank.get(s) ?? Number.MAX_SAFE_INTEGER // 무채색은 맨 뒤(오른쪽 열)
    const byHueThenLight = (a: Swatch, b: Swatch) => rankOf(a) - rankOf(b) || byLightDesc(a, b)

    const normal = valid.filter((s) => s.hsl.l > DEEP_LIGHTNESS_MAX)
    const deep = valid.filter((s) => s.hsl.l <= DEEP_LIGHTNESS_MAX)

    const out: string[] = []
    // 밝은 색: 밝은 순으로 columns개씩 한 가로줄, 줄 안은 색상군 순서 → 세로줄 하나가 한 색상군.
    const byLight = [...normal].sort(byLightDesc)
    for (let i = 0; i < byLight.length; i += columns) {
        byLight.slice(i, i + columns).sort(byHueThenLight).forEach((s) => out.push(s.hex))
    }
    // 진한 색: 같은 색상군 순서로 정렬해 통째로 뒤에 → 맨 아랫줄(들)에 진한 색만 모인다.
    ;[...deep].sort(byHueThenLight).forEach((s) => out.push(s.hex))

    return [...out, ...invalid]
}
