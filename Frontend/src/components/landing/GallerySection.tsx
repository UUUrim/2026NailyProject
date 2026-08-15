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
  moveLikedDesign,
  unlikeDesign,
  getLikedDesigns,
  getDesignDetail,
  addDesignReaction,
  removeDesignReaction,
  type CommunityDesignResponse,
  type DesignExtractedDetails,
} from '@/apis/design'
import { FavoriteFolderModal } from '@/components/mypage/FavoriteFolderModal'
import { DesignDetailsPanel } from '@/components/design/DesignDetailsPanel'
import { ModalActionIcons } from '@/components/design/ModalActionIcons'
import { downloadImage } from '@/utils/downloadImage'
import { isLoggedIn } from '@/utils/auth'
import { ApiError } from '@/utils/apiClient'
import { ScrollReveal } from '@/components/landing/ScrollReveal'
import '@/styles/mypage.css'
import '@/styles/nail-design.css'

const VISIBLE_COUNT = 4
const ZOOM_MIN = 1
const ZOOM_MAX = 4
const WHEEL_ZOOM_SENSITIVITY = 0.0015

const HeartIcon = (
  <svg viewBox="0 0 24 24" fill="none" width="18" height="18" aria-hidden="true">
    <path
      d="M12 20s-7-4.35-9.5-8.8C.8 8 2 4.5 5.4 4a4.9 4.9 0 0 1 6.6 2 4.9 4.9 0 0 1 6.6-2c3.4.5 4.6 4 3.9 7.2C19 15.65 12 20 12 20z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  </svg>
)

const LikeIcon = ({ filled }: { filled?: boolean }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path
      d="M7 11v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h2a2 2 0 0 1 1.6.8L14 4.5A2.5 2.5 0 0 1 18 6.3V10h2.2a1.8 1.8 0 0 1 1.76 2.2l-1.3 6A2 2 0 0 1 18.7 20H9.5"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  </svg>
)

const ChevronDownIcon = (
  <svg viewBox="0 0 24 24" fill="none" width="13" height="13" aria-hidden="true">
    <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

function favKeyOf(designId: number, imageUrl: string) {
  return `${designId}-${imageUrl}`
}

function sortByLikeCount(list: CommunityDesignResponse[]) {
  return [...list].sort((a, b) => {
    const diff = (b.likeCount ?? 0) - (a.likeCount ?? 0)
    if (diff !== 0) return diff
    return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
  })
}

export function GallerySection() {
  const navigate = useNavigate()

  const [designs, setDesigns] = useState<CommunityDesignResponse[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [pageIndex, setPageIndex] = useState(0)

  const [favoritedKeys, setFavoritedKeys] = useState<Set<string>>(new Set())
  const [favoriteFolders, setFavoriteFolders] = useState<Record<string, { folderId: number; name: string }>>({})
  const [detailDesign, setDetailDesign] = useState<CommunityDesignResponse | null>(null)
  const [detailDetails, setDetailDetails] = useState<DesignExtractedDetails | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [showDesignDetails, setShowDesignDetails] = useState(false)
  const [favoriteModalTarget, setFavoriteModalTarget] = useState<{
    design: CommunityDesignResponse
    mode: 'like' | 'move'
  } | null>(null)
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
          if (!cancelled) setDesigns(sortByLikeCount(data))
        })
        .catch(() => {
          if (!cancelled) setDesigns([])
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false)
        })

    // 로그인 상태라면 찜 목록만 별도로 받아온다 (좋아요는 community 응답의 likedByMe 사용)
    if (isLoggedIn()) {
      getLikedDesigns()
          .then((favorites) => {
            if (cancelled) return
            setFavoritedKeys(new Set(favorites.map((f) => favKeyOf(f.designId, f.imageUrl))))
            const folderMap: Record<string, { folderId: number; name: string }> = {}
            favorites.forEach((f) => {
              if (f.folder) folderMap[favKeyOf(f.designId, f.imageUrl)] = f.folder
            })
            setFavoriteFolders(folderMap)
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
    setShowDesignDetails(false)
    setDetailDesign(design)
    setDetailDetails(design.details ?? null)
    setDetailLoading(true)
    void getDesignDetail(design.designId)
        .then((detail) => {
          setDetailDesign((prev) =>
              prev && prev.designId === design.designId
                  ? { ...prev, createdAt: detail.createdAt || prev.createdAt, details: detail.details }
                  : prev,
          )
          setDetailDetails(detail.details ?? null)
        })
        .catch(() => {
          /* 목록에 있던 details로 폴백 */
        })
        .finally(() => setDetailLoading(false))
  }

  const closeDetail = () => {
    setDetailDesign(null)
    setDetailDetails(null)
    setDetailLoading(false)
    setShowDesignDetails(false)
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

  // ── 찜 / 좋아요 (완전 분리) ──────
  const isFavorited = (design: CommunityDesignResponse) =>
      favoritedKeys.has(favKeyOf(design.designId, design.imageUrl))

  const isReactionLiked = (design: CommunityDesignResponse) => Boolean(design.likedByMe)

  const applyReactionState = (designId: number, likeCount: number, liked: boolean) => {
    const apply = (item: CommunityDesignResponse) =>
        item.designId === designId ? { ...item, likeCount, likedByMe: liked } : item
    setDesigns((prev) => sortByLikeCount(prev.map(apply)))
    setDetailDesign((prev) => (prev ? apply(prev) : prev))
  }

  const handleToggleFavorite = async (design: CommunityDesignResponse) => {
    if (!isLoggedIn()) {
      requireLogin()
      return
    }
    if (isBusy) return
    const key = favKeyOf(design.designId, design.imageUrl)
    if (!favoritedKeys.has(key)) {
      setFavoriteModalTarget({ design, mode: 'like' })
      return
    }
    setIsBusy(true)
    try {
      await unlikeDesign(design.designId, design.imageUrl)
      setFavoritedKeys((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
      setFavoriteFolders((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    } catch (e) {
      alert(e instanceof ApiError ? e.message : '요청에 실패했습니다.')
    } finally {
      setIsBusy(false)
    }
  }

  const handleToggleReaction = async (design: CommunityDesignResponse) => {
    if (!isLoggedIn()) {
      requireLogin()
      return
    }
    if (isBusy) return
    setIsBusy(true)
    try {
      const result = design.likedByMe
          ? await removeDesignReaction(design.designId)
          : await addDesignReaction(design.designId)
      applyReactionState(result.designId, result.likeCount, result.liked)
    } catch (e) {
      alert(e instanceof ApiError ? e.message : '요청에 실패했습니다.')
    } finally {
      setIsBusy(false)
    }
  }

  const confirmFavoriteWithFolder = async (choice: { folderId?: number; newFolderName?: string }) => {
    if (!favoriteModalTarget) return
    const { design, mode } = favoriteModalTarget
    const key = favKeyOf(design.designId, design.imageUrl)
    const saved =
        mode === 'move'
            ? await moveLikedDesign(design.designId, design.imageUrl, choice)
            : await likeDesign(design.designId, design.imageUrl, choice)
    setFavoritedKeys((prev) => new Set(prev).add(key))
    if (saved.folder) {
      setFavoriteFolders((prev) => ({ ...prev, [key]: saved.folder! }))
    }
  }

  // ── 로컬 저장 ──────
  const handleDownload = async (design: CommunityDesignResponse) => {
    await downloadImage(design.imageUrl, `naily-design-${Date.now()}.png`)
  }

  return (
      <section className="gallery-section landing-section--viewport" aria-labelledby="gallery-title">
        <div className="landing-section__shell">
        <div className="landing-section__inner">
        <ScrollReveal>
        <h2 id="gallery-title" className="landing-section__title">
          AI <span className="landing-section__highlight">디자인</span> 둘러보기
        </h2>
        <p className="landing-section__subtitle">
          다른 사용자들이 AI로 만든 네일 디자인에서 영감을 받아 보세요
        </p>
        </ScrollReveal>

        <ScrollReveal delay={140}>
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
                    ←
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
                      {isFavorited(design) && (
                          <span className="gallery-section__item-liked" aria-label="찜함">
                            ♥
                          </span>
                      )}
                      <span className="gallery-section__item-likes" aria-label={`좋아요 ${design.likeCount ?? 0}`}>
                        <LikeIcon filled />
                        <em>{design.likeCount ?? 0}</em>
                      </span>
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
                    →
                  </button>
              )}
            </div>
        )}
        </ScrollReveal>

        {/* ── 이미지 상세 모달 (찜/좋아요 분리 · 마이페이지와 동일 레이아웃) ─── */}
        {detailDesign && (
            <div className="mypage-x__modal" role="dialog" aria-modal="true" aria-label="공유 디자인 상세">
              <button
                  type="button"
                  className="mypage-x__modal-backdrop"
                  aria-label="닫기"
                  onClick={closeDetail}
              />
              <div className="mypage-x__modal-panel mypage-x__modal-panel--lg mypage-x__modal-panel--image">
                <button
                    type="button"
                    className="mypage-x__modal-close mypage-x__modal-close--plain"
                    onClick={closeDetail}
                    aria-label="닫기"
                >
                  ✕
                </button>

                <div
                    ref={imageViewportRef}
                    className={`mypage-x__modal-image-viewport mypage-x__modal-image-viewport--fit${zoom > 1 ? ' is-zoomed' : ''}${isDragging ? ' is-dragging' : ''}`}
                    onMouseUp={stopDragging}
                    onMouseLeave={stopDragging}
                >
                  <img
                      src={detailDesign.imageUrl}
                      alt="네일리 사용자가 공유한 네일 디자인 확대"
                      className="mypage-x__modal-image"
                      draggable={false}
                      style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
                      onMouseDown={handleImagePointerDown}
                      onMouseMove={handleImagePointerMove}
                  />

                  <div className="mypage-x__modal-image-tools">
                    <button
                        type="button"
                        className={`mypage-x__modal-heart${isFavorited(detailDesign) ? ' is-liked' : ''}`}
                        onClick={() => void handleToggleFavorite(detailDesign)}
                        disabled={isBusy}
                        aria-label={isFavorited(detailDesign) ? '찜 해제' : '찜하기'}
                    >
                      {HeartIcon}
                    </button>
                    {isFavorited(detailDesign) && (
                        <button
                            type="button"
                            className="mypage-x__modal-folder-pill"
                            onClick={() => setFavoriteModalTarget({ design: detailDesign, mode: 'move' })}
                            title="저장 위치 변경"
                            aria-label={`저장 위치 변경 (현재: ${favoriteFolders[favKeyOf(detailDesign.designId, detailDesign.imageUrl)]?.name ?? '기본'})`}
                        >
                          <span className="mypage-x__modal-folder-pill-text">
                            {favoriteFolders[favKeyOf(detailDesign.designId, detailDesign.imageUrl)]?.name ?? '기본'}
                          </span>
                          <span className="mypage-x__modal-folder-pill-icon" aria-hidden="true">
                            {ChevronDownIcon}
                          </span>
                        </button>
                    )}
                  </div>

                  <span className="mypage-x__modal-share-corner mypage-x__share-badge is-on">
                    둘러보기 공유
                  </span>

                  <div className="mypage-x__modal-zoom-controls">
                    <span className="mypage-x__modal-zoom-value">{Math.round(zoom * 100)}%</span>
                  </div>
                </div>

                {showDesignDetails && (
                    <div id="gallery-design-details" className="mypage-x__modal-design-details">
                      <DesignDetailsPanel details={detailDetails} loading={detailLoading} />
                    </div>
                )}

                <div className="mypage-x__modal-info">
                  {detailDesign.createdAt && <p className="mypage-x__modal-date">{detailDesign.createdAt}</p>}
                  <button
                      type="button"
                      className={`mypage-x__modal-details-btn mypage-x__modal-details-btn--inline${showDesignDetails ? ' is-open' : ''}`}
                      onClick={() => setShowDesignDetails((prev) => !prev)}
                      aria-expanded={showDesignDetails}
                      aria-controls="gallery-design-details"
                  >
                    {ModalActionIcons.details}
                    <span>{showDesignDetails ? '상세 닫기' : '이미지 상세보기'}</span>
                  </button>
                </div>
                <div className="mypage-x__modal-actions">
                  <button
                      type="button"
                      className={`mypage-x__modal-action--accent${isReactionLiked(detailDesign) ? ' is-active' : ''}`}
                      onClick={() => void handleToggleReaction(detailDesign)}
                      disabled={isBusy}
                      aria-pressed={isReactionLiked(detailDesign)}
                  >
                    {ModalActionIcons.like(isReactionLiked(detailDesign))}
                    <span>{isReactionLiked(detailDesign) ? '좋아요 취소' : '좋아요'}</span>
                  </button>
                  <button
                      type="button"
                      className="mypage-x__modal-action--ghost"
                      onClick={() => void handleDownload(detailDesign)}
                  >
                    {ModalActionIcons.download}
                    <span>이미지 다운로드</span>
                  </button>
                </div>
              </div>
            </div>
        )}

        <FavoriteFolderModal
          open={!!favoriteModalTarget}
          onClose={() => setFavoriteModalTarget(null)}
          onConfirm={confirmFavoriteWithFolder}
          mode={favoriteModalTarget?.mode ?? 'like'}
          initialFolderId={
            favoriteModalTarget
                ? favoriteFolders[favKeyOf(favoriteModalTarget.design.designId, favoriteModalTarget.design.imageUrl)]?.folderId ?? null
                : null
          }
        />
        </div>
        </div>
      </section>
  )
}