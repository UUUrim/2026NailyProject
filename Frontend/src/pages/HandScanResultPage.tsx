import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { PageBackLink } from '@/components/layout/PageBackLink'
import { FingerDetailModal } from '@/components/handScan/FingerDetailModal'
import { getNailShape, NAIL_SHAPES } from '@/constants/nailShapes'
import { createPrintOrder } from '@/apis/prints'
import { getScanResult, generateStl, type ScanResultResponse } from '@/apis/scan'
import { getMyProfile } from '@/apis/user'
import { ApiError } from '@/utils/apiClient'
import { PERSONAL_COLOR_SWATCHES, SEASON_ROWS } from '@/constants/designPreferences'
import '@/styles/hand-scan-result.css'
import type { FingerDetail } from '@/utils/handScanAnalysis'

// 이 페이지 상태를 모듈 스코프에 스냅샷으로 저장해서, 디자인 채팅 등 다른 페이지로 이동했다가
// (뒤로가기 포함) 돌아와도 분석 결과·선택한 쉐입·출력 신청 상태가 초기화되지 않도록 한다.
// 다른 스캔 결과를 보러 온 경우(scanId가 다름)까지 잘못 복원하지 않도록 scanId가 일치할 때만 사용한다.
type HandScanResultSnapshot = {
    leftScanId: number | null
    rightScanId: number | null
    leftResult: ScanResultResponse | null
    rightResult: ScanResultResponse | null
    selectedShape: string
    printConfirmed: boolean
    userName: string
}

let handScanResultSnapshot: HandScanResultSnapshot | null = null

// 네일팁 출력 페이지(PrintPage)의 출력 신청 모달과 아이콘을 통일한다.
const PrinterIcon = (
    <svg viewBox="0 0 24 24" fill="none" width="26" height="26">
        <path
            d="M7 8V4h10v4M6 17h12a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
        />
        <rect x="8" y="14" width="8" height="6" stroke="currentColor" strokeWidth="1.6" />
    </svg>
)

