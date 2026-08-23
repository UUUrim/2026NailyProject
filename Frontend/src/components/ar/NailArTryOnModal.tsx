import { useEffect, useRef, useState, type RefObject } from 'react'
import { drawNailOverlays } from '@/utils/nailArRenderer'
import { getHandLandmarker } from '@/utils/handLandmarker'
import { prepareNailDesignAsset, type NailDesignAsset } from '@/utils/nailDesignAsset'
import '@/styles/nail-ar-tryon.css'

type NailArTryOnModalProps = {
  imageUrl: string
  onClose: () => void
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return fallback
}

async function waitForVideoElement(videoRef: RefObject<HTMLVideoElement | null>) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (videoRef.current) return videoRef.current
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
  }
  throw new Error('카메라 화면을 초기화할 수 없습니다.')
}

export function NailArTryOnModal({ imageUrl, onClose }: NailArTryOnModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const assetRef = useRef<NailDesignAsset | null>(null)
  const rafRef = useRef<number | null>(null)

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('AR 미리보기를 준비하고 있어요...')

  useEffect(() => {
    let cancelled = false

    const start = async () => {
      try {
        setMessage('네일 디자인을 불러오는 중...')
        const asset = await prepareNailDesignAsset(imageUrl)
        if (cancelled) return
        assetRef.current = asset

        setMessage('AR 엔진을 준비하는 중...')
        await getHandLandmarker()
        if (cancelled) return

        setMessage('카메라를 연결하는 중...')
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'user' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        })

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        streamRef.current = stream
        const video = await waitForVideoElement(videoRef)
        if (cancelled) return

        video.srcObject = stream
        video.playsInline = true
        video.muted = true
        await video.play()

        if (cancelled) return
        setStatus('ready')
        setMessage('손을 카메라에 맞춰 네일 디자인을 확인해 보세요.')
      } catch (error) {
        if (cancelled) return
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        setStatus('error')
        setMessage(
          getErrorMessage(error, '카메라 또는 AR 엔진을 시작할 수 없습니다.'),
        )
      }
    }

    void start()

    return () => {
      cancelled = true
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [imageUrl])

  useEffect(() => {
    if (status !== 'ready') return

    let active = true
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    const render = async () => {
      if (!active) return

      const ctx = canvas.getContext('2d')
      const asset = assetRef.current
      if (!ctx || !asset || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(() => {
          void render()
        })
        return
      }

      const width = video.videoWidth
      const height = video.videoHeight
      if (width === 0 || height === 0) {
        rafRef.current = requestAnimationFrame(() => {
          void render()
        })
        return
      }

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }

      ctx.clearRect(0, 0, width, height)
      ctx.save()
      ctx.translate(width, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(video, 0, 0, width, height)
      ctx.restore()

      try {
        const landmarker = await getHandLandmarker()
        const results = landmarker.detectForVideo(video, performance.now())
        for (const landmarks of results.landmarks) {
          drawNailOverlays(ctx, landmarks, asset, width, height, true)
        }
      } catch {
        // ignore frame-level detection errors
      }

      rafRef.current = requestAnimationFrame(() => {
        void render()
      })
    }

    void render()

    return () => {
      active = false
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [status])

  return (
    <div className="nail-ar-tryon" role="dialog" aria-modal="true" aria-label="AR 네일 미리보기">
      <button type="button" className="nail-ar-tryon__backdrop" aria-label="닫기" onClick={onClose} />

      <div className="nail-ar-tryon__panel">
        <div className="nail-ar-tryon__header">
          <div>
            <h2 className="nail-ar-tryon__title">AR 네일 미리보기</h2>
            <p className="nail-ar-tryon__subtitle">{message}</p>
          </div>
          <button type="button" className="nail-ar-tryon__close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        <div className="nail-ar-tryon__stage">
          {status === 'loading' && <div className="nail-ar-tryon__loading">준비 중...</div>}
          {status === 'error' && <div className="nail-ar-tryon__error">{message}</div>}

          <video ref={videoRef} className="nail-ar-tryon__video" playsInline muted autoPlay />
          <canvas
            ref={canvasRef}
            className={`nail-ar-tryon__canvas${status === 'ready' ? ' is-visible' : ''}`}
          />
        </div>

        <p className="nail-ar-tryon__hint">
          생성된 네일 이미지 형태를 따라 손톱 위에 디자인이 올라갑니다.
        </p>
      </div>
    </div>
  )
}
