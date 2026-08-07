import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { PageBackLink } from '@/components/layout/PageBackLink'
import { FingerDetailModal } from '@/components/handScan/FingerDetailModal'
import { getNailShape, NAIL_SHAPES } from '@/constants/nailShapes'
import { createPrintOrder } from '@/apis/prints'
import { getScanResult, generateStl, type ScanResultResponse } from '@/apis/scan'
import { ApiError } from '@/utils/apiClient'
import { PERSONAL_COLOR_SWATCHES, SEASON_ROWS } from '@/constants/designPreferences'
import '@/styles/hand-scan-result.css'
import type { FingerDetail } from '@/utils/handScanAnalysis'

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

export function HandScanResultPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { leftScanId, rightScanId } = (location.state as
        | { leftScanId?: number | null; rightScanId?: number | null }
        | null) ?? {}
    const fromMypage = !!(location.state as { fromMypage?: boolean } | null)?.fromMypage

    const [leftResult, setLeftResult] = useState<ScanResultResponse | null>(null)
    const [rightResult, setRightResult] = useState<ScanResultResponse | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [showFingerModal, setShowFingerModal] = useState(false)
    const [selectedShape, setSelectedShape] = useState<string>('round')
    const [isGeneratingStl, setIsGeneratingStl] = useState(false)
    const [showPrintModal, setShowPrintModal] = useState(false)
    const [printConfirmed, setPrintConfirmed] = useState(false)

    const TERMINAL_STATUSES = ['MEASURED', 'COMPLETED', 'FAILED']

    function average(nums: number[]): number {
        if (nums.length === 0) return 0
        return nums.reduce((a, b) => a + b, 0) / nums.length
    }

    // 왼손/오른손이 같은 값을 주면 그대로 사용(=둘 다 반영된 합의값).
    // 드물게 서로 다르면, 분석 파이프라인이 더 진행된(COMPLETED) 쪽을 우선하고,
    // 그마저 같으면 왼손을 우선한다.
    function pickHandField<K extends 'shape' | 'seasonCode' | 'seasonNameKo'>(
        field: K,
        left: ScanResultResponse | null,
        right: ScanResultResponse | null,
    ): ScanResultResponse[K] | null {
        const l = left?.[field] ?? null
        const r = right?.[field] ?? null
        if (l == null) return r
        if (r == null) return l
        if (l === r) return l
        const rightIsMoreComplete = right?.status === 'COMPLETED' && left?.status !== 'COMPLETED'
        return rightIsMoreComplete ? r : l
    }

    useEffect(() => {
        if (!leftScanId && !rightScanId) return

        let cancelled = false // 언마운트되면 true로 바뀌어서, 예약된 다음 poll()이 실행돼도 즉시 멈춘다
        let timer: ReturnType<typeof setTimeout> | null = null

        const fetchBoth = async (): Promise<[string | null, string | null]> => {
            const [leftRes, rightRes] = await Promise.all([
                leftScanId ? getScanResult(leftScanId).catch((e) => {
                    setError(e instanceof ApiError ? e.message : '오류가 발생했습니다.')
                    return null
                }) : Promise.resolve(null),
                rightScanId ? getScanResult(rightScanId).catch((e) => {
                    setError(e instanceof ApiError ? e.message : '오류가 발생했습니다.')
                    return null
                }) : Promise.resolve(null),
            ])

            if (cancelled) return [null, null] // 응답 오는 사이에 이미 페이지를 떠났으면 상태 업데이트도 하지 않는다

            if (leftRes) setLeftResult(leftRes)
            if (rightRes) setRightResult(rightRes)
            const combinedShape = pickHandField('shape', leftRes, rightRes)
            if (combinedShape) setSelectedShape(combinedShape)

            setIsLoading(false)
            return [leftRes?.status ?? null, rightRes?.status ?? null]
        }

        const poll = async () => {
            const [leftStatus, rightStatus] = await fetchBoth()
            if (cancelled) return
            const leftDone = !leftScanId || (leftStatus && TERMINAL_STATUSES.includes(leftStatus))
            const rightDone = !rightScanId || (rightStatus && TERMINAL_STATUSES.includes(rightStatus))
            if (!(leftDone && rightDone)) {
                timer = setTimeout(() => void poll(), 3000)
            }
        }

        void poll()

        return () => {
            cancelled = true
            if (timer) clearTimeout(timer)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [leftScanId, rightScanId, fromMypage])

    // 왼손 결과를 베이스로 하고, shape/seasonCode/seasonNameKo는 양손 결과를 함께 반영해서 병합
    const baseResult = leftResult ?? rightResult
    const result = baseResult
        ? {
            ...baseResult,
            shape: pickHandField('shape', leftResult, rightResult) ?? baseResult.shape,
            seasonCode: pickHandField('seasonCode', leftResult, rightResult) ?? baseResult.seasonCode,
            seasonNameKo: pickHandField('seasonNameKo', leftResult, rightResult) ?? baseResult.seasonNameKo,
        }
        : null

    const handleGoToDesign = () => {
        navigate('/design/chat', {
            state: {
                scanId: leftScanId ?? rightScanId ?? null,
                leftScanId,
                rightScanId,
                seasonCode: result?.seasonCode ?? null,
            },
        })
    }

    const handleGenerateStl = async () => {
        if (!leftScanId && !rightScanId) return
        setIsGeneratingStl(true)
        try {
            // 왼손/오른손 각각 STL 생성 요청 (10손가락 전체)
            await Promise.all([
                leftScanId ? generateStl(leftScanId, selectedShape) : Promise.resolve(),
                rightScanId ? generateStl(rightScanId, selectedShape) : Promise.resolve(),
            ])
            const shapeLabelKo = getNailShape(selectedShape)?.labelKo ?? selectedShape
            await createPrintOrder({ shapeId: selectedShape, shapeLabelKo, leftScanId, rightScanId })
            setPrintConfirmed(true)
            setShowPrintModal(true)
        } catch (e) {
            const msg = e instanceof ApiError ? e.message : 'STL 생성 요청에 실패했습니다.'
            alert(msg)
        } finally {
            setIsGeneratingStl(false)
        }
    }

    if (isLoading) {
        return (
            <AppShell>
                <div className="scan-result-empty">
                    <p>결과를 불러오는 중...</p>
                </div>
            </AppShell>
        )
    }

    if ((!leftScanId && !rightScanId) || !result || error) {
        return (
            <AppShell>
                <PageBackLink to="/scan/hand" label="손 촬영" />
                <div className="scan-result-empty">
                    <p>{error ?? '손 스캔 결과가 없습니다. 먼저 손 촬영을 진행해 주세요.'}</p>
                    <button type="button" className="scan-result-cta" onClick={() => navigate('/scan/hand')}>
                        손 촬영하러 가기
                    </button>
                </div>
            </AppShell>
        )
    }

    const recommended = getNailShape(result.shape)
    const seasonRow = SEASON_ROWS.find(r => r.code === result.seasonCode)
    const personalColorSwatches = result.seasonCode ? (PERSONAL_COLOR_SWATCHES[result.seasonCode] ?? []) : []

    // 왼손 5손가락 + 오른손 5손가락 = 실제 10손가락
    const apiFingers = [...(leftResult?.fingers ?? []), ...(rightResult?.fingers ?? [])]

    const displayFingers = apiFingers

    const FINGER_OVERLAYS = [
        { x: 42, y: 47 },
        { x: 35, y: 24 },
        { x: 27, y: 16 },
        { x: 19, y: 22 },
        { x: 14, y: 34 },
        { x: 58, y: 47 },
        { x: 65, y: 24 },
        { x: 73, y: 16 },
        { x: 81, y: 22 },
        { x: 86, y: 34 },
    ]

    const FINGER_NAMES = [
        '엄지 (왼손)',
        '검지 (왼손)',
        '중지 (왼손)',
        '약지 (왼손)',
        '소지 (왼손)',
        '엄지 (오른손)',
        '검지 (오른손)',
        '중지 (오른손)',
        '약지 (오른손)',
        '소지 (오른손)',
    ]

    const fingerDetails: FingerDetail[] = displayFingers.map((finger, index) => {
        let measurements: any = {}

        try {
            const parsed = JSON.parse(finger.measurements ?? '{}')
            measurements = parsed || {}
        } catch {
            measurements = {}
        }

        return {
            id: `finger-${index}`,
            name: FINGER_NAMES[index] ?? finger.finger,

            // 백엔드 값이 있으면 사용
            // 없으면 임시 Mock 값
            lengthMm: Number(
                measurements?.lengthMm ??
                measurements?.length ??
                (12 + index * 0.3)
            ),

            widthMm: Number(
                measurements?.widthMm ??
                measurements?.width ??
                (9 + index * 0.2)
            ),

            cCurve: Number(
                measurements?.cCurve ??
                measurements?.curve ??
                0.55
            ),

            overlay: FINGER_OVERLAYS[index] ?? { x: 50, y: 50 },
        }
    })

    // 손톱 기본 지표: 왼손 5개 + 오른손 5개 = 10손가락 실측 평균
    // (percentile/comparisonLabel은 전체 사용자 모집단 통계 API가 아직 없어 임시값 유지)
    const AVERAGE_METRICS = {
        length: {
            value: Number(average(fingerDetails.map((f) => f.lengthMm)).toFixed(1)),
            unit: 'mm',
            percentile: 68,
            comparisonLabel: '평균보다 약간 긺',
        },
        width: {
            value: Number(average(fingerDetails.map((f) => f.widthMm)).toFixed(1)),
            unit: 'mm',
            percentile: 55,
            comparisonLabel: '평균과 비슷함',
        },
        cCurve: {
            value: Number(average(fingerDetails.map((f) => f.cCurve)).toFixed(2)),
            unit: '',
            percentile: 72,
            comparisonLabel: '곡률이 뚜렷한 편',
        },
    }

    return (
        <AppShell mainClassName="scan-result-page">
            {fromMypage
                ? <PageBackLink to="/mypage" label="손 분석 기록" state={{ tab: 'scan' }} />
                : <PageBackLink to="/scan/hand" label="손 촬영" />
            }

            <header className="scan-result-hero">
                <p className="scan-result-hero__eyebrow">Hand Scan Analysis</p>
                <h1>손 스캔 분석 결과</h1>
                <p>손 스캔이 완료되었습니다.</p>
            </header>

            <section className="scan-result-section">
                <div className="scan-result-section__head">
                    <h2>손톱 기본 지표</h2>
                    {apiFingers.length > 0 && (
                        <button type="button" className="scan-result-link" onClick={() => setShowFingerModal(true)}>
                            상세보기
                        </button>
                    )}
                </div>
                <div className="scan-result-metrics">
                    <MetricCard title="길이 (Length)" metric={AVERAGE_METRICS.length} hint="손톱 끝에서 베이스까지 평균 길이" />
                    <MetricCard title="너비 (Width)" metric={AVERAGE_METRICS.width} hint="손톱 최대 너비 평균" />
                    <MetricCard
                        title="곡률 (C-curve)"
                        metric={AVERAGE_METRICS.cCurve}
                        hint="손톱 측면 곡률 지수 (0~1)"
                    />
                </div>
                {/*<div className="scan-result-metrics">*/}
                {/*    <MetricCard title="전체 크기" value={result.overallSize ?? '-'} hint="손톱 전체 크기 분류" />*/}
                {/*    <MetricCard title="손 방향" value={result.handSide === 'RIGHT' ? '오른손' : '왼손'} hint="촬영한 손 방향" />*/}
                {/*    <MetricCard title="분석 상태" value={result.status} hint="현재 분석 진행 상태" />*/}
                {/*</div>*/}
            </section>

            {result.seasonCode && (
                <section className="scan-result-section scan-result-section--grid">
                    <article className="scan-tone-card">
                        <h2>퍼스널 컬러</h2>
                        <p className="scan-tone-card__hex" style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                            {result.seasonNameKo ?? result.seasonCode}
                        </p>
                        {seasonRow && (
                            <p className="scan-tone-card__desc">
                                {seasonRow.tone} 톤 · {seasonRow.brightness} · {seasonRow.saturation}
                            </p>
                        )}
                        {/*{result.skinToneHex && (*/}
                        {/*    <>*/}
                        {/*        <div className="scan-tone-card__swatch" style={{ background: result.skinToneHex }} />*/}
                        {/*        <p className="scan-tone-card__hex">{result.skinToneHex}</p>*/}
                        {/*    </>*/}
                        {/*)}*/}
                    </article>

                    {personalColorSwatches.length > 0 && (
                        <article className="scan-season-card">
                            <h2>추천 컬러</h2>
                            <div className="scan-palette">
                                {personalColorSwatches.map((hex) => (
                                    <button
                                        key={hex}
                                        type="button"
                                        className="scan-palette__chip"
                                        style={{ background: hex }}
                                        title={hex}
                                        aria-label={`팔레트 색 ${hex}`}
                                    />
                                ))}
                            </div>
                            <p className="scan-season-card__desc">
                                {result.seasonNameKo} 타입에 어울리는 추천 컬러 팔레트입니다.
                            </p>
                        </article>
                    )}
                </section>
            )}

            <section className="scan-result-section">
                <h2>네일팁 모양 선택</h2>
                <p className="scan-result-section__sub">
                    {recommended ? (
                        <>추천 쉐입은 <strong>{recommended.labelKo}</strong>입니다. 원하는 모양을 선택해 주세요.</>
                    ) : (
                        <>AI가 추천 쉐입을 분석하고 있어요. 분석이 끝나면 자동으로 추천 배지가 표시됩니다. 먼저 원하는 모양을 선택해 주세요.</>
                    )}
                </p>
                <div className="scan-shape-grid">
                    {NAIL_SHAPES.map((shape) => {
                        const isRecommended = shape.id === result.shape
                        const isSelected = shape.id === selectedShape
                        return (
                            <article
                                key={shape.id}
                                className={`scan-shape-card ${isRecommended ? 'is-recommended' : ''} ${isSelected ? 'is-selected' : ''}`}
                                onClick={() => setSelectedShape(shape.id)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => e.key === 'Enter' && setSelectedShape(shape.id)}
                                aria-pressed={isSelected}
                                style={{ cursor: 'pointer' }}
                            >
                                {isRecommended && <span className="scan-shape-card__badge">추천</span>}
                                <img src={shape.image} alt={shape.labelKo} />
                                <h3>{shape.labelKo}</h3>
                                <p>{shape.labelEn}</p>
                            </article>
                        )
                    })}
                </div>
            </section>

            <div className="scan-result-actions">
                <button
                    type="button"
                    className="scan-result-cta"
                    onClick={() => void handleGenerateStl()}
                    disabled={printConfirmed || isGeneratingStl}
                >
                    {isGeneratingStl ? 'STL 생성 중...' : printConfirmed ? '출력 신청 완료 ✓' : '네일팁 출력하기'}
                </button>
                <button
                    type="button"
                    className="scan-result-cta"
                    onClick={handleGoToDesign}
                >
                    네일 디자인 생성하기
                </button>
            </div>

            {showFingerModal && apiFingers.length > 0 && (
                <FingerDetailModal fingers={fingerDetails} onClose={() => setShowFingerModal(false)} />
            )}

            {showPrintModal && createPortal(
                <div className="print-modal">
                    <button type="button" className="print-modal__backdrop" onClick={() => setShowPrintModal(false)} />
                    <div className="print-modal__panel" role="dialog" aria-modal="true">
                        <p className="print-modal__icon">🖨️</p>
                        <h2>출력 신청 완료</h2>
                        <p>
                            당신의 네일팁이{' '}
                            <strong>{getNailShape(selectedShape)?.labelKo ?? selectedShape}</strong>
                            {' '}(으)로 출력 신청되었습니다.
                        </p>
                        <button
                            type="button"
                            className="scan-result-cta"
                            onClick={() => setShowPrintModal(false)}
                        >
                            확인
                        </button>
                    </div>
                </div>,
                document.body,
            )}
        </AppShell>
    )
}