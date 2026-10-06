import { useEffect, useId, useState } from 'react'
import {
    getDefaultTipExtensionMm,
    getNailShape,
    TIP_EXTENSION_MAX_MM,
    type NailShapeId,
} from '@/shared/constants/nailShapes'
import { parseSvgPath, remapNailLength, type Subpath } from '@/features/print/utils/nailPathTransform'

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
const SHAPE_GEOMETRY: Record<NailShapeId, { viewBoxW: number; viewBoxH: number; bboxTop: number; bboxBottom: number; shoulderY: number }> = {
    round: { viewBoxW: 1024, viewBoxH: 1024, bboxTop: 277.7, bboxBottom: 910.2, shoulderY: 469.1 },
    oval: { viewBoxW: 672, viewBoxH: 1024, bboxTop: 209.8, bboxBottom: 908.2, shoulderY: 437.4 },
    almond: { viewBoxW: 672, viewBoxH: 1024, bboxTop: 84.9, bboxBottom: 931.3, shoulderY: 449.8 },
    stiletto: { viewBoxW: 672, viewBoxH: 1024, bboxTop: 80.6, bboxBottom: 925.5, shoulderY: 514.7 },
    ballerina: { viewBoxW: 1024, viewBoxH: 1536, bboxTop: 177.5, bboxBottom: 1330.8, shoulderY: 662.2 },
    square: { viewBoxW: 1024, viewBoxH: 1536, bboxTop: 96.4, bboxBottom: 1408.0, shoulderY: 531.1 },
}

// 쉐입마다 원본 비율(viewBoxW/H)이 달라서 자연스러운 크기로 그리면 카드마다 크기가
// 들쭉날쭉해진다 - 그래서 svg 자체의 화면 크기는 이 고정값으로 못박고(카드도 그만큼
// 고정된다), viewBox는 쉐입별로 그대로 계산해서 기본 preserveAspectRatio(xMidYMid meet)가
// 비율은 유지한 채 이 고정 박스 안에 맞춰 넣도록 한다.
const UNIFORM_BOX_WIDTH_PX = 120
const UNIFORM_BOX_HEIGHT_PX = 148

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
}

export function NailLengthPreview({ shapeId, extensionMm }: Props) {
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

    const { viewBoxW, bboxTop, bboxBottom, shoulderY } = geometry

    const boundaryY = shoulderY

    // mm 값에 그대로 비례하는 단일 배율 - scale = extensionMm / defaultExtensionMm. 구간별로
    // 다른 기울기를 쓰면(예: 기본값 위/아래를 다르게 취급) 기본값을 지나는 지점에서 1mm당
    // 변화폭이 갑자기 달라져 버린다. 하나의 직선 비례식만 쓰면 1mm→2mm든 10mm→11mm든
    // 어디서든 1mm당 변화폭(px)이 항상 똑같다.
    const defaultExtensionMm = getDefaultTipExtensionMm(shape)
    const scale = extensionMm / defaultExtensionMm
    const d = remapNailLength(subpaths, boundaryY, scale)

    // 손톱 몸통+손가락(y >= boundaryY)은 remapNailLength에서 좌표를 전혀 안 건드리므로
    // bboxBottom이 항상 같은 자리다 - 그 자리를 프레임(viewBox) 아래쪽 기준으로 고정한다.
    // 프레임 위쪽 여유는 mm과 무관하게 "이 쉐입이 가장 많이 늘어났을 때(15mm)"에 맞춰 미리
    // 확보해 둔다 - 그래야 mm을 조절해도 카드·옆의 −/+ 버튼 위치가 전혀 흔들리지 않는다.
    // X는 절대 안 바뀌므로(폭 고정, 길이만 변함) 가로 프레임은 원본 폭 그대로 두면 된다.
    const capHeightAtDefault = boundaryY - bboxTop
    const maxScale = TIP_EXTENSION_MAX_MM / defaultExtensionMm
    const maxCapHeight = capHeightAtDefault * maxScale

    const framePad = viewBoxW * 0.08
    const frameTop = boundaryY - maxCapHeight - framePad
    const frameBottom = bboxBottom + framePad

    const vbX = -framePad
    const vbY = frameTop
    const vbW = viewBoxW + framePad * 2
    const vbH = frameBottom - frameTop

    return (
        <svg
            className="nail-length-preview"
            width={UNIFORM_BOX_WIDTH_PX}
            height={UNIFORM_BOX_HEIGHT_PX}
            viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
            role="img"
            aria-label={`${getNailShape(shape)?.labelKo ?? shape} 쉐입 손톱 길이 미리보기, 연장 길이 ${extensionMm}밀리미터`}
        >
            <defs>
                <clipPath id={clipId}>
                    <rect x={vbX} y={vbY} width={vbW} height={boundaryY - vbY} />
                </clipPath>
            </defs>
            <path className="nail-length-preview__path" d={d} />
            {/* 같은 경로를 boundaryY 위쪽(늘어나는 팁 부분)만 잘라서 한 번 더 그려 브랜드 색으로 강조한다.
                clip 영역은 고정이고 경로만 움직이므로 길이가 바뀌는 애니메이션과 항상 정확히 맞물린다. */}
            <path className="nail-length-preview__path nail-length-preview__path--ext" d={d} clipPath={`url(#${clipId})`} />
            <line className="nail-length-preview__edge" x1={vbX} x2={vbX + vbW} y1={boundaryY} y2={boundaryY} />
        </svg>
    )
}
