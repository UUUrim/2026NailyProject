import { useEffect, useRef, useState, type RefObject } from 'react'
import { drawNailOverlays } from '@/features/mypage/utils/nailArRenderer'
import { getHandLandmarker } from '@/features/mypage/utils/handLandmarker'
import { resetLandmarkSmoothing, smoothLandmarks } from '@/features/mypage/utils/landmarkSmoothing'
import { prepareNailDesignAsset, type NailDesignAsset } from '@/features/mypage/utils/nailDesignAsset'
import { isKnownNailShape, loadShapeTemplate } from '@/features/mypage/utils/nailMeshAsset'
import { NailArScene } from '@/features/mypage/utils/nailArScene'
import { CameraFeedSelect } from '@/features/hand-scan/components/CameraFeedSelect'
import '@/styles/mypage.css'
import '@/styles/hand-scan.css'
import '@/styles/nail-ar-tryon.css'

const DEFAULT_CAMERA_DEVICE_ID = 'default'

function buildVideoConstraints(deviceId: string): MediaTrackConstraints {
  return deviceId === DEFAULT_CAMERA_DEVICE_ID
    ? { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } }
    : { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
}

type NailArTryOnModalProps = {
  imageUrl: string
  /** round/oval/almond/square/stiletto/ballerina 중 하나면 실측 3D 쉐입 템플릿을
   *  쓰고, 그 외(null/미확인 쉐입/템플릿 로드 실패)는 2D 방식으로 폴백한다. */
  shape: string | null
  /** detect 서버가 생성 시점에 뽑아낸 손가락별 매트 이미지 5장(있으면). 있으면
   *  로컬 세그멘테이션 대신 이걸 그대로 쓴다 - prepareNailDesignAsset() 참고. */
  nailTipCropUrls?: string[] | null
  onClose: () => void
}

type RenderMode = '2d' | '3d'

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

export function NailArTryOnModal({ imageUrl, shape, nailTipCropUrls, onClose }: NailArTryOnModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const meshCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const assetRef = useRef<NailDesignAsset | null>(null)
  const sceneRef = useRef<NailArScene | null>(null)
  const modeRef = useRef<RenderMode>('2d')
  const rafRef = useRef<number | null>(null)

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('AR 미리보기를 준비하고 있어요...')
  const [mode, setMode] = useState<RenderMode>('2d')
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState(DEFAULT_CAMERA_DEVICE_ID)

  // 드롭다운에서 다른 카메라를 고르면, 초기 진입 때와 같은 제약 조건으로 새 스트림만
  // 새로 받아 기존 스트림과 교체한다 - 디자인 에셋/HandLandmarker/3D 씬은 그대로 둔다.
  const handleCameraChange = async (deviceId: string) => {
    const video = videoRef.current
    if (!video) return
    try {
      setMessage('카메라를 전환하는 중...')
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: buildVideoConstraints(deviceId),
        audio: false,
      })
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = nextStream
      video.srcObject = nextStream
      await video.play()
      setSelectedDeviceId(deviceId)
      setMessage('손을 카메라에 맞춰 네일 디자인을 확인해 보세요.')
    } catch (error) {
      setMessage(getErrorMessage(error, '카메라를 전환할 수 없습니다.'))
    }
  }

  useEffect(() => {
    let cancelled = false

    const start = async () => {
      try {
        resetLandmarkSmoothing()
        setMessage('네일 디자인을 불러오는 중...')
        const asset = await prepareNailDesignAsset(imageUrl, nailTipCropUrls)
        if (cancelled) return
        assetRef.current = asset

        // 실측 3D 쉐입 템플릿을 쓸 수 있으면 3D로, 아니면(쉐입 불명/로드 실패) 기존
        // 2D 방식으로 조용히 폴백한다 - 카메라/HandLandmarker는 두 경로가 공유한다.
        let resolvedMode: RenderMode = '2d'
        if (isKnownNailShape(shape) && meshCanvasRef.current) {
          try {
            const template = await loadShapeTemplate(shape)
            if (cancelled) return
            const scene = new NailArScene(meshCanvasRef.current)
            scene.setTemplate(template)
            scene.setFingerTextures(asset)
            sceneRef.current = scene
            resolvedMode = '3d'
          } catch (e) {
            resolvedMode = '2d'
            // eslint-disable-next-line no-console
            console.error('3D 쉐입 템플릿 로드 실패, 2D로 폴백:', e)
          }
        }
        modeRef.current = resolvedMode
        setMode(resolvedMode)

        setMessage('AR 엔진을 준비하는 중...')
        await getHandLandmarker()
        if (cancelled) return

        setMessage('카메라를 연결하는 중...')
        const stream = await navigator.mediaDevices.getUserMedia({
          video: buildVideoConstraints(DEFAULT_CAMERA_DEVICE_ID),
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

        // 카메라 라벨은 getUserMedia로 권한을 얻은 뒤에야 채워지므로, 스트림이 실제로
        // 붙은 지금 시점에 열거해야 드롭다운에 "카메라 1" 대신 실제 기기명이 나온다.
        try {
          const devices = await navigator.mediaDevices.enumerateDevices()
          if (!cancelled) setVideoDevices(devices.filter((d) => d.kind === 'videoinput'))
        } catch {
          // 열거 실패해도 AR 자체는 계속 진행 - 드롭다운이 "기본 카메라"만 보여줄 뿐
        }

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
      sceneRef.current?.dispose()
      sceneRef.current = null
      resetLandmarkSmoothing()
    }
  }, [imageUrl, shape, nailTipCropUrls])

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
        const smoothedHands = smoothLandmarks(results.landmarks)
        if (modeRef.current === '3d' && sceneRef.current) {
          sceneRef.current.updateFromLandmarks(smoothedHands, width, height, true)
          sceneRef.current.render()
        } else {
          for (const landmarks of smoothedHands) {
            drawNailOverlays(ctx, landmarks, asset, width, height, true)
          }
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
          <button
            type="button"
            className="mypage-x__modal-close mypage-x__modal-close--plain nail-ar-tryon__close"
            onClick={onClose}
            aria-label="닫기"
          >
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
          <canvas
            ref={meshCanvasRef}
            className={`nail-ar-tryon__mesh-canvas${status === 'ready' && mode === '3d' ? ' is-visible' : ''}`}
          />

          {status === 'ready' && (
            <CameraFeedSelect
              label="카메라"
              value={selectedDeviceId}
              devices={videoDevices}
              onChange={(deviceId) => void handleCameraChange(deviceId)}
            />
          )}
        </div>

        <p className="nail-ar-tryon__hint">
          생성된 네일 이미지 형태를 따라 손톱 위에 디자인이 올라갑니다.
        </p>
      </div>
    </div>
  )
}
