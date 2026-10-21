import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AppShell } from '@/shared/layout/AppShell'
import { PageHero } from '@/shared/layout/PageHero'
import { FingerDetailModal } from '@/features/hand-scan/components/FingerDetailModal'
import { RecommendedShapeCard } from '@/features/hand-scan/components/RecommendedShapeCard'
import { NextStepButton } from '@/shared/components/NextStepButton'
import { getNailShape } from '@/shared/constants/nailShapes'
import { sortRecommendedColors } from '@/shared/utils/colorSort'
import { buildHandScanAnalysis } from '@/shared/utils/handScanAnalysis'
import { analyzeSkinTone } from '@/shared/utils/skinTone'
import '@/styles/hand-scan-result.css'

// ══════════════════════════════════════════════════════════════════════
// 개발용 화면 확인 페이지 — 실제 API 없이 buildHandScanAnalysis()가 만들어주는
// 가짜 분석 데이터로 손 분석 결과 화면(완료 상태)을 실제와 동일한 마크업/스타일로 보여준다.
// 주소창에 /preview/scan-result 를 직접 입력해서 들어가야 볼 수 있다 (다른 화면에서 링크 없음).
// ══════════════════════════════════════════════════════════════════════

const MOCK_SKIN_HEX = '#F3D2B8'

// 추천 컬러 30색 — 화면에는 실제 결과 화면처럼 sortRecommendedColors 순서(비슷한 색끼리 잇는
// TSP 경로, 연한 색 → 진한 색)로 정렬해 6열 × 5행 그리드에 가로 방향으로 채운다.
const MOCK_PALETTE = [
    '#F5E6D3', '#DCC1A5', '#C9A887', '#E8B9A4', '#B9825A', '#F5C6C6',
    '#C9858D', '#D98291', '#F08F82', '#AD6F79', '#F4B183', '#F28E78',
    '#F6C7A1', '#C76F52', '#B85D3D', '#C6A184', '#96715B', '#704A3A',
    '#98665F', '#9A887B', '#A8B5A0', '#898B50', '#B8D9C5', '#8CA8BC',
    '#376D68', '#F3D875', '#C5B4D9', '#80516B', '#B83A4B', '#722F3D',
]

function MetricCard({
    title,
    metric,
    hint,
}: {
    title: string
    metric: { value: number; unit: string; percentile: number; comparisonLabel: string }
    hint: string
}) {
    // percentile은 이미 3~97로 clamp되지만, 막대·"상위 %" 표기가 절대 범위를 벗어나지 않도록 한 번 더 방어한다.
    const barPercent = Math.round(Math.min(100, Math.max(0, metric.percentile)))
    return (
        <article className="scan-metric-card">
            <h3>{title}</h3>
            <p className="scan-metric-card__value">
                {metric.value}
                {metric.unit}
            </p>
            <p className="scan-metric-card__compare">{metric.comparisonLabel}</p>
            <div className="scan-metric-card__bar" aria-hidden="true">
                <span style={{ width: `${barPercent}%` }} />
            </div>
            <p className="scan-metric-card__hint">{hint}</p>
        </article>
    )
}

function SkinToneSlider({
    label,
    valueLabel,
    percent,
    minLabel,
    maxLabel,
    trackClass,
}: {
    label: string
    valueLabel: string
    percent: number
    minLabel: string
    maxLabel: string
    trackClass: string
}) {
    return (
        <div className="skin-tone-slider">
            <div className="skin-tone-slider__head">
                <span className="skin-tone-slider__label">{label}</span>
                <span className="skin-tone-slider__value">{valueLabel}</span>
            </div>
            <div className={`skin-tone-slider__track ${trackClass}`}>
                <span className="skin-tone-slider__thumb" style={{ left: `${percent}%` }} />
            </div>
            <div className="skin-tone-slider__ends">
                <span>{minLabel}</span>
                <span>{maxLabel}</span>
            </div>
        </div>
    )
}

export function HandScanResultPagePreviewContent() {
    const [showFingerModal, setShowFingerModal] = useState(false)
    const [searchParams] = useSearchParams()

    const analysis = buildHandScanAnalysis(MOCK_SKIN_HEX)
    // ?shape=stiletto 처럼 넘기면 그 쉐입의 추천 카드로 바꿔서 볼 수 있다
    const recommended = getNailShape(searchParams.get('shape') ?? '') ?? getNailShape(analysis.recommendedShape)
    const skinToneAnalysis = analyzeSkinTone(analysis.skinToneHex)
    const skinTonePalette = sortRecommendedColors(MOCK_PALETTE)

    return (
        <AppShell mainClassName="scan-result-page">
            <PageHero
                eyebrow="Hand Analysis"
                title="손 분석 결과"
                description="네일리님의 손톱 수치와 피부 톤, 추천 쉐입을 확인해 보세요."
            />

            <section className="scan-result-section">
                <div className="scan-result-section__head">
                    <h2>손톱 기본 지표</h2>
                    <button type="button" className="scan-result-link" onClick={() => setShowFingerModal(true)}>
                        상세 보기
                    </button>
                </div>
                <div className="scan-result-metrics">
                    <MetricCard title="길이 (Length)" metric={analysis.length} hint="큐티클에서 손톱 끝까지의 길이 평균" />
                    <MetricCard title="너비 (Width)" metric={analysis.width} hint="손톱 최대 너비 평균" />
                    <MetricCard title="곡률 (C-curve)" metric={analysis.cCurve} hint="C-curve 깊이" />
                </div>
            </section>

            <section className="scan-result-section">
                <h2>추천 네일 팁 쉐입</h2>
                {recommended && <RecommendedShapeCard shape={recommended} userName="네일리" />}
            </section>

            <section className="scan-result-section">
                <h2>피부 톤 분석</h2>
                <div className="skin-tone-grid">
                    <article className="skin-tone-card">
                        <div
                            className="skin-tone-card__banner"
                            style={{ background: analysis.skinToneHex }}
                        >
                            <div className="skin-tone-card__badge">
                                <p>대표 피부색</p>
                                <strong>{analysis.skinToneHex}</strong>
                            </div>
                        </div>
                        <div className="skin-tone-card__body">
                            <SkinToneSlider
                                label="톤"
                                valueLabel={skinToneAnalysis.tone.label}
                                percent={skinToneAnalysis.tone.percent}
                                minLabel="쿨"
                                maxLabel="웜"
                                trackClass="skin-tone-slider__track--tone"
                            />
                            <SkinToneSlider
                                label="명도"
                                valueLabel={skinToneAnalysis.brightness.label}
                                percent={skinToneAnalysis.brightness.percent}
                                minLabel="어두운"
                                maxLabel="밝은"
                                trackClass="skin-tone-slider__track--brightness"
                            />
                            <SkinToneSlider
                                label="채도 (혈색)"
                                valueLabel={skinToneAnalysis.saturation.label}
                                percent={skinToneAnalysis.saturation.percent}
                                minLabel="없음"
                                maxLabel="있음"
                                trackClass="skin-tone-slider__track--saturation"
                            />
                        </div>
                    </article>

                    <article className="skin-tone-palette-card">
                        <h3>추천 컬러</h3>
                        <p className="skin-tone-palette-card__desc">
                            네일리님의 손에 어울리는 컬러예요.
                        </p>
                        <div className="skin-tone-palette-grid">
                            {skinTonePalette.map((hex, i) => (
                                <button
                                    key={`${hex}-${i}`}
                                    type="button"
                                    className="skin-tone-palette-grid__chip"
                                    style={{ background: hex }}
                                    title={hex}
                                    aria-label={`팔레트 색 ${hex}`}
                                />
                            ))}
                        </div>
                    </article>
                </div>
            </section>

            <div className="scan-result-actions">
                <NextStepButton label="네일 팁 출력하러 가기" onClick={() => {}} />
            </div>

            {showFingerModal && (
                <FingerDetailModal fingers={analysis.fingers} onClose={() => setShowFingerModal(false)} />
            )}
        </AppShell>
    )
}
