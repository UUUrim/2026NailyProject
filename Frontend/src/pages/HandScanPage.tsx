import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { PageBackLink } from '@/components/layout/PageBackLink'
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

const API_BASE = '/api'

export function HandScanPage() {
  const navigate = useNavigate()
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('default')

  // 촬영 진행 상태
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
    if (cameraOn) {
      await handleStartCamera(deviceId)
    }
  }

// 크롭 없이 원본 그대로 Blob 반환
  const captureAndCropBlob = async (): Promise<Blob> => {
    const video = videoRef.current
    if (!video) throw new Error('Video element is not ready.')

    const fullWidth = Math.max(1, video.videoWidth || 1280)
    const fullHeight = Math.max(1, video.videoHeight || 720)

    const canvas = document.createElement('canvas')
    canvas.width = fullWidth
    canvas.height = fullHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas context is not available.')

    ctx.drawImage(video, 0, 0, fullWidth, fullHeight)

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Failed to create image blob.'))),
          'image/jpeg',
          0.92,
      )
    })
  }

  // 스캔 세션 시작 → scanId 받아오기
  const startScanSession = async (): Promise<number> => {
    const token = localStorage.getItem('token')
    const res = await fetch(`${API_BASE}/scans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ handSide: 'RIGHT' }),
    })
    if (!res.ok) throw new Error('스캔 세션 시작에 실패했습니다.')
    const data = await res.json()
    return data.data.scanId as number
  }

  // 손가락 이미지 업로드
  const uploadFingerImage = async (id: number, finger: Finger, blob: Blob): Promise<void> => {
    const token = localStorage.getItem('token')
    const formData = new FormData()
    formData.append('file', blob, `${finger.toLowerCase()}.jpg`)

    const res = await fetch(`${API_BASE}/scans/${id}/images?finger=${finger}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    })
    if (!res.ok) throw new Error(`${FINGER_LABELS[finger]} 이미지 업로드에 실패했습니다.`)
  }

  // 분석 요청
  const requestAnalyze = async (id: number): Promise<void> => {
    const token = localStorage.getItem('token')
    const res = await fetch(`${API_BASE}/scans/${id}/analyze`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    if (!res.ok) throw new Error('분석 요청에 실패했습니다.')
  }

  // 촬영 버튼 클릭 → 현재 손가락 촬영 + 업로드
  const handleCaptureFinger = async () => {
    if (!cameraOn) {
      setCameraError('먼저 카메라를 켜 주세요.')
      return
    }

    setIsUploading(true)
    setCameraError(null)

    try {
      // 첫 번째 손가락이면 스캔 세션 먼저 시작
      let currentScanId = scanId
      if (currentScanId === null) {
        currentScanId = await startScanSession()
        setScanId(currentScanId)
      }

      // 촬영 + 크롭
      const blob = await captureAndCropBlob()

      // S3 업로드 (백엔드 경유)
      await uploadFingerImage(currentScanId, currentFinger, blob)

      setUploadedFingers((prev) => [...prev, currentFinger])

      // 다음 손가락으로
      if (currentFingerIndex < FINGERS.length - 1) {
        setCurrentFingerIndex((prev) => prev + 1)
      } else {
        // 5개 다 찍었으면 분석 요청
        await requestAnalyze(currentScanId)
        setIsDone(true)
        stopStream()
      }
    } catch (e) {
      setCameraError(e instanceof Error ? e.message : '오류가 발생했습니다. 다시 시도해 주세요.')
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
    return () => {
      stopStream()
    }
  }, [])

  // 완료 후 결과 페이지로 이동
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

        {/* 진행 상태 표시 */}
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