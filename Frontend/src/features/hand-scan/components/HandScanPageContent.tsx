import { createPortal } from 'react-dom'
import { AppShell } from '@/shared/layout/AppShell'
import { PageHero } from '@/shared/layout/PageHero'
import { CameraSetupPreview } from '@/features/hand-scan/components/CameraSetupPreview'
import { ScanDetailModal } from '@/shared/components/ScanDetailModal'
import { PillButton } from '@/shared/components/PillButton'
import { WarningIcon } from '@/shared/components/icons/WarningIcon'
import { analyzeSkinTone } from '@/shared/utils/skinTone'
import { formatMetricCurve } from '@/shared/utils/scanDetail'
import { getNailShape } from '@/shared/constants/nailShapes'
import {
  useHandScanPage,
  HANDS,
  FINGERS,
  FINGER_LABELS,
  HAND_LABELS,
  STEPS,
} from '@/features/hand-scan/hooks/useHandScanPage'
import '@/styles/hand-scan.css'

function formatScanDateLabel(raw: string): string {
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
}

export function HandScanPageContent() {
  const {
    navigate,
    SCAN_SERVER_URL,
    PHONE_CAM_URL,
    isFullscreen,
    cameraError,
    isUploading,
    topCameraIdx,
    sideCameraIdx,
    currentStepIndex,
    uploadedSteps,
    isDone,
    gateStatus,
    latestCompletedSession,
    detailSession,
    setDetailSession,
    currentHand,
    currentFinger,
    handleConfirmRescan,
    handleCloseFullscreen,
    handleOpenFullscreen,
    handleCaptureFinger,
    handleCameraChange,
  } = useHandScanPage()

  // ── 풀스크린 오버레이 ─────────────────────────────────────────
  const fullscreenOverlay = isFullscreen
      ? createPortal(
          <div className="hand-scan-fs" role="dialog" aria-modal="true" aria-label="손 촬영">
            <div className="hand-scan-fs__feeds">
              {/* 탑뷰: 스캔 서버 MJPEG 스트림 (ArUco 가이드선 포함) */}
              <div className="hand-scan-fs__feed">
                <img
                    src={`${SCAN_SERVER_URL}/stream/top`}
                    className="hand-scan-fs__video"
                    alt="탑뷰 스캔 피드"
                />
                <div className="hand-scan-fs__feed-select-wrap">
                  <label className="hand-scan-fs__feed-select-label">
                    <span className="hand-scan-fs__feed-select-name">카메라 1</span>
                    <div className="hand-scan-fs__feed-select-inner">
                      <select
                          className="hand-scan-fs__feed-select"
                          value={topCameraIdx}
                          onChange={(e) => void handleCameraChange(Number(e.target.value), sideCameraIdx)}
                      >
                        <option value={0}>인덱스 0</option>
                        <option value={1}>인덱스 1</option>
                        <option value={2}>인덱스 2</option>
                      </select>
                    </div>
                  </label>
                </div>
              </div>

              <div className="hand-scan-fs__divider" aria-hidden="true" />

              {/* 사이드뷰: sideCameraIdx가 웹캠(>=0) 또는 폰(-2)일 때 스트림 표시 */}
              <div className="hand-scan-fs__feed">
                {sideCameraIdx >= 0 || sideCameraIdx === -2 ? (
                    <img
                        src={`${SCAN_SERVER_URL}/stream/side`}
                        className="hand-scan-fs__video"
                        alt="사이드뷰 스캔 피드"
                    />
                ) : null}
                {sideCameraIdx === -2 ? (
                    <p className="hand-scan-fs__phone-hint">
                      폰 브라우저에서 {PHONE_CAM_URL}/phone/side 를 열어 카메라를 연결하세요
                    </p>
                ) : null}
                <div className="hand-scan-fs__feed-select-wrap">
                  <label className="hand-scan-fs__feed-select-label">
                    <span className="hand-scan-fs__feed-select-name">카메라 2</span>
                    <div className="hand-scan-fs__feed-select-inner">
                      <select
                          className="hand-scan-fs__feed-select"
                          value={sideCameraIdx}
                          onChange={(e) => void handleCameraChange(topCameraIdx, Number(e.target.value))}
                      >
                        <option value={-1}>사용 안 함</option>
                        <option value={-2}>폰(원격)</option>
                        <option value={0}>인덱스 0</option>
                        <option value={1}>인덱스 1</option>
                        <option value={2}>인덱스 2</option>
                      </select>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <div className="hand-scan-fs__vignette" aria-hidden="true" />

            <button
                type="button"
                className="hand-scan-fs__close"
                onClick={handleCloseFullscreen}
                aria-label="촬영 종료"
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>

            <p className="hand-scan-fs__prompt">
              <svg className="hand-scan-fs__prompt-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
                <path d="M12 4.5l9 15.5H3l9-15.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
                <line x1="12" y1="10.5" x2="12" y2="14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <circle cx="12" cy="17.2" r="1" fill="currentColor" />
              </svg>
              {HAND_LABELS[currentHand]} {FINGER_LABELS[currentFinger]}를 탑뷰 박스에 넣고 ArUco 마커와 함께 찍어주세요
              <svg className="hand-scan-fs__prompt-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
                <path d="M12 4.5l9 15.5H3l9-15.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
                <line x1="12" y1="10.5" x2="12" y2="14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <circle cx="12" cy="17.2" r="1" fill="currentColor" />
              </svg>
            </p>

            <div className="hand-scan-fs__finger-badge">
            <span className="hand-scan-fs__finger-badge-name">
              {FINGER_LABELS[currentFinger]}
              <span className="hand-scan-fs__finger-badge-hand">
                ({currentHand === 'LEFT' ? 'L' : 'R'})
              </span>
            </span>
              <span className="hand-scan-fs__finger-badge-divider" />
              <span className="hand-scan-fs__finger-badge-progress">
              {currentStepIndex + 1}/{STEPS.length}
            </span>
            </div>

            <div className="hand-scan-fs__capture-wrap">
              <button
                  type="button"
                  className="hand-scan__action-btn hand-scan-fs__capture"
                  onClick={() => void handleCaptureFinger()}
              >
                지금 촬영
              </button>
            </div>
          </div>,
          document.body,
      )
      : null

  // ── 게이트: 로딩 ─────────────────────────────────────────────
  if (gateStatus === 'checking') {
    return (
        <AppShell mainClassName="hand-scan-page hand-scan-page--gate">
          <p className="hand-scan-rescan-gate__loading">이전 분석 기록을 확인하는 중...</p>
        </AppShell>
    )
  }

  // ── 게이트: 이전 기록 있음 ─────────────────────────────────────
  if (gateStatus === 'show' && latestCompletedSession) {
    const session = latestCompletedSession
    const dateLabel = formatScanDateLabel(session.scannedAt)
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
        <>
          <AppShell mainClassName="hand-scan-page hand-scan-page--gate">
            <section className="hand-scan-rescan-gate" aria-labelledby="rescan-gate-title">
              <div className="hand-scan-rescan-gate__icon" aria-hidden="true">
                <WarningIcon width={28} height={28} />
              </div>

              <h2 id="rescan-gate-title" className="hand-scan-rescan-gate__title">
                이미 손 분석 결과 기록이 있습니다.
              </h2>

              <div className="hand-scan-rescan-gate__record">
                <div className="hand-scan-rescan-gate__record-head">
                  <span className="hand-scan-rescan-gate__record-label">최근 분석 기록</span>
                  <button
                      type="button"
                      className="hand-scan-rescan-gate__record-all-link"
                      onClick={() => navigate('/mypage/scans')}
                  >
                    전체 기록 보기
                  </button>
                </div>
                <button
                    type="button"
                    className="hand-scan-rescan-gate__record-open"
                    onClick={() => setDetailSession(session)}
                >
                  <span
                      className="hand-scan-rescan-gate__record-swatch"
                      style={{ background: skinHex ?? '#de869f' }}
                      aria-hidden="true"
                  />
                  <span className="hand-scan-rescan-gate__record-body">
                    <strong className="hand-scan-rescan-gate__record-date">{dateLabel}</strong>
                    <span className="hand-scan-rescan-gate__record-season">{toneLabel}</span>
                    <span className="hand-scan-rescan-gate__record-metrics">{metricsLine}</span>
                    <span className="hand-scan-rescan-gate__record-shape">
                      추천 쉐입: {shapeLabel ?? '미정'}
                    </span>
                  </span>
                </button>
              </div>

              <p className="hand-scan-rescan-gate__desc">
                새로 스캔하면 분석 결과가 추가로 저장됩니다.
                <br />
                손이 달라졌거나 더 정확한 측정이 필요할 때만 다시 진행해 주세요.
              </p>

              <div className="hand-scan-rescan-gate__actions">
                <PillButton
                    variant="ghost"
                    className="hand-scan-rescan-gate__btn"
                    onClick={handleConfirmRescan}
                >
                  다시 스캔하기
                </PillButton>
                <PillButton
                    variant="primary"
                    className="hand-scan-rescan-gate__btn"
                    onClick={() =>
                        navigate('/print', {
                          state: {
                            leftScanId: session.leftScanId,
                            rightScanId: session.rightScanId,
                          },
                        })
                    }
                >
                  네일팁 출력하러 가기
                </PillButton>
              </div>
            </section>
          </AppShell>

          <ScanDetailModal session={detailSession} onClose={() => setDetailSession(null)} />
        </>
    )
  }

  // ── 메인 스캔 페이지 ──────────────────────────────────────────
  return (
      <>
        <AppShell mainClassName="hand-scan-page">
          <PageHero
              eyebrow="Hand Scan"
              title="손 촬영 및 스캔"
              description={
                <>
                  두 카메라가 동시에 촬영하여 손톱 형태와 곡률을 분석합니다.<br />
                  왼손 다섯 손가락을 먼저 촬영한 뒤, 오른손 다섯 손가락을 이어서 촬영합니다.
                </>
              }
              align="center"
          />

          <div className="hand-scan__progress-groups">
            {HANDS.map((hand) => (
                <div key={hand} className="hand-scan__progress-group">
                  <div className="hand-scan__progress">
                    {FINGERS.map((finger) => {
                      const stepIdx = STEPS.findIndex((s) => s.hand === hand && s.finger === finger)
                      return (
                          <span
                              key={`${hand}-${finger}`}
                              className={[
                                'hand-scan__progress-step',
                                uploadedSteps.has(`${hand}-${finger}`) ? 'hand-scan__progress-step--done' : '',
                                stepIdx === currentStepIndex && !isDone ? 'hand-scan__progress-step--current' : '',
                              ].filter(Boolean).join(' ')}
                          >
                      {FINGER_LABELS[finger]}({hand === 'LEFT' ? 'L' : 'R'})
                    </span>
                      )
                    })}
                  </div>
                </div>
            ))}
          </div>

          <div className="hand-scan__prep">
            <CameraSetupPreview />
          </div>

          {cameraError && <p className="hand-scan__error">{cameraError}</p>}

          {!isDone && (
              <button
                  type="button"
                  className="hand-scan__action-btn"
                  onClick={() => void handleOpenFullscreen()}
                  disabled={isUploading}
              >
                {isUploading ? '스캔 시작 중...' : '촬영 시작하기'}
              </button>
          )}
        </AppShell>

        {fullscreenOverlay}
      </>
  )
}
