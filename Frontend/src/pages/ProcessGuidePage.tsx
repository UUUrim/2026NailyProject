import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { usePersonalColorRecommender } from '@/services/aiContext'
import { setRecommendedSeasonCode } from '@/utils/personalColorStorage'
import '@/styles/process-guide.css'

const STEPS = [
  { title: '손 촬영 및\n손 분석 결과 확인', description: '~단계 설명~' },
  { title: '네일팁 디자인 생성', description: '~단계 설명~' },
  { title: '네일팁 미리보기', description: '~단계 설명~' },
  { title: '3D 프린터 제작', description: '~단계 설명~' },
]

export function ProcessGuidePage() {
  const navigate = useNavigate()
  const personalColorRecommender = usePersonalColorRecommender()
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [seasonRecommendation, setSeasonRecommendation] = useState<string | null>(null)
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
      // ignore: some browsers block enumerateDevices before permission
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

  const handleRecommendSeason = async () => {
    try {
      const frame = await captureFrameBlob()
      const rec = await personalColorRecommender.recommend({ frame })
      if (!rec?.seasonCode) {
        setSeasonRecommendation(null)
        setCameraError('추천 시즌을 얻지 못했습니다. (연결된 모델이 없을 수 있어요)')
        return
      }
      setRecommendedSeasonCode(rec.seasonCode)
      setSeasonRecommendation(rec.seasonCode)
      setCameraError(null)
    } catch {
      setCameraError('시즌 추천에 실패했습니다. 카메라가 켜져 있는지 확인해 주세요.')
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
    <div className="process-guide">
      <header className="process-guide__header">
        <Link to="/" className="process-guide__logo">
          Naily
        </Link>
        <button type="button" className="process-guide__profile" aria-label="프로필">
          ㅇ
        </button>
      </header>

      <main className="process-guide__main">
        <h1 className="process-guide__title">OO 님의 네일팁은 다음과 같은 순서로 제작됩니다.</h1>

        <div className="process-guide__steps">
          {STEPS.map((step, index) => (
            <div key={step.title} className="process-guide__step-wrap">
              <article className="process-guide__step">
                <div className="process-guide__placeholder" aria-hidden="true" />
                <h2 className="process-guide__step-title">
                  {step.title.split('\n').map((line, lineIndex) => (
                    <span key={line}>
                      {lineIndex > 0 && <br />}
                      {line}
                    </span>
                  ))}
                </h2>
                <p className="process-guide__step-desc">{step.description}</p>
              </article>
              {index < STEPS.length - 1 && <span className="process-guide__arrow">→</span>}
            </div>
          ))}
        </div>

        <button
          type="button"
          className="process-guide__capture"
          onClick={() => void handleStartCamera(selectedDeviceId)}
        >
          손 촬영하기
        </button>
        <button
          type="button"
          className="process-guide__recommend-button"
          onClick={() => void handleRecommendSeason()}
          disabled={!cameraOn}
        >
          AI로 퍼스널컬러 시즌 추천
        </button>
        <button
          type="button"
          className="process-guide__design-button"
          onClick={() => navigate('/design/preferences')}
        >
          네일 디자인 생성하기
        </button>
        {seasonRecommendation && (
          <p className="process-guide__recommend-result">
            추천 시즌: <strong>{seasonRecommendation}</strong>
          </p>
        )}

        {cameraOn && (
          <section className="process-guide__camera">
            <div className="process-guide__camera-controls">
              <label className="process-guide__camera-label" htmlFor="cameraSelect">
                카메라 선택
              </label>
              <select
                id="cameraSelect"
                className="process-guide__camera-select"
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
                className="process-guide__camera-refresh"
                onClick={() => void refreshDeviceList()}
              >
                새로고침
              </button>
              <span className="process-guide__camera-selected" aria-label="선택된 카메라">
                {selectedLabel}
              </span>
            </div>
            <video ref={videoRef} autoPlay playsInline muted className="process-guide__video" />
          </section>
        )}
        {cameraError && <p className="process-guide__camera-error">{cameraError}</p>}
      </main>

      <footer className="process-guide__footer">
        <p className="process-guide__footer-logo">Naily</p>
        <p className="process-guide__copyright">© 2026. Naily(네일리) All rights reserved.</p>
        <span className="process-guide__mail" aria-hidden="true">
          ✉
        </span>
      </footer>
    </div>
  )
}
