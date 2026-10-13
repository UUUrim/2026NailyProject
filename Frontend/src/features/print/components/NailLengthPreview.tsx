import { useEffect, useId, useState } from 'react'
import {
    getNailShape,
    TIP_EXTENSION_MAX_MM,
    type NailShapeId,
} from '@/shared/constants/nailShapes'
import { getPathXExtent, parseSvgPath, remapNailLength, type Subpath } from '@/features/print/utils/nailPathTransform'

// public/images/nail-shapes/*.svg 각 파일의 실제 <path> bbox와 "어깨선"(shoulderY)을
// 오프라인에서 측정해 둔 값 (g transform까지 적용한 최종 viewBox 단위). 파일이 바뀌면 이
// 값도 다시 측정해야 한다.
//
// shoulderY 구하는 법: 이 파일들은 손톱 벽 윤곽선이 한 번 아래로 내려갔다가(큐티클 쪽
// 손톱 바닥 중앙까지) 다시 같은 지점 근처에서 손가락 다리 쪽으로 방향을 꺾어 내려가는
// 구조다 - 즉 윤곽선을 따라가다 보면 "Y좌표가 국소적으로 가장 작아지는 지점"(local
// minimum)이 바로 손톱 벽과 손가락 다리가 갈라지는 진짜 어깨 지점이다. 예전에 썼던
// "가로 중심 좌표 중 Y가 제일 큰 값" 방식은 손톱 벽이 큐티클 중앙까지 휘어져 내려가는
// 구간과 손가락 다리로 빠지는 구간을 구분하지 못해서, 손가락 다리 상단 일부가 "손톱"으로
// 잘못 분류돼 같이 움직이는 문제가 있었다. shoulderY 아래(손가락 다리 전체 + 손톱 바닥
// 중앙까지)는 완전히 고정하고, 그 위(팁 전체)만 늘이고 줄인다.
//
// cuticleY: 손톱 윤곽 맨 아래(큐티클, 손톱 바닥 U자의 가장 낮은 점) - 가로 중앙 구간에서
// shoulderY 아래로 가장 내려간 점. cuticleY - shoulderY가 그림 속 "내 손톱" 길이이고,
// 이걸 사용자의 실측 손톱 길이(mm)에 대응시켜 연장 길이를 같은 mm 배율로 그린다.
const SHAPE_GEOMETRY: Record<NailShapeId, { viewBoxW: number; viewBoxH: number; bboxTop: number; bboxBottom: number; shoulderY: number; cuticleY: number }> = {
    round: { viewBoxW: 1024, viewBoxH: 1024, bboxTop: 277.7, bboxBottom: 910.2, shoulderY: 469.1, cuticleY: 757.3 },
    oval: { viewBoxW: 672, viewBoxH: 1024, bboxTop: 209.8, bboxBottom: 908.2, shoulderY: 437.4, cuticleY: 734.4 },
    almond: { viewBoxW: 672, viewBoxH: 1024, bboxTop: 84.9, bboxBottom: 931.3, shoulderY: 449.8, cuticleY: 766.4 },
    stiletto: { viewBoxW: 672, viewBoxH: 1024, bboxTop: 80.6, bboxBottom: 925.5, shoulderY: 514.7, cuticleY: 785.3 },
    ballerina: { viewBoxW: 1024, viewBoxH: 1536, bboxTop: 177.5, bboxBottom: 1330.8, shoulderY: 662.2, cuticleY: 1101.8 },
    square: { viewBoxW: 1024, viewBoxH: 1536, bboxTop: 96.4, bboxBottom: 1408.0, shoulderY: 531.1, cuticleY: 1023.8 },
}

// 쉐입마다 원본 비율(viewBoxW/H)이 달라서 자연스러운 크기로 그리면 카드마다 크기가
// 들쭉날쭉해진다 - 그래서 svg 자체의 화면 크기는 이 고정값으로 못박고(카드도 그만큼
// 고정된다), viewBox는 쉐입별로 그대로 계산해서 기본 preserveAspectRatio(xMidYMid meet)가
// 비율은 유지한 채 이 고정 박스 안에 맞춰 넣도록 한다.
// 높이는 최대 연장(20mm)까지 늘어날 자리를 미리 비워 둔 채로도 손가락이 너무 작아지지 않게 잡은 값
const UNIFORM_BOX_WIDTH_PX = 120
const UNIFORM_BOX_HEIGHT_PX = 176

