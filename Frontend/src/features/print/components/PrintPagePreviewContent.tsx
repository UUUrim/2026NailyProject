import { useState } from 'react'
import { AppShell } from '@/shared/layout/AppShell'
import { PageHero } from '@/shared/layout/PageHero'
import { getNailShape, NAIL_SHAPES } from '@/shared/constants/nailShapes'
import {
    formatMetricCurve,
    type ScanSession,
} from '@/shared/utils/scanDetail'
import { analyzeSkinTone, skinToneAnalysisFromMetrics } from '@/shared/utils/skinTone'
import '@/styles/hand-scan-result.css'
import '@/styles/print.css'
import '@/styles/mypage.css'

// ══════════════════════════════════════════════════════════════════════
// 개발용 화면 확인 페이지 — 실제 API를 호출하지 않고 가짜 분석 결과 7건으로
// PrintPage와 동일한 마크업/스타일을 그대로 재사용해서 렌더링한다.
// 페이지네이션(5개 단위) 동작을 확인하려면 6개 이상의 기록이 필요해서 7개를 넣어둠.
// 주소창에 /preview/print 를 직접 입력해서 들어가야 볼 수 있다 (다른 화면에서 링크 없음).
// ══════════════════════════════════════════════════════════════════════

const SESSIONS_PAGE_SIZE = 5

// 1번 기록은 recommendedShape(round)와 shape(oval)를 일부러 다르게 넣어서, 이미 다른 쉐입으로
// 출력 신청을 마친 기록에서도 "추천" 배지가 원래 AI 추천값(round)에 고정되는지 확인할 수 있게 했다.
const MOCK_SESSIONS: ScanSession[] = [
    { key: '1', scannedAt: '2026-08-10T14:20:00', leftScanId: 101, rightScanId: 102, skinToneHex: '#F3D2B8', tone: 'warm', brightness: 0.78, saturation: 0.32, recommendedColors: [], shape: 'oval', recommendedShape: 'round', status: 'COMPLETED', avgLengthMm: 12.4, avgWidthMm: 9.6, avgCurve: 0.58 },
    { key: '2', scannedAt: '2026-08-05T10:05:00', leftScanId: 103, rightScanId: 104, skinToneHex: '#EFC7B0', tone: 'cool', brightness: 0.7, saturation: 0.4, recommendedColors: [], shape: 'oval', recommendedShape: 'oval', status: 'COMPLETED', avgLengthMm: 13.1, avgWidthMm: 9.0, avgCurve: 0.51 },
    { key: '3', scannedAt: '2026-07-28T18:42:00', leftScanId: 105, rightScanId: 106, skinToneHex: '#C89A78', tone: 'warm', brightness: 0.55, saturation: 0.45, recommendedColors: [], shape: 'almond', recommendedShape: 'almond', status: 'COMPLETED', avgLengthMm: 12.9, avgWidthMm: 8.7, avgCurve: 0.63 },
    { key: '4', scannedAt: '2026-07-20T09:15:00', leftScanId: 107, rightScanId: 108, skinToneHex: '#D9AFA0', tone: 'cool', brightness: 0.6, saturation: 0.5, recommendedColors: [], shape: 'stiletto', recommendedShape: 'stiletto', status: 'COMPLETED', avgLengthMm: 14.2, avgWidthMm: 8.2, avgCurve: 0.47 },
    { key: '5', scannedAt: '2026-07-12T16:30:00', leftScanId: 109, rightScanId: 110, skinToneHex: '#F0D0BE', tone: 'warm', brightness: 0.8, saturation: 0.35, recommendedColors: [], shape: 'ballerina', recommendedShape: 'ballerina', status: 'COMPLETED', avgLengthMm: 11.8, avgWidthMm: 10.1, avgCurve: 0.55 },
    { key: '6', scannedAt: '2026-07-01T11:00:00', leftScanId: 111, rightScanId: 112, skinToneHex: '#E4C9BC', tone: 'cool', brightness: 0.68, saturation: 0.3, recommendedColors: [], shape: 'square', recommendedShape: 'square', status: 'COMPLETED', avgLengthMm: 12.0, avgWidthMm: 9.9, avgCurve: 0.44 },
    { key: '7', scannedAt: '2026-06-20T13:50:00', leftScanId: 113, rightScanId: 114, skinToneHex: '#D3A587', tone: 'warm', brightness: 0.58, saturation: 0.42, recommendedColors: [], shape: 'round', recommendedShape: 'round', status: 'COMPLETED', avgLengthMm: 13.5, avgWidthMm: 9.3, avgCurve: 0.60 },
]

function formatScanDateLabel(raw: string): string {
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return ''
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
}

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

const ChevronLeftIcon = (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="m15 6-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
)
const ChevronRightIcon = (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
)

export function PrintPagePreviewContent() {
    const [selectedKey, setSelectedKey] = useState<string | null>(MOCK_SESSIONS[0].key)
    const [selectedShape, setSelectedShape] = useState<string | null>(MOCK_SESSIONS[0].recommendedShape ?? MOCK_SESSIONS[0].shape)
    const [sessionPage, setSessionPage] = useState(1)
    const [printModalStep, setPrintModalStep] = useState<'confirm' | 'done' | null>(null)
    const [printConfirmed, setPrintConfirmed] = useState(false)

    const selectedSession = MOCK_SESSIONS.find((s) => s.key === selectedKey) ?? null

    const sessionTotalPages = Math.max(1, Math.ceil(MOCK_SESSIONS.length / SESSIONS_PAGE_SIZE))
    const sessionCurrentPage = Math.min(sessionPage, sessionTotalPages)
    const pagedSessions = MOCK_SESSIONS.slice(
        (sessionCurrentPage - 1) * SESSIONS_PAGE_SIZE,
        sessionCurrentPage * SESSIONS_PAGE_SIZE,
    )

    const handleSelectSession = (session: ScanSession) => {
        if (printConfirmed) return
        setSelectedKey(session.key)
        setSelectedShape(session.recommendedShape ?? session.shape ?? 'round')
    }

    return (
        <AppShell mainClassName="print-page">
            <div className="print-page__inner">
                <PageHero
                    eyebrow="Print · Preview"
                    title="네일팁 출력 (샘플 데이터)"
                    description={
                        <span style={{ color: '#c96d88', fontWeight: 700 }}>
                            이 화면은 실제 API 없이 가짜 분석 결과 7건으로 스타일만 확인하는 개발용 미리보기입니다.
                        </span>
                    }
                />

                <section className="print-page__section">
                    <div className="print-page__section-head">
                        <h2>1. 분석 결과 선택</h2>
                        <span className="print-page__section-count">{MOCK_SESSIONS.length}개 기록</span>
                    </div>
                    <div className={`print-session-list${printConfirmed ? ' is-locked' : ''}`}>
                        {pagedSessions.map((session) => {
                            const isSelected = session.key === selectedKey
                            const repColor = session.skinToneHex ?? '#de869f'
                            const toneLabel = (
                                skinToneAnalysisFromMetrics(session.tone, session.brightness, session.saturation)?.tone.label ??
                                (session.skinToneHex ? analyzeSkinTone(session.skinToneHex).tone.label : null)
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
                                            style={{ background: repColor }}
                                            aria-hidden="true"
                                        />
                                        <span className="print-session-card__body">
                      <strong className="print-session-card__date">
                        {formatScanDateLabel(session.scannedAt)}
                      </strong>
                      <span className="print-session-card__season" style={{ color: repColor }}>
                        {toneLabel}
                      </span>
                      <span className="print-session-card__metrics">{metricsLine}</span>
                      <span className="print-session-card__shape">추천 쉐입: {shapeLabel ?? '미정'}</span>
                    </span>
                                    </button>
                                    <button type="button" className="print-session-card__detail-btn" disabled>
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

                <div className="print-page__actions">
                    <button
                        type="button"
                        className={`print-page__submit${printConfirmed ? ' is-done' : ''}`}
                        onClick={() => setPrintModalStep('confirm')}
                        disabled={!selectedSession || !selectedShape || printConfirmed}
                    >
                        {printConfirmed ? '출력 신청 완료 ✓' : '출력 신청하기'}
                    </button>

                    {printConfirmed && (
                        <button type="button" className="print-page__design-cta" onClick={() => {}}>
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

            {printModalStep && (
                <div className="print-modal">
                    <button
                        type="button"
                        className="print-modal__backdrop"
                        onClick={() => setPrintModalStep(null)}
                    />
                    <div className="print-modal__panel" role="dialog" aria-modal="true">
                        <button
                            type="button"
                            className="print-modal__close"
                            onClick={() => setPrintModalStep(null)}
                            aria-label="닫기"
                        >
                            ✕
                        </button>
                        {printModalStep === 'confirm' ? (
                            <>
                                <span className="print-modal__icon-badge" aria-hidden="true">{PrinterIcon}</span>
                                <h2>네일팁 출력 안내</h2>
                                <p>
                                    미리보기 회원 님의{' '}
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
                                        onClick={() => setPrintModalStep(null)}
                                    >
                                        취소
                                    </button>
                                    <button
                                        type="button"
                                        className="print-modal__btn"
                                        onClick={() => {
                                            setPrintConfirmed(true)
                                            setPrintModalStep('done')
                                        }}
                                    >
                                        출력하기
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
                                        onClick={() => setPrintModalStep(null)}
                                    >
                                        출력 내역 보기
                                    </button>
                                    <button
                                        type="button"
                                        className="print-modal__btn"
                                        onClick={() => setPrintModalStep(null)}
                                    >
                                        디자인 생성하러 가기
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </AppShell>
    )
}