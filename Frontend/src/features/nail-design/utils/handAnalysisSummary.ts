import { getScanResult, type ScanResultResponse } from '@/entities/scan/api'
import { analyzeSkinTone, generateSkinTonePalette, pickSpreadColors, skinToneAnalysisFromMetrics } from '@/shared/utils/skinTone'
import { parseDateFlexible } from '@/shared/utils/scanDetail'
import { sortRecommendedColors } from '@/shared/utils/colorSort'
import { NAIL_BASELINE, FINGER_SIZE_MM, percentileAgainstBaseline, labelByPercentile } from '@/shared/utils/nailMetrics'
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

    // 손 분석 결과 화면과 동일하게: 왼손 5손가락 + 오른손 5손가락 = 10손가락 실측 평균
    const combinedFingers = [...(leftAnalysis?.fingers ?? []), ...(rightAnalysis?.fingers ?? [])]

    const details = combinedFingers.map((finger, index) => {
        let measurements: { lengthMm?: number; length?: number; widthMm?: number; width?: number; cCurveMm?: number; cCurve?: number; curve?: number }
        try {
            measurements = JSON.parse(finger.measurements ?? '{}') || {}
        } catch {
            measurements = {}
        }
        // index는 0~9(왼손 0~4 + 오른손 5~9)이므로, 손가락 종류(엄지~소지)는 %5로 구한다.
        const fingerSize = FINGER_SIZE_MM[index % 5]
        // 실제 스캔 파이프라인(scan/server.py) 필드명은 cCurveMm(C-curve sagitta 깊이, mm)
        // — cCurve/curve는 옛 목업 호환용. 값이 없으면 해당 손가락의 실측 평균값을 쓴다.
        return {
            lengthMm: Number(measurements.lengthMm ?? measurements.length ?? fingerSize.lengthMm),
            widthMm: Number(measurements.widthMm ?? measurements.width ?? fingerSize.widthMm),
            cCurve: Number(measurements.cCurveMm ?? measurements.cCurve ?? measurements.curve ?? fingerSize.cCurveMm),
        }
    })

    const avg = (nums: number[]) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0)
    const avgLength = Number(avg(details.map((d) => d.lengthMm)).toFixed(1))
    const avgWidth = Number(avg(details.map((d) => d.widthMm)).toFixed(1))
    // cCurve는 C-curve sagitta 깊이(mm). 소수 첫째 자리까지만 보여 준다.
    const avgCurve = Number(avg(details.map((d) => d.cCurve)).toFixed(1))

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

    // 손 분석 결과 화면과 동일한 기준값으로 막대 위치·비교 문구를 계산한다
    const lengthPct = percentileAgainstBaseline(avgLength, NAIL_BASELINE.length)
    const widthPct = percentileAgainstBaseline(avgWidth, NAIL_BASELINE.width)
    const curvePct = percentileAgainstBaseline(avgCurve, NAIL_BASELINE.cCurve)

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
        avgLength,
        avgWidth,
        avgCurve,
        lengthPct,
        widthPct,
        curvePct,
        lengthCompareLabel: labelByPercentile(lengthPct, '평균보다 짧은 편', '평균보다 긴 편', '평균과 비슷함'),
        widthCompareLabel: labelByPercentile(widthPct, '좁은 편', '넓은 편', '평균과 비슷함'),
        curveCompareLabel: labelByPercentile(curvePct, '완만한 편', '뚜렷한 편', '평균 범위'),
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

export type SkinToneKind = 'warm' | 'cool' | 'neutral'

export type HandRecordPreview = {
    skinToneHex: string | null
    toneLabel: string | null
    // 웜/쿨/뉴트럴 — 톤 이름을 각자 어울리는 글자색으로 보여 준다
    toneKind: SkinToneKind | null
    palette: string[]
    dateLabel: string
}

function toneKindOf(toneLabel: string | null): SkinToneKind | null {
    if (!toneLabel) return null
    if (toneLabel.startsWith('웜')) return 'warm'
    if (toneLabel.startsWith('쿨')) return 'cool'
    if (toneLabel.startsWith('뉴트럴')) return 'neutral'
    return null
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
    const toneLabel =
        (skinToneAnalysisFromMetrics(source.tone ?? null, source.warmness ?? null, source.brightness ?? null, source.saturation ?? null)
            ?.tone.label ??
            (skinToneHex ? analyzeSkinTone(skinToneHex).tone.label : null))?.replace(/\s+/g, '') ?? null
    const colors = source.recommendedColors?.length
        ? source.recommendedColors
        : skinToneHex
            ? generateSkinTonePalette(skinToneHex, 30)
            : []
    return {
        skinToneHex,
        toneLabel,
        toneKind: toneKindOf(toneLabel),
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
