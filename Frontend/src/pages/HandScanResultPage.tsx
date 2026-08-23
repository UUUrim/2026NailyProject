import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation, useNavigationType } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { PageHero } from '@/components/layout/PageHero'
import { FingerDetailModal } from '@/components/handScan/FingerDetailModal'
import { NextStepButton } from '@/components/common/NextStepButton'
import { getNailShape } from '@/constants/nailShapes'
import { getScanResult, type ScanResultResponse } from '@/apis/scan'
import { getMyProfile } from '@/apis/user'
import { ApiError } from '@/utils/apiClient'
import { analyzeSkinTone, generateSkinTonePalette } from '@/utils/skinTone'
import { NAIL_BASELINE, percentileAgainstBaseline, labelByPercentile } from '@/utils/nailMetrics'
import { useLeaveWarning } from '@/hooks/useLeaveWarning'
import { AUTH_CHANGE_EVENT } from '@/utils/auth'
import '@/styles/hand-scan-result.css'
import type { FingerDetail } from '@/utils/handScanAnalysis'

const LEAVE_DURING_ANALYSIS_WARNING =
    '지금 나가면 분석이 중단되어 다시 촬영해야 해요. 그래도 나가시겠어요?'
const LEAVE_AFTER_ANALYSIS_WARNING =
    '지금 나가면 진행 상황이 초기화돼요. 분석 결과는 마이페이지에서 다시 확인할 수 있어요. 그래도 나가시겠어요?'

// 이 페이지 상태를 모듈 스코프에 스냅샷으로 저장해서, 디자인 채팅 등 다른 페이지로 이동했다가
// (뒤로가기 포함) 돌아와도 분석 결과가 초기화되지 않도록 한다.
// 다른 스캔 결과를 보러 온 경우(scanId가 다름)까지 잘못 복원하지 않도록 scanId가 일치할 때만 사용한다.
type HandScanResultSnapshot = {
    leftScanId: number | null
    rightScanId: number | null
    leftResult: ScanResultResponse | null
    rightResult: ScanResultResponse | null
    userName: string
    showFingerModal: boolean
}

let handScanResultSnapshot: HandScanResultSnapshot | null = null

// 손가락별 measurements JSON(scan/server.py → ScanImg.measurements)의 필드 형태.
// cCurveMm이 실제 파이프라인 필드명이고, cCurve/curve는 옛 목업 데이터 호환용 fallback이다.
type FingerMeasurements = {
    lengthMm?: number
    length?: number
    widthMm?: number
    width?: number
    cCurveMm?: number
    cCurve?: number
    curve?: number
}

// 로그인/로그아웃(계정 전환)이 일어나면 이전 계정의 분석 결과 화면이 다음 계정에게
// 보이지 않도록 스냅샷을 비운다. 실제 서버에 저장된 이력은 계정별로 분리되어 있어 영향 없음.
window.addEventListener(AUTH_CHANGE_EVENT, () => {
    handScanResultSnapshot = null
})

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

