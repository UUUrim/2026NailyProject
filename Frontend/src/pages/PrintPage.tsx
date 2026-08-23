import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { PageBackLink } from '@/components/layout/PageBackLink'
import { ScanDetailModal } from '@/components/mypage/ScanDetailModal'
import { getMyScans, generateStl, getScanResult } from '@/apis/scan'
import { createPrintOrder } from '@/apis/prints'
import { getMyProfile } from '@/apis/user'
import { getNailShape, NAIL_SHAPES } from '@/constants/nailShapes'
import { ApiError } from '@/utils/apiClient'
import {
    buildScanSessions,
    formatMetricCurve,
    isFullyAnalyzedSession,
    representativePersonalColor,
    type ScanSession,
} from '@/utils/scanDetail'
import '@/styles/hand-scan-result.css'
import '@/styles/print.css'

type LocationState = {
    leftScanId?: number | null
    rightScanId?: number | null
} | null

const STL_POLL_INTERVAL_MS = 1500
const STL_POLL_TIMEOUT_MS = 60000

/** scanId의 상태가 STL 생성 완료(COMPLETED)될 때까지 폴링 대기 */
async function waitForStlReady(scanId: number): Promise<void> {
    const deadline = Date.now() + STL_POLL_TIMEOUT_MS
    while (Date.now() < deadline) {
        const result = await getScanResult(scanId)
        if (result.status === 'COMPLETED') return
        if (result.status === 'FAILED') {
            throw new Error('STL 생성에 실패했습니다.')
        }
        await new Promise((resolve) => setTimeout(resolve, STL_POLL_INTERVAL_MS))
    }
    throw new Error('STL 생성이 너무 오래 걸려 시간 초과되었습니다.')
}

function formatScanDateLabel(raw: string): string {
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return ''
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
}

// 마이페이지에서 쓰는 프린터 아이콘과 통일
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

// "완료됐다"가 한눈에 들어오도록 두꺼운 체크 + 원형 뱃지
const CheckIcon = (
    <svg viewBox="0 0 24 24" fill="none" width="28" height="28">
        <path d="M5 12.5 10 17.5 19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
)

