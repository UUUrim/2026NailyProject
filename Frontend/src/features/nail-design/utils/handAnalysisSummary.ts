import { getScanResult, type ScanResultResponse } from '@/entities/scan/api'
import {
    analyzeSkinTone,
    generateSkinTonePalette,
    pickSpreadColors,
    skinToneAnalysisFromMetrics,
    type SkinBaseKind,
} from '@/shared/utils/skinTone'
import { parseDateFlexible } from '@/shared/utils/scanDetail'
import { sortRecommendedColors } from '@/shared/utils/colorSort'
import { nailSummaryMetrics } from '@/shared/utils/nailMetrics'
import { getNailShape } from '@/shared/constants/nailShapes'

// 디자인 채팅에 반영하는 손 분석 기록 — 사이드바(분석 결과 상세 보기·기록별 새 채팅)와 채팅(추천 컬러·쉐입·스캔 자동 생성)이 같이 쓴다

/** 손 분석 기록 키 (ScanSession.key와 같은 "{왼손scanId}-{오른손scanId}" 형식) */
export function buildScanKey(leftScanId: number | null | undefined, rightScanId: number | null | undefined): string | null {
    if (leftScanId == null && rightScanId == null) return null
    return `${leftScanId ?? null}-${rightScanId ?? null}`
}

/** 손 분석 기록 키에서 왼손/오른손 scanId를 꺼낸다 */
export function parseScanKey(scanKey: string | null | undefined): { leftScanId: number | null; rightScanId: number | null } {
    const [left, right] = (scanKey ?? '').split('-')
    const toId = (raw: string | undefined) => {
        const id = Number(raw)
        return raw && raw !== 'null' && Number.isFinite(id) ? id : null
    }
    return { leftScanId: toId(left), rightScanId: toId(right) }
}

export type HandAnalysis = {
    leftAnalysis: ScanResultResponse | null
    rightAnalysis: ScanResultResponse | null
}

/** 손 분석 기록의 실제 분석 결과(왼손/오른손)를 서버에서 받아온다 */
export async function fetchHandAnalysis(scanKey: string): Promise<HandAnalysis> {
    const { leftScanId, rightScanId } = parseScanKey(scanKey)
    const [leftAnalysis, rightAnalysis] = await Promise.all([
        leftScanId ? getScanResult(leftScanId).catch(() => null) : Promise.resolve(null),
        rightScanId ? getScanResult(rightScanId).catch(() => null) : Promise.resolve(null),
    ])
    return { leftAnalysis, rightAnalysis }
}

export type HandAnalysisSummary = NonNullable<ReturnType<typeof buildHandAnalysisSummary>>

/** 손 분석 결과 화면과 같은 기준으로, 사이드 패널·채팅에 보여 줄 요약을 만든다 */
export function buildHandAnalysisSummary(
    leftAnalysis: ScanResultResponse | null,
    rightAnalysis: ScanResultResponse | null,
) {
    if (!leftAnalysis && !rightAnalysis) return null

    // 손 분석 결과 화면과 동일하게: 열 손가락 평균 길이·너비·곡률과 평균 판정은 스캔 서버 통합 measurements.json
    // 상단 summary 값을 그대로 쓴다 (읽지 못하면 여성 평균 수치와 average). 값은 소수 첫째 자리까지만 보여 준다.
    const metrics = nailSummaryMetrics(leftAnalysis, rightAnalysis)
    const toDisplayMm = (mm: number) => Number(mm.toFixed(1))

    // 톤/쉐입은 왼손을 우선하고, 없으면 오른손 값을 사용.
    // shape는 출력 신청 시 유저가 고른 쉐입으로 덮어써질 수 있어서, "추천" 배지/문구는
    // 반드시 recommendedShape를 써야 한다 (ScanResultResponse 타입 주석 참고)
    const skinToneHex = leftAnalysis?.skinToneHex ?? rightAnalysis?.skinToneHex ?? null
    const tone = leftAnalysis?.tone ?? rightAnalysis?.tone ?? null
    const warmness = leftAnalysis?.warmness ?? rightAnalysis?.warmness ?? null
    const brightness = leftAnalysis?.brightness ?? rightAnalysis?.brightness ?? null
    const saturation = leftAnalysis?.saturation ?? rightAnalysis?.saturation ?? null
    const backendSkinToneAnalysis = skinToneAnalysisFromMetrics(tone, warmness, brightness, saturation)
    const toneLabel = backendSkinToneAnalysis?.tone.label ?? (skinToneHex ? analyzeSkinTone(skinToneHex).tone.label : null)
    const recommendedColors = leftAnalysis?.recommendedColors?.length
        ? leftAnalysis.recommendedColors
        : rightAnalysis?.recommendedColors ?? []
    const shapeId = leftAnalysis?.recommendedShape ?? rightAnalysis?.recommendedShape ?? null
    const shapeInfo = shapeId ? getNailShape(shapeId) : undefined

    return {
        scannedAt: leftAnalysis?.scannedAt ?? rightAnalysis?.scannedAt ?? null,
        // 실제로 분석된 톤 이름 (분석값이 없으면 null — 아래 toneLabel은 '분석 중'으로 채운다)
        detectedToneLabel: toneLabel,
        toneLabel: toneLabel || '분석 중',
        shapeId,
        // 실제로 추천된 쉐입 이름 (없으면 null)
        detectedShapeLabel: shapeInfo ? shapeInfo.labelKo : shapeId,
        shapeLabel: shapeInfo ? shapeInfo.labelKo : shapeId || '분석 중',
        shapeImage: shapeInfo?.image ?? null,
        avgLength: toDisplayMm(metrics.length.valueMm),
        avgWidth: toDisplayMm(metrics.width.valueMm),
        avgCurve: toDisplayMm(metrics.cCurve.valueMm),
        // 판정 막대 채움(%)과 판정 문구 — 스캔 서버의 5단계 평균 판정
        lengthPct: metrics.length.barPercent,
        widthPct: metrics.width.barPercent,
        curvePct: metrics.cCurve.barPercent,
        lengthCompareLabel: metrics.length.label,
        widthCompareLabel: metrics.width.label,
        curveCompareLabel: metrics.cCurve.label,
        skinToneHex,
        skinToneAnalysis: backendSkinToneAnalysis ?? (skinToneHex ? analyzeSkinTone(skinToneHex) : null),
        skinTonePalette: sortRecommendedColors(
            recommendedColors.length > 0
                ? recommendedColors
                : skinToneHex
                    ? generateSkinTonePalette(skinToneHex, 30)
                    : []
        ),
    }
}

// ── 사이드바에 보여 줄 손 분석 기록 미리보기 (대표 피부색·톤·추천 컬러 6개·날짜) ──

export type HandRecordPreview = {
    skinToneHex: string | null
    // 베이스 이름 (예: 핑크 베이스)
    toneLabel: string | null
    // 핑크/뉴트럴/옐로우 — 제목(대표 피부색 헥스값)의 바탕을 이 베이스 색으로 칠한다
    baseKind: SkinBaseKind | null
    palette: string[]
    dateLabel: string
}

type HandRecordSource = {
    scannedAt: string | null | undefined
    skinToneHex: string | null | undefined
    tone: string | null | undefined
    warmness: number | null | undefined
    brightness: number | null | undefined
    saturation: number | null | undefined
    recommendedColors: string[] | null | undefined
}

/** "n월 n일" (연도가 올해가 아니면 "yy. n. n.") */
export function formatRecordDate(raw: string | null | undefined): string {
    const date = parseDateFlexible(raw ?? '')
    if (!date) return ''
    if (date.getFullYear() !== new Date().getFullYear()) {
        return `${String(date.getFullYear()).slice(2)}. ${date.getMonth() + 1}. ${date.getDate()}.`
    }
    return `${date.getMonth() + 1}월 ${date.getDate()}일`
}

/** 마이페이지 손 분석 기록 줄(ScanSessionRow)과 같은 기준 — 정렬한 추천 컬러에서 고르게 6색을 뽑는다 */
export function buildHandRecordPreview(source: HandRecordSource): HandRecordPreview {
    const skinToneHex = source.skinToneHex ?? null
    const skinAnalysis =
        skinToneAnalysisFromMetrics(source.tone ?? null, source.warmness ?? null, source.brightness ?? null, source.saturation ?? null) ??
        (skinToneHex ? analyzeSkinTone(skinToneHex) : null)
    const colors = source.recommendedColors?.length
        ? source.recommendedColors
        : skinToneHex
            ? generateSkinTonePalette(skinToneHex, 30)
            : []
    return {
        skinToneHex,
        toneLabel: skinAnalysis?.tone.label ?? null,
        baseKind: skinAnalysis?.baseKind ?? null,
        palette: pickSpreadColors(sortRecommendedColors(colors), 6),
        dateLabel: formatRecordDate(source.scannedAt),
    }
}

/** 지금 반영 중인 분석 결과(왼손/오른손)로 만든 미리보기 — 손 분석 기록 목록에 없는 기록(이력에서 연 예전 채팅 등)에도 쓴다 */
export function buildHandRecordPreviewFromAnalysis({ leftAnalysis, rightAnalysis }: HandAnalysis): HandRecordPreview | null {
    const primary = leftAnalysis ?? rightAnalysis
    if (!primary) return null
    return buildHandRecordPreview({
        scannedAt: leftAnalysis?.scannedAt ?? rightAnalysis?.scannedAt,
        skinToneHex: leftAnalysis?.skinToneHex ?? rightAnalysis?.skinToneHex,
        tone: leftAnalysis?.tone ?? rightAnalysis?.tone,
        warmness: leftAnalysis?.warmness ?? rightAnalysis?.warmness,
        brightness: leftAnalysis?.brightness ?? rightAnalysis?.brightness,
        saturation: leftAnalysis?.saturation ?? rightAnalysis?.saturation,
        recommendedColors: leftAnalysis?.recommendedColors?.length
            ? leftAnalysis.recommendedColors
            : rightAnalysis?.recommendedColors,
    })
}