const CheckIcon = (
    <svg viewBox="0 0 24 24" fill="none" width="28" height="28">
        <path d="M5 12.5 10 17.5 19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
)

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

    // 지금 보려는 scanId와 스냅샷에 저장된 scanId가 일치할 때만 "돌아온 것"으로 보고 복원한다.
    const wasRestoredRef = useRef(
        !!handScanResultSnapshot &&
            handScanResultSnapshot.leftScanId === (leftScanId ?? null) &&
            handScanResultSnapshot.rightScanId === (rightScanId ?? null),
    )
    const snapshot = wasRestoredRef.current ? handScanResultSnapshot : null

    const [leftResult, setLeftResult] = useState<ScanResultResponse | null>(snapshot?.leftResult ?? null)
    const [rightResult, setRightResult] = useState<ScanResultResponse | null>(snapshot?.rightResult ?? null)
    const [isLoading, setIsLoading] = useState(!wasRestoredRef.current)
    const [error, setError] = useState<string | null>(null)
    const [showFingerModal, setShowFingerModal] = useState(false)
    const [selectedShape, setSelectedShape] = useState<string>(snapshot?.selectedShape ?? 'round')
    const [isGeneratingStl, setIsGeneratingStl] = useState(false)
    const [printModalStep, setPrintModalStep] = useState<'confirm' | 'done' | null>(null)
    const [printConfirmed, setPrintConfirmed] = useState(snapshot?.printConfirmed ?? false)
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
            const combinedShape = pickHandField('shape', leftRes, rightRes)
            if (combinedShape) setSelectedShape(combinedShape)

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

    // 분석 결과를 기다리는 동안 페이지를 벗어나면 분석이 완료되지 않아 결과가 저장되지 않고
    // 손 촬영을 다시 해야 하므로, 새로고침/탭 닫기와 브라우저 뒤로가기 모두 경고로 막는다.
    useEffect(() => {
        if (!isAnalyzing) return

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault()
            e.returnValue = '' // 커스텀 문구는 브라우저 정책상 표시되지 않고 기본 확인창만 뜬다
        }
        window.addEventListener('beforeunload', handleBeforeUnload)
        return () => window.removeEventListener('beforeunload', handleBeforeUnload)
    }, [isAnalyzing])

    useEffect(() => {
        if (!isAnalyzing) return

        window.history.pushState(null, '', window.location.href)

        const handlePopState = () => {
            const confirmed = window.confirm(
                '지금 나가면 분석이 완료되지 않아 결과가 저장되지 않아요. 손 촬영을 다시 진행해야 해요. 그래도 나가시겠어요?',
            )
            if (confirmed) {
                window.removeEventListener('popstate', handlePopState)
                window.history.back()
            } else {
                window.history.pushState(null, '', window.location.href)
            }
        }

        window.addEventListener('popstate', handlePopState)
        return () => window.removeEventListener('popstate', handlePopState)
    }, [isAnalyzing])

    // 분석 결과·선택한 쉐입·출력 신청 상태를 모듈 스코프 스냅샷에 반영해 둔다.
    // 다른 페이지로 이동했다가(디자인 채팅 등) 돌아와도 위 useState 초기값이 여기서 복원된다.
    useEffect(() => {
        handScanResultSnapshot = {
            leftScanId: leftScanId ?? null,
            rightScanId: rightScanId ?? null,
            leftResult,
            rightResult,
            selectedShape,
            printConfirmed,
            userName,
        }
    }, [leftScanId, rightScanId, leftResult, rightResult, selectedShape, printConfirmed, userName])

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

    // 요청한 손이 전부 FAILED로 끝났으면 — 측정이 하나도 안 된 상태이므로
    // Mock 값으로 채운 화면을 "정상 완료"처럼 보여주면 안 된다.
    const leftFailed = !leftScanId || leftResult?.status === 'FAILED'
    const rightFailed = !rightScanId || rightResult?.status === 'FAILED'
    const scanFailed = !isLoading && leftFailed && rightFailed && !!(leftScanId || rightScanId)

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

    const handleOpenPrintConfirm = () => {
        if (printConfirmed || isGeneratingStl) return
        setPrintModalStep('confirm')
    }

    const handleClosePrintModal = () => {
        if (isGeneratingStl) return
        setPrintModalStep(null)
    }

    const handleConfirmPrint = async () => {
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
            setPrintModalStep('done')
        } catch (e) {
            const msg = e instanceof ApiError ? e.message : 'STL 생성 요청에 실패했습니다.'
            alert(msg)
        } finally {
            setIsGeneratingStl(false)
        }
    }

    if (!leftScanId && !rightScanId) {
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

    if (error) {
        return (
            <AppShell>
                <PageBackLink to="/scan/hand" label="손 촬영" />
                <div className="scan-result-empty">
                    <p>{error}</p>
                    <button type="button" className="scan-result-cta" onClick={() => navigate('/scan/hand')}>
                        손 촬영하러 가기
                    </button>
                </div>
            </AppShell>
        )
    }

    const recommended = result ? getNailShape(result.shape) : null
    const seasonRow = result ? SEASON_ROWS.find(r => r.code === result.seasonCode) : undefined
    const personalColorSwatches = result?.seasonCode ? (PERSONAL_COLOR_SWATCHES[result.seasonCode] ?? []) : []

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

    if (scanFailed) {
        return (
            <AppShell mainClassName="scan-result-page">
                {fromMypage
                    ? <PageBackLink to="/mypage" label="손 분석 기록" state={{ tab: 'scan' }} />
                    : <PageBackLink to="/scan/hand" label="손 촬영" />
                }

                <header className="scan-result-hero">
                    <p className="scan-result-hero__eyebrow">Hand Scan Analysis</p>
                    <h1>손 스캔 분석 실패</h1>
                    <p>
                        손톱 측정에 실패했어요. 마커가 잘 보이도록 다시 촬영해 주세요.
                        (조명, 초점, 마커가 프레임 안에 온전히 들어왔는지 확인해 주세요.)
                    </p>
                </header>

                <div style={{ padding: '2rem 0' }}>
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
            {fromMypage
                ? <PageBackLink to="/mypage" label="손 분석 기록" state={{ tab: 'scans' }} />
                : <PageBackLink to="/scan/hand" label="손 촬영" />
            }

            <header className="scan-result-hero">
                <p className="scan-result-hero__eyebrow">Hand Scan Analysis</p>
                <h1>손 스캔 분석 결과</h1>
                <p>{isLoading ? '분석중...' : '손 스캔이 완료되었습니다.'}</p>
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

            {isLoading ? (
                <section className="scan-result-section scan-result-section--grid" aria-hidden="true">
                    <article className="scan-tone-card scan-tone-card--skeleton">
                        <h2>퍼스널 컬러</h2>
                        <p className="scan-tone-card__hex" style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                            분석중...
                        </p>
                    </article>
                    <article className="scan-season-card scan-season-card--skeleton">
                        <h2>추천 컬러</h2>
                        <div className="scan-palette">
                            {Array.from({ length: 8 }).map((_, i) => (
                                <span key={i} className="scan-palette__chip scan-palette__chip--skeleton" />
                            ))}
                        </div>
                    </article>
                </section>
            ) : (
                result?.seasonCode && (
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
                )
            )}

    {isLoading ? (
        <section className="scan-result-section" aria-hidden="true">
            <h2>네일팁 모양 선택</h2>
            <p className="scan-result-section__sub">분석중...</p>
            <div className="scan-shape-grid">
                {NAIL_SHAPES.map((shape) => (
                    <article key={shape.id} className="scan-shape-card scan-shape-card--skeleton">
                        <div className="scan-shape-card__img-skeleton" />
                        <h3>&nbsp;</h3>
                        <p>&nbsp;</p>
                    </article>
                ))}
            </div>
        </section>
    ) : (
        <section className="scan-result-section">
            <div className="scan-result-section__head">
                <h2>네일팁 모양 선택</h2>
                <button
                    type="button"
                    className="scan-shape-print-btn"
                    onClick={handleOpenPrintConfirm}
                    disabled={printConfirmed || isGeneratingStl}
                >
                    {printConfirmed ? '출력 신청 완료 ✓' : '네일팁 출력하기'}
                </button>
            </div>
            <p className="scan-result-section__sub">
                {recommended ? (
                    <>추천 쉐입은 <strong>{recommended.labelKo}</strong>입니다. 원하는 모양을 선택해 주세요.</>
                ) : (
                    <>AI가 추천 쉐입을 분석하고 있어요. 분석이 끝나면 자동으로 추천 배지가 표시됩니다. 먼저 원하는 모양을 선택해 주세요.</>
                )}
            </p>
            <div className={`scan-shape-grid ${printConfirmed ? 'is-locked' : ''}`}>
                {NAIL_SHAPES.map((shape) => {
                    const isRecommended = !!result && shape.id === result.shape
                    const isSelected = shape.id === selectedShape
                    return (
                        <article
                            key={shape.id}
                            className={`scan-shape-card ${isRecommended ? 'is-recommended' : ''} ${isSelected ? 'is-selected' : ''} ${printConfirmed ? 'is-locked' : ''}`}
                            onClick={() => {
                                if (printConfirmed) return
                                setSelectedShape(shape.id)
                            }}
                            role="button"
                            tabIndex={printConfirmed ? -1 : 0}
                            onKeyDown={(e) => {
                                if (printConfirmed) return
                                if (e.key === 'Enter') setSelectedShape(shape.id)
                            }}
                            aria-pressed={isSelected}
                            aria-disabled={printConfirmed}
                        >
                            {isRecommended && (
                                <span className="scan-shape-card__badge scan-shape-card__badge--recommend">추천</span>
                            )}
                            {isSelected && (
                                <span className="scan-shape-card__badge scan-shape-card__badge--selected">선택</span>
                            )}
                            <img src={shape.image} alt={shape.labelKo} />
                            <h3>{shape.labelKo}</h3>
                            <p>{shape.labelEn}</p>
                        </article>
                    )
                })}
            </div>
        </section>
    )}

            <div className="scan-result-actions">
            <button
            type="button"
            className="scan-result-next"
            onClick={handleGoToDesign}
            >
            다음 단계로
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
            d="M5 12h12M13 6l6 6-6 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            />
        </svg>
</button>
</div>

            {showFingerModal && apiFingers.length > 0 && (
                <FingerDetailModal fingers={fingerDetails} onClose={() => setShowFingerModal(false)} />
            )}

            {printModalStep && createPortal(
                <div className="print-modal">
                    <button
                        type="button"
                        className="print-modal__backdrop"
                        onClick={handleClosePrintModal}
                        disabled={isGeneratingStl}
                    />
                    <div className="print-modal__panel" role="dialog" aria-modal="true">
                        {printModalStep === 'confirm' ? (
                            <>
                                <span className="print-modal__icon-badge" aria-hidden="true">{PrinterIcon}</span>
                                <h2>네일팁 출력 안내</h2>
                                <p>
                                    {userName || '회원'} 님의 손 스캔 정보를 기반으로 만든
                                    <br />
                                    <strong>{getNailShape(selectedShape)?.labelKo ?? selectedShape} 네일팁이 3D 프린터로 출력</strong>됩니다.
                                    <br />
                                    출력을 진행하시겠습니까?
                                </p>
                                <div className="print-modal__actions">
                                    <button
                                        type="button"
                                        className="print-modal__btn print-modal__btn--ghost"
                                        onClick={handleClosePrintModal}
                                        disabled={isGeneratingStl}
                                    >
                                        취소
                                    </button>
                                    <button
                                        type="button"
                                        className="print-modal__btn"
                                        onClick={() => void handleConfirmPrint()}
                                        disabled={isGeneratingStl}
                                    >
                                        {isGeneratingStl ? '출력 요청 중...' : '출력하기'}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <span className="print-modal__icon-badge print-modal__icon-badge--success" aria-hidden="true">
                                  {CheckIcon}
                                </span>
                                <h2>출력 신청 완료</h2>
                                <p>
                                    당신의 네일팁이{' '}
                                    <br />
                                    <strong>{getNailShape(selectedShape)?.labelKo ?? selectedShape}</strong>
                                    {' '}(으)로 출력 신청되었습니다.
                                    <br />
                                    <br />
                                    출력을 기다리는 동안 다음 단계로 넘어가
                                    <br />
                                    네일 디자인을 생성해 보세요!
                                </p>
                                <button
                                    type="button"
                                    className="print-modal__btn"
                                    onClick={handleClosePrintModal}
                                >
                                    확인
                                </button>
                            </>
                        )}
                    </div>
                </div>,
                document.body,
            )}
        </AppShell>
    )
}