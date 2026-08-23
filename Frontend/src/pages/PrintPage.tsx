import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { PageHero } from '@/components/layout/PageHero'
import { ScanDetailModal } from '@/components/mypage/ScanDetailModal'
import { PillButton } from '@/components/common/PillButton'
import { WarningIcon } from '@/components/icons/WarningIcon'
import { getMyScans, generateStl } from '@/apis/scan'
import { createPrintOrder } from '@/apis/prints'
import { getMyProfile } from '@/apis/user'
import { getNailShape, NAIL_SHAPES } from '@/constants/nailShapes'
import { useLeaveWarning } from '@/hooks/useLeaveWarning'
import { useSnapshotRestore } from '@/hooks/useSnapshotRestore'
import { ApiError } from '@/utils/apiClient'
import { AUTH_CHANGE_EVENT } from '@/utils/auth'
import {
    buildScanSessions,
    formatMetricCurve,
    isFullyAnalyzedSession,
    type ScanSession,
} from '@/utils/scanDetail'
import { analyzeSkinTone } from '@/utils/skinTone'
import '@/styles/hand-scan-result.css'
import '@/styles/print.css'
import '@/styles/mypage.css'

type LocationState = {
    leftScanId?: number | null
    rightScanId?: number | null
} | null

const SESSIONS_PAGE_SIZE = 5

// 출력 신청을 완료한 뒤 다른 페이지로 갔다가(뒤로가기 포함) 돌아와도 선택 상태가
// 초기화되지 않도록, HandScanResultPage와 동일하게 모듈 스코프 스냅샷에 저장해 둔다.
// 이게 없으면 컴포넌트가 다시 마운트될 때 아래 초기 선택 로직이 selectedShape를
// 추천 쉐입으로 되돌려버려서, 사용자가 고른 쉐입 위로 "추천" 배지가 옮겨간 것처럼 보이는 버그가 있었다.
type PrintPageSnapshot = {
    selectedKey: string | null
    selectedShape: string | null
    printConfirmed: boolean
    sessionPage: number
    printModalStep: 'confirm' | 'done' | null
    detailSessionKey: string | null
}

let printPageSnapshot: PrintPageSnapshot | null = null

// 로그인/로그아웃(계정 전환)이 일어나면 이전 계정의 선택 상태가 다음 계정에게 보이지
// 않도록 스냅샷을 비운다. 실제 서버에 저장된 이력/출력 신청은 계정별로 분리되어 있어 영향 없음.
window.addEventListener(AUTH_CHANGE_EVENT, () => {
    printPageSnapshot = null
})

const ChevronLeftIcon = (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="m15 6-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
)
const ChevronRightIcon = (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
)

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

    // 브라우저 뒤로/앞으로가기(POP)로 돌아온 경우에만 이전 선택 상태를 복원한다.
    // 앱 안의 링크/버튼으로 들어온 경우엔 항상 처음부터 새로 시작한다.
    const snapshot = useSnapshotRestore(printPageSnapshot, () => {
        printPageSnapshot = null
    })
    const wasRestoredRef = useRef(!!snapshot)

    const [isLoading, setIsLoading] = useState(true)
    const [sessions, setSessions] = useState<ScanSession[]>([])
    const [selectedKey, setSelectedKey] = useState<string | null>(snapshot?.selectedKey ?? null)
    const [selectedShape, setSelectedShape] = useState<string | null>(snapshot?.selectedShape ?? null)
    const [detailSession, setDetailSession] = useState<ScanSession | null>(null)
    const [userName, setUserName] = useState('')
    const [sessionPage, setSessionPage] = useState(snapshot?.sessionPage ?? 1)

    const [printModalStep, setPrintModalStep] = useState<'confirm' | 'done' | null>(snapshot?.printModalStep ?? null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [printConfirmed, setPrintConfirmed] = useState(snapshot?.printConfirmed ?? false)

    // 선택 상태를 모듈 스코프 스냅샷에 반영해 둔다 — 뒤로가기로 돌아왔을 때 복원된다.
    useEffect(() => {
        printPageSnapshot = {
            selectedKey,
            selectedShape,
            printConfirmed,
            sessionPage,
            printModalStep,
            detailSessionKey: detailSession?.key ?? null,
        }
    }, [selectedKey, selectedShape, printConfirmed, sessionPage, printModalStep, detailSession])

    // 출력 신청을 완료한 뒤에만 경고한다 — 그 전(기록/쉐입을 고르는 중)에는 언제든 자유롭게
    // 나갈 수 있어야 한다. 뒤로가기는 여기서도 그대로 허용(스냅샷이 복원해줌). 새로고침/탭
    // 닫기/헤더 내비게이션 등으로 벗어나려 할 때만 경고하고, 그래도 나가면 스냅샷을 비워서
    // 다음엔 처음부터 다시 고르게 한다.
    useLeaveWarning(
        printConfirmed,
        '지금 나가면 화면 내용이 초기화돼요. 출력 신청 내역은 마이페이지에서 확인할 수 있어요. 그래도 나가시겠어요?',
        () => {
            printPageSnapshot = null
        },
    )

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

                // 스냅샷으로 복원된 경우엔 이미 선택 상태가 있으므로 추천값으로 덮어쓰지 않는다.
                if (wasRestoredRef.current) {
                    if (snapshot?.detailSessionKey) {
                        const match = completed.find((s) => s.key === snapshot.detailSessionKey)
                        if (match) setDetailSession(match)
                    }
                    return
                }

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
                    setSelectedShape(initial.recommendedShape ?? initial.shape ?? 'round')
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

    const sessionTotalPages = Math.max(1, Math.ceil(sessions.length / SESSIONS_PAGE_SIZE))
    const sessionCurrentPage = Math.min(sessionPage, sessionTotalPages)
    const pagedSessions = sessions.slice(
        (sessionCurrentPage - 1) * SESSIONS_PAGE_SIZE,
        sessionCurrentPage * SESSIONS_PAGE_SIZE,
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
        setSelectedShape(session.recommendedShape ?? session.shape ?? 'round')
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
            await Promise.all([
                leftScanId ? generateStl(leftScanId, selectedShape) : Promise.resolve(),
                rightScanId ? generateStl(rightScanId, selectedShape) : Promise.resolve(),
            ])
            const shapeLabelKo = getNailShape(selectedShape)?.labelKo ?? selectedShape
            await createPrintOrder({ shapeId: selectedShape, shapeLabelKo, leftScanId, rightScanId })
            setPrintConfirmed(true)
            setPrintModalStep('done')
        } catch (e) {
            const msg = e instanceof ApiError ? e.message : '출력 신청에 실패했습니다.'
            setSubmitError(msg)
            setPrintModalStep(null)
        } finally {
            setIsSubmitting(false)
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
                <div className="print-page__inner">
                    <div className="print-page__empty">
              <span className="print-page__empty-icon" aria-hidden="true">
                <WarningIcon width={26} height={26} />
              </span>
                        <h2>아직 분석 완료된 손 스캔 기록이 없어요.</h2>
                        <p>먼저 손을 스캔하면 그 결과를 바탕으로 네일팁을 출력할 수 있어요.</p>
                        <PillButton variant="primary" className="print-page__empty-cta" onClick={() => navigate('/scan/hand')}>
                            손 촬영하러 가기
                        </PillButton>
                    </div>
                </div>
            </AppShell>
        )
    }

    return (
        <AppShell mainClassName="print-page">
            <div className="print-page__inner">
                <PageHero
                    eyebrow="Nail Tips Print"
                    title="네일팁 출력"
                    description="원하는 분석 결과와 쉐입을 선택하면 그대로 네일팁을 출력해 드려요."
                />

                <section className="print-page__section">
                    <div className="print-page__section-head">
                        <h2>1. 분석 결과 선택</h2>
                        <span className="print-page__section-count">{sessions.length}개 기록</span>
                    </div>
                    <div className={`print-session-list${printConfirmed ? ' is-locked' : ''}`}>
                        {pagedSessions.map((session) => {
                            const isSelected = session.key === selectedKey
                            const skinHex = session.skinToneHex
                            const toneLabel = skinHex ? analyzeSkinTone(skinHex).tone.label.replace(/\s+/g, '') : '미분석'
                            const shapeLabel = session.recommendedShape
                                ? getNailShape(session.recommendedShape)?.labelKo ?? session.recommendedShape
                                : null
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
                                            style={{ background: skinHex ?? '#de869f' }}
                                            aria-hidden="true"
                                        />
                                        <span className="print-session-card__body">
                        <strong className="print-session-card__date">
                          {formatScanDateLabel(session.scannedAt)}
                        </strong>
                        <span className="print-session-card__season">{toneLabel}</span>
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
                    {sessionTotalPages > 1 && (
                        <div className="mypage-x__pagination">
                            <button
                                type="button"
                                className="mypage-x__page-arrow"
                                disabled={sessionCurrentPage <= 1}
                                onClick={() => setSessionPage((p) => Math.max(1, p - 1))}
                                aria-label="이전 페이지"
                            >
                                {ChevronLeftIcon}
                            </button>
                            <div className="mypage-x__page-numbers">
                                {Array.from({ length: sessionTotalPages }, (_, i) => i + 1).map((pageNum) => (
                                    <button
                                        key={pageNum}
                                        type="button"
                                        className={`mypage-x__page-num${pageNum === sessionCurrentPage ? ' is-active' : ''}`}
                                        onClick={() => setSessionPage(pageNum)}
                                        aria-current={pageNum === sessionCurrentPage ? 'page' : undefined}
                                    >
                                        {pageNum}
                                    </button>
                                ))}
                            </div>
                            <button
                                type="button"
                                className="mypage-x__page-arrow"
                                disabled={sessionCurrentPage >= sessionTotalPages}
                                onClick={() => setSessionPage((p) => Math.min(sessionTotalPages, p + 1))}
                                aria-label="다음 페이지"
                            >
                                {ChevronRightIcon}
                            </button>
                        </div>
                    )}
                </section>

                <section className="print-page__section">
                    <div className="print-page__section-head">
                        <h2>2. 네일팁 쉐입 선택</h2>
                    </div>
                    <p className="print-page__section-sub">
                        {selectedSession?.recommendedShape ? (
                            <>
                                선택한 기록의 추천 쉐입은{' '}
                                <strong>{getNailShape(selectedSession.recommendedShape)?.labelKo ?? selectedSession.recommendedShape}</strong>입니다.
                                원하는 모양을 선택해 주세요.
                            </>
                        ) : (
                            <>원하는 네일팁 모양을 선택해 주세요.</>
                        )}
                    </p>
                    <div className={`scan-shape-grid ${printConfirmed ? 'is-locked' : ''}`}>
                        {NAIL_SHAPES.map((shape) => {
                            const isRecommended = !!selectedSession?.recommendedShape && shape.id === selectedSession.recommendedShape
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
                                        <span className="scan-shape-card__badge scan-shape-card__badge--recommend">
                                            <svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" aria-hidden="true">
                                                <path d="M12 2.5l2.9 6.02 6.6.85-4.85 4.6 1.27 6.53L12 17.9l-5.92 2.6 1.27-6.53-4.85-4.6 6.6-.85z" />
                                            </svg>
                                            추천
                                        </span>
                                    )}
                                    {isSelected && (
                                        <span className="scan-shape-card__badge scan-shape-card__badge--selected">
                                            <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                <path d="M5 12.5 10 17.5 19 7" />
                                            </svg>
                                            선택
                                        </span>
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
                                    <strong> {selectedShape ? getNailShape(selectedShape)?.labelKo ?? selectedShape : ''} </strong>
                                    네일팁이 3D 프린터로 출력됩니다.
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
                                <h2>출력 신청 완료</h2>
                                <p>
                                    당신의 네일팁이{' '}
                                    <br />
                                    <strong>{selectedShape ? getNailShape(selectedShape)?.labelKo ?? selectedShape : ''}</strong>
                                    {' '}(으)로 출력 신청되었습니다.
                                    <br />
                                    <br />
                                    출력을 기다리는 동안 다음 단계로 넘어가
                                    <br />
                                    네일 디자인을 생성해 보세요!
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