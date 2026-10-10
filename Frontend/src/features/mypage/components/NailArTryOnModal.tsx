import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { drawNailOverlays } from '@/features/mypage/utils/nailArRenderer'
import { getHandLandmarker } from '@/features/mypage/utils/handLandmarker'
import { HandTracker } from '@/features/mypage/utils/landmarkSmoothing'
import { NailFitter, type NailDetector } from '@/features/mypage/utils/nailFit'
import { preloadNailSegmenter } from '@/features/mypage/utils/nailSegmenter'
import { prepareNailDesignAsset, type NailDesignAsset } from '@/features/mypage/utils/nailDesignAsset'
import { isKnownNailShape, loadShapeTemplate } from '@/features/mypage/utils/nailMeshAsset'
import { NailArScene } from '@/features/mypage/utils/nailArScene'
import { CameraFeedSelect } from '@/features/hand-scan/components/CameraFeedSelect'
import '@/styles/mypage.css'
import '@/styles/hand-scan.css'
import '@/styles/nail-ar-tryon.css'

const DEFAULT_CAMERA_DEVICE_ID = 'default'
// Reprocess an unchanged camera frame after this long anyway, in case a
// browser doesn't advance video.currentTime for live streams.
const STALE_FRAME_MS = 100

// 개발 모드에서 화면 구석에 보여 주는, 지금 손톱을 찾는 방식
const DETECTOR_LABELS: Record<NailDetector, string> = {
  loading: '분할 모델 불러오는 중 (그동안 색 기반)',
  webgpu: '분할 모델 · GPU(WebGPU)',
  wasm: '분할 모델 · CPU(WASM)',
  failed: '색 기반 (분할 모델 실패 - 콘솔 확인)',
}

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

// iPhone Safari처럼 페이지 전체화면 API가 없는 브라우저에서는 창만 화면에 꽉 채운다.
function canUseDocumentFullscreen() {
  return typeof document !== 'undefined' && document.fullscreenEnabled && !!document.documentElement.requestFullscreen
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
  const trackerRef = useRef(new HandTracker())
  const fitterRef = useRef<NailFitter | null>(null)
  // 이 모달이 직접 페이지 전체화면을 켰을 때만, 끌 때/닫힐 때 다시 꺼 준다.
  const ownsDocumentFullscreenRef = useRef(false)

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('AR 미리보기를 준비하고 있어요...')
  const [mode, setMode] = useState<RenderMode>('2d')
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState(DEFAULT_CAMERA_DEVICE_ID)
  const [detector, setDetector] = useState<NailDetector | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const toggleFullscreen = () => {
    if (isFullscreen) {
      setIsFullscreen(false)
      if (ownsDocumentFullscreenRef.current) {
        ownsDocumentFullscreenRef.current = false
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
      }
      return
    }
    setIsFullscreen(true)
    // 창(패널)이 아니라 페이지 전체를 전체화면으로 올린다 - 카메라 선택 메뉴가
    // document.body로 포털되어서, 패널만 올리면 그 메뉴가 보이지 않는다.
    if (canUseDocumentFullscreen() && !document.fullscreenElement) {
      ownsDocumentFullscreenRef.current = true
      document.documentElement.requestFullscreen().catch(() => {
        // 막혀도 창은 이미 화면을 꽉 채웠으니 그대로 둔다
        ownsDocumentFullscreenRef.current = false
      })
    }
  }

  // 헤더를 더블클릭해도 전체화면을 켜고 끈다.
  const handleHeaderDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return
    toggleFullscreen()
  }

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
      setMessage('손등이 카메라를 향하게 손을 비춰 네일 디자인을 확인해 보세요.')
    } catch (error) {
      setMessage(getErrorMessage(error, '카메라를 전환할 수 없습니다.'))
    }
  }

  useEffect(() => {
    let cancelled = false
    const tracker = trackerRef.current

    const start = async () => {
      try {
        tracker.reset()
        fitterRef.current?.reset()
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
            console.error('3D 쉐입 템플릿 로드 실패, 2D로 폴백:', e)
          }
        }
        modeRef.current = resolvedMode
        setMode(resolvedMode)

        setMessage('AR 엔진을 준비하는 중...')
        // The nail model is big; start it now but don't wait for it - until
        // it's ready, nails are found by color (see nailFit.ts).
        preloadNailSegmenter().catch(() => {})
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
        setMessage('손등이 카메라를 향하게 손을 비춰 네일 디자인을 확인해 보세요.')
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
      tracker.reset()
      fitterRef.current?.reset()
    }
  }, [imageUrl, shape, nailTipCropUrls])

  useEffect(() => {
    if (status !== 'ready') return

    let active = true
    let lastFrameTime = -1
    let lastProcessedAt = 0
    let lastDetector: NailDetector | null = null
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

      const resized = canvas.width !== width || canvas.height !== height
      if (resized) {
        canvas.width = width
        canvas.height = height
      }

      // The camera delivers ~30 fps while this loop runs at the display rate:
      // process each frame once - the canvases keep showing its result.
      const now = performance.now()
      if (!resized && video.currentTime === lastFrameTime && now - lastProcessedAt < STALE_FRAME_MS) {
        rafRef.current = requestAnimationFrame(() => {
          void render()
        })
        return
      }
      lastFrameTime = video.currentTime
      lastProcessedAt = now

      ctx.clearRect(0, 0, width, height)
      ctx.save()
      ctx.translate(width, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(video, 0, 0, width, height)
      ctx.restore()

      try {
        const landmarker = await getHandLandmarker()
        const hands = trackerRef.current.update(landmarker.detectForVideo(video, now), now)
        // Find each nail in the raw frame so tips land on the real cuticle.
        fitterRef.current ??= new NailFitter()
        const fits = fitterRef.current.update(video, hands, width, height, now)
        if (fitterRef.current.detector !== lastDetector) {
          lastDetector = fitterRef.current.detector
          setDetector(lastDetector)
        }
        if (modeRef.current === '3d' && sceneRef.current) {
          sceneRef.current.updateFromHands(hands, width, height, true, fits)
          sceneRef.current.render()
        } else {
          for (const hand of hands) {
            drawNailOverlays(ctx, hand, asset, width, height, true, fits.get(hand.id))
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

  // 모달이 떠 있는 동안 뒤 페이지 스크롤을 잠근다 - 페이지 스크롤바가 화면 오른쪽 폭을 차지하지
  // 않아야 창이 화면 정가운데에 오고, 전체화면에서도 스크롤바가 보이지 않는다.
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('nail-ar-tryon-scroll-lock')
    return () => root.classList.remove('nail-ar-tryon-scroll-lock')
  }, [])

  // Esc나 브라우저 UI로 페이지 전체화면이 꺼지면 창도 원래 크기로 돌린다.
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && ownsDocumentFullscreenRef.current) {
        ownsDocumentFullscreenRef.current = false
        setIsFullscreen(false)
      }
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      if (ownsDocumentFullscreenRef.current && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {})
      }
      ownsDocumentFullscreenRef.current = false
    }
  }, [])

  // 페이지 전체화면은 브라우저가 Esc를 처리하므로, 창만 키운 경우에만 직접 되돌린다.
  useEffect(() => {
    if (!isFullscreen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.fullscreenElement) setIsFullscreen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isFullscreen])

  // body에 바로 붙여 띄운다 - 이 모달을 여는 화면/모달 쪽 조상에 transform·filter가 있으면
  // position: fixed가 화면이 아니라 그 조상 기준이 되어 창이 정가운데에서 벗어나기 때문.
  return createPortal(
    <div
      className={`nail-ar-tryon${isFullscreen ? ' is-fullscreen' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="AR 네일 미리보기"
    >
      <button type="button" className="nail-ar-tryon__backdrop" aria-label="닫기" onClick={onClose} />

      <div className="nail-ar-tryon__panel">
        <div className="nail-ar-tryon__header" onDoubleClick={handleHeaderDoubleClick}>
          <span className="nail-ar-tryon__badge" aria-hidden="true">
            AR
          </span>
          <div className="nail-ar-tryon__heading">
            <h2 className="nail-ar-tryon__title">AR 네일 미리보기</h2>
            <p className={`nail-ar-tryon__subtitle is-${status}`} title={message} aria-live="polite">
              {message}
            </p>
          </div>
          <div className="nail-ar-tryon__actions">
            <button
              type="button"
              className="nail-ar-tryon__icon-btn"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? '전체화면 종료' : '전체화면'}
              title={isFullscreen ? '전체화면 종료' : '전체화면'}
            >
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                <path
                  d={
                    isFullscreen
                      ? 'M8 3.5V8H3.5M12 3.5V8h4.5M8 16.5V12H3.5M12 16.5V12h4.5'
                      : 'M3.5 8V3.5H8M16.5 8V3.5H12M3.5 12v4.5H8M16.5 12v4.5H12'
                  }
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              className="mypage-x__modal-close mypage-x__modal-close--plain nail-ar-tryon__close"
              onClick={onClose}
              aria-label="닫기"
              title="닫기"
            >
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                <path
                  d="M5 5l10 10M15 5L5 15"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="nail-ar-tryon__stage">
          {status === 'loading' && (
            <div className="nail-ar-tryon__loading">
              <span className="nail-ar-tryon__spinner" aria-hidden="true" />
              준비 중...
            </div>
          )}
          {status === 'error' && (
            <div className="nail-ar-tryon__error">
              <span className="nail-ar-tryon__error-icon" aria-hidden="true">
                !
              </span>
              {message}
            </div>
          )}

          <video ref={videoRef} className="nail-ar-tryon__video" playsInline muted autoPlay />
          <canvas
            ref={canvasRef}
            className={`nail-ar-tryon__canvas${status === 'ready' ? ' is-visible' : ''}`}
          />
          <canvas
            ref={meshCanvasRef}
            className={`nail-ar-tryon__mesh-canvas${status === 'ready' && mode === '3d' ? ' is-visible' : ''}`}
          />

          {/* 왼쪽 위 카메라 선택, 오른쪽 위 (개발 모드) 손톱 인식 표시 */}
          {status === 'ready' && (
            <div className="nail-ar-tryon__topbar">
              <CameraFeedSelect
                label="카메라"
                value={selectedDeviceId}
                devices={videoDevices}
                onChange={(deviceId) => void handleCameraChange(deviceId)}
              />
              {import.meta.env.DEV && detector && (
                <div className={`nail-ar-tryon__detector is-${detector}`} title={DETECTOR_LABELS[detector]}>
                  <span className="nail-ar-tryon__detector-dot" aria-hidden="true" />
                  <span className="nail-ar-tryon__detector-label">손톱 인식</span>
                  <span className="nail-ar-tryon__detector-value">{DETECTOR_LABELS[detector]}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
