import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { PageBackLink } from '@/components/layout/PageBackLink'
import { FingerDetailModal } from '@/components/handScan/FingerDetailModal'
import { getNailShape, NAIL_SHAPES } from '@/constants/nailShapes'
import '@/styles/hand-scan-result.css'

const API_BASE = '/api'

interface FingerResult {
    finger: string
    imageUrl: string
    stlUrl: string
    measurements: string
    size: string
}

interface ScanResult {
    scanId: number
    handSide: string
    status: string
    shape: string
    skinToneHex: string
    recommendedColors: string[]
    overallSize: string
    fingers: FingerResult[]
    scannedAt: string
}

function MetricCard({
                        title,
                        value,
                        hint,
                    }: {
    title: string
    value: string
    hint: string
}) {
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

    const [result, setResult] = useState<ScanResult | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [showFingerModal, setShowFingerModal] = useState(false)

    useEffect(() => {
        if (!scanId) {
            setIsLoading(false)
            return
        }

        const fetchResult = async () => {
            const token = localStorage.getItem('token')
            try {
                const res = await fetch(`${API_BASE}/scans/${scanId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                })
                if (!res.ok) throw new Error('결과를 불러오는데 실패했습니다.')
                const data = await res.json()
                setResult(data.data)
            } catch (e) {
                setError(e instanceof Error ? e.message : '오류가 발생했습니다.')
            } finally {
                setIsLoading(false)
            }
        }

        void fetchResult()
    }, [scanId])

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

    return (
        <AppShell mainClassName="scan-result-page">
            <PageBackLink to="/scan/hand" label="손 촬영" />

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

            {result.skinToneHex && (
                <section className="scan-result-section scan-result-section--grid">
                    <article className="scan-tone-card">
                        <h2>피부 톤</h2>
                        <div className="scan-tone-card__swatch" style={{ background: result.skinToneHex }} />
                        <p className="scan-tone-card__hex">{result.skinToneHex}</p>
                        <p className="scan-tone-card__desc">손등·손바닥 영역에서 추출한 대표 피부색 HEX 값입니다.</p>
                    </article>

                    {result.recommendedColors && result.recommendedColors.length > 0 && (
                        <article className="scan-season-card">
                            <h2>추천 컬러</h2>
                            <div className="scan-palette">
                                {result.recommendedColors.map((hex) => (
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
                            <p className="scan-season-card__desc">당신에게 어울리는 추천 컬러 팔레트입니다.</p>
                        </article>
                    )}
                </section>
            )}

            {result.shape && (
                <section className="scan-result-section">
                    <h2>추천 네일팁 모양</h2>
                    <p className="scan-result-section__sub">
                        손톱 비율과 곡률을 기준으로 가장 잘 어울리는 쉐입은{' '}
                        <strong>{recommended?.labelKo ?? result.shape}</strong> 입니다.
                    </p>
                    <div className="scan-shape-grid">
                        {NAIL_SHAPES.map((shape) => {
                            const isRecommended = shape.id === result.shape
                            return (
                                <article
                                    key={shape.id}
                                    className={`scan-shape-card ${isRecommended ? 'is-recommended' : ''}`}
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
            )}

            <div className="scan-result-actions">
                <button type="button" className="scan-result-cta" onClick={() => navigate('/design/preferences')}>
                    네일 디자인 생성하기
                </button>
            </div>

            {showFingerModal && result.fingers.length > 0 && (
                <FingerDetailModal fingers={result.fingers as never} onClose={() => setShowFingerModal(false)} />
            )}
        </AppShell>
    )
}