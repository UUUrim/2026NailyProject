import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getCommunityDesigns,
  likeDesign,
  unlikeDesign,
  getLikedDesigns,
  type CommunityDesignResponse,
} from '@/apis/design'
import { downloadImage } from '@/utils/downloadImage'
import { isLoggedIn } from '@/utils/auth'
import { ApiError } from '@/utils/apiClient'
import '@/styles/mypage.css'

const VISIBLE_COUNT = 4
const ZOOM_MIN = 1
const ZOOM_MAX = 4
const WHEEL_ZOOM_SENSITIVITY = 0.0015

function likeKeyOf(designId: number, imageUrl: string) {
  return `${designId}-${imageUrl}`
}

export function GallerySection() {
  const navigate = useNavigate()

  const [designs, setDesigns] = useState<CommunityDesignResponse[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [pageIndex, setPageIndex] = useState(0)

  const [likedKeys, setLikedKeys] = useState<Set<string>>(new Set())
  const [detailDesign, setDetailDesign] = useState<CommunityDesignResponse | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  // ── 이미지 확대/축소/이동 (모달) ──────
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const imageViewportRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false

    getCommunityDesigns()
        .then((data) => {
          if (!cancelled) setDesigns(data)
        })
        .catch(() => {
          if (!cancelled) setDesigns([])
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false)
        })

    // 로그인 상태라면 내가 이미 찜한 디자인이 무엇인지 미리 받아와서 하트 표시에 반영
    if (isLoggedIn()) {
      getLikedDesigns()
          .then((favorites) => {
            if (cancelled) return
            setLikedKeys(new Set(favorites.map((f) => likeKeyOf(f.designId, f.imageUrl))))
          })
          .catch(() => {
            /* 찜 목록을 못 가져와도 둘러보기 자체는 정상 동작해야 하므로 무시 */
          })
    }

    return () => {
      cancelled = true
    }
  }, [])

  const pageCount = Math.max(1, Math.ceil(designs.length / VISIBLE_COUNT))
  const showArrows = designs.length > VISIBLE_COUNT
  const startIndex = pageIndex * VISIBLE_COUNT

  const visibleDesigns = useMemo(() => {
    if (designs.length === 0) return []
    if (designs.length <= VISIBLE_COUNT) return designs
    return Array.from({ length: VISIBLE_COUNT }, (_, offset) => {
      const index = (startIndex + offset) % designs.length
      return designs[index]
    })
  }, [designs, startIndex])

  const handlePrev = () => {
    setPageIndex((prev) => (prev - 1 + pageCount) % pageCount)
  }

  const handleNext = () => {
    setPageIndex((prev) => (prev + 1) % pageCount)
  }

  // ── 상세 모달 열기/닫기 ──────
  const openDetail = (design: CommunityDesignResponse) => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setDetailDesign(design)
  }

  const closeDetail = () => {
    setDetailDesign(null)
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  // ── 마우스 휠로 확대/축소 ──────
  useEffect(() => {
    const viewport = imageViewportRef.current
    if (!viewport || !detailDesign) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setZoom((z) => {
        const next = Math.min(
            ZOOM_MAX,
            Math.max(ZOOM_MIN, Number((z - e.deltaY * WHEEL_ZOOM_SENSITIVITY).toFixed(2))),
        )
        if (next === ZOOM_MIN) setPan({ x: 0, y: 0 })
        return next
      })
    }

    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [detailDesign])

  const handleImagePointerDown = (e: ReactMouseEvent<HTMLImageElement>) => {
    if (zoom <= ZOOM_MIN) return
    setIsDragging(true)
    dragStartRef.current.x = e.clientX
    dragStartRef.current.y = e.clientY
    dragStartRef.current.panX = pan.x
    dragStartRef.current.panY = pan.y
  }

  const handleImagePointerMove = (e: ReactMouseEvent<HTMLImageElement>) => {
    if (!isDragging) return
    const dx = e.clientX - dragStartRef.current.x
    const dy = e.clientY - dragStartRef.current.y
    setPan({ x: dragStartRef.current.panX + dx, y: dragStartRef.current.panY + dy })
  }

  const stopDragging = () => setIsDragging(false)

  // ── 로그인이 필요한 동작 공통 처리 ──────
  const requireLogin = () => {
    if (window.confirm('로그인 후 이용할 수 있는 기능이에요. 로그인 페이지로 이동할까요?')) {
      navigate('/login')
    }
  }

  // ── 찜하기 ──────
  const isLiked = (design: CommunityDesignResponse) => likedKeys.has(likeKeyOf(design.designId, design.imageUrl))

  const handleToggleLike = async (design: CommunityDesignResponse) => {
    if (!isLoggedIn()) {
      requireLogin()
      return
    }
    if (isBusy) return
    const key = likeKeyOf(design.designId, design.imageUrl)
    const liked = likedKeys.has(key)
    setIsBusy(true)
    try {
      if (liked) {
        await unlikeDesign(design.designId, design.imageUrl)
        setLikedKeys((prev) => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
      } else {
        await likeDesign(design.designId, design.imageUrl)
        setLikedKeys((prev) => new Set(prev).add(key))
      }
    } catch (e) {
      alert(e instanceof ApiError ? e.message : '요청에 실패했습니다.')
    } finally {
      setIsBusy(false)
    }
  }

  // ── 로컬 저장 ──────
  const handleDownload = async (design: CommunityDesignResponse) => {
    if (!isLoggedIn()) {
      requireLogin()
      return
    }
    await downloadImage(design.imageUrl, `naily-design-${Date.now()}.png`)
  }

  return (
      <section className="gallery-section" aria-labelledby="gallery-title">
        <h2 id="gallery-title" className="gallery-section__title">
          둘러보기
        </h2>
        <p className="gallery-section__subtitle">네일리 사용자들이 직접 만든 디자인이에요</p>

        {isLoading ? (
            <div className="gallery-section__carousel">
              <div className="gallery-section__track">
                {Array.from({ length: VISIBLE_COUNT }, (_, index) => (
                    <div key={index} className="gallery-section__item gallery-section__item--skeleton" />
                ))}
              </div>
            </div>
        ) : designs.length === 0 ? (
            <p className="gallery-section__empty">
              아직 생성된 디자인이 없어요. 가장 먼저 나만의 네일 디자인을 만들어 보세요!
            </p>
        ) : (
            <div className="gallery-section__carousel">
              {showArrows && (
                  <button
                      type="button"
                      className="gallery-section__arrow gallery-section__arrow--prev"
                      onClick={handlePrev}
                      aria-label="이전 이미지"
                  >
                    ‹
                  </button>
              )}

              <div className="gallery-section__track">
                {visibleDesigns.map((design, index) => (
                    <button
                        type="button"
                        key={`${design.designId}-${index}`}
                        className="gallery-section__item"
                        onClick={() => openDetail(design)}
                        aria-label="네일 디자인 확대해서 보기"
                    >
                      <img
                          src={design.imageUrl}
                          alt="네일리 사용자가 생성한 네일 디자인"
                          className="gallery-section__image"
                          loading="lazy"
                      />
                      {design.createdAt && (
                          <span className="gallery-section__item-date">{design.createdAt}</span>
                      )}
                      {isLiked(design) && <span className="gallery-section__item-liked">♥</span>}
                    </button>
                ))}
              </div>

              {showArrows && (
                  <button
                      type="button"
                      className="gallery-section__arrow gallery-section__arrow--next"
                      onClick={handleNext}
                      aria-label="다음 이미지"
                  >
                    ›
                  </button>
              )}
            </div>
        )}

        {/* ── 이미지 상세 모달 (확대/찜하기/로컬 저장) ───────────────────────── */}
        {detailDesign && (
            <div className="mypage-x__modal" role="dialog" aria-modal="true">
              <button
                  type="button"
                  className="mypage-x__modal-backdrop"
                  aria-label="닫기"
                  onClick={closeDetail}
              />
              <div className="mypage-x__modal-panel mypage-x__modal-panel--lg">
                <button
                    type="button"
                    className="mypage-x__modal-close"
                    onClick={closeDetail}
                    aria-label="닫기"
                >
                  ✕
                </button>

                <div
                    ref={imageViewportRef}
                    className={`mypage-x__modal-image-viewport${zoom > 1 ? ' is-zoomed' : ''}${isDragging ? ' is-dragging' : ''}`}
                    onMouseUp={stopDragging}
                    onMouseLeave={stopDragging}
                >
                  <img
                      src={detailDesign.imageUrl}
                      alt="네일리 사용자가 생성한 네일 디자인 확대"
                      className="mypage-x__modal-image"
                      draggable={false}
                      style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
                      onMouseDown={handleImagePointerDown}
                      onMouseMove={handleImagePointerMove}
                  />

                  <div className="mypage-x__modal-zoom-controls">
                    <span className="mypage-x__modal-zoom-value">{Math.round(zoom * 100)}%</span>
                  </div>
                </div>

                <div className="mypage-x__modal-info">
                  {detailDesign.createdAt && <p className="mypage-x__modal-date">{detailDesign.createdAt}</p>}
                </div>
                <div className="mypage-x__modal-actions">
                  <button type="button" onClick={() => void handleDownload(detailDesign)}>
                    로컬에 저장
                  </button>
                  <button
                      type="button"
                      className={isLiked(detailDesign) ? 'is-active' : ''}
                      onClick={() => void handleToggleLike(detailDesign)}
                      disabled={isBusy}
                  >
                    {isLiked(detailDesign) ? '♥ 찜 해제' : '♡ 찜하기'}
                  </button>
                </div>
              </div>
            </div>
        )}
      </section>
  )
}