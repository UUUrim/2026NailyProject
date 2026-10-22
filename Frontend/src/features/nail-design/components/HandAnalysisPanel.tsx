import { WarningIcon } from '@/shared/components/icons/WarningIcon'
import type { HandAnalysisSummary } from '@/features/nail-design/utils/handAnalysisSummary'

// 손 분석 결과 패널 — 사이드바의 "분석 결과 상세 보기"로 채팅 오른쪽에 연다 (좁은 화면에서는 채팅 위에 덮는다).
// 지금 채팅에 반영 중인 기록, 또는 채팅 이력에서 누른 다른 기록의 대표 피부색·추천 컬러·추천 쉐입·손톱 측정값을 보여 준다.
// 다른 기록이면 그 사실을 맨 위에 알리고, 그 기록으로 새 채팅을 열 수 있으면 아래에 '이 기록으로 새 채팅'을 둔다.
export function HandAnalysisPanel({
    userName,
    analysisSummary,
    dateLabel,
    isFixedRecord,
    isOtherRecord,
    isLoading,
    loadFailed,
    onStartChat,
    onClose,
    onGoToScan,
}: {
    userName: string
    analysisSummary: HandAnalysisSummary | null
    // 이 기록의 촬영 날짜 (예: 10월 12일)
    dateLabel: string
    // 손 촬영 → 출력에서 이어 와 이번 촬영 기록에 고정된 채팅인지
    isFixedRecord: boolean
    // 지금 채팅에 반영 중인 기록이 아니라 채팅 이력에서 누른 다른 기록인지
    isOtherRecord: boolean
    isLoading: boolean
    // 다른 기록의 분석 결과를 불러오지 못했는지
    loadFailed: boolean
    // 이 기록으로 새 채팅 (열 수 없는 기록이면 없음)
    onStartChat?: () => void
    onClose: () => void
    onGoToScan: () => void
}) {
    const hasRecord = !!analysisSummary || isLoading || loadFailed
    return (
        <aside className="design-chat-sidebar design-chat-analysis-panel" aria-label="손 분석 결과">
            <div className="design-chat-sidebar__header">
                <div className="design-chat-sidebar__header-main">
                    <p className="design-chat-sidebar__eyebrow">
                        Hand Analysis
                    </p>
                    <div className="design-chat-sidebar__title-row">
                        <h2>{userName ? `${userName}님의 손 분석` : '손 분석 결과'}</h2>
                        {hasRecord && dateLabel && (
                            <span className="design-chat-sidebar__session-static">
                                {dateLabel}
                                {isFixedRecord ? ' 촬영' : ''}
                            </span>
                        )}
                    </div>
                    {/* 지금 채팅의 기록인지, 보기만 하는 다른 기록인지 */}
                    {hasRecord && (
                        <p className={`dcw-panel-status dcw-panel-status--${isOtherRecord ? 'other' : 'current'}`}>
                            <span className="dcw-panel-status__dot" aria-hidden="true" />
                            {isOtherRecord ? '지금 채팅과 다른 분석 기록' : '지금 채팅에 반영 중'}
                        </p>
                    )}
                </div>
                <button type="button" className="design-chat-sidebar__close" aria-label="분석 결과 상세 닫기" onClick={onClose}>
                    ×
                </button>
            </div>

            <div className="design-chat-sidebar__scroll">
                {isLoading ? (
                    <div className="dcw-panel-loading" aria-busy="true" aria-label="분석 결과를 불러오는 중">
                        <span className="dcw-skeleton" />
                        <span className="dcw-skeleton" />
                        <span className="dcw-skeleton" />
                    </div>
                ) : loadFailed ? (
                    <div className="design-chat-sidebar__empty">
                        <span className="design-chat-sidebar__empty-icon" aria-hidden="true">
                            <WarningIcon />
                        </span>
                        <p className="design-chat-sidebar__empty-text">
                            이 분석 기록을 불러오지 못했어요.
                            <br />
                            잠시 후 다시 시도해 주세요.
                        </p>
                    </div>
                ) : !analysisSummary ? (
                    <div className="design-chat-sidebar__empty">
                        <span className="design-chat-sidebar__empty-icon" aria-hidden="true">
                            <WarningIcon />
                        </span>
                        <p className="design-chat-sidebar__empty-text">
                            손 스캔 정보가 없습니다.
                            <br />
                            {userName ? `${userName}님의` : '회원님의'} 손 정보를 바탕으로 맞춤 디자인을 생성하려면,
                            먼저 손을 촬영해 주세요.
                        </p>
                        <button
                            type="button"
                            className="design-chat-sidebar__scan-cta"
                            onClick={onGoToScan}
                        >
                            손 촬영하러 가기
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
                    </div>
                ) : (
                    <>
                        {analysisSummary.skinToneHex && analysisSummary.skinToneAnalysis && (
                            <div className="design-chat-sidebar__card">
                                <span className="design-chat-sidebar__card-label">대표 피부색</span>
                                <div className="design-chat-sidebar__tone-row">
                                    <span
                                        className="design-chat-sidebar__tone-dot"
                                        style={{ background: analysisSummary.skinToneHex }}
                                        aria-hidden="true"
                                    />
                                    <p className="design-chat-sidebar__tone-name">{analysisSummary.skinToneHex}</p>
                                </div>

                                <div className="design-chat-sidebar__tone-bars">
                                    <div className="design-chat-sidebar__tone-bar">
                                        <div className="design-chat-sidebar__tone-bar-head">
                                            <span>베이스</span>
                                            <span>{analysisSummary.skinToneAnalysis.tone.label}</span>
                                        </div>
                                        <div className="design-chat-sidebar__tone-bar-track design-chat-sidebar__tone-bar-track--tone">
                                            <span style={{ left: `${analysisSummary.skinToneAnalysis.tone.percent}%` }} />
                                        </div>
                                    </div>
                                    <div className="design-chat-sidebar__tone-bar">
                                        <div className="design-chat-sidebar__tone-bar-head">
                                            <span>명도</span>
                                            <span>{analysisSummary.skinToneAnalysis.brightness.label}</span>
                                        </div>
                                        <div className="design-chat-sidebar__tone-bar-track design-chat-sidebar__tone-bar-track--brightness">
                                            <span style={{ left: `${analysisSummary.skinToneAnalysis.brightness.percent}%` }} />
                                        </div>
                                    </div>
                                    <div className="design-chat-sidebar__tone-bar">
                                        <div className="design-chat-sidebar__tone-bar-head">
                                            <span>채도 (혈색)</span>
                                            <span>{analysisSummary.skinToneAnalysis.saturation.label}</span>
                                        </div>
                                        <div className="design-chat-sidebar__tone-bar-track design-chat-sidebar__tone-bar-track--saturation">
                                            <span style={{ left: `${analysisSummary.skinToneAnalysis.saturation.percent}%` }} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {analysisSummary.skinTonePalette.length > 0 && (
                            <div className="design-chat-sidebar__card">
                                <span className="design-chat-sidebar__card-label">추천 컬러</span>
                                <div className="design-chat-sidebar__palette">
                                    {analysisSummary.skinTonePalette.map((hex, idx) => (
                                        <span
                                            key={`${hex}-${idx}`}
                                            className="design-chat-sidebar__palette-chip"
                                            style={{ background: hex }}
                                            title={hex}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="design-chat-sidebar__card">
                            <span className="design-chat-sidebar__card-label">추천 네일 쉐입</span>
                            <div className="design-chat-sidebar__shape-row">
                                <p className="design-chat-sidebar__shape-name">{analysisSummary.shapeLabel}</p>
                                {analysisSummary.shapeImage && (
                                    <img
                                        src={analysisSummary.shapeImage}
                                        alt=""
                                        className="design-chat-sidebar__shape-img"
                                    />
                                )}
                            </div>
                        </div>

                        <div className="design-chat-sidebar__card">
                            <span className="design-chat-sidebar__card-label">손톱 측정값 평균</span>
                            <ul className="design-chat-sidebar__metric-list">
                                <li className="design-chat-sidebar__metric-row">
                                    <div className="design-chat-sidebar__metric-top">
                                        <span className="design-chat-sidebar__metric-name">길이</span>
                                        <span className="design-chat-sidebar__metric-value">{analysisSummary.avgLength}mm</span>
                                    </div>
                                    <span className="design-chat-sidebar__metric-bar" aria-hidden="true">
                                        <span style={{ width: `${analysisSummary.lengthPct}%` }} />
                                    </span>
                                    <p className="design-chat-sidebar__metric-compare">{analysisSummary.lengthCompareLabel}</p>
                                </li>
                                <li className="design-chat-sidebar__metric-row">
                                    <div className="design-chat-sidebar__metric-top">
                                        <span className="design-chat-sidebar__metric-name">너비</span>
                                        <span className="design-chat-sidebar__metric-value">{analysisSummary.avgWidth}mm</span>
                                    </div>
                                    <span className="design-chat-sidebar__metric-bar" aria-hidden="true">
                                        <span style={{ width: `${analysisSummary.widthPct}%` }} />
                                    </span>
                                    <p className="design-chat-sidebar__metric-compare">{analysisSummary.widthCompareLabel}</p>
                                </li>
                                <li className="design-chat-sidebar__metric-row">
                                    <div className="design-chat-sidebar__metric-top">
                                        <span className="design-chat-sidebar__metric-name">곡률 (C-curve)</span>
                                        <span className="design-chat-sidebar__metric-value">{analysisSummary.avgCurve}mm</span>
                                    </div>
                                    <span className="design-chat-sidebar__metric-bar" aria-hidden="true">
                                        <span style={{ width: `${analysisSummary.curvePct}%` }} />
                                    </span>
                                    <p className="design-chat-sidebar__metric-compare">{analysisSummary.curveCompareLabel}</p>
                                </li>
                            </ul>
                        </div>
                    </>
                )}
            </div>

            {/* 다른 기록을 보고 마음에 들면 바로 그 기록으로 새 채팅 — 채팅 이력의 + 와 같다 */}
            {onStartChat && analysisSummary && !isLoading && (
                <div className="dcw-panel-footer">
                    <button type="button" className="dcw-panel-start" onClick={onStartChat}>
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="M12 5.5v13M5.5 12h13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                        </svg>
                        이 분석 기록으로 새 채팅
                    </button>
                </div>
            )}
        </aside>
    )
}