export function HandScanResultPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { leftScanId, rightScanId } = (location.state as
        | { leftScanId?: number | null; rightScanId?: number | null }
        | null) ?? {}
    const fromMypage = !!(location.state as { fromMypage?: boolean } | null)?.fromMypage

    // 브라우저 뒤로/앞으로가기(POP)로, 그리고 지금 보려는 scanId와 스냅샷에 저장된
    // scanId가 일치할 때만 "돌아온 것"으로 보고 복원한다. 앱 안의 링크/버튼으로
    // 들어온 경우엔 같은 scanId라도 항상 새로 불러온다.
    const navigationType = useNavigationType()
    const wasRestoredRef = useRef(
        navigationType === 'POP' &&
            !!handScanResultSnapshot &&
            handScanResultSnapshot.leftScanId === (leftScanId ?? null) &&
            handScanResultSnapshot.rightScanId === (rightScanId ?? null),
    )
    const snapshot = wasRestoredRef.current ? handScanResultSnapshot : null

    const [leftResult, setLeftResult] = useState<ScanResultResponse | null>(snapshot?.leftResult ?? null)
    const [rightResult, setRightResult] = useState<ScanResultResponse | null>(snapshot?.rightResult ?? null)
    const [isLoading, setIsLoading] = useState(!wasRestoredRef.current)
    const [error, setError] = useState<string | null>(null)
    const [showFingerModal, setShowFingerModal] = useState(snapshot?.showFingerModal ?? false)
    const [userName, setUserName] = useState(snapshot?.userName ?? '')
    // 분석 결과를 아직 기다리는 중인지(폴링이 끝나지 않았는지) — 이 사이에 페이지를 벗어나면
    // 분석이 완료되지 않아 결과가 저장되지 않고, 손 촬영을 다시 해야 한다.
    const [isAnalyzing, setIsAnalyzing] = useState(false)

    const TERMINAL_STATUSES = ['MEASURED', 'COMPLETED', 'FAILED']

    function average(nums: number[]): number {
        if (nums.length === 0) return 0
        return nums.reduce((a, b) => a + b, 0) / nums.length
    }

    // 왼손/오른손이 같은 값을 주면 그대로 사용(=둘 다 반영된 합의값).
    // 드물게 서로 다르면, 분석 파이프라인이 더 진행된(COMPLETED) 쪽을 우선하고,
    // 그마저 같으면 왼손을 우선한다.
    function pickHandField<K extends 'shape' | 'recommendedShape'>(
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
        if (wasRestoredRef.current) return // 이미 복원된 이름이 있으므로 다시 불러오지 않는다
        let cancelled = false
        void getMyProfile()
            .then((profile) => {
                if (!cancelled) setUserName(profile.nickname || profile.name || '')
            })
            .catch(() => {
                // 이름 못 가져와도 진행
            })
        return () => {
            cancelled = true
        }
    }, [])

    useEffect(() => {
        if (!leftScanId && !rightScanId) return
        // 이미 복원된 결과가 있으므로 다시 폴링하지 않는다 — 안 그러면 선택해 둔 쉐입이 재조회 결과로 덮어써진다.
        if (wasRestoredRef.current) return

        let cancelled = false // 언마운트되면 true로 바뀌어서, 예약된 다음 poll()이 실행돼도 즉시 멈춘다
        let timer: ReturnType<typeof setTimeout> | null = null
        setIsAnalyzing(true)

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

            return [leftRes?.status ?? null, rightRes?.status ?? null]
        }

        const poll = async () => {
            const [leftStatus, rightStatus] = await fetchBoth()
            if (cancelled) return
            const leftDone = !leftScanId || (leftStatus && TERMINAL_STATUSES.includes(leftStatus))
            const rightDone = !rightScanId || (rightStatus && TERMINAL_STATUSES.includes(rightStatus))
            if (leftDone && rightDone) {
                // 양손 다 최종 상태(측정 완료 또는 실패)가 됐을 때만 로딩을 끝낸다.
                setIsLoading(false)
                setIsAnalyzing(false)
            } else {
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

    // 분석이 끝난 뒤에는 뒤로가기를 그대로 허용한다 — 스냅샷이 항상 복원해주므로 내용이
    // 사라지지 않는다. 새로고침/탭 닫기/헤더 내비게이션 등 "뒤로가기가 아닌" 방식으로 벗어나려
    // 할 때만 경고하고, 그래도 나가면 스냅샷을 비워서 다음엔 처음부터 새로 진행하도록 한다.
    useLeaveWarning(
        !!(leftScanId || rightScanId),
        isAnalyzing ? LEAVE_DURING_ANALYSIS_WARNING : LEAVE_AFTER_ANALYSIS_WARNING,
        () => {
            handScanResultSnapshot = null
        },
    )

    // 분석이 "진행 중"일 때는 뒤로가기도 예외적으로 막는다 — 아직 결과가 나오지 않은 상태라
    // 스냅샷을 복원해도 이어서 보여줄 완성된 결과가 없기 때문에, 다른 페이지들과 달리 여기서는
    // 뒤로가기도 경고 후 진행되게 하고, 그래도 나가면 분석을 중단시키고(=폴링을 멈추고 스냅샷을
    // 비워서) 다음엔 손 촬영부터 새로 하도록 한다.
    useEffect(() => {
        if (!isAnalyzing) return

        window.history.pushState(null, '', window.location.href)

        const handlePopState = () => {
            const confirmed = window.confirm(LEAVE_DURING_ANALYSIS_WARNING)
            if (confirmed) {
                handScanResultSnapshot = null
                window.removeEventListener('popstate', handlePopState)
                window.history.back()
            } else {
                window.history.pushState(null, '', window.location.href)
            }
        }

        window.addEventListener('popstate', handlePopState)
        return () => window.removeEventListener('popstate', handlePopState)
    }, [isAnalyzing])

    // 분석 결과 상태를 모듈 스코프 스냅샷에 반영해 둔다.
    // 다른 페이지로 이동했다가(디자인 채팅 등) 돌아와도 위 useState 초기값이 여기서 복원된다.
    useEffect(() => {
        handScanResultSnapshot = {
            leftScanId: leftScanId ?? null,
            rightScanId: rightScanId ?? null,
            leftResult,
            rightResult,
            userName,
            showFingerModal,
        }
    }, [leftScanId, rightScanId, leftResult, rightResult, userName, showFingerModal])

    // 왼손 결과를 베이스로 하고, shape/recommendedShape는 양손 결과를 함께 반영해서 병합
    const baseResult = leftResult ?? rightResult
    const result = baseResult
        ? {
            ...baseResult,
            shape: pickHandField('shape', leftResult, rightResult) ?? baseResult.shape,
            recommendedShape: pickHandField('recommendedShape', leftResult, rightResult) ?? baseResult.recommendedShape,
        }
        : null

    // 요청한 손이 전부 FAILED로 끝났으면 — 측정이 하나도 안 된 상태이므로
    // Mock 값으로 채운 화면을 "정상 완료"처럼 보여주면 안 된다.
    const leftFailed = !leftScanId || leftResult?.status === 'FAILED'
    const rightFailed = !rightScanId || rightResult?.status === 'FAILED'
    const scanFailed = !isLoading && leftFailed && rightFailed && !!(leftScanId || rightScanId)

    // 이 페이지에서는 더 이상 쉐입을 고르거나 출력 신청을 하지 않고, 네일팁 출력 페이지로
    // 넘어가서 진행한다. 이 분석 결과를 바로 이어서 고를 수 있도록 scanId를 함께 전달한다.
    const handleGoToPrint = () => {
        navigate('/print', {
            state: { leftScanId, rightScanId },
        })
    }

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

    const recommended = result?.recommendedShape ? getNailShape(result.recommendedShape) : null
    const skinToneAnalysis = result?.skinToneHex ? analyzeSkinTone(result.skinToneHex) : null
    const skinTonePalette = result?.skinToneHex ? generateSkinTonePalette(result.skinToneHex, 24) : []

    // 왼손 5손가락 + 오른손 5손가락 = 실제 10손가락
    const apiFingers = [...(leftResult?.fingers ?? []), ...(rightResult?.fingers ?? [])]

    const displayFingers = apiFingers

    const FINGER_OVERLAYS = [
        { x: 42, y: 47 },
        { x: 35, y: 23 },
        { x: 27, y: 16 },
        { x: 19, y: 22 },
        { x: 14, y: 33 },
        { x: 58, y: 47 },
        { x: 65, y: 23 },
        { x: 73, y: 16 },
        { x: 81, y: 22 },
        { x: 86, y: 33 },
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
        let measurements: FingerMeasurements = {}

        try {
            const parsed = JSON.parse(finger.measurements ?? '{}')
            measurements = parsed || {}
        } catch {
            measurements = {}
        }

        return {
            id: `finger-${index}`,
            name: FINGER_NAMES[index] ?? finger.finger,

            // 백엔드(scan/server.py) 실측값을 그대로 사용. 값이 없는 경우에만 임시 Mock 값으로 대체.
            lengthMm: Number(
                measurements.lengthMm ??
                measurements.length ??
                (12 + index * 0.3)
            ),

            widthMm: Number(
                measurements.widthMm ??
                measurements.width ??
                (9 + index * 0.2)
            ),

            // 실제 파이프라인이 내려주는 곡률 필드명은 cCurveMm — cCurve/curve는 옛 목업 호환용
            cCurve: Number(
                measurements.cCurveMm ??
                measurements.cCurve ??
                measurements.curve ??
                0.55
            ),

            overlay: FINGER_OVERLAYS[index] ?? { x: 50, y: 50 },
        }
    })

    // 손톱 기본 지표: 왼손 5개 + 오른손 5개 = 10손가락 실측 평균
    // percentile/comparisonLabel은 전체 사용자 모집단 통계 API가 없어, 성인 평균 손톱 규격을
    // 고정 기준값(NAIL_BASELINE)으로 두고 실측 평균이 그 기준과 얼마나 차이 나는지로 계산한다.
    const lengthValue = Number(average(fingerDetails.map((f) => f.lengthMm)).toFixed(1))
    const widthValue = Number(average(fingerDetails.map((f) => f.widthMm)).toFixed(1))
    const cCurveValue = Number(average(fingerDetails.map((f) => f.cCurve)).toFixed(2))

    const lengthPercentile = percentileAgainstBaseline(lengthValue, NAIL_BASELINE.length)
    const widthPercentile = percentileAgainstBaseline(widthValue, NAIL_BASELINE.width)
    const cCurvePercentile = percentileAgainstBaseline(cCurveValue, NAIL_BASELINE.cCurve)

    const AVERAGE_METRICS = {
        length: {
            value: lengthValue,
            unit: 'mm',
            percentile: lengthPercentile,
            comparisonLabel: labelByPercentile(lengthPercentile, '평균보다 짧은 편', '평균보다 긴 편', '평균과 비슷함'),
        },
        width: {
            value: widthValue,
            unit: 'mm',
            percentile: widthPercentile,
            comparisonLabel: labelByPercentile(widthPercentile, '좁은 편', '넓은 편', '평균과 비슷함'),
        },
        cCurve: {
            value: cCurveValue,
            unit: '',
            percentile: cCurvePercentile,
            comparisonLabel: labelByPercentile(cCurvePercentile, '완만한 편', '뚜렷한 편', '평균 범위'),
        },
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