export function PrintPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const preselect = (location.state as LocationState) ?? null

    const [isLoading, setIsLoading] = useState(true)
    const [sessions, setSessions] = useState<ScanSession[]>([])
    const [selectedKey, setSelectedKey] = useState<string | null>(null)
    const [selectedShape, setSelectedShape] = useState<string | null>(null)
    const [detailSession, setDetailSession] = useState<ScanSession | null>(null)
    const [userName, setUserName] = useState('')

    const [printModalStep, setPrintModalStep] = useState<'confirm' | 'done' | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [printConfirmed, setPrintConfirmed] = useState(false)

    useEffect(() => {
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
        let cancelled = false
        setIsLoading(true)
        void getMyScans()
            .then((scans) => {
                if (cancelled) return
                const completed = buildScanSessions(scans).filter(isFullyAnalyzedSession)
                setSessions(completed)

                // 이전 화면(재스캔 안내 카드 등)에서 특정 스캔을 지정해 넘어온 경우 그 기록을 우선 선택
                const preselected = preselect
                    ? completed.find(
                        (s) =>
                            (preselect.leftScanId != null && s.leftScanId === preselect.leftScanId) ||
                            (preselect.rightScanId != null && s.rightScanId === preselect.rightScanId),
                    )
                    : null
                const initial = preselected ?? completed[0] ?? null
                if (initial) {
                    setSelectedKey(initial.key)
                    setSelectedShape(initial.shape ?? 'round')
                }
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false)
            })
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const selectedSession = useMemo(
        () => sessions.find((s) => s.key === selectedKey) ?? null,
        [sessions, selectedKey],
    )

    const handleGoToDesign = () => {
        if (!selectedSession) return
        navigate('/design/chat', {
            state: {
                scanId: selectedSession.leftScanId ?? selectedSession.rightScanId ?? null,
                leftScanId: selectedSession.leftScanId,
                rightScanId: selectedSession.rightScanId,
                seasonCode: selectedSession.seasonCode ?? null,
            },
        })
    }

    const handleSelectSession = (session: ScanSession) => {
        if (printConfirmed) return
        setSelectedKey(session.key)
        // 기록을 바꾸면 그 기록의 추천 쉐입으로 다시 맞춰준다 (사용자가 이미 직접 고른 경우는 유지해도 되지만,
        // 기록마다 손 형태가 다를 수 있어 추천값으로 리셋하는 편이 안전함)
        setSelectedShape(session.shape ?? 'round')
    }

    const handleOpenPrintConfirm = () => {
        if (!selectedSession || !selectedShape || isSubmitting || printConfirmed) return
        setSubmitError(null)
        setPrintModalStep('confirm')
    }

    const handleClosePrintModal = () => {
        if (isSubmitting) return
        setPrintModalStep(null)
    }

    const handleConfirmPrint = async () => {
        if (!selectedSession || !selectedShape) return
        setIsSubmitting(true)
        setSubmitError(null)
        try {
            const { leftScanId, rightScanId } = selectedSession
            // STL 생성 요청만 접수하고 바로 사용자에게 "접수됨"을 보여준다.
            // 실제 생성 완료 후 병합(createPrintOrder)은 백그라운드에서 처리한다
            // (완료를 여기서 기다리게 하면 사용자가 몇십 초씩 화면에 묶여있어야 함).
            await Promise.all([
                leftScanId ? generateStl(leftScanId, selectedShape) : Promise.resolve(),
                rightScanId ? generateStl(rightScanId, selectedShape) : Promise.resolve(),
            ])
            setPrintConfirmed(true)
            setPrintModalStep('done')
            void finalizePrintOrderInBackground(leftScanId, rightScanId, selectedShape)
        } catch (e) {
            const msg = e instanceof ApiError ? e.message : '출력 신청에 실패했습니다.'
            setSubmitError(msg)
            setPrintModalStep(null)
        } finally {
            setIsSubmitting(false)
        }
    }

    /** STL 생성 완료를 기다렸다가 실제 출력 주문(병합)을 넣는다. 모달이 닫힌 뒤에도 계속 진행됨. */
    const finalizePrintOrderInBackground = async (
        leftScanId: number | null | undefined,
        rightScanId: number | null | undefined,
        shape: string,
    ) => {
        try {
            await Promise.all([
                leftScanId ? waitForStlReady(leftScanId) : Promise.resolve(),
                rightScanId ? waitForStlReady(rightScanId) : Promise.resolve(),
            ])
            const shapeLabelKo = getNailShape(shape)?.labelKo ?? shape
            await createPrintOrder({ shapeId: shape, shapeLabelKo, leftScanId, rightScanId })
        } catch (e) {
            console.error('[Print] 출력 준비 중 오류:', e)
            alert('출력 준비 중 문제가 발생했습니다. 마이페이지에서 다시 확인해주세요.')
        }
    }

    if (isLoading) {
        return (
            <AppShell mainClassName="print-page">
                <div className="print-page__loading">분석 기록을 불러오는 중...</div>
            </AppShell>
        )
    }

    if (sessions.length === 0) {
        return (
            <AppShell mainClassName="print-page">
                <PageBackLink to="/process" />
                <div className="print-page__inner">
                    <div className="print-page__empty">
              <span className="print-page__empty-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
                  <rect x="3" y="7" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M17 10.5l4-2.2v9.4l-4-2.2" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                  <circle cx="10" cy="12.5" r="2.4" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              </span>
                        <h2>아직 분석 완료된 손 스캔 기록이 없어요.</h2>
                        <p>먼저 손을 스캔하면 그 결과를 바탕으로 네일팁을 출력할 수 있어요.</p>
                        <button type="button" className="print-page__empty-cta" onClick={() => navigate('/scan/hand')}>
                            손 촬영하러 가기
                        </button>
                    </div>
                </div>
            </AppShell>
        )
    }

    return (
        <AppShell mainClassName="print-page">
            <PageBackLink to="/process" />

            <div className="print-page__inner">
                <header className="print-page__hero">
                    <p className="print-page__eyebrow">Print</p>
                    <h1>네일팁 출력하기</h1>
                    <p>기존 분석 결과와 원하는 쉐입을 선택하면 그대로 네일팁을 출력해드려요.</p>
                </header>


                <section className="print-page__section">
                    <div className="print-page__section-head">
                        <h2>1. 분석 결과 선택</h2>
                        <span className="print-page__section-count">{sessions.length}개 기록</span>
                    </div>
                    <div className={`print-session-list${printConfirmed ? ' is-locked' : ''}`}>
                        {sessions.map((session) => {
                            const isSelected = session.key === selectedKey
                            const repColor = representativePersonalColor(session.seasonCode)
                            const shapeLabel = session.shape ? getNailShape(session.shape)?.labelKo ?? session.shape : null
                            const metricsLine = [
                                `길이 ${session.avgLengthMm != null ? `${Number(session.avgLengthMm).toFixed(1)}mm` : '-'}`,
                                `너비 ${session.avgWidthMm != null ? `${Number(session.avgWidthMm).toFixed(1).replace(/\.0$/, '')}mm` : '-'}`,
                                `곡률 ${formatMetricCurve(session.avgCurve)}`,
                            ].join(' · ')

                            return (
                                <div key={session.key} className={`print-session-card${isSelected ? ' is-selected' : ''}`}>
                                    <button
                                        type="button"
                                        className="print-session-card__select"
                                        onClick={() => handleSelectSession(session)}
                                        aria-pressed={isSelected}
                                        disabled={printConfirmed}
                                    >
                                        <span className="print-session-card__radio" aria-hidden="true" />
                                        <span
                                            className="print-session-card__swatch"
                                            style={{ background: repColor }}
                                            aria-hidden="true"
                                        />
                                        <span className="print-session-card__body">
                        <strong className="print-session-card__date">
                          {formatScanDateLabel(session.scannedAt)}
                        </strong>
                        <span className="print-session-card__season" style={{ color: repColor }}>
                          {session.seasonNameKo ?? '미분석'}
                        </span>
                        <span className="print-session-card__metrics">{metricsLine}</span>
                        <span className="print-session-card__shape">추천 쉐입: {shapeLabel ?? '미정'}</span>
                      </span>
                                    </button>
                                    <button
                                        type="button"
                                        className="print-session-card__detail-btn"
                                        onClick={() => setDetailSession(session)}
                                    >
                                        상세보기
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                </section>

                <section className="print-page__section">
                    <div className="print-page__section-head">
                        <h2>2. 네일팁 쉐입 선택</h2>
                    </div>
                    <p className="print-page__section-sub">
                        {selectedSession?.shape ? (
                            <>
                                선택한 기록의 추천 쉐입은{' '}
                                <strong>{getNailShape(selectedSession.shape)?.labelKo ?? selectedSession.shape}</strong>입니다.
                                원하는 모양을 선택해 주세요.
                            </>
                        ) : (
                            <>원하는 네일팁 모양을 선택해 주세요.</>
                        )}
                    </p>
                    <div className={`scan-shape-grid ${printConfirmed ? 'is-locked' : ''}`}>
                        {NAIL_SHAPES.map((shape) => {
                            const isRecommended = !!selectedSession?.shape && shape.id === selectedSession.shape
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

                {submitError && <p className="print-page__error">{submitError}</p>}

                <div className="print-page__actions">
                    <button
                        type="button"
                        className={`print-page__submit${printConfirmed ? ' is-done' : ''}`}
                        onClick={handleOpenPrintConfirm}
                        disabled={!selectedSession || !selectedShape || printConfirmed}
                    >
                        {printConfirmed ? '출력 신청 완료 ✓' : '출력 신청하기'}
                    </button>

                    {printConfirmed && (
                        <button
                            type="button"
                            className="print-page__design-cta"
                            onClick={handleGoToDesign}
                        >
                            디자인 생성하러 가기
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path
                                    d="M5 12h12M13 6l6 6-6 6"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            </svg>
                        </button>
                    )}
                </div>
            </div>

            {detailSession && (
                <ScanDetailModal session={detailSession} onClose={() => setDetailSession(null)} />
            )}

            {printModalStep && createPortal(
                <div className="print-modal">
                    <button
                        type="button"
                        className="print-modal__backdrop"
                        onClick={handleClosePrintModal}
                        disabled={isSubmitting}
                    />
                    <div className="print-modal__panel" role="dialog" aria-modal="true">
                        <button
                            type="button"
                            className="print-modal__close"
                            onClick={handleClosePrintModal}
                            disabled={isSubmitting}
                            aria-label="닫기"
                        >
                            ✕
                        </button>
                        {printModalStep === 'confirm' ? (
                            <>
                                <span className="print-modal__icon-badge" aria-hidden="true">{PrinterIcon}</span>
                                <h2>네일팁 출력 안내</h2>
                                <p>
                                    {userName || '회원'} 님의{' '}
                                    {selectedSession ? formatScanDateLabel(selectedSession.scannedAt) : ''} 분석 결과를 기반으로
                                    <br />
                                    <strong>
                                        {selectedShape ? getNailShape(selectedShape)?.labelKo ?? selectedShape : ''} 네일팁이 3D
                                        프린터로 출력
                                    </strong>
                                    됩니다.
                                    <br />
                                    출력을 진행하시겠습니까?
                                </p>
                                <div className="print-modal__actions">
                                    <button
                                        type="button"
                                        className="print-modal__btn print-modal__btn--ghost"
                                        onClick={handleClosePrintModal}
                                        disabled={isSubmitting}
                                    >
                                        취소
                                    </button>
                                    <button
                                        type="button"
                                        className="print-modal__btn"
                                        onClick={() => void handleConfirmPrint()}
                                        disabled={isSubmitting}
                                    >
                                        {isSubmitting ? '출력 요청 중...' : '출력하기'}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                      <span className="print-modal__icon-badge print-modal__icon-badge--success" aria-hidden="true">
                        {CheckIcon}
                      </span>
                                <h2>출력 신청 접수 완료</h2>
                                <p>
                                    당신의 네일팁이{' '}
                                    <br />
                                    <strong>{selectedShape ? getNailShape(selectedShape)?.labelKo ?? selectedShape : ''}</strong>
                                    {' '}(으)로 준비 중이에요.
                                    <br />
                                    완료되면 마이페이지에서 확인하실 수 있어요.
                                </p>
                                <div className="print-modal__actions">
                                    <button
                                        type="button"
                                        className="print-modal__btn print-modal__btn--ghost"
                                        onClick={() => navigate('/mypage', { state: { tab: 'prints' } })}
                                    >
                                        출력 내역 보기
                                    </button>
                                    <button
                                        type="button"
                                        className="print-modal__btn"
                                        onClick={() => {
                                            setPrintModalStep(null)
                                            handleGoToDesign()
                                        }}
                                    >
                                        디자인 생성하러 가기
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>,
                document.body,
            )}
        </AppShell>
    )
}