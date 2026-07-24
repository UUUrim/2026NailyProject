import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { PageBackLink } from '@/components/layout/PageBackLink'
import { startScan, uploadFingerImage, requestAnalyze } from '@/apis/scan'
import { CameraFeedSelect } from '@/components/handScan/CameraFeedSelect'
import { CameraSetupPreview } from '@/components/handScan/CameraSetupPreview'
import { useFingerAlignment } from '@/hooks/useFingerAlignment'
import { ApiError } from '@/utils/apiClient'
import '@/styles/hand-scan.css'

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

export function HandScanPage() {
  const navigate = useNavigate()
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([])
  const [leftDeviceId, setLeftDeviceId] = useState<string>('default')
  const [rightDeviceId, setRightDeviceId] = useState<string>('default')

  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [scanIds, setScanIds] = useState<Record<HandSide, number | null>>({
    LEFT: null,
    RIGHT: null,
  })
  const [uploadedSteps, setUploadedSteps] = useState<Set<string>>(new Set())
  const [isDone, setIsDone] = useState(false)

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

  return (
      <>
        <AppShell mainClassName="hand-scan-page">
          <div className="hand-scan-page__topbar">
            <PageBackLink to="/process" />
            <h1 className="hand-scan-page__title">손 촬영 및 스캔</h1>
          </div>

          <div className="hand-scan-page__info-card">
            <svg className="hand-scan-page__info-card-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
              <rect x="3" y="7" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
              <path d="M17 10.5l4-2.2v9.4l-4-2.2" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              <circle cx="10" cy="12.5" r="2.4" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            <p className="hand-scan-page__info-card-text">
              두 카메라가 동시에 촬영하여 손톱 형태와 곡률을 분석합니다.
              <br />
              왼손 다섯 손가락을 먼저 촬영한 뒤, 오른손 다섯 손가락을 이어서 촬영합니다.
            </p>
          </div>

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