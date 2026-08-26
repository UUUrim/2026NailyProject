import { createPortal } from 'react-dom'
import { AppShell } from '@/shared/layout/AppShell'
import { PageHero } from '@/shared/layout/PageHero'
import { ScanDetailModal } from '@/shared/components/ScanDetailModal'
import { PillButton } from '@/shared/components/PillButton'
import { WarningIcon } from '@/shared/components/icons/WarningIcon'
import { getNailShape, NAIL_SHAPES } from '@/shared/constants/nailShapes'
import { formatMetricCurve } from '@/shared/utils/scanDetail'
import { analyzeSkinTone, skinToneAnalysisFromMetrics } from '@/shared/utils/skinTone'
import { usePrintPage } from '@/features/print/hooks/usePrintPage'
import '@/styles/hand-scan-result.css'
import '@/styles/print.css'
import '@/styles/mypage.css'

function formatScanDateLabel(raw: string): string {
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return ''
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
}

const ChevronLeftIcon = (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="m15 6-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
)
const ChevronRightIcon = (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
)

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

export function PrintPageContent() {
    const {
        navigate,
        isLoading,
        sessions,
        selectedKey,
        selectedShape,
        setSelectedShape,
        detailSession,
        setDetailSession,
        userName,
        setSessionPage,
        printModalStep,
        setPrintModalStep,
        isSubmitting,
        submitError,
        printConfirmed,
        selectedSession,
        sessionTotalPages,
        sessionCurrentPage,
        pagedSessions,
        handleGoToDesign,
        handleSelectSession,
        handleOpenPrintConfirm,
        handleClosePrintModal,
        handleConfirmPrint,
    } = usePrintPage()

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
                            const toneLabel = (
                                skinToneAnalysisFromMetrics(session.tone, session.brightness, session.saturation)?.tone.label ??
                                (skinHex ? analyzeSkinTone(skinHex).tone.label : null)
                            )?.replace(/\s+/g, '') ?? '미분석'
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
                                        onClick={() => navigate('/mypage/prints')}
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