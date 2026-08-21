import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { PageHero } from '@/components/layout/PageHero'
import { startScan, uploadFingerImage, requestAnalyze, getMyScans } from '@/apis/scan'
import { CameraFeedSelect } from '@/components/handScan/CameraFeedSelect'
import { CameraSetupPreview } from '@/components/handScan/CameraSetupPreview'
import { ScanDetailModal } from '@/components/mypage/ScanDetailModal'
import { PillButton } from '@/components/common/PillButton'
import { WarningIcon } from '@/components/icons/WarningIcon'
import { useFingerAlignment } from '@/hooks/useFingerAlignment'
import { useAuth } from '@/hooks/useAuth'
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
import { getNailShape } from '@/constants/nailShapes'
import '@/styles/hand-scan.css'

function formatScanDateLabel(raw: string): string {
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
}

function pickLatestCompletedSession(sessions: ScanSession[]): ScanSession | null {
  const completed = sessions.filter(isFullyAnalyzedSession)
  if (completed.length === 0) return null
  return completed.reduce((latest, cur) => {
    const lt = new Date(latest.scannedAt).getTime()
    const ct = new Date(cur.scannedAt).getTime()
    return ct >= lt ? cur : latest
  })
}

const FINGERS = ['THUMB', 'INDEX', 'MIDDLE', 'RING', 'PINKY'] as const
type Finger = (typeof FINGERS)[number]

const HANDS = ['LEFT', 'RIGHT'] as const
type HandSide = (typeof HANDS)[number]

const FINGER_LABELS: Record<Finger, string> = {
  THUMB: '엄지',
  INDEX: '검지',
  MIDDLE: '중지',
  RING: '약지',
  PINKY: '소지',
}

const HAND_LABELS: Record<HandSide, string> = {
  LEFT: '왼손',
  RIGHT: '오른손',
}

// 왼손 5손가락 → 오른손 5손가락, 총 10단계
type ScanStep = { hand: HandSide; finger: Finger }
const STEPS: ScanStep[] = HANDS.flatMap((hand) => FINGERS.map((finger) => ({ hand, finger })))

function pickDefaultDevices(devices: MediaDeviceInfo[]): [string, string] {
  if (devices.length === 0) return ['default', 'default']
  if (devices.length === 1) return [devices[0].deviceId, devices[0].deviceId]
  return [devices[0].deviceId, devices[1].deviceId]
}

// 촬영 진행 상태(몇 번째 손가락까지 찍었는지)를 모듈 스코프에 스냅샷으로 저장해서, 다른 페이지로
// 갔다가 돌아와도 처음부터 다시 찍지 않아도 되도록 한다. 카메라 스트림 자체는 하드웨어 리소스라
// 여기 포함하지 않고(다시 열 때 새로 요청), 서버에 이미 업로드된 진행 상황만 보존한다.
type HandScanSnapshot = {
  currentStepIndex: number
  scanIds: Record<HandSide, number | null>
  uploadedSteps: Set<string>
  isDone: boolean
}

let handScanSnapshot: HandScanSnapshot | null = null

// 로그인/로그아웃(계정 전환)이 일어나면 이전 계정의 촬영 진행 상황이 다음 계정에게
// 보이지 않도록 스냅샷을 비운다. 실제 서버에 저장된 이력은 계정별로 분리되어 있어 영향 없음.
window.addEventListener(AUTH_CHANGE_EVENT, () => {
  handScanSnapshot = null
})