// 손톱이 손가락 끝보다 많이 나와 있다고 측정되면 "손가락 위에 얹힌 손톱" 길이(실측 - 나온 부분)가
// 비정상적으로 작아져 배율이 튈 수 있어서, 이보다 작게는 보지 않는다
const MIN_PLATE_ON_FINGER_MM = 5

const pathCache = new Map<NailShapeId, Subpath[]>()
const pathLoaders = new Map<NailShapeId, Promise<Subpath[]>>()

function loadShapePath(shapeId: NailShapeId): Promise<Subpath[]> {
    const cached = pathCache.get(shapeId)
    if (cached) return Promise.resolve(cached)
    const existing = pathLoaders.get(shapeId)
    if (existing) return existing

    const shape = getNailShape(shapeId)
    const promise = fetch(shape!.image)
        .then((res) => res.text())
        .then((text) => {
            const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
            const rawD = doc.querySelector('path')?.getAttribute('d') ?? ''
            const gTransform = doc.querySelector('g')?.getAttribute('transform') ?? null
            const subpaths = parseSvgPath(rawD, gTransform)
            pathCache.set(shapeId, subpaths)
            return subpaths
        })
    pathLoaders.set(shapeId, promise)
    return promise
}

type Props = {
    shapeId: string | null | undefined
    extensionMm: number
    // 사용자의 실측 손톱 길이(mm, 큐티클 → 손톱 끝) - 그림 속 "내 손톱" 부분이 이 길이를 나타낸다
    naturalLengthMm: number
    // 스캔 사진에서 잰, 손톱이 손가락 살 끝보다 나와 있는 길이(mm) - "내 손톱 끝" 선을 손가락 끝에서
    // 이만큼 위에 그린다. 0이면(손가락 끝을 넘지 않는 손톱, 이 측정 전의 예전 스캔) 손가락 끝에 그린다
    freeEdgeMm: number
}

