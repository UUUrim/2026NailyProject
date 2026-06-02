import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { PageBackLink } from '@/components/layout/PageBackLink'
import { usePersonalColorRecommender } from '@/services/aiContext'
import { buildHandScanAnalysis } from '@/utils/handScanAnalysis'
import { setHandScanResult } from '@/utils/handScanStorage'
import { setRecommendedSeasonCode } from '@/utils/personalColorStorage'
import '@/styles/hand-scan.css'

export function HandScanPage() {
  const navigate = useNavigate()
  const personalColorRecommender = usePersonalColorRecommender()
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('default')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

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

  const captureFrameBlob = async (): Promise<Blob> => {
    const video = videoRef.current
    if (!video) {
      throw new Error('Video element is not ready.')
    }

    const width = Math.max(1, video.videoWidth || 1280)
    const height = Math.max(1, video.videoHeight || 720)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Canvas context is not available.')
    }
    ctx.drawImage(video, 0, 0, width, height)

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to create image blob.'))), 'image/jpeg', 0.92)
    })
    return blob
  }

  const handleCompleteScan = async () => {
    if (!cameraOn) {
      setCameraError('먼저 카메라를 켜고 손을 촬영해 주세요.')
      return
    }

    setIsAnalyzing(true)
    setCameraError(null)

    try {
      const frame = await captureFrameBlob()
      const rec = await personalColorRecommender.recommend({ frame })
      const seasonCode = rec?.seasonCode ?? 'spring_light'
      const analysis = buildHandScanAnalysis(seasonCode)

      setRecommendedSeasonCode(seasonCode)
      setHandScanResult({
        ...analysis,
        capturedAt: new Date().toISOString(),
      })

      stopStream()
      navigate('/scan/result')
    } catch {
      setCameraError('손 스캔 분석에 실패했습니다. 카메라가 켜져 있는지 확인해 주세요.')
    } finally {
      setIsAnalyzing(false)
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

  return (
    <AppShell mainClassName="hand-scan-page">
      <PageBackLink to="/process" />

      <header className="hand-scan-page__intro">
        <h1>손 촬영 및 스캔</h1>
        <p>손등과 손톱이 잘 보이도록 카메라에 맞춰 주세요.</p>
      </header>

      <button
        type="button"
        className="hand-scan__start-camera"
        onClick={() => void handleStartCamera(selectedDeviceId)}
      >
        손 촬영하기
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

      <button
        type="button"
        className="hand-scan__complete"
        onClick={() => void handleCompleteScan()}
        disabled={!cameraOn || isAnalyzing}
      >
        {isAnalyzing ? '분석 중…' : '촬영 및 스캔 완료'}
      </button>
    </AppShell>
  )
}
