// public/images/nail-shapes/*.svg의 실제 <path> d 데이터를 파싱해서, 손톱 끝(팁) 쪽과
// 손·큐티클 쪽 좌표는 그대로 둔 채 그 사이 "몸통" 구간의 좌표만 늘리거나 줄인다.
// 이미지 자르기/스케일링이 아니라 실제 벡터 좌표를 옮기는 방식이라, 팁 곡선이나 손
// 일러스트의 형태 자체가 절대 찌그러지지 않는다.
//
// 이 파일들은 M/C(절대) 또는 M/m/c/l(상대) 명령만 쓰고, round/oval/almond/stiletto는
// <g transform> 없이 바로 좌표를 쓰지만 ballerina/square는 <g transform="translate(...)
// scale(...)">로 감싸져 있다(일러스트레이터 내보내기 특유의 10배 확대 + Y축 반전). 파싱
// 시점에 이 transform을 좌표에 직접 적용해서, 이후로는 항상 "최종 viewBox 좌표계"만 다룬다.

type Point = [number, number]
type Segment = { cmd: 'M' | 'L' | 'C' | 'Z'; points: Point[] }
export type Subpath = Segment[]

function parseTransform(transformAttr: string | null): { tx: number; ty: number; sx: number; sy: number } {
    if (!transformAttr) return { tx: 0, ty: 0, sx: 1, sy: 1 }
    const translateMatch = transformAttr.match(/translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/)
    const scaleMatch = transformAttr.match(/scale\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/)
    return {
        tx: translateMatch ? parseFloat(translateMatch[1]) : 0,
        ty: translateMatch ? parseFloat(translateMatch[2]) : 0,
        sx: scaleMatch ? parseFloat(scaleMatch[1]) : 1,
        sy: scaleMatch ? parseFloat(scaleMatch[2]) : 1,
    }
}

/** 'd' 문자열을 파싱해서 g의 translate/scale까지 이미 적용된 절대좌표 서브패스 배열로 돌려준다. */
export function parseSvgPath(rawD: string, gTransformAttr: string | null): Subpath[] {
    const { tx, ty, sx, sy } = parseTransform(gTransformAttr)
    const toFinal = (x: number, y: number): Point => [tx + x * sx, ty + y * sy]

    const tokens = rawD.match(/[MmLlCcZz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []
    let i = 0
    let cx = 0
    let cy = 0
    let startX = 0
    let startY = 0
    let cmd = ''
    const subpaths: Subpath[] = []
    let current: Subpath = []

    const readNum = () => parseFloat(tokens[i++])

    while (i < tokens.length) {
        if (/^[MmLlCcZz]$/.test(tokens[i])) {
            cmd = tokens[i]
            i += 1
        }

        switch (cmd) {
            case 'M': {
                const x = readNum()
                const y = readNum()
                cx = x
                cy = y
                startX = x
                startY = y
                current = [{ cmd: 'M', points: [toFinal(x, y)] }]
                subpaths.push(current)
                cmd = 'L' // M 뒤에 좌표쌍이 더 나오면 암묵적으로 LineTo
                break
            }
            case 'm': {
                const x = cx + readNum()
                const y = cy + readNum()
                cx = x
                cy = y
                startX = x
                startY = y
                current = [{ cmd: 'M', points: [toFinal(x, y)] }]
                subpaths.push(current)
                cmd = 'l'
                break
            }
            case 'L': {
                const x = readNum()
                const y = readNum()
                cx = x
                cy = y
                current.push({ cmd: 'L', points: [toFinal(x, y)] })
                break
            }
            case 'l': {
                const x = cx + readNum()
                const y = cy + readNum()
                cx = x
                cy = y
                current.push({ cmd: 'L', points: [toFinal(x, y)] })
                break
            }
            case 'C': {
                const x1 = readNum()
                const y1 = readNum()
                const x2 = readNum()
                const y2 = readNum()
                const x = readNum()
                const y = readNum()
                cx = x
                cy = y
                current.push({ cmd: 'C', points: [toFinal(x1, y1), toFinal(x2, y2), toFinal(x, y)] })
                break
            }
            case 'c': {
                const baseX = cx
                const baseY = cy
                const x1 = baseX + readNum()
                const y1 = baseY + readNum()
                const x2 = baseX + readNum()
                const y2 = baseY + readNum()
                const x = baseX + readNum()
                const y = baseY + readNum()
                cx = x
                cy = y
                current.push({ cmd: 'C', points: [toFinal(x1, y1), toFinal(x2, y2), toFinal(x, y)] })
                break
            }
            case 'Z':
            case 'z': {
                current.push({ cmd: 'Z', points: [] })
                cx = startX
                cy = startY
                break
            }
            default:
                // 이 아이콘들에서 쓰지 않는 명령(H/V/S/Q/T/A) - 만나면 더 이상 진행할 수 없으므로 중단
                i = tokens.length
                break
        }
    }

    return subpaths
}

/**
 * boundaryY보다 아래(손톱 몸통 대부분 + 손가락)는 좌표를 전혀 건드리지 않고 완전히 고정한다.
 * boundaryY보다 위(둥근/뾰족한 팁 캡)는 X(폭)는 그대로 두고 Y(길이 방향)만 boundaryY에
 * 붙은 채로 scale배 늘이거나 줄인다 - 폭이 안 바뀌니까 "전체 크기가 커진다"는 느낌 없이
 * 순수하게 세로 길이만 변한다.
 *
 * @param scale 팁 캡 높이에 곱할 배율. 1이면 원본 그대로, 작을수록 짧아지고 0에 가까울수록
 *   boundaryY 선에 거의 붙는다(길이가 최소 설정일 때 손가락 끝에 바짝 붙어 보이도록).
 */
export function remapNailLength(subpaths: Subpath[], boundaryY: number, scale: number): string {
    const remapPoint = ([x, y]: Point): Point => {
        if (y >= boundaryY) return [x, y] // 손톱 몸통 대부분 + 손가락 - 완전 고정
        // 팁 캡 - X(폭)는 그대로, Y만 boundaryY를 기준으로 늘이거나 줄인다
        return [x, boundaryY - (boundaryY - y) * scale]
    }

    let d = ''
    for (const subpath of subpaths) {
        for (const seg of subpath) {
            if (seg.cmd === 'Z') {
                d += 'Z '
                continue
            }
            const mapped = seg.points.map((p) => {
                const [x, y] = remapPoint(p)
                return `${x.toFixed(2)},${y.toFixed(2)}`
            }).join(' ')
            d += `${seg.cmd}${mapped} `
        }
    }
    return d.trim()
}
