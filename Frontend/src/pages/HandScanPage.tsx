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

const FINGER_LABELS: Record<Finger, string> = {
  THUMB: '엄지',
  INDEX: '검지',
  MIDDLE: '중지',
  RING: '약지',
  PINKY: '소지',
}

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

  const [currentFingerIndex, setCurrentFingerIndex] = useState(0)
  const [scanId, setScanId] = useState<number | null>(null)
  const [uploadedFingers, setUploadedFingers] = useState<Finger[]>([])
  const [isDone, setIsDone] = useState(false)

  const leftVideoRef = useRef<HTMLVideoElement | null>(null)
  const rightVideoRef = useRef<HTMLVideoElement | null>(null)
  const leftStreamRef = useRef<MediaStream | null>(null)
  const rightStreamRef = useRef<MediaStream | null>(null)

  const currentFinger = FINGERS[currentFingerIndex]
  const isFingerAligned = useFingerAlignment(
    isFullscreen,
    leftVideoRef,
    rightVideoRef,
    currentFingerIndex,
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

  const handleSwapCameras = () => {
    const leftVideo = leftVideoRef.current
    const rightVideo = rightVideoRef.current
    if (!leftVideo || !rightVideo) return

    const tempStream = leftVideo.srcObject
    leftVideo.srcObject = rightVideo.srcObject
    rightVideo.srcObject = tempStream

    if (leftStreamRef.current !== rightStreamRef.current) {
      ;[leftStreamRef.current, rightStreamRef.current] = [
        rightStreamRef.current,
        leftStreamRef.current,
      ]
    }
  }

  const captureDualBlob = async (): Promise<Blob> => {
    const leftVideo = leftVideoRef.current
    const rightVideo = rightVideoRef.current
    if (!leftVideo || !rightVideo) throw new Error('Video element is not ready.')

    const leftW = Math.max(1, leftVideo.videoWidth || 640)
    const leftH = Math.max(1, leftVideo.videoHeight || 480)
    const rightW = Math.max(1, rightVideo.videoWidth || 640)
    const rightH = Math.max(1, rightVideo.videoHeight || 480)
    const canvasH = Math.max(leftH, rightH)

    const canvas = document.createElement('canvas')
    canvas.width = leftW + rightW
    canvas.height = canvasH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas context is not available.')

    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(leftVideo, 0, 0, leftW, leftH)
    ctx.drawImage(rightVideo, leftW, 0, rightW, rightH)

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

    setIsUploading(true)
    setCameraError(null)

    try {
      let currentScanId = scanId
      if (currentScanId === null) {
        const data = await startScan('RIGHT')
        currentScanId = data.scanId
        setScanId(currentScanId)
      }

      const blob = await captureDualBlob()
      await uploadFingerImage(currentScanId, currentFinger, blob)

      setUploadedFingers((prev) => [...prev, currentFinger])

      if (currentFingerIndex < FINGERS.length - 1) {
        setCurrentFingerIndex((prev) => prev + 1)
      } else {
        await requestAnalyze(currentScanId)
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
      navigate('/scan/result', { state: { scanId } })
    }
  }, [isDone, navigate, scanId])

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
            <p className="hand-scan-fs__prompt">손톱이 잘 보이도록 홈에 맞춰 주세요</p>
          )}

          <p className="hand-scan-fs__finger-badge">
            {FINGER_LABELS[currentFinger]} · {currentFingerIndex + 1}/{FINGERS.length}
          </p>

          <button
            type="button"
            className="hand-scan-fs__switch"
            onClick={handleSwapCameras}
            aria-label="좌우 카메라 전환"
            disabled={videoInputs.length < 2 && leftDeviceId === rightDeviceId}
          >
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden="true">
              <path
                d="M7 7h12l-3-3M17 17H5l3 3"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M7 17V7M17 7v10"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

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

        <p className="hand-scan-page__subtitle">
          손등과 손톱이 잘 보이도록 촬영 박스 홈에 맞춰 주세요.
        </p>

        <div className="hand-scan__progress">
          {FINGERS.map((finger, idx) => (
            <span
              key={finger}
              className={[
                'hand-scan__progress-step',
                uploadedFingers.includes(finger) ? 'hand-scan__progress-step--done' : '',
                idx === currentFingerIndex && !isDone ? 'hand-scan__progress-step--current' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {FINGER_LABELS[finger]}
            </span>
          ))}
        </div>

        <div className="hand-scan__prep">
          <CameraSetupPreview />
          <p className="hand-scan__prep-hint">
            두 카메라가 동시에 촬영하여 손톱 형태와 곡률을 분석합니다.
          </p>
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
