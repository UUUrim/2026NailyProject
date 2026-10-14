// 추천 컬러(보통 30색)·이달의 컬러·디자인 결과 컬러 팔레트를 화면에 보여줄 순서로 재정렬한다.
// 세 곳 모두 같은 규칙이고, 한 줄 띠든 6열·10열 그리드든 이 순서를 그대로(왼→오, 위→아래로
// 이어 읽히게) 흘려 넣는다 — 열 수에 따라 배치를 따로 만들지 않는다.
//
// 규칙: 전체 색을 외판원 순회(TSP) 경로 하나로 잇는다.
//  - 가장 연한 색에서 출발해 모든 색을 한 번씩 지나는 경로 중, 이웃한 두 색 사이 비용의 합이
//    가장 작은 경로를 고른다. 색상 계열을 미리 나누지 않는다 — 바로 옆 색끼리 가장 매끄럽게
//    이어지는 순서가 곧 화면 순서다.
//  - 비용 = 두 색의 차이(OKLab 거리, 사람 눈에 보이는 색 차이)
//         + 더 연한 색으로 되돌아갈 때의 벌점(LIGHTEN_PENALTY × 연해진 정도)
//    그래서 이웃끼리는 비슷하게 이어지면서 흐름은 연한 색 → 진한 색으로 간다(보통 화이트로
//    시작해 블랙으로 끝난다).
//  - "연한 정도"는 흰색이 섞인 정도 — 채널 최댓값·최솟값의 평균(= HSL 명도). 파스텔은 높고,
//    쨍한 색·탁한 색·어두운 색은 낮다.
//  - hex로 해석할 수 없는 값은 입력 순서 그대로 맨 끝에 붙인다.
//
// 경로 찾기: 색이 EXACT_TSP_MAX개 이하면 동적 계획법으로 정확히 푼다. 그보다 많으면(추천 30색 등)
// 정확히 풀 수 없어서 근사로 푼다 — 시작 경로 두 개(가까운 색 따라가기, 연한 순)를 2-opt·Or-opt로
// 다듬고, 경로를 조금씩 흔들었다 다시 다듬기(반복 지역 탐색)를 SEARCH_KICKS번, 마지막으로 연속한
// WINDOW_SIZE칸씩 최적 순서로 다시 놓는다. 생성기 팔레트 40개로 재 보면 아주 오래 탐색한 결과와
// 평균 0.1% 안쪽 차이, 30색 한 번에 수 ms. 흔들기는 고정된 시드를 써서 같은 입력엔 늘 같은 순서다.

// TSP 비용에서 더 연한 색으로 되돌아갈 때의 벌점 배율. 0이면 순수하게 이웃끼리 비슷한 경로만 찾고,
// 클수록 연한 → 진한 흐름을 더 고집한다. 이웃 색 사이 OKLab 거리가 보통 0.03~0.15라서, 이 정도면
// 비슷한 색끼리 붙이기를 우선하되 굳이 연한 색으로 거슬러 올라가지는 않는다.
const LIGHTEN_PENALTY = 0.5
// 색 수가 이 이하면 TSP를 정확히(동적 계획법) 푼다. 12색에 3ms 안팎.
const EXACT_TSP_MAX = 12
// 근사 풀이에서 경로를 흔들었다 다시 다듬는 횟수와, 마지막에 최적 순서로 다시 놓는 연속 칸 수.
const SEARCH_KICKS = 30
const WINDOW_SIZE = 7
// 같은 팔레트를 화면이 다시 그려질 때마다 다시 풀지 않도록 최근 결과를 이만큼 기억해 둔다.
const SORT_CACHE_MAX = 64

/** l·a·b = OKLab, pale = 흰색이 섞인 정도(HSL 명도, 0~1, 클수록 연한 색). */
type ColorInfo = { l: number; a: number; b: number; pale: number }
type Cost = number[][]

function srgbToLinear(channel: number): number {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function parseHex(value: string): ColorInfo | null {
    const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
    if (!match) return null

    const raw = match[1]
    const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
    const int = parseInt(full, 16)
    const channels = [(int >> 16) & 255, (int >> 8) & 255, int & 255]
    const [r, g, b] = channels.map(srgbToLinear)

    // sRGB(linear) → OKLab (Björn Ottosson)
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)

    return {
        l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
        pale: (Math.max(...channels) + Math.min(...channels)) / 2 / 255,
    }
}

/** from 다음에 to를 놓는 비용 = 두 색의 OKLab 거리 + 더 연한 색으로 되돌아가는 만큼의 벌점. */
function stepCost(from: ColorInfo, to: ColorInfo): number {
    const distance = Math.hypot(from.l - to.l, from.a - to.a, from.b - to.b)
    return distance + LIGHTEN_PENALTY * Math.max(0, to.pale - from.pale)
}

// ── TSP 경로 찾기 ────────────────────────────────────────────────────────
// 모두 0번 점(가장 연한 색)에서 출발하고 끝점은 자유인 경로를 다룬다. 비용은 방향에 따라 다르다
// (연해지는 쪽에만 벌점이 붙어서).

const EPS = 1e-12

function pathCost(cost: Cost, path: number[]): number {
    let total = 0
    for (let i = 1; i < path.length; i += 1) total += cost[path[i - 1]][path[i]]
    return total
}

/**
 * path[from..from+size-1]의 점들을 path[from-1] 다음에 오는 최소 비용 순서로 다시 놓는다
 * (path[from+size]가 있으면 그 앞에서 끝나는 비용까지 따진다). 동적 계획법(Held-Karp) — size가
 * 경로 전체(from = 1)면 정확한 TSP 풀이다. 나아졌으면 path를 고치고 true.
 */
function reorderOptimally(cost: Cost, path: number[], from: number, size: number): boolean {
    const nodes = path.slice(from, from + size)
    const w = nodes.length
    const before = path[from - 1]
    const after = from + w < path.length ? path[from + w] : -1
    const full = 1 << w
    const best = new Float64Array(full * w).fill(Infinity)
    const prev = new Int8Array(full * w).fill(-1)
    for (let j = 0; j < w; j += 1) best[(1 << j) * w + j] = cost[before][nodes[j]]
    for (let visited = 1; visited < full; visited += 1) {
        for (let last = 0; last < w; last += 1) {
            const sofar = best[visited * w + last]
            if (sofar === Infinity) continue
            for (let next = 0; next < w; next += 1) {
                if (visited & (1 << next)) continue
                const key = (visited | (1 << next)) * w + next
                const total = sofar + cost[nodes[last]][nodes[next]]
                if (total < best[key]) {
                    best[key] = total
                    prev[key] = last
                }
            }
        }
    }

    let end = 0
    let bestTotal = Infinity
    for (let last = 0; last < w; last += 1) {
        const total = best[(full - 1) * w + last] + (after >= 0 ? cost[nodes[last]][after] : 0)
        if (total < bestTotal) {
            bestTotal = total
            end = last
        }
    }
    let current = cost[before][nodes[0]] + (after >= 0 ? cost[nodes[w - 1]][after] : 0)
    for (let j = 1; j < w; j += 1) current += cost[nodes[j - 1]][nodes[j]]
    if (bestTotal >= current - EPS) return false

    const order: number[] = []
    for (let visited = full - 1, node = end; node !== -1; ) {
        order.push(nodes[node])
        const before2 = prev[visited * w + node]
        visited &= ~(1 << node)
        node = before2
    }
    order.reverse()
    for (let j = 0; j < w; j += 1) path[from + j] = order[j]
    return true
}

/** 비용이 줄어드는 구간 뒤집기(2-opt)를 하나 찾아 적용하면 true. */
function applyTwoOpt(cost: Cost, path: number[]): boolean {
    const n = path.length
    for (let i = 1; i < n - 1; i += 1) {
        let forward = 0
        let backward = 0
        for (let j = i + 1; j < n; j += 1) {
            forward += cost[path[j - 1]][path[j]]
            backward += cost[path[j]][path[j - 1]]
            const oldOut = j + 1 < n ? cost[path[j]][path[j + 1]] : 0
            const newOut = j + 1 < n ? cost[path[i]][path[j + 1]] : 0
            const delta = cost[path[i - 1]][path[j]] + backward + newOut - (cost[path[i - 1]][path[i]] + forward + oldOut)
            if (delta < -EPS) {
                for (let a = i, b = j; a < b; a += 1, b -= 1) [path[a], path[b]] = [path[b], path[a]]
                return true
            }
        }
    }
    return false
}

/** 비용이 줄어드는 1~3칸 구간 옮기기(Or-opt, 뒤집어 옮기기 포함)를 하나 찾아 적용하면 true. */
function applyOrOpt(cost: Cost, path: number[]): boolean {
    const n = path.length
    for (let size = 1; size <= 3; size += 1) {
        for (let i = 1; i + size <= n; i += 1) {
            const first = path[i]
            const last = path[i + size - 1]
            const before = path[i - 1]
            const after = i + size < n ? path[i + size] : -1
            let inner = 0
            let innerReversed = 0
            for (let k = i; k < i + size - 1; k += 1) {
                inner += cost[path[k]][path[k + 1]]
                innerReversed += cost[path[k + 1]][path[k]]
            }
            const removeGain = cost[before][first] + (after >= 0 ? cost[last][after] - cost[before][after] : 0)

            // 원래 배열의 path[at-1]과 path[at] 사이에 끼워 넣는다 (at = n이면 맨 끝). 구간 자신과 맞닿은 자리는 건너뛴다.
            for (let at = 1; at <= n; at += 1) {
                if (at >= i && at <= i + size) continue
                const a = path[at - 1]
                const b = at < n ? path[at] : -1
                const broken = b >= 0 ? cost[a][b] : 0
                const addForward = cost[a][first] + (b >= 0 ? cost[last][b] : 0) - broken
                const addReversed = size > 1
                    ? cost[a][last] + (b >= 0 ? cost[first][b] : 0) - broken + innerReversed - inner
                    : Infinity
                if (Math.min(addForward, addReversed) - removeGain < -EPS) {
                    const segment = path.slice(i, i + size)
                    if (addReversed < addForward) segment.reverse()
                    const rest = [...path.slice(0, i), ...path.slice(i + size)]
                    const insertAt = at > i ? at - size : at
                    const next = [...rest.slice(0, insertAt), ...segment, ...rest.slice(insertAt)]
                    for (let k = 0; k < n; k += 1) path[k] = next[k]
                    return true
                }
            }
        }
    }
    return false
}

/** 2-opt·Or-opt로 더 줄어들지 않을 때까지 다듬은 새 경로. */
function polish(cost: Cost, start: number[]): number[] {
    const path = [...start]
    while (applyTwoOpt(cost, path) || applyOrOpt(cost, path)) {
        // 줄어드는 수가 없을 때까지 반복
    }
    return path
}

/** 가장 가까운(비용이 가장 작은) 색을 차례로 따라가는 경로. */
function nearestNeighborPath(cost: Cost): number[] {
    const n = cost.length
    const path = [0]
    const used = new Uint8Array(n)
    used[0] = 1
    for (let step = 1; step < n; step += 1) {
        const last = path[path.length - 1]
        let nearest = -1
        for (let node = 0; node < n; node += 1) {
            if (!used[node] && (nearest === -1 || cost[last][node] < cost[last][nearest])) nearest = node
        }
        path.push(nearest)
        used[nearest] = 1
    }
    return path
}

/** 색이 많을 때의 근사 풀이 (반복 지역 탐색). 맨 위 설명 참고. */
function approximatePath(cost: Cost): number[] {
    const n = cost.length
    const seeds = [nearestNeighborPath(cost), Array.from({ length: n }, (_, i) => i)].map((seed) => polish(cost, seed))
    let path = pathCost(cost, seeds[0]) <= pathCost(cost, seeds[1]) ? seeds[0] : seeds[1]
    let total = pathCost(cost, path)

    // 고정 시드 난수 — 같은 입력이면 늘 같은 결과가 나오게.
    let state = 0x2545f491
    const random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return state / 2 ** 32
    }
    for (let kick = 0; kick < SEARCH_KICKS && n > 4; kick += 1) {
        // 이웃한 두 구간의 자리를 맞바꿔 흔든 뒤 다시 다듬고, 나아졌을 때만 받아들인다.
        const a = 1 + Math.floor(random() * (n - 3))
        const b = a + 1 + Math.floor(random() * (n - a - 1))
        const c = b + Math.floor(random() * (n - b))
        const candidate = polish(cost, [...path.slice(0, a), ...path.slice(b, c), ...path.slice(a, b), ...path.slice(c)])
        const candidateTotal = pathCost(cost, candidate)
        if (candidateTotal < total - EPS) {
            path = candidate
            total = candidateTotal
        }
    }

    // 마지막으로 연속한 WINDOW_SIZE칸씩 최적 순서로 다시 놓고, 나아진 게 있으면 한 번 더 다듬는다.
    for (;;) {
        let improved = false
        for (let i = 1; i + 1 < n; i += 1) {
            if (reorderOptimally(cost, path, i, Math.min(WINDOW_SIZE, n - i))) improved = true
        }
        if (!improved) return path
        path = polish(cost, path)
    }
}

/** 0번(가장 연한 색)에서 출발해 모든 점을 한 번씩 지나는 최소 비용 경로. */
function shortestPath(cost: Cost): number[] {
    const n = cost.length
    if (n <= 2) return Array.from({ length: n }, (_, i) => i)
    if (n > EXACT_TSP_MAX) return approximatePath(cost)
    const path = Array.from({ length: n }, (_, i) => i)
    reorderOptimally(cost, path, 1, n - 1)
    return path
}

/**
 * 항목들을 가장 연한 색에서 출발하는 TSP 경로 순으로 정렬해서 돌려준다.
 * hexOf가 hex를 못 돌려주는(또는 hex로 해석 안 되는) 항목은 입력 순서 그대로 맨 끝에 붙는다.
 */
export function sortByColorPath<T>(items: T[], hexOf: (item: T) => string | null | undefined): T[] {
    const valid: { item: T; color: ColorInfo }[] = []
    const invalid: T[] = []
    for (const item of items) {
        const hex = hexOf(item)
        const color = hex ? parseHex(hex) : null
        if (color) valid.push({ item, color })
        else invalid.push(item)
    }

    // 연한 순으로 먼저 늘어놓아 0번 = 출발점(가장 연한 색). 비용이 같을 때도 순서가 흔들리지 않는다.
    valid.sort((a, b) => b.color.pale - a.color.pale || b.color.l - a.color.l)
    const cost = valid.map((from) => valid.map((to) => stepCost(from.color, to.color)))
    return [...shortestPath(cost).map((index) => valid[index].item), ...invalid]
}

const sortCache = new Map<string, string[]>()

/**
 * 추천 컬러 hex 배열을 화면 표시용 순서로 정렬해서 돌려준다.
 * 입력 길이/원소는 그대로 보존하고 순서만 바꾼다.
 */
export function sortRecommendedColors(hexes: string[]): string[] {
    const key = hexes.join(',')
    let sorted = sortCache.get(key)
    if (!sorted) {
        sorted = sortByColorPath(hexes, (hex) => hex)
        if (sortCache.size >= SORT_CACHE_MAX) sortCache.delete(sortCache.keys().next().value as string)
        sortCache.set(key, sorted)
    }
    return [...sorted]
}