export function HandScanPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { isLoggedIn } = useAuth()
  const skipRescanGate = searchParams.get('rescan') === '1'

  const [isFullscreen, setIsFullscreen] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([])
  const [leftDeviceId, setLeftDeviceId] = useState<string>('default')
  const [rightDeviceId, setRightDeviceId] = useState<string>('default')

  // 브라우저 뒤로/앞으로가기(POP)로 돌아온 경우에만 이전 촬영 진행 상황을 복원한다.
  // 앱 안의 링크/버튼으로 들어온 경우엔 항상 처음부터 새로 시작한다.
  const restoredSnapshot = useSnapshotRestore(handScanSnapshot, () => {
    handScanSnapshot = null
  })

  const [currentStepIndex, setCurrentStepIndex] = useState(restoredSnapshot?.currentStepIndex ?? 0)
  const [scanIds, setScanIds] = useState<Record<HandSide, number | null>>(
      restoredSnapshot?.scanIds ?? { LEFT: null, RIGHT: null },
  )
  const [uploadedSteps, setUploadedSteps] = useState<Set<string>>(restoredSnapshot?.uploadedSteps ?? new Set())
  const [isDone, setIsDone] = useState(restoredSnapshot?.isDone ?? false)

  const [gateStatus, setGateStatus] = useState<'checking' | 'show' | 'pass'>(
      skipRescanGate || !isLoggedIn ? 'pass' : 'checking',
  )
  const [latestCompletedSession, setLatestCompletedSession] = useState<ScanSession | null>(null)
  const [detailSession, setDetailSession] = useState<ScanSession | null>(null)

  useEffect(() => {
    if (skipRescanGate || !isLoggedIn) {
      setGateStatus('pass')
      return
    }

    let cancelled = false
    setGateStatus('checking')
    void getMyScans()
        .then((scans) => {
          if (cancelled) return
          const latest = pickLatestCompletedSession(buildScanSessions(scans))
          if (latest) {
            setLatestCompletedSession(latest)
            setGateStatus('show')
          } else {
            setGateStatus('pass')
          }
        })
        .catch(() => {
          if (!cancelled) setGateStatus('pass')
        })

    return () => {
      cancelled = true
    }
  }, [isLoggedIn, skipRescanGate])

  const handleConfirmRescan = () => {
    setGateStatus('pass')
    setSearchParams({ rescan: '1' }, { replace: true })
  }

  const leftVideoRef = useRef<HTMLVideoElement | null>(null)
  const rightVideoRef = useRef<HTMLVideoElement | null>(null)
  const leftStreamRef = useRef<MediaStream | null>(null)
  const rightStreamRef = useRef<MediaStream | null>(null)

  const currentStep = STEPS[currentStepIndex]
  const currentHand = currentStep.hand
  const currentFinger = currentStep.finger
  const isFingerAligned = useFingerAlignment(
      isFullscreen,
      leftVideoRef,
      rightVideoRef,
      currentStepIndex,
  )

  const stopStreams = useCallback(() => {
    for (const stream of [leftStreamRef.current, rightStreamRef.current]) {
      stream?.getTracks().forEach((track) => track.stop())
    }
    leftStreamRef.current = null
    rightStreamRef.current = null
  }, [])

  const refreshDeviceList = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videos = devices.filter((d) => d.kind === 'videoinput')
      setVideoInputs(videos)
      return videos
    } catch {
      return []
    }
  }, [])

  const startStreamForDevice = async (deviceId: string): Promise<MediaStream> => {
    const videoConstraint =
        deviceId && deviceId !== 'default'
            ? { deviceId: { exact: deviceId } }
            : { facingMode: 'user' as const }

    return navigator.mediaDevices.getUserMedia({
      video: videoConstraint,
      audio: false,
    })
  }

  const attachStream = (video: HTMLVideoElement | null, stream: MediaStream) => {
    if (video) video.srcObject = stream
  }

  const startDualCameras = useCallback(
      async (leftId: string, rightId: string) => {
        stopStreams()
        try {
          const leftStream = await startStreamForDevice(leftId)
          leftStreamRef.current = leftStream
          attachStream(leftVideoRef.current, leftStream)

          const rightStream =
              rightId === leftId ? leftStream : await startStreamForDevice(rightId)
          rightStreamRef.current = rightStream
          attachStream(rightVideoRef.current, rightStream)

          setCameraError(null)
          await refreshDeviceList()
        } catch {
          stopStreams()
          setCameraError('카메라 권한을 허용한 뒤 다시 시도해 주세요.')
          setIsFullscreen(false)
        }
      },
      [refreshDeviceList, stopStreams],
  )

  const handleOpenFullscreen = async () => {
    setCameraError(null)
    setIsFullscreen(true)

    try {
      const probe = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      })
      probe.getTracks().forEach((track) => track.stop())

      const videos = await refreshDeviceList()
      const [leftId, rightId] = pickDefaultDevices(videos)
      setLeftDeviceId(leftId)
      setRightDeviceId(rightId)
    } catch {
      setCameraError('카메라 권한을 허용한 뒤 다시 시도해 주세요.')
      setIsFullscreen(false)
    }
  }

  const handleCloseFullscreen = () => {
    stopStreams()
    setIsFullscreen(false)
  }

  const captureVideoBlob = async (video: HTMLVideoElement): Promise<Blob> => {
    const w = Math.max(1, video.videoWidth || 640)
    const h = Math.max(1, video.videoHeight || 480)

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas context is not available.')

    ctx.drawImage(video, 0, 0, w, h)

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Failed to create image blob.'))),
          'image/jpeg',
          0.92,
      )
    })
  }

  const handleCaptureFinger = async () => {
    if (!isFullscreen) return
    const topVideo = leftVideoRef.current
    const sideVideo = rightVideoRef.current
    if (!topVideo || !sideVideo) return

    setIsUploading(true)
    setCameraError(null)

    try {
      let currentScanId = scanIds[currentHand]
      if (currentScanId === null) {
        const data = await startScan(currentHand)
        currentScanId = data.scanId
        setScanIds((prev) => ({ ...prev, [currentHand]: currentScanId }))
      }

      // 카메라 1(탑뷰)과 카메라 2(측면뷰)를 각각 원본 그대로 캡처해서 한 번에 업로드
      const [topBlob, sideBlob] = await Promise.all([
        captureVideoBlob(topVideo),
        captureVideoBlob(sideVideo),
      ])
      await uploadFingerImage(currentScanId, currentFinger, topBlob, sideBlob)

      setUploadedSteps((prev) => new Set(prev).add(`${currentHand}-${currentFinger}`))

      // 해당 손의 마지막 손가락(소지)까지 올라갔으면 그 손 분석 요청
      if (currentFinger === 'PINKY') {
        await requestAnalyze(currentScanId)
      }

      if (currentStepIndex < STEPS.length - 1) {
        setCurrentStepIndex((prev) => prev + 1)
      } else {
        setIsDone(true)
        handleCloseFullscreen()
      }
    } catch (e) {
      if (e instanceof ApiError) {
        setCameraError(e.message)
      } else {
        setCameraError(e instanceof Error ? e.message : '오류가 발생했습니다. 다시 시도해 주세요.')
      }
    } finally {
      setIsUploading(false)
    }
  }

  useEffect(() => {
    if (!isFullscreen) return

    const frameId = requestAnimationFrame(() => {
      void startDualCameras(leftDeviceId, rightDeviceId)
    })

    return () => cancelAnimationFrame(frameId)
  }, [isFullscreen, leftDeviceId, rightDeviceId, startDualCameras])

  useEffect(() => {
    return () => {
      stopStreams()
    }
  }, [stopStreams])

  useEffect(() => {
    if (isDone) {
      navigate('/scan/result', {
        state: { leftScanId: scanIds.LEFT, rightScanId: scanIds.RIGHT },
      })
    }
  }, [isDone, navigate, scanIds])

  // 촬영 진행 상태를 모듈 스코프 스냅샷에 반영해 둔다 — 다른 페이지로 이동했다가 돌아와도
  // 위 useState 초기값이 여기서 복원되어 처음부터 다시 찍지 않아도 된다.
  useEffect(() => {
    handScanSnapshot = { currentStepIndex, scanIds, uploadedSteps, isDone }
  }, [currentStepIndex, scanIds, uploadedSteps, isDone])

  // 뒤로가기는 그대로 허용(스냅샷이 복원해줌). 새로고침/탭 닫기/헤더 내비게이션 등으로
  // 벗어나려 할 때만 경고하고, 그래도 나가면 촬영 진행 상황을 초기화해서 처음부터 다시 찍게 한다.
  useLeaveWarning(
      currentStepIndex > 0 || uploadedSteps.size > 0,
      '지금 나가면 촬영 진행 상황이 초기화돼, 처음부터 다시 찍어야 해요. 그래도 나가시겠어요?',
      () => {
        handScanSnapshot = null
        stopStreams()
      },
  )

  useEffect(() => {
    if (!isFullscreen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCloseFullscreen()
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isFullscreen])

  const fullscreenOverlay = isFullscreen
      ? createPortal(
          <div className="hand-scan-fs" role="dialog" aria-modal="true" aria-label="손 촬영">
            <div className="hand-scan-fs__feeds">
              <div className="hand-scan-fs__feed">
                <video
                    ref={leftVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="hand-scan-fs__video"
                />
                <CameraFeedSelect
                    label="카메라 1"
                    value={leftDeviceId}
                    devices={videoInputs}
                    onChange={setLeftDeviceId}
                />
              </div>
              <div className="hand-scan-fs__divider" aria-hidden="true" />
              <div className="hand-scan-fs__feed">
                <video
                    ref={rightVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="hand-scan-fs__video"
                />
                <CameraFeedSelect
                    label="카메라 2"
                    value={rightDeviceId}
                    devices={videoInputs}
                    onChange={setRightDeviceId}
                />
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
                <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                />
              </svg>
            </button>

            {!isFingerAligned && (
                <p className="hand-scan-fs__prompt">
                  <svg className="hand-scan-fs__prompt-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
                    <path
                        d="M12 4.5l9 15.5H3l9-15.5z"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                    />
                    <line x1="12" y1="10.5" x2="12" y2="14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    <circle cx="12" cy="17.2" r="1" fill="currentColor" />
                  </svg>
                  {HAND_LABELS[currentHand]} {FINGER_LABELS[currentFinger]}를 촬영 박스에 넣어주세요
                  <svg className="hand-scan-fs__prompt-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
                    <path
                        d="M12 4.5l9 15.5H3l9-15.5z"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                    />
                    <line x1="12" y1="10.5" x2="12" y2="14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    <circle cx="12" cy="17.2" r="1" fill="currentColor" />
                  </svg>
                </p>
            )}

            <div className="hand-scan-fs__finger-badge">
            <span className="hand-scan-fs__finger-badge-name">
              {FINGER_LABELS[currentFinger]}
              <span className="hand-scan-fs__finger-badge-hand">({currentHand === 'LEFT' ? 'L' : 'R'})</span>
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
                  disabled={isUploading}
              >
                {isUploading ? '업로드 중…' : '사진 촬영하기'}
              </button>
            </div>
          </div>,
          document.body,
      )
      : null

  if (gateStatus === 'checking') {
    return (
        <AppShell mainClassName="hand-scan-page hand-scan-page--gate">
          <p className="hand-scan-rescan-gate__loading">이전 분석 기록을 확인하는 중...</p>
        </AppShell>
    )
  }

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
                      onClick={() => navigate('/mypage', { state: { tab: 'scans' } })}
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

  return (
      <>
        <AppShell mainClassName="hand-scan-page">
          <PageHero
              eyebrow="Hand Scan"
              title="손 촬영 및 스캔"
              description={
                <>
                  두 카메라가 동시에 촬영하여 손톱 형태와 곡률을 분석합니다.
                  <br />
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
                              ]
                                  .filter(Boolean)
                                  .join(' ')}
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
              >
                촬영 시작하기
              </button>
          )}
        </AppShell>

        {fullscreenOverlay}
      </>
  )
}