import { useState } from 'react'
import { AppShell } from '@/shared/layout/AppShell'
import { PageHero } from '@/shared/layout/PageHero'
import { FingerDetailModal } from '@/features/hand-scan/components/FingerDetailModal'
import { NextStepButton } from '@/shared/components/NextStepButton'
import { getNailShape } from '@/shared/constants/nailShapes'
import { buildHandScanAnalysis } from '@/shared/utils/handScanAnalysis'
import { analyzeSkinTone, generateSkinTonePalette } from '@/shared/utils/skinTone'
import { arrangeRecommendedColors } from '@/shared/utils/colorSort'
import '@/styles/hand-scan-result.css'

// ══════════════════════════════════════════════════════════════════════
// 개발용 화면 확인 페이지 — 실제 API 없이 buildHandScanAnalysis()가 만들어주는
// 가짜 분석 데이터로 손 분석 결과 화면(완료 상태)을 실제와 동일한 마크업/스타일로 보여준다.
// 주소창에 /preview/scan-result 를 직접 입력해서 들어가야 볼 수 있다 (다른 화면에서 링크 없음).
// ══════════════════════════════════════════════════════════════════════

const MOCK_SKIN_HEX = '#F3D2B8'

function MetricCard({
    title,
    metric,
    hint,
}: {
    title: string
    metric: { value: number; unit: string; percentile: number; comparisonLabel: string }
    hint: string
}) {
    return (
        <article className="scan-metric-card">
            <h3>{title}</h3>
            <p className="scan-metric-card__value">
                {metric.value}
                {metric.unit}
            </p>
            <p className="scan-metric-card__compare">{metric.comparisonLabel}</p>
            <div className="scan-metric-card__bar" aria-hidden="true">
                <span style={{ width: `${metric.percentile}%` }} />
            </div>
            <p className="scan-metric-card__hint">{hint}</p>
            <p className="scan-metric-card__percentile">상위 {100 - metric.percentile}% 수준</p>
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

    const analysis = buildHandScanAnalysis(MOCK_SKIN_HEX)
    const recommended = getNailShape(analysis.recommendedShape)
    const skinToneAnalysis = analyzeSkinTone(analysis.skinToneHex)
    const skinTonePalette = arrangeRecommendedColors(
        generateSkinTonePalette(analysis.skinToneHex, 30),
        { columns: 6 },
    )

    return (
        <AppShell mainClassName="scan-result-page">
            <PageHero
                eyebrow="Hand Analysis · Preview"
                title="손 분석 결과"
                description="미리보기 회원님의 손톱 수치와 피부 톤, 추천 쉐입을 확인해 보세요. (개발용 미리보기 — 실제 데이터 아님)"
            />

            <section className="scan-result-section">
                <div className="scan-result-section__head">
                    <h2>손톱 기본 지표</h2>
                    <button type="button" className="scan-result-link" onClick={() => setShowFingerModal(true)}>
                        상세보기
                    </button>
                </div>
                <div className="scan-result-metrics">
                    <MetricCard title="길이 (Length)" metric={analysis.length} hint="손톱 끝에서 베이스까지 평균 길이" />
                    <MetricCard title="너비 (Width)" metric={analysis.width} hint="손톱 최대 너비 평균" />
                    <MetricCard title="곡률 (C-curve)" metric={analysis.cCurve} hint="손톱 측면 곡률 지수 (0~1)" />
                </div>
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
                        <p className="skin-tone-palette-card__desc">
                            미리보기 회원님과 어울리는 컬러들이에요.
                        </p>
                    </article>
                </div>
            </section>

            <section className="scan-result-section">
                <h2>추천 네일팁 쉐입</h2>
                {recommended && (
                    <div className="scan-shape-highlight">
                        <div className="scan-shape-highlight__body">
                            <p className="scan-shape-highlight__name">{recommended.labelKo}</p>
                            <p className="scan-shape-highlight__label-en">{recommended.labelEn}</p>
                            <p className="scan-shape-highlight__desc">
                                미리보기 회원님은 {recommended.description}이 잘 어울려요.
                            </p>
                        </div>
                        <div className="scan-shape-highlight__icon" aria-hidden="true">
                            <img src={recommended.image} alt="" />
                        </div>
                    </div>
                )}
            </section>

            <div className="scan-result-actions">
                <NextStepButton label="네일팁 출력하러 가기" onClick={() => {}} />
            </div>

            {showFingerModal && (
                <FingerDetailModal fingers={analysis.fingers} onClose={() => setShowFingerModal(false)} />
            )}
        </AppShell>
    )
}
