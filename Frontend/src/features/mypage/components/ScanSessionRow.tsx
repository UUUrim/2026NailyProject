import { memo } from 'react'
import { getNailShape } from '@/shared/constants/nailShapes'
import { analyzeSkinTone, generateSkinTonePalette, pickSpreadColors, skinToneAnalysisFromMetrics } from '@/shared/utils/skinTone'
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
    // 추천 컬러 팔레트를 6열×5행(색상군 6개 × 밝기 5단계)으로 봤을 때 맨 윗줄 6색 —
    // 즉 색상군마다 가장 밝은 톤 하나씩. 30색 배열에서 균등 간격(0,5,10,15,20,25)으로
    // 뽑으면 그 맨 윗줄과 일치한다.
    const palettePreview =
        session.recommendedColors.length > 0
            ? pickSpreadColors(session.recommendedColors, 6)
            : skinHex
                ? pickSpreadColors(generateSkinTonePalette(skinHex, 30), 6)
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
