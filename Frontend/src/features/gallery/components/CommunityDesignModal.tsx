import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { CommunityDesignResponse, DesignExtractedDetails } from '@/entities/design/api'
import { NailArTryOnModal } from '@/features/mypage/components/NailArTryOnModal'
import { DesignDetailsPanel } from '@/shared/components/DesignDetailsPanel'
import { ModalActionIcons } from '@/shared/components/ModalActionIcons'
import '@/styles/mypage.css'
import '@/styles/nail-design.css'

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

const ChevronDownIcon = (
  <svg viewBox="0 0 24 24" fill="none" width="13" height="13" aria-hidden="true">
    <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

type CommunityDesignModalProps = {
  design: CommunityDesignResponse
  details: DesignExtractedDetails | null
  detailsLoading: boolean
  /** AR 미리보기용 네일팁 쉐입·손가락별 손톱팁 이미지 (상세 조회 응답) */
  shape: string | null
  nailTipCropUrls: string[] | null
  favorited: boolean
  folderName: string
  busy: boolean
  /** 찜 폴더 선택 모달처럼 위에 다른 모달이 떠 있으면 false — Esc가 그 모달 대신 이 모달을 닫지 않게 */
  closeOnEscape?: boolean
  onClose: () => void
  onToggleFavorite: () => void
  onMoveFolder: () => void
  onToggleReaction: () => void
  onDownload: () => void
}

/** 둘러보기 디자인 상세 — 찜(폴더 저장)과 좋아요를 따로 누를 수 있고, 휠/드래그로 확대해서 본다. */
export function CommunityDesignModal({
  design,
  details,
  detailsLoading,
  shape,
  nailTipCropUrls,
  favorited,
  folderName,
  busy,
  closeOnEscape = true,
  onClose,
  onToggleFavorite,
  onMoveFolder,
  onToggleReaction,
  onDownload,
}: CommunityDesignModalProps) {
  const [zoom, setZoom] = useState(ZOOM_MIN)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [arOpen, setArOpen] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const liked = Boolean(design.likedByMe)

  // 모달이 떠 있는 동안 뒤 페이지 스크롤을 잠근다
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  // AR 창이 떠 있으면 Esc는 그 창(전체화면 종료)에 맡기고 상세 모달은 닫지 않는다
  useEffect(() => {
    if (!closeOnEscape || arOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeOnEscape, arOpen, onClose])

  // ── 마우스 휠로 확대/축소 ──────
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setZoom((z) => {
        const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number((z - e.deltaY * WHEEL_ZOOM_SENSITIVITY).toFixed(2))))
        if (next === ZOOM_MIN) setPan({ x: 0, y: 0 })
        return next
      })
    }

    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [])

  const handleImagePointerDown = (e: ReactMouseEvent<HTMLImageElement>) => {
    if (zoom <= ZOOM_MIN) return
    setIsDragging(true)
    dragStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
  }

  const handleImagePointerMove = (e: ReactMouseEvent<HTMLImageElement>) => {
    if (!isDragging) return
    const dx = e.clientX - dragStartRef.current.x
    const dy = e.clientY - dragStartRef.current.y
    setPan({ x: dragStartRef.current.panX + dx, y: dragStartRef.current.panY + dy })
  }

  const stopDragging = () => setIsDragging(false)

  return (
    <div className="mypage-x__modal" role="dialog" aria-modal="true" aria-label="공유 디자인 상세">
      <button type="button" className="mypage-x__modal-backdrop" aria-label="닫기" onClick={onClose} />
      <div className="mypage-x__modal-panel mypage-x__modal-panel--lg mypage-x__modal-panel--image">
        <button
          type="button"
          className="mypage-x__modal-close mypage-x__modal-close--plain"
          onClick={onClose}
          aria-label="닫기"
        >
          ✕
        </button>

        <div
          ref={viewportRef}
          className={`mypage-x__modal-image-viewport mypage-x__modal-image-viewport--fit${zoom > 1 ? ' is-zoomed' : ''}${isDragging ? ' is-dragging' : ''}`}
          onMouseUp={stopDragging}
          onMouseLeave={stopDragging}
        >
          <img
            src={design.imageUrl}
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
              className={`mypage-x__modal-heart${favorited ? ' is-liked' : ''}`}
              onClick={onToggleFavorite}
              disabled={busy}
              aria-label={favorited ? '찜 해제' : '찜하기'}
            >
              {HeartIcon}
            </button>
            {favorited && (
              <button
                type="button"
                className="mypage-x__modal-folder-pill"
                onClick={onMoveFolder}
                title="저장 위치 변경"
                aria-label={`저장 위치 변경 (현재: ${folderName})`}
              >
                <span className="mypage-x__modal-folder-pill-text">{folderName}</span>
                <span className="mypage-x__modal-folder-pill-icon" aria-hidden="true">
                  {ChevronDownIcon}
                </span>
              </button>
            )}
          </div>

          <span className="mypage-x__modal-share-corner mypage-x__share-badge is-on">둘러보기 공유</span>

          <div className="mypage-x__modal-zoom-controls">
            <span className="mypage-x__modal-zoom-value">{Math.round(zoom * 100)}%</span>
          </div>
        </div>

        {showDetails && (
          <div id="gallery-design-details" className="mypage-x__modal-design-details">
            <DesignDetailsPanel details={details} loading={detailsLoading} />
          </div>
        )}

        <div className="mypage-x__modal-info">
          {design.createdAt && <p className="mypage-x__modal-date">{design.createdAt}</p>}
          <button
            type="button"
            className={`mypage-x__modal-details-btn mypage-x__modal-details-btn--inline${showDetails ? ' is-open' : ''}`}
            onClick={() => setShowDetails((prev) => !prev)}
            aria-expanded={showDetails}
            aria-controls="gallery-design-details"
          >
            {ModalActionIcons.details}
            <span>{showDetails ? '상세 닫기' : '이미지 상세보기'}</span>
          </button>
        </div>
        <div className="mypage-x__modal-actions">
          <button
            type="button"
            className={`gallery-modal__like${liked ? ' is-active' : ''}`}
            onClick={onToggleReaction}
            disabled={busy}
            aria-pressed={liked}
          >
            {ModalActionIcons.like(liked)}
            <span>
              {liked ? '좋아요 취소' : '좋아요'}
              <em className="gallery-modal__like-count">{design.likeCount ?? 0}</em>
            </span>
          </button>
          <button type="button" className="mypage-x__modal-action--ghost" onClick={onDownload}>
            {ModalActionIcons.download}
            <span>이미지 다운로드</span>
          </button>
          {/* 쉐입·손톱팁 정보가 오기 전에 열면 도중에 AR이 다시 시작되므로 상세 조회가 끝난 뒤에 연다 */}
          <button
            type="button"
            className="mypage-x__modal-action--accent"
            onClick={() => setArOpen(true)}
            disabled={detailsLoading}
          >
            {ModalActionIcons.ar}
            <span>AR로 미리보기</span>
          </button>
        </div>
      </div>

      {arOpen && (
        <NailArTryOnModal
          imageUrl={design.imageUrl}
          shape={shape}
          nailTipCropUrls={nailTipCropUrls}
          onClose={() => setArOpen(false)}
        />
      )}
    </div>
  )
}
