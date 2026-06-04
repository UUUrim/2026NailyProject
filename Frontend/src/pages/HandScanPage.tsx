import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { PageBackLink } from '@/components/layout/PageBackLink'
import { startScan, uploadFingerImage, requestAnalyze } from '@/api/scan'
import { ApiError } from '@/utils/apiClient'
import '@/styles/hand-scan.css'

const FINGERS = ['THUMB', 'INDEX', 'MIDDLE', 'RING', 'PINKY'] as const
type Finger = (typeof FINGERS)[number]

const FINGER_LABELS: Record<Finger, string> = {
  THUMB: '엄지',
  INDEX: '검지',
  MIDDLE: '중지',
  RING: '약지',
  PINKY: '새끼',
}

export function HandScanPage() {
  const navigate = useNavigate()
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('default')

  const [currentFingerIndex, setCurrentFingerIndex] = useState(0)
  const [scanId, setScanId] = useState<number | null>(null)
  const [uploadedFingers, setUploadedFingers] = useState<Finger[]>([])
  const [isDone, setIsDone] = useState(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const currentFinger = FINGERS[currentFingerIndex]

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }

  const refreshDeviceList = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videos = devices.filter((d) => d.kind === 'videoinput')
      setVideoInputs(videos)
      if (selectedDeviceId !== 'default' && !videos.some((v) => v.deviceId === selectedDeviceId)) {
        setSelectedDeviceId('default')
      }
    } catch {
      // ignore
    }
  }

  const handleStartCamera = async (deviceId?: string) => {
    try {
      stopStream()
      const videoConstraint =
          deviceId && deviceId !== 'default'
              ? { deviceId: { exact: deviceId } }
              : { facingMode: 'user' }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraint,
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      setCameraError(null)
      setCameraOn(true)
      await refreshDeviceList()
    } catch {
      setCameraError('카메라 권한을 허용한 뒤 다시 시도해 주세요.')
    }
  }

  const handleChangeCamera = async (deviceId: string) => {
    setSelectedDeviceId(deviceId)
    if (cameraOn) await handleStartCamera(deviceId)
  }

  const captureBlob = async (): Promise<Blob> => {
    const video = videoRef.current
    if (!video) throw new Error('Video element is not ready.')

    const w = Math.max(1, video.videoWidth || 1280)
    const h = Math.max(1, video.videoHeight || 720)
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
    if (!cameraOn) {
      setCameraError('먼저 카메라를 켜 주세요.')
      return
    }

    setIsUploading(true)
    setCameraError(null)

    try {
      // 첫 손가락이면 스캔 세션 시작 → POST /scans { handSide: 'RIGHT' }
      let currentScanId = scanId
      if (currentScanId === null) {
        const data = await startScan('RIGHT')
        currentScanId = data.scanId
        setScanId(currentScanId)
      }

      // 촬영 → POST /scans/{scanId}/images?finger=THUMB
      const blob = await captureBlob()
      await uploadFingerImage(currentScanId, currentFinger, blob)

      setUploadedFingers((prev) => [...prev, currentFinger])

      if (currentFingerIndex < FINGERS.length - 1) {
        setCurrentFingerIndex((prev) => prev + 1)
      } else {
        // 5장 완료 → POST /scans/{scanId}/analyze
        await requestAnalyze(currentScanId)
        setIsDone(true)
        stopStream()
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

  const selectedLabel = useMemo(() => {
    if (selectedDeviceId === 'default') return '기본 카메라'
    const found = videoInputs.find((d) => d.deviceId === selectedDeviceId)
    return found?.label || '카메라'
  }, [selectedDeviceId, videoInputs])

  useEffect(() => {
    return () => { stopStream() }
  }, [])

  useEffect(() => {
    if (isDone) {
      navigate('/scan/result', { state: { scanId } })
    }
  }, [isDone, navigate, scanId])

  return (
      <AppShell mainClassName="hand-scan-page">
        <PageBackLink to="/process" />

        <header className="hand-scan-page__intro">
          <h1>손 촬영 및 스캔</h1>
          <p>손등과 손톱이 잘 보이도록 카메라에 맞춰 주세요.</p>
        </header>

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

        {!isDone && (
            <p className="hand-scan__current-finger">
              현재 촬영: <strong>{FINGER_LABELS[currentFinger]}</strong> ({currentFingerIndex + 1} / {FINGERS.length})
            </p>
        )}

        <button
            type="button"
            className="hand-scan__start-camera"
            onClick={() => void handleStartCamera(selectedDeviceId)}
            disabled={cameraOn}
        >
          {cameraOn ? '카메라 켜짐' : '카메라 켜기'}
        </button>

        {cameraOn && (
            <section className="hand-scan__camera">
              <div className="hand-scan__camera-controls">
                <label className="hand-scan__camera-label" htmlFor="handScanCameraSelect">
                  카메라 선택
                </label>
                <select
                    id="handScanCameraSelect"
                    className="hand-scan__camera-select"
                    value={selectedDeviceId}
                    onChange={(e) => void handleChangeCamera(e.target.value)}
                >
                  <option value="default">기본 카메라</option>
                  {videoInputs.map((device, index) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `카메라 ${index + 1}`}
                      </option>
                  ))}
                </select>
                <button
                    type="button"
                    className="hand-scan__camera-refresh"
                    onClick={() => void refreshDeviceList()}
                >
                  새로고침
                </button>
                <span className="hand-scan__camera-selected">{selectedLabel}</span>
              </div>
              <video ref={videoRef} autoPlay playsInline muted className="hand-scan__video" />
            </section>
        )}

        {cameraError && <p className="hand-scan__error">{cameraError}</p>}

        {!isDone && (
            <button
                type="button"
                className="hand-scan__complete"
                onClick={() => void handleCaptureFinger()}
                disabled={!cameraOn || isUploading}
            >
              {isUploading
                  ? '업로드 중…'
                  : `${FINGER_LABELS[currentFinger]} 촬영 (${currentFingerIndex + 1}/${FINGERS.length})`}
            </button>
        )}
      </AppShell>
  )
}