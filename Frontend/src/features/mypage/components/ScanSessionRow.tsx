import { memo } from 'react'
import { getNailShape } from '@/shared/constants/nailShapes'
import { analyzeSkinTone, generateSkinTonePalette, pickSpreadColors, skinToneAnalysisFromMetrics } from '@/shared/utils/skinTone'
import { sortRecommendedColors } from '@/shared/utils/colorSort'
import { type ScanSession } from '@/shared/utils/scanDetail'
import { formatMetricCurve, formatDateTimeFull } from '@/features/mypage/shared'

type ScanSessionRowProps = {
    session: ScanSession
    activityId?: string
    interactive?: boolean
    activeActivityId: string | null
    onOpenDetail: (session: ScanSession) => void
    onSelectActivity: (id: string) => void
    onHoverActivity: (id: string | null) => void
}

export const ScanSessionRow = memo(function ScanSessionRow({
    session,
    activityId: activityIdProp,
    interactive,
    activeActivityId,
    onOpenDetail,
    onSelectActivity,
    onHoverActivity,
}: ScanSessionRowProps) {
    const activityId = activityIdProp ?? `scan-${session.key}`
    const timeLabel = formatDateTimeFull(session.scannedAt)
    const highlighted = interactive ? activeActivityId === activityId : false
    const shapeLabel = session.recommendedShape
        ? getNailShape(session.recommendedShape)?.labelKo ?? session.recommendedShape
        : null
    const skinHex = session.skinToneHex
    const toneLabel = (
        skinToneAnalysisFromMetrics(session.tone, session.warmness, session.brightness, session.saturation)?.tone.label ??
        (skinHex ? analyzeSkinTone(skinHex).tone.label : null)
    )?.replace(/\s+/g, '') ?? '미분석'
    // 화면 표시용으로 정렬한 추천 컬러(sortRecommendedColors: 색상군별로 묶고 밝은→어두운,
    // 진한 색은 후미)에서 균등 간격으로 6색만 뽑아 미리보기로 쓴다 — 짧은 스와치에도
    // 서로 다른 색상군이 골고루 섞여 보인다.
    const palettePreview =
        session.recommendedColors.length > 0
            ? pickSpreadColors(sortRecommendedColors(session.recommendedColors), 6)
            : skinHex
                ? pickSpreadColors(sortRecommendedColors(generateSkinTonePalette(skinHex, 30)), 6)
                : []
    const metricsLine = [
        `길이 ${session.avgLengthMm != null ? `${Number(session.avgLengthMm).toFixed(1)}mm` : '-'}`,
        `너비 ${session.avgWidthMm != null ? `${Number(session.avgWidthMm).toFixed(1).replace(/\.0$/, '')}mm` : '-'}`,
        `곡률 ${formatMetricCurve(session.avgCurve)}`,
    ].join(' · ')

    return (
        <button
            key={session.key}
            type="button"
            data-activity-id={interactive ? activityId : undefined}
            data-activity-side={interactive ? 'right' : undefined}
            className={`mypage-x__scan-row mypage-x__scan-row--rich${highlighted ? ' is-highlighted' : ''}`}
            onClick={() => {
                if (interactive) onSelectActivity(activityId)
                onOpenDetail(session)
            }}
            onMouseEnter={() => interactive && onHoverActivity(activityId)}
            onMouseLeave={() => interactive && onHoverActivity(null)}
        >
            <span
                className="mypage-x__scan-swatch mypage-x__scan-swatch--lg"
                style={{ background: skinHex ?? '#de869f' }}
                aria-hidden="true"
            />
            <div className="mypage-x__scan-info">
                <p className="mypage-x__scan-season">{toneLabel}</p>
                <p className="mypage-x__scan-metrics">{metricsLine}</p>
                <p className="mypage-x__scan-shape-line">추천 쉐입: {shapeLabel ?? '미정'}</p>
                {palettePreview.length > 0 && (
                    <div className="mypage-x__scan-palette" aria-label="대표 피부색 추천 컬러">
                        {palettePreview.map((hex, idx) => (
                            <i key={`${hex}-${idx}`} style={{ background: hex }} />
                        ))}
                    </div>
                )}
            </div>
            {timeLabel && <span className="mypage-x__scan-date-end">{timeLabel}</span>}
        </button>
    )
})
