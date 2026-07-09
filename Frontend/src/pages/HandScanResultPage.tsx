import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { PageBackLink } from '@/components/layout/PageBackLink'
import { FingerDetailModal } from '@/components/handScan/FingerDetailModal'
import { getNailShape, NAIL_SHAPES } from '@/constants/nailShapes'
import { addNailTipPrintOrder } from '@/utils/mypageStorage'
import { getScanResult, generateStl, type ScanResultResponse } from '@/api/scan'
import { ApiError } from '@/utils/apiClient'
import { PERSONAL_COLOR_SWATCHES, SEASON_ROWS } from '@/constants/designPreferences'
import '@/styles/hand-scan-result.css'

function MetricCard({ title, value, hint }: { title: string; value: string; hint: string }) {
    return (
        <article className="scan-metric-card">
            <h3>{title}</h3>
            <p className="scan-metric-card__value">{value}</p>
            <p className="scan-metric-card__hint">{hint}</p>
        </article>
    )
}

export function HandScanResultPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const scanId = (location.state as { scanId?: number })?.scanId
    const fromMypage = !!(location.state as { fromMypage?: boolean } | null)?.fromMypage

    const [result, setResult] = useState<ScanResultResponse | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [showFingerModal, setShowFingerModal] = useState(false)
    const [selectedShape, setSelectedShape] = useState<string>('round')
    const [isGeneratingStl, setIsGeneratingStl] = useState(false)
    const [showPrintModal, setShowPrintModal] = useState(false)
    const [printConfirmed, setPrintConfirmed] = useState(false)

    useEffect(() => {
        if (!scanId) return

        const fetchResult = async (): Promise<string | null> => {
            try {
                const data = await getScanResult(scanId)
                console.log("status =", data.status)
                setResult(data)
                if (data.shape) setSelectedShape(data.shape)
                return data.status
            } catch (e) {
                const msg = e instanceof ApiError ? e.message : '오류가 발생했습니다.'
                setError(msg)
                return null
            } finally {
                setIsLoading(false)
            }
        }

        const poll = async () => {
            const status = await fetchResult()
            if (status !== null && status !== 'MEASURED' && status !== 'COMPLETED' && status !== 'FAILED') {
                setTimeout(() => void poll(), 3000)
            }
        }

        void poll()
    }, [scanId, fromMypage])

    const handleGoToDesign = () => {
        navigate('/design/preferences', {
            state: { scanId, seasonCode: result?.seasonCode ?? null },
        })
    }

    const handleGenerateStl = async () => {
        if (!scanId) return
        setIsGeneratingStl(true)
        try {
            await generateStl(scanId, selectedShape)
            const shapeLabelKo = getNailShape(selectedShape)?.labelKo ?? selectedShape
            addNailTipPrintOrder({ shapeId: selectedShape, shapeLabelKo })
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

    if (!scanId || !result || error) {
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
                    {result.fingers.length > 0 && (
                        <button type="button" className="scan-result-link" onClick={() => setShowFingerModal(true)}>
                            상세보기
                        </button>
                    )}
                </div>
                <div className="scan-result-metrics">
                    <MetricCard title="전체 크기" value={result.overallSize ?? '-'} hint="손톱 전체 크기 분류" />
                    <MetricCard title="손 방향" value={result.handSide === 'RIGHT' ? '오른손' : '왼손'} hint="촬영한 손 방향" />
                    <MetricCard title="분석 상태" value={result.status} hint="현재 분석 진행 상태" />
                </div>
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
                    추천 쉐입은 <strong>{recommended?.labelKo ?? result.shape}</strong>입니다. 원하는 모양을 선택해 주세요.
                </p>
                <div className="scan-shape-grid">
                    {NAIL_SHAPES.map((shape) => {
                        const isRecommended = shape.id === result.shape
                        const isSelected = shape.id === selectedShape
                        return (
                            <article
                                key={shape.id}
                                className={`scan-shape-card ${isSelected ? 'is-recommended' : ''} ${isSelected ? 'is-selected' : ''}`}
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

            {showFingerModal && result.fingers.length > 0 && (
                <FingerDetailModal fingers={result.fingers as never} onClose={() => setShowFingerModal(false)} />
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