import { useEffect, useState } from 'react'
import { getScanResult } from '@/entities/scan/api'
import { getNailShape } from '@/shared/constants/nailShapes'
import { SHAPE_PREVIEW_IMAGES } from '@/shared/constants/designPreferences'
import { analyzeSkinTone, generateSkinTonePalette, skinToneAnalysisFromMetrics } from '@/shared/utils/skinTone'
import {
  buildScanDetail,
  dateKeyOf,
  formatDateTimeFull,
  formatNavDate,
  type ScanDetail,
  type ScanSession,
} from '@/shared/utils/scanDetail'
import { ScanXModalShell } from '@/shared/components/ScanXModalShell'
import '@/styles/mypage.css'

type Props = {
  session: ScanSession | null
  onClose: () => void
}

const FALLBACK_SKIN_COLOR = '#de869f'

const Icon = {
  design: (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="m8 14 2.5-3 2 2L16 9l2 2.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="9" r="1.1" fill="currentColor" />
    </svg>
  ),
  chevronDown: (
    <svg viewBox="0 0 24 24" fill="none" width="13" height="13">
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  lengthIcon: (
    <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
      <path
        d="M12 4v16M12 4l-3 3.2M12 4l3 3.2M12 20l-3-3.2M12 20l3-3.2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  widthIcon: (
    <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
      <path
        d="M4 12h16M4 12l3.2-3.2M4 12l3.2 3.2M20 12l-3.2-3.2M20 12l-3.2 3.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  curveIcon: (
    <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
      <path
        d="M3.5 14.8c3.2-2.4 6.2-3.2 8.5-3.2s5.3.8 8.5 3.2"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  summaryIcon: (
    <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 7.6v5.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="16.4" r="1.05" fill="currentColor" />
    </svg>
  ),
  palette: (
    <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
      <path
        d="M12 3.5c-4.7 0-8.5 3.4-8.5 8.1 0 3.3 2.2 5.4 4.4 5.4.7 0 1.3-.3 1.7-.8.3-.4.8-.7 1.4-.7h1.1c2.9 0 5.4-2.3 5.4-5.3C17.5 6.4 15.1 3.5 12 3.5z"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinejoin="round"
      />
      <circle cx="8.2" cy="10.2" r="1.05" fill="currentColor" />
      <circle cx="11.1" cy="7.8" r="1.05" fill="currentColor" />
      <circle cx="14.3" cy="8.6" r="1.05" fill="currentColor" />
      <circle cx="15.2" cy="11.8" r="1.05" fill="currentColor" />
    </svg>
  ),
}

export function ScanDetailModal({ session, onClose }: Props) {
  const [detail, setDetail] = useState<ScanDetail | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [fingerDetailOpen, setFingerDetailOpen] = useState(false)
  const [fingerHand, setFingerHand] = useState<'L' | 'R'>('L')
  const [paletteOpen, setPaletteOpen] = useState(false)
  // 클릭으로 고정(핀)된 상태인지 — 핀 되어 있으면 마우스가 벗어나도 안 닫히고,
  // 핀 된 채로 버튼을 다시 클릭하면 마우스가 버튼 위에 있어도 확실히 닫혀야 한다.
  const [palettePinned, setPalettePinned] = useState(false)

  const openPaletteOnHover = () => {
    if (!palettePinned) setPaletteOpen(true)
  }
  const closePaletteOnHover = () => {
    if (!palettePinned) setPaletteOpen(false)
  }
  const togglePaletteClick = () => {
    if (palettePinned) {
      setPalettePinned(false)
      setPaletteOpen(false)
    } else {
      setPalettePinned(true)
      setPaletteOpen(true)
    }
  }

  useEffect(() => {
    if (!session) {
      setDetail(null)
      setIsLoading(false)
      setFingerDetailOpen(false)
      setPaletteOpen(false)
      setPalettePinned(false)
      return
    }

    let cancelled = false
    setDetail(null)
    setFingerDetailOpen(false)
    setFingerHand('L')
    setPaletteOpen(false)
    setPalettePinned(false)
    setIsLoading(true)

    void (async () => {
      try {
        const [left, right] = await Promise.all([
          session.leftScanId ? getScanResult(session.leftScanId).catch(() => null) : Promise.resolve(null),
          session.rightScanId ? getScanResult(session.rightScanId).catch(() => null) : Promise.resolve(null),
        ])
        if (cancelled) return
        const next = buildScanDetail(left, right)
        setDetail(next)
        setFingerHand(next.fingers.some((f) => f.hand === 'L') ? 'L' : 'R')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [session])

  if (!session) return null

  const subtitle = detail
    ? formatDateTimeFull(detail.scannedAt) || formatNavDate(dateKeyOf(detail.scannedAt))
    : null

  return (
    <ScanXModalShell
      ariaLabel="손 분석 상세 결과"
      eyebrow="Hand Analysis"
      title="손 분석 결과"
      subtitle={subtitle}
      onClose={onClose}
    >
      {isLoading || !detail ? (
        <p className="mypage-x__empty">분석 결과를 불러오는 중...</p>
      ) : (() => {
        const skinHex = detail.skinToneHex ?? FALLBACK_SKIN_COLOR
        // scan/skin_color.py가 10손가락 LAB 평균으로 계산해 API에 내려주는 실제 진단값을 우선 쓰고,
        // (구버전 스캔 등) 값이 없을 때만 대표 피부색 hex 하나로 만든 대체 추정치를 쓴다.
        const analysis =
          skinToneAnalysisFromMetrics(detail.tone, detail.warmness, detail.brightness, detail.saturation) ??
          (detail.skinToneHex ? analyzeSkinTone(detail.skinToneHex) : null)
        const toneLabel = analysis ? analysis.tone.label.replace(/\s+/g, '') : '분석 결과 없음'
        const palette =
          detail.recommendedColors.length > 0
            ? detail.recommendedColors
            : detail.skinToneHex
              ? generateSkinTonePalette(detail.skinToneHex, 30)
              : []
        const shapeLabel = detail.shapeId
          ? getNailShape(detail.shapeId)?.labelKo ?? detail.shapeId
          : null
        const shapeEn = detail.shapeId
          ? getNailShape(detail.shapeId)?.labelEn ?? detail.shapeId
          : null
        const lengthPct = Math.min(100, Math.max(8, (detail.avgLength / 18) * 100))
        const widthPct = Math.min(100, Math.max(8, (detail.avgWidth / 14) * 100))
        const curvePct = Math.min(100, Math.max(8, detail.avgCurve * 100))
        const fingerList = detail.fingers.filter((f) => f.hand === fingerHand)
        // 세션 자체가 양손 스캔 페어링 결과라 leftScanId/rightScanId는 항상 둘 다 존재한다.
        // detail.fingers 유무로 탭을 판단하면, 한쪽 분석이 실패해서 손가락 데이터가 비어 있을 때
        // (예: 손가락 5개 측정이 전부 실패해 FAILED 처리된 경우) 탭 자체가 사라져 버려서
        // "왜 오른손 탭이 안 보이지"처럼 원인을 알 수 없는 상태가 된다 — 탭은 항상 보여주고,
        // 데이터가 없는 손은 표 안에서 빈 상태 문구로 안내한다.
        const hasLeft = Boolean(session.leftScanId)
        const hasRight = Boolean(session.rightScanId)

        return (
          <>
            <section
              className="mypage-x__scanx-hero"
              style={{
                background: `linear-gradient(145deg, ${skinHex}22 0%, #fff 48%, ${skinHex}14 100%)`,
              }}
            >
              {palette.length > 0 && (
                <div
                  className={`mypage-x__scanx-palette-wrap${paletteOpen ? ' is-open' : ''}`}
                  onMouseEnter={openPaletteOnHover}
                  onMouseLeave={closePaletteOnHover}
                  onFocus={openPaletteOnHover}
                  onBlur={closePaletteOnHover}
                >
                  <button
                    type="button"
                    className="mypage-x__scanx-palette-btn"
                    aria-label="추천 컬러 팔레트 보기"
                    aria-expanded={paletteOpen}
                    aria-haspopup="true"
                    onClick={togglePaletteClick}
                  >
                    {Icon.palette}
                  </button>
                  <div className="mypage-x__scanx-palette-pop" role="tooltip">
                    <p className="mypage-x__scanx-palette-pop-title">추천 컬러</p>
                    <div className="mypage-x__scanx-palette" aria-label="대표 피부색 추천 컬러 24색">
                      {palette.map((hex, idx) => (
                        <i key={`${hex}-${idx}`} style={{ background: hex }} title={hex} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div className="mypage-x__scanx-hero-top">
                <span
                  className="mypage-x__scanx-color-orb"
                  style={{ background: skinHex }}
                  aria-hidden="true"
                />
                <div className="mypage-x__scanx-hero-copy">
                  <p className="mypage-x__scanx-kicker">대표 피부색</p>
                  <h3 className="mypage-x__scanx-season">{toneLabel}</h3>
                  {analysis && (
                    <div className="mypage-x__scanx-chips">
                      <span>{skinHex}</span>
                      <span>{toneLabel}</span>
                      <span>{analysis.brightness.level}명도</span>
                      <span>{analysis.saturation.level}채도</span>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {analysis && (
              <section className="mypage-x__scanx-tone-card" aria-label="피부톤 분석">
                <p className="mypage-x__scanx-section-label">피부톤 분석</p>
                <div className="mypage-x__scanx-tone-bars">
                  <div className="mypage-x__scanx-tone-bar">
                    <div className="mypage-x__scanx-tone-bar-head">
                      <span>톤</span>
                      <span>{analysis.tone.label}</span>
                    </div>
                    <div className="mypage-x__scanx-tone-bar-track mypage-x__scanx-tone-bar-track--tone">
                      <span style={{ left: `${analysis.tone.percent}%` }} />
                    </div>
                  </div>
                  <div className="mypage-x__scanx-tone-bar">
                    <div className="mypage-x__scanx-tone-bar-head">
                      <span>명도</span>
                      <span>{analysis.brightness.label}</span>
                    </div>
                    <div className="mypage-x__scanx-tone-bar-track mypage-x__scanx-tone-bar-track--brightness">
                      <span style={{ left: `${analysis.brightness.percent}%` }} />
                    </div>
                  </div>
                  <div className="mypage-x__scanx-tone-bar">
                    <div className="mypage-x__scanx-tone-bar-head">
                      <span>채도 (혈색)</span>
                      <span>{analysis.saturation.label}</span>
                    </div>
                    <div className="mypage-x__scanx-tone-bar-track mypage-x__scanx-tone-bar-track--saturation">
                      <span style={{ left: `${analysis.saturation.percent}%` }} />
                    </div>
                  </div>
                </div>
              </section>
            )}

            <section className="mypage-x__scanx-shape">
              <div className="mypage-x__scanx-shape-copy">
                <p className="mypage-x__scanx-kicker">추천 네일팁 쉐입</p>
                <strong>{shapeLabel ?? '미정'}</strong>
                {shapeEn && <span>{shapeEn}</span>}
              </div>
              <div className="mypage-x__scanx-shape-preview" aria-hidden="true">
                {detail.shapeId && SHAPE_PREVIEW_IMAGES[detail.shapeId] ? (
                  <img src={SHAPE_PREVIEW_IMAGES[detail.shapeId]} alt="" />
                ) : (
                  Icon.design
                )}
              </div>
            </section>

            <section className="mypage-x__scanx-metrics" aria-label="양손 평균 손톱 지표">
              <p className="mypage-x__scanx-section-label">손톱 평균 수치</p>
              <div className="mypage-x__scanx-metric-grid">
                <article className="mypage-x__scanx-metric">
                  <div className="mypage-x__scanx-metric-top">
                    <div className="mypage-x__scanx-metric-copy">
                      <p>길이</p>
                      <strong>
                        {detail.avgLength.toFixed(1)}
                        <em>mm</em>
                      </strong>
                    </div>
                    <span className="mypage-x__scanx-metric-icon" aria-hidden="true">
                      {Icon.lengthIcon}
                    </span>
                  </div>
                  <div className="mypage-x__scanx-meter" aria-hidden="true">
                    <i style={{ width: `${lengthPct}%` }} />
                  </div>
                  <span className="mypage-x__scanx-metric-hint">끝에서 큐티클까지</span>
                </article>
                <article className="mypage-x__scanx-metric">
                  <div className="mypage-x__scanx-metric-top">
                    <div className="mypage-x__scanx-metric-copy">
                      <p>너비</p>
                      <strong>
                        {detail.avgWidth.toFixed(1)}
                        <em>mm</em>
                      </strong>
                    </div>
                    <span className="mypage-x__scanx-metric-icon" aria-hidden="true">
                      {Icon.widthIcon}
                    </span>
                  </div>
                  <div className="mypage-x__scanx-meter" aria-hidden="true">
                    <i style={{ width: `${widthPct}%` }} />
                  </div>
                  <span className="mypage-x__scanx-metric-hint">최대 너비 평균</span>
                </article>
                <article className="mypage-x__scanx-metric">
                  <div className="mypage-x__scanx-metric-top">
                    <div className="mypage-x__scanx-metric-copy">
                      <p>곡률</p>
                      <strong>{detail.avgCurve.toFixed(2)}</strong>
                    </div>
                    <span className="mypage-x__scanx-metric-icon" aria-hidden="true">
                      {Icon.curveIcon}
                    </span>
                  </div>
                  <div className="mypage-x__scanx-meter" aria-hidden="true">
                    <i style={{ width: `${curvePct}%` }} />
                  </div>
                  <span className="mypage-x__scanx-metric-hint">C-curve</span>
                </article>
              </div>
            </section>

            <p className="mypage-x__scanx-comment">
              <span className="mypage-x__scanx-comment-label">
                한줄 요약
                <i aria-hidden="true">{Icon.summaryIcon}</i>
              </span>
              {detail.comment}
            </p>

            {detail.fingers.length > 0 && (
              <div className="mypage-x__scanx-detail-toggle-wrap">
                <button
                  type="button"
                  className={`mypage-x__scanx-detail-toggle${fingerDetailOpen ? ' is-open' : ''}`}
                  onClick={() => setFingerDetailOpen((prev) => !prev)}
                  aria-expanded={fingerDetailOpen}
                >
                  손가락별 상세 측정값 {fingerDetailOpen ? '접기' : '보기'}
                  <span className="mypage-x__scanx-detail-toggle-icon" aria-hidden="true">
                    {Icon.chevronDown}
                  </span>
                </button>

                {fingerDetailOpen && (
                  <div className="mypage-x__scanx-finger-panel">
                    <div
                      className={`mypage-x__scanx-hand-tabs${hasLeft && hasRight ? '' : ' is-single'}`}
                      role="tablist"
                      aria-label="손 선택"
                    >
                      {hasLeft && (
                        <button
                          type="button"
                          role="tab"
                          aria-selected={fingerHand === 'L'}
                          className={fingerHand === 'L' ? 'is-active' : ''}
                          onClick={() => setFingerHand('L')}
                        >
                          <em>L</em>
                          <span>왼손</span>
                        </button>
                      )}
                      {hasRight && (
                        <button
                          type="button"
                          role="tab"
                          aria-selected={fingerHand === 'R'}
                          className={fingerHand === 'R' ? 'is-active' : ''}
                          onClick={() => setFingerHand('R')}
                        >
                          <em>R</em>
                          <span>오른손</span>
                        </button>
                      )}
                    </div>
                    <div className="mypage-x__scanx-hand-rows">
                      <div className="mypage-x__scanx-hand-row mypage-x__scanx-hand-row--head">
                        <span>손가락</span>
                        <span>길이</span>
                        <span>너비</span>
                        <span>곡률</span>
                      </div>
                      {fingerList.length > 0 ? (
                        fingerList.map((f) => (
                          <div key={f.label} className="mypage-x__scanx-hand-row">
                            <span className="mypage-x__scanx-hand-name">{f.partLabel}</span>
                            <span>
                              {f.lengthMm.toFixed(1)}
                              <small>mm</small>
                            </span>
                            <span>
                              {f.widthMm.toFixed(1)}
                              <small>mm</small>
                            </span>
                            <span>{f.cCurve.toFixed(2)}</span>
                          </div>
                        ))
                      ) : (
                        <p className="mypage-x__scanx-finger-empty">
                          이 손은 측정 데이터가 없어요. 분석이 실패했거나 아직 완료되지 않았을 수 있어요.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )
      })()}
    </ScanXModalShell>
  )
}