export function NailLengthPreview({ shapeId, extensionMm, naturalLengthMm, freeEdgeMm }: Props) {
    // clipPath id로 쓰므로 url(#...)에서 문제 되는 문자는 걷어 낸다
    const clipId = `nail-ext-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
    const [subpaths, setSubpaths] = useState<Subpath[] | null>(
        shapeId ? pathCache.get(shapeId as NailShapeId) ?? null : null,
    )

    useEffect(() => {
        if (!shapeId || !(shapeId in SHAPE_GEOMETRY)) {
            setSubpaths(null)
            return
        }
        const cached = pathCache.get(shapeId as NailShapeId)
        if (cached) {
            setSubpaths(cached)
            return
        }
        let cancelled = false
        setSubpaths(null)
        void loadShapePath(shapeId as NailShapeId).then((sp) => {
            if (!cancelled) setSubpaths(sp)
        })
        return () => {
            cancelled = true
        }
    }, [shapeId])

    // 아직 경로를 못 불러왔을 때도 같은 크기 자리를 잡아 둬서, 로딩 순간 패널 레이아웃이 튀지 않게 한다
    if (!shapeId || !(shapeId in SHAPE_GEOMETRY) || !subpaths) {
        return <svg className="nail-length-preview" width={UNIFORM_BOX_WIDTH_PX} height={UNIFORM_BOX_HEIGHT_PX} aria-hidden="true" />
    }
    const shape = shapeId as NailShapeId
    const geometry = SHAPE_GEOMETRY[shape]

    const { bboxTop, bboxBottom, shoulderY, cuticleY } = geometry

    // shoulderY = 손가락 끝(손가락 살이 끝나는 높이). 그 아래(손가락 + 손톱 몸통)는 고정이고,
    // 위의 팁 캡만 늘이고 줄인다. 내 손톱 끝은 손가락 끝에서 freeEdgeMm만큼 위다.
    const fingertipY = shoulderY
    const freeEdge = freeEdgeMm

    // 그림 속 큐티클 → 손가락 끝을 "손가락 위에 얹힌 내 손톱"(실측 길이 - 손가락 끝 밖으로 나온 부분)으로
    // 보고, 거기서 나온 하나의 mm 배율로 내 손톱의 나온 부분과 연장 부분도 그린다 - 같은 +8mm라도
    // 손톱이 짧은 사람에겐 상대적으로 길게, 긴 사람에겐 짧게 보여서 실제로 끼웠을 때의 비율 그대로가 된다.
    // 팁 캡 원본 높이(capHeight)는 하나의 직선 비례식으로만 늘이고 줄이므로, 1mm→2mm든
    // 10mm→11mm든 1mm당 변화폭(px)이 항상 똑같다.
    const plateOnFingerMm = Math.max(naturalLengthMm - freeEdge, MIN_PLATE_ON_FINGER_MM)
    const unitsPerMm = (cuticleY - fingertipY) / plateOnFingerMm
    const nailEndY = fingertipY - freeEdge * unitsPerMm
    const capHeight = fingertipY - bboxTop
    const scale = ((freeEdge + extensionMm) * unitsPerMm) / capHeight
    const d = remapNailLength(subpaths, fingertipY, scale)

    // 손톱 몸통+손가락(y >= fingertipY)은 remapNailLength에서 좌표를 전혀 안 건드리므로
    // bboxBottom이 항상 같은 자리다 - 그 자리를 프레임(viewBox) 아래쪽 기준으로 고정한다.
    // 프레임 위쪽 여유는 mm과 무관하게 "이 사용자 손톱 기준으로 최대 연장(TIP_EXTENSION_MAX_MM)일 때"에
    // 맞춰 미리 확보해 둔다 - 그래야 mm을 조절해도 카드·옆의 −/+ 버튼 위치가 전혀 흔들리지 않는다.
    // X는 절대 안 바뀌므로(폭 고정, 길이만 변함) 가로 프레임은 그림이 실제로 차지하는 폭에 맞춘다 -
    // 원본 파일 폭(viewBoxW)을 그대로 쓰면 좌우 여백까지 프레임에 들어가서 손가락이 작게 보인다.
    const maxCapHeight = (freeEdge + TIP_EXTENSION_MAX_MM) * unitsPerMm
    const { minX, maxX } = getPathXExtent(subpaths)

    const framePad = (maxX - minX) * 0.12
    const frameTop = fingertipY - maxCapHeight - framePad
    const frameBottom = bboxBottom + framePad

    const vbX = minX - framePad
    const vbY = frameTop
    const vbW = maxX - minX + framePad * 2
    const vbH = frameBottom - frameTop

    return (
        <svg
            className="nail-length-preview"
            width={UNIFORM_BOX_WIDTH_PX}
            height={UNIFORM_BOX_HEIGHT_PX}
            viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
            role="img"
            aria-label={`${getNailShape(shape)?.labelKo ?? shape} 쉐입 손톱 길이 미리보기, 내 손톱 ${naturalLengthMm.toFixed(1)}밀리미터에 연장 길이 ${extensionMm}밀리미터`}
        >
            <defs>
                <clipPath id={clipId}>
                    <rect x={vbX} y={vbY} width={vbW} height={nailEndY - vbY} />
                </clipPath>
            </defs>
            <path className="nail-length-preview__path" d={d} />
            {/* 같은 경로를 내 손톱 끝 위쪽(연장되는 부분)만 잘라서 한 번 더 그려 브랜드 색으로 강조한다 -
                내 손톱 끝 아래(손가락 끝 밖으로 나온 내 손톱 포함)는 검정, 위는 핑크.
                clip 영역은 고정이고 경로만 움직이므로 길이가 바뀌는 애니메이션과 항상 정확히 맞물린다. */}
            <path className="nail-length-preview__path nail-length-preview__path--ext" d={d} clipPath={`url(#${clipId})`} />
            <line className="nail-length-preview__edge" x1={vbX} x2={vbX + vbW} y1={nailEndY} y2={nailEndY} />
        </svg>
    )
}
