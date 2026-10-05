import { createPortal } from 'react-dom'
import { AppShell } from '@/shared/layout/AppShell'
import { PageHero } from '@/shared/layout/PageHero'
import { CameraSetupPreview } from '@/features/hand-scan/components/CameraSetupPreview'
import { TopViewFingerGuide } from '@/features/hand-scan/components/TopViewFingerGuide'
import { CaptureButton } from '@/features/hand-scan/components/CaptureButton'
import { ScanProgressDots } from '@/features/hand-scan/components/ScanProgressDots'
import { CAPTURE_COPY, getCaptureStatus, toGuidePhase } from '@/features/hand-scan/utils/captureStatus'
import { ScanDetailModal } from '@/shared/components/ScanDetailModal'
import { PillButton } from '@/shared/components/PillButton'
import { WarningIcon } from '@/shared/components/icons/WarningIcon'
import { analyzeSkinTone, skinToneAnalysisFromMetrics } from '@/shared/utils/skinTone'
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
    isFullscreen,
    cameraError,
    isUploading,
    stabilityRatio,
    isStable,
    topGuide,
    isCapturing,
    completedStep,
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
  } = useHandScanPage()

  // ── 풀스크린 오버레이 ─────────────────────────────────────────
  // 화면 상태(안내 문구·촬영 버튼 막대)는 서버가 이미 주는 값에서 계산만 한다 —
  // 측정/촬영 요청은 예전과 같다 (captureStatus.ts 참고).
  const captureStatus = getCaptureStatus({
    cameraReady: topGuide !== null,
    ratio: stabilityRatio,
    stable: isStable,
    capturing: isCapturing,
  })
  const target = `${HAND_LABELS[currentHand]} ${FINGER_LABELS[currentFinger]}`

  const fullscreenOverlay = isFullscreen
      ? createPortal(
          <div
              className={`hand-scan-fs hand-scan-fs--${captureStatus}`}
              role="dialog"
              aria-modal="true"
              aria-label="손 촬영"
          >
            <header className="hand-scan-fs__header">
              <ScanProgressDots currentStepIndex={currentStepIndex} uploadedSteps={uploadedSteps} />
              <h2 className="hand-scan-fs__title" aria-live="polite">
                {CAPTURE_COPY[captureStatus].title(target)}
              </h2>
            </header>

            <div className="hand-scan-fs__feeds">
              {/* 탑뷰: 스캔 서버 MJPEG 스트림 + 손가락/큐티클 가이드(프론트에서 그림) */}
              <div className="hand-scan-fs__feed">
                <img
                    src={`${SCAN_SERVER_URL}/stream/top`}
                    className="hand-scan-fs__video"
                    alt="탑뷰 스캔 피드"
                />
                <TopViewFingerGuide
                    guide={topGuide}
                    finger={currentFinger}
                    fingerLabel={FINGER_LABELS[currentFinger]}
                    phase={toGuidePhase(captureStatus)}
                />
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

            {/* 촬영 완료 — 화면 가운데 잠깐 떴다 사라진다 (key가 바뀔 때마다 새로 떠서 CSS 애니메이션으로 사라짐) */}
            {completedStep ? (
                <div
                    key={`${completedStep.hand}-${completedStep.finger}`}
                    className="hand-scan-fs__toast"
                    role="status"
                >
                  <span className="hand-scan-fs__toast-icon" aria-hidden="true">
                    <svg viewBox="0 0 16 16" width="18" height="18">
                      <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="hand-scan-fs__toast-text">
                    {HAND_LABELS[completedStep.hand]} {FINGER_LABELS[completedStep.finger]} 촬영 완료
                    {completedStep.hand === 'LEFT' && completedStep.finger === 'PINKY' ? (
                        <small>이제 오른손을 촬영해요</small>
                    ) : null}
                  </span>
                </div>
            ) : null}
            <div className="hand-scan-fs__dock">
              {/* 촬영 요청 오류 — 버튼 바로 위에 계속 표시 (다음에 촬영 버튼을 누르면 지워짐) */}
              {cameraError ? (
                  <p className="hand-scan-fs__error" role="alert">
                    <span className="hand-scan-fs__error-icon" aria-hidden="true">!</span>
                    {cameraError}
                  </p>
              ) : null}
              <CaptureButton
                  status={captureStatus}
                  ratio={stabilityRatio}
                  onCapture={() => void handleCaptureFinger()}
              />
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
    const toneLabel = (
      skinToneAnalysisFromMetrics(session.tone, session.warmness, session.brightness, session.saturation)?.tone.label ??
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
