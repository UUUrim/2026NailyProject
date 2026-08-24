import { AppShell } from '@/shared/layout/AppShell'
import { PageHero } from '@/shared/layout/PageHero'
import { FingerDetailModal } from '@/features/hand-scan/components/FingerDetailModal'
import { NextStepButton } from '@/shared/components/NextStepButton'
import { useHandScanResultPage } from '@/features/hand-scan/hooks/useHandScanResultPage'
import '@/styles/hand-scan-result.css'

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

export function HandScanResultPageContent() {
    const {
        navigate,
        leftScanId,
        rightScanId,
        isLoading,
        error,
        showFingerModal,
        setShowFingerModal,
        userName,
        isAnalyzing,
        scanFailed,
        recommended,
        skinToneAnalysis,
        skinTonePalette,
        apiFingers,
        fingerDetails,
        AVERAGE_METRICS,
        result,
        handleGoToPrint,
    } = useHandScanResultPage()

    if (!leftScanId && !rightScanId) {
        return (
            <AppShell>
                <div className="scan-result-empty">
                    <p>{error ?? '손 스캔 결과가 없습니다. 먼저 손 촬영을 진행해 주세요.'}</p>
                    <button type="button" className="scan-result-cta" onClick={() => navigate('/scan/hand')}>
                        손 촬영하러 가기
                    </button>
                </div>
            </AppShell>
        )
    }

    if (error) {
        return (
            <AppShell>
                <div className="scan-result-empty">
                    <p>{error}</p>
                    <button type="button" className="scan-result-cta" onClick={() => navigate('/scan/hand')}>
                        손 촬영하러 가기
                    </button>
                </div>
            </AppShell>
        )
    }

    if (scanFailed) {
        return (
            <AppShell mainClassName="scan-result-page">
                <PageHero
                    eyebrow="Hand Scan Analysis"
                    title="손 스캔 분석 실패"
                    description={
                        <>
                            손톱 측정에 실패했어요. 마커가 잘 보이도록 다시 촬영해 주세요.
                            (조명, 초점, 마커가 프레임 안에 온전히 들어왔는지 확인해 주세요.)
                        </>
                    }
                />

                <div className="scan-result-actions" style={{ paddingTop: '2rem' }}>
                    <button
                        type="button"
                        className="scan-result-cta"
                        onClick={() => navigate('/scan/hand')}
                    >
                        다시 촬영하기
                    </button>
                </div>
            </AppShell>
        )
    }

    return (
        <AppShell mainClassName="scan-result-page">
            <PageHero
                eyebrow="Hand Analysis"
                title="손 분석 결과"
                description={isLoading ? '분석 중...' : `${userName ? `${userName}님의` : '나의'} 손톱 수치와 피부 톤, 추천 쉐입을 확인해 보세요.`}
            />

            <section className="scan-result-section">
                <div className="scan-result-section__head">
                    <h2>손톱 기본 지표</h2>
                    {!isLoading && apiFingers.length > 0 && (
                        <button type="button" className="scan-result-link" onClick={() => setShowFingerModal(true)}>
                            상세보기
                        </button>
                    )}
                </div>
                <div className="scan-result-metrics">
                    {isLoading ? (
                        <>
                            <article className="scan-metric-card scan-metric-card--skeleton" aria-hidden="true">
                                <h3>길이 (Length)</h3>
                                <p className="scan-metric-card__value">···</p>
                            </article>
                            <article className="scan-metric-card scan-metric-card--skeleton" aria-hidden="true">
                                <h3>너비 (Width)</h3>
                                <p className="scan-metric-card__value">···</p>
                            </article>
                            <article className="scan-metric-card scan-metric-card--skeleton" aria-hidden="true">
                                <h3>곡률 (C-curve)</h3>
                                <p className="scan-metric-card__value">···</p>
                            </article>
                        </>
                    ) : (
                        <>
                            <MetricCard title="길이 (Length)" metric={AVERAGE_METRICS.length} hint="손톱 끝에서 베이스까지 평균 길이" />
                            <MetricCard title="너비 (Width)" metric={AVERAGE_METRICS.width} hint="손톱 최대 너비 평균" />
                            <MetricCard
                                title="곡률 (C-curve)"
                                metric={AVERAGE_METRICS.cCurve}
                                hint="손톱 측면 곡률 지수 (0~1)"
                            />
                        </>
                    )}
                </div>
                {/*<div className="scan-result-metrics">*/}
                {/*    <MetricCard title="전체 크기" value={result.overallSize ?? '-'} hint="손톱 전체 크기 분류" />*/}
                {/*    <MetricCard title="손 방향" value={result.handSide === 'RIGHT' ? '오른손' : '왼손'} hint="촬영한 손 방향" />*/}
                {/*    <MetricCard title="분석 상태" value={result.status} hint="현재 분석 진행 상태" />*/}
                {/*</div>*/}
            </section>

            <section className="scan-result-section">
                <h2>피부 톤 분석</h2>
                {isLoading ? (
                    <div className="skin-tone-grid" aria-hidden="true">
                        <article className="skin-tone-card skin-tone-card--skeleton">
                            <div className="skin-tone-card__banner" style={{ background: '#eee' }}>
                                <div className="skin-tone-card__badge">
                                    <p>대표 피부색</p>
                                    <strong>···</strong>
                                </div>
                            </div>
                            <div className="skin-tone-card__body">
                                <p className="scan-result-section__sub">분석중...</p>
                            </div>
                        </article>
                        <article className="skin-tone-palette-card skin-tone-palette-card--skeleton">
                            <h3>추천 컬러</h3>
                            <div className="skin-tone-palette-grid">
                                {Array.from({ length: 24 }).map((_, i) => (
                                    <span key={i} className="skin-tone-palette-grid__chip skin-tone-palette-grid__chip--skeleton" />
                                ))}
                            </div>
                        </article>
                    </div>
                ) : (
                    result?.skinToneHex && skinToneAnalysis && (
                        <div className="skin-tone-grid">
                            <article className="skin-tone-card">
                                <div
                                    className="skin-tone-card__banner"
                                    style={{ background: result.skinToneHex }}
                                >
                                    <div className="skin-tone-card__badge">
                                        <p>대표 피부색</p>
                                        <strong>{result.skinToneHex}</strong>
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
                                    {userName ? `${userName}님과` : '회원님과'} 어울리는 컬러들이에요.
                                </p>
                            </article>
                        </div>
                    )
                )}
            </section>

            {isLoading ? (
                <section className="scan-result-section" aria-hidden="true">
                    <h2>추천 네일팁 쉐입</h2>
                    <div className="scan-shape-highlight scan-shape-highlight--skeleton">
                        <div className="scan-shape-highlight__body">
                            <p className="scan-shape-highlight__name">&nbsp;</p>
                            <p className="scan-shape-highlight__desc">분석중...</p>
                        </div>
                        <div className="scan-shape-highlight__icon-skeleton" />
                    </div>
                </section>
            ) : (
                <section className="scan-result-section">
                    <h2>추천 네일팁 쉐입</h2>
                    {recommended ? (
                        <div className="scan-shape-highlight">
                            <div className="scan-shape-highlight__body">
                                <p className="scan-shape-highlight__name">{recommended.labelKo}</p>
                                <p className="scan-shape-highlight__label-en">{recommended.labelEn}</p>
                                <p className="scan-shape-highlight__desc">
                                    {userName ? `${userName}님은 ` : '회원님께는 '}
                                    {recommended.description}이 잘 어울려요.
                                </p>
                            </div>
                            <div className="scan-shape-highlight__icon" aria-hidden="true">
                                <img src={recommended.image} alt="" />
                            </div>
                        </div>
                    ) : (
                        <p className="scan-result-section__sub">AI가 추천 쉐입을 분석하고 있어요.</p>
                    )}
                </section>
            )}

            <div className="scan-result-actions">
                <NextStepButton label="네일팁 출력하러 가기" onClick={handleGoToPrint} disabled={isAnalyzing} />
            </div>

            {showFingerModal && apiFingers.length > 0 && (
                <FingerDetailModal fingers={fingerDetails} onClose={() => setShowFingerModal(false)} />
            )}
        </AppShell>
    )
}
