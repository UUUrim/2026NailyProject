import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  deleteDesign,
  getDesignChatHistory,
  getDesignDetail,
  likeDesign,
  moveLikedDesign,
  shareDesign,
  unlikeDesign,
  unshareDesign,
  type DesignChatMessage,
  type DesignExtractedDetails,
  type SavedDesignResponse,
} from '@/entities/design/api'
import { FavoriteFolderModal } from '@/shared/components/FavoriteFolderModal'
import { DesignDetailsPanel } from '@/shared/components/DesignDetailsPanel'
import { ModalActionIcons } from '@/shared/components/ModalActionIcons'
import { ShareStatusBadge } from '@/shared/components/ShareStatusBadge'
import { NailArTryOnModal } from '@/features/mypage/components/NailArTryOnModal'
import { ApiError } from '@/shared/utils/apiClient'
import { downloadImage } from '@/shared/utils/downloadImage'
import '@/styles/mypage.css'
import '@/styles/design-chat.css'

type FolderRef = { folderId: number; name: string }

export type DesignImageDetailInput = {
  designId: number | null
  imageUrl: string
  createdAt?: string
  liked: boolean
  folder?: FolderRef | null
}

type Props = {
  image: DesignImageDetailInput | null
  onClose: () => void
  /** 찜하기/저장 위치 변경 뒤 서버가 돌려준 전체 응답을 그대로 넘겨준다 (해제 시에는 null) —
   * 목록을 들고 있는 화면(마이페이지 등)이 자기 favorites 배열을 그대로 갱신할 수 있게 하기 위함 */
  onLikeChange?: (designId: number, imageUrl: string, saved: SavedDesignResponse | null) => void
  /** 공유 상태가 바뀐 뒤 알려준다 */
  onShareChange?: (designId: number, shared: boolean) => void
  /** 삭제된 뒤 알려준다 (모달은 이후 자동으로 닫힘) */
  onDeleted?: (designId: number) => void
  /** 삭제 버튼을 보여줄지 (기본 true) — 마이페이지처럼 내 디자인을 관리하는 화면이 아니면 false로 끈다 */
  showDelete?: boolean
  /** "채팅 이력 보기" 토글을 보여줄지 (기본 true) */
  showChatHistoryToggle?: boolean
  /** "이미지 상세보기" 토글을 보여줄지 (기본 true) */
  showDesignDetailsToggle?: boolean
  /** 찜하기 버튼 + 찜 폴더명 배지를 보여줄지 (기본 true) */
  showLike?: boolean
  /** 공유 상태 배지 + 공유하기 버튼을 보여줄지 (기본 true) */
  showShare?: boolean
  /** AR로 미리보기 버튼을 보여줄지 (기본 true) */
  showAr?: boolean
  /** 이미지 다운로드 버튼을 보여줄지 (기본 true) */
  showDownload?: boolean
  /** 다른 모달(예: 채팅 이력 보기) 위에 한 겹 더 겹쳐 떠야 할 때 z-index를 한 단계 더 올린다 */
  stackedAboveModal?: boolean
}

// 이미지 위에 겹쳐 보이는 찜/폴더 UI를 다른 화면(디자인 결과 화면 등)에서도 그대로 재사용하기 위해 export
export const Icon = {
  heart: (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M12 20s-7-4.35-9.5-8.8C.8 8 2 4.5 5.4 4a4.9 4.9 0 0 1 6.6 2 4.9 4.9 0 0 1 6.6-2c3.4.5 4.6 4 3.9 7.2C19 15.65 12 20 12 20z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  ),
  chevronDown: (
    <svg viewBox="0 0 24 24" fill="none" width="13" height="13">
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
}

const ZOOM_MIN = 1
const ZOOM_MAX = 4
const WHEEL_ZOOM_SENSITIVITY = 0.0015

type LikeModalTarget = {
  designId: number
  imageUrl: string
  mode: 'like' | 'move'
  currentFolderId?: number | null
}

/**
 * 마이페이지 디자인/찜 탭에서 쓰던 이미지 상세모달을 그대로 뽑아낸 공용 컴포넌트.
 * 좋아요/공유/저장위치/삭제 API 호출은 이 컴포넌트가 직접 하고, 호출 화면은
 * onLikeChange/onShareChange/onDeleted 콜백으로 자기 목록 상태만 맞추면 된다.
 */
export function DesignImageDetailModal({
  image,
  onClose,
  onLikeChange,
  onShareChange,
  onDeleted,
  showDelete = true,
  showChatHistoryToggle = true,
  showDesignDetailsToggle = true,
  showLike = true,
  showShare = true,
  showAr = true,
  showDownload = true,
  stackedAboveModal = false,
}: Props) {
  const [viewDesignId, setViewDesignId] = useState<number | null>(null)
  const [viewImageUrl, setViewImageUrl] = useState('')
  const [viewLiked, setViewLiked] = useState(false)
  const [viewFolder, setViewFolder] = useState<FolderRef | null>(null)

  const [createdAt, setCreatedAt] = useState<string | undefined>(undefined)
  const [owner, setOwner] = useState<boolean | undefined>(undefined)
  const [shared, setShared] = useState(false)
  const [details, setDetails] = useState<DesignExtractedDetails | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [shareBusy, setShareBusy] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [showDesignDetails, setShowDesignDetails] = useState(false)
  const [arTryOnImageUrl, setArTryOnImageUrl] = useState<string | null>(null)
  const [shape, setShape] = useState<string | null>(null)
  const [nailTipCropUrls, setNailTipCropUrls] = useState<string[] | null>(null)
  const [likeModalTarget, setLikeModalTarget] = useState<LikeModalTarget | null>(null)

  // 채팅 이력 보기 (모달 안에서 이미지 영역을 채팅 재연으로 토글)
  const [showChatHistory, setShowChatHistory] = useState(false)
  const [chatHistory, setChatHistory] = useState<DesignChatMessage[]>([])
  const [isChatHistoryLoading, setIsChatHistoryLoading] = useState(false)
  const [chatHistoryError, setChatHistoryError] = useState<string | null>(null)
  const [chatDesignId, setChatDesignId] = useState<number | null>(null)
  // 채팅 이력 안의 이미지를 클릭했을 때 위에 띄우는, 확대/이동+다운로드만 가능한 축소판 상세모달
  const [chatHistoryZoomImage, setChatHistoryZoomImage] = useState<string | null>(null)

  // 이미지 확대/축소/이동
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const imageViewportRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setShowChatHistory(false)
    setChatHistory([])
    setChatHistoryError(null)
    setShowDesignDetails(false)
    setShareBusy(false)
    setIsBusy(false)

    if (!image) {
      setViewDesignId(null)
      setViewImageUrl('')
      setViewLiked(false)
      setViewFolder(null)
      setChatDesignId(null)
      setCreatedAt(undefined)
      setOwner(undefined)
      setShared(false)
      setDetails(null)
      setShape(null)
      setNailTipCropUrls(null)
      return
    }

    setViewDesignId(image.designId)
    setViewImageUrl(image.imageUrl)
    setViewLiked(image.liked)
    setViewFolder(image.folder ?? null)
    setChatDesignId(image.designId)
    setCreatedAt(image.createdAt)
    setOwner(undefined)
    setShared(false)
    setDetails(null)
    setShape(null)
    setNailTipCropUrls(null)

    if (image.designId == null) return
    let cancelled = false
    setDetailLoading(true)
    void getDesignDetail(image.designId)
      .then((detail) => {
        if (cancelled) return
        setShared(detail.shared)
        setOwner(detail.owner)
        setDetails(detail.details ?? null)
        setCreatedAt((prev) => detail.createdAt || prev)
        setShape(detail.shape ?? null)
        setNailTipCropUrls(detail.nailTipCropUrls ?? null)
      })
      .catch(() => {
        /* 상세 실패해도 이미지는 볼 수 있게 유지 */
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [image])

  useEffect(() => {
    if (!showChatHistory || chatDesignId == null) return
    let cancelled = false
    setIsChatHistoryLoading(true)
    setChatHistoryError(null)
    getDesignChatHistory(chatDesignId)
      .then((data) => {
        if (!cancelled) setChatHistory(data)
      })
      .catch(() => {
        if (!cancelled) setChatHistoryError('채팅 이력을 불러오지 못했어요.')
      })
      .finally(() => {
        if (!cancelled) setIsChatHistoryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [showChatHistory, chatDesignId])

  useEffect(() => {
    const viewport = imageViewportRef.current
    if (!viewport || !image) return

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
  }, [image])

  if (!image) return null

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

  const openMoveFolderModal = () => {
    if (viewDesignId == null) return
    setLikeModalTarget({
      designId: viewDesignId,
      imageUrl: viewImageUrl,
      mode: 'move',
      currentFolderId: viewFolder?.folderId ?? null,
    })
  }

  const handleToggleLike = async () => {
    if (viewDesignId == null || isBusy) return
    if (viewLiked) {
      setIsBusy(true)
      try {
        await unlikeDesign(viewDesignId, viewImageUrl)
        setViewLiked(false)
        setViewFolder(null)
        onLikeChange?.(viewDesignId, viewImageUrl, null)
      } catch (e) {
        alert(e instanceof ApiError ? e.message : '요청에 실패했습니다.')
      } finally {
        setIsBusy(false)
      }
      return
    }
    setLikeModalTarget({ designId: viewDesignId, imageUrl: viewImageUrl, mode: 'like' })
  }

  const confirmLikeWithFolder = async (choice: { folderId?: number; newFolderName?: string }) => {
    if (!likeModalTarget) return
    const { designId, imageUrl, mode } = likeModalTarget
    const saved = mode === 'move' ? await moveLikedDesign(designId, imageUrl, choice) : await likeDesign(designId, imageUrl, choice)
    if (designId === viewDesignId && imageUrl === viewImageUrl) {
      setViewLiked(true)
      setViewFolder(saved.folder)
    }
    onLikeChange?.(designId, imageUrl, saved)
  }

  const handleToggleShare = async () => {
    if (viewDesignId == null || !owner || shareBusy) return
    setShareBusy(true)
    try {
      const next = shared ? await unshareDesign(viewDesignId) : await shareDesign(viewDesignId)
      setShared(next.shared)
      setDetails((prev) => next.details ?? prev)
      onShareChange?.(viewDesignId, next.shared)
    } catch (e) {
      alert(e instanceof ApiError ? e.message : '공유 처리에 실패했습니다.')
    } finally {
      setShareBusy(false)
    }
  }

  const handleDelete = async () => {
    if (viewDesignId == null || isBusy) return
    if (!window.confirm('이 디자인을 삭제할까요? 삭제하면 되돌릴 수 없어요.')) return
    setIsBusy(true)
    try {
      await deleteDesign(viewDesignId)
      onDeleted?.(viewDesignId)
      onClose()
    } catch (e) {
      alert(e instanceof ApiError ? e.message : '삭제에 실패했습니다.')
    } finally {
      setIsBusy(false)
    }
  }

  const canManage = owner ?? false
  const folderLabel = viewFolder?.name ?? '기본'

  return (
    <div
      className={`mypage-x__modal${stackedAboveModal ? ' mypage-x__modal--stacked-2' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="디자인 상세"
    >
      <button type="button" className="mypage-x__modal-backdrop" aria-label="닫기" onClick={onClose} />
      <div className="mypage-x__modal-panel mypage-x__modal-panel--lg mypage-x__modal-panel--image">
        <button type="button" className="mypage-x__modal-close mypage-x__modal-close--plain" onClick={onClose} aria-label="닫기">
          ✕
        </button>

        <div
          ref={imageViewportRef}
          className={`mypage-x__modal-image-viewport mypage-x__modal-image-viewport--fit${zoom > 1 ? ' is-zoomed' : ''}${isDragging ? ' is-dragging' : ''}`}
          onMouseUp={stopDragging}
          onMouseLeave={stopDragging}
        >
          <img
            src={viewImageUrl || image.imageUrl}
            alt="네일 디자인 확대"
            className="mypage-x__modal-image"
            draggable={false}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            onMouseDown={handleImagePointerDown}
            onMouseMove={handleImagePointerMove}
          />

          {showLike && (
            <div className="mypage-x__modal-image-tools">
              <button
                type="button"
                className={`mypage-x__modal-heart${viewLiked ? ' is-liked' : ''}`}
                onClick={() => void handleToggleLike()}
                disabled={isBusy || viewDesignId == null}
                aria-label={viewLiked ? '찜 해제' : '찜하기'}
              >
                {Icon.heart}
              </button>
              {viewLiked && viewDesignId != null && (
                <button
                  type="button"
                  className="mypage-x__modal-folder-pill"
                  onClick={openMoveFolderModal}
                  title="저장 위치 변경"
                  aria-label={`저장 위치 변경 (현재: ${folderLabel})`}
                >
                  <span className="mypage-x__modal-folder-pill-text">{folderLabel}</span>
                  <span className="mypage-x__modal-folder-pill-icon" aria-hidden="true">
                    {Icon.chevronDown}
                  </span>
                </button>
              )}
            </div>
          )}

          {showShare && canManage && <ShareStatusBadge shared={shared} className="mypage-x__modal-share-corner" />}

          <div className="mypage-x__modal-zoom-controls">
            <span className="mypage-x__modal-zoom-value">{Math.round(zoom * 100)}%</span>
          </div>
        </div>

        {showDesignDetails && (
          <div id="design-image-detail-panel" className="mypage-x__modal-design-details">
            <DesignDetailsPanel details={details} loading={detailLoading} />
          </div>
        )}

        <div className="mypage-x__modal-info">
          {createdAt && <p className="mypage-x__modal-date">{createdAt}</p>}
          {showDesignDetailsToggle && (
            <button
              type="button"
              className={`mypage-x__modal-details-btn mypage-x__modal-details-btn--inline${showDesignDetails ? ' is-open' : ''}`}
              onClick={() => setShowDesignDetails((prev) => !prev)}
              aria-expanded={showDesignDetails}
              aria-controls="design-image-detail-panel"
            >
              {ModalActionIcons.details}
              <span>{showDesignDetails ? '상세 닫기' : '이미지 상세보기'}</span>
            </button>
          )}
        </div>
        <div className="mypage-x__modal-actions">
          {showChatHistoryToggle && viewDesignId != null && (
            <button type="button" className="mypage-x__modal-action--accent" onClick={() => setShowChatHistory(true)}>
              {ModalActionIcons.chat}
              <span>채팅 이력 보기</span>
            </button>
          )}
          {showDelete && viewDesignId != null && (
            <button
              type="button"
              className="mypage-x__modal-action--danger"
              onClick={() => void handleDelete()}
              disabled={isBusy || !canManage}
              title={!canManage ? '내 디자인만 삭제할 수 있어요' : undefined}
            >
              {ModalActionIcons.trash}
              <span>이미지 삭제</span>
            </button>
          )}
          {showDownload && (
            <button type="button" className="mypage-x__modal-action--ghost" onClick={() => void downloadImage(viewImageUrl, `naily-design-${Date.now()}.png`)}>
              {ModalActionIcons.download}
              <span>이미지 다운로드</span>
            </button>
          )}
          {showShare && viewDesignId != null && (
            <button
              type="button"
              className={`mypage-x__modal-action--ghost${shared ? ' is-active' : ''}`}
              onClick={() => void handleToggleShare()}
              disabled={shareBusy || !canManage}
              title={!canManage ? '내 디자인만 공유할 수 있어요' : undefined}
            >
              {ModalActionIcons.share}
              <span>{shareBusy ? '처리 중...' : shared ? '공유 해제' : '공유하기'}</span>
            </button>
          )}
          {showAr && (
            <button type="button" className="mypage-x__modal-action--accent" onClick={() => setArTryOnImageUrl(viewImageUrl)}>
              {ModalActionIcons.ar}
              <span>AR로 미리보기</span>
            </button>
          )}
        </div>
      </div>

      {showChatHistory && (
        <div className="mypage-x__modal mypage-x__modal--stacked" role="dialog" aria-modal="true" aria-label="채팅 이력">
          <button
            type="button"
            className="mypage-x__modal-backdrop"
            aria-label="닫기"
            onClick={() => setShowChatHistory(false)}
          />
          <div className="mypage-x__modal-panel mypage-x__chat-history-panel">
            <button
              type="button"
              className="mypage-x__modal-close mypage-x__modal-close--plain"
              onClick={() => setShowChatHistory(false)}
              aria-label="닫기"
            >
              ✕
            </button>
            {createdAt && <p className="mypage-x__modal-date mypage-x__chat-history-date">{createdAt}</p>}
            <div className="mypage-x__chat-history-scroll">
              <div className="design-chat__messages">
                {isChatHistoryLoading && <p style={{ textAlign: 'center', color: '#999' }}>불러오는 중…</p>}
                {chatHistoryError && <p style={{ textAlign: 'center', color: '#c0392b' }}>{chatHistoryError}</p>}
                {!isChatHistoryLoading && !chatHistoryError && chatHistory.length === 0 && (
                  <p style={{ textAlign: 'center', color: '#999' }}>
                    이 디자인은 채팅 없이 만들어졌거나, 저장된 대화 이력이 없어요.
                  </p>
                )}
                {chatHistory.map((msg, i) => (
                  <div key={i} className={`design-chat__row design-chat__row--${msg.role}`}>
                    {msg.role === 'assistant' && <img src="/images/logo.png" alt="" className="design-chat__avatar" />}
                    <div className={`design-chat__bubble design-chat__bubble--${msg.role}`}>
                      {msg.content.split('\n').map((line, j) => (
                        <p key={j}>{line}</p>
                      ))}
                      {msg.imageUrls && msg.imageUrls.length > 0 && (
                        <div className="design-chat__bubble-images">
                          {msg.imageUrls.map((url, k) => (
                            <div key={k} className="design-chat__bubble-image-wrap">
                              <img
                                src={url}
                                alt={`생성된 네일 디자인 ${k + 1}`}
                                style={{ cursor: 'zoom-in' }}
                                onClick={() => setChatHistoryZoomImage(url)}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <FavoriteFolderModal
        open={!!likeModalTarget}
        onClose={() => setLikeModalTarget(null)}
        onConfirm={confirmLikeWithFolder}
        mode={likeModalTarget?.mode ?? 'like'}
        initialFolderId={likeModalTarget?.currentFolderId ?? null}
      />

      {arTryOnImageUrl && (
        <NailArTryOnModal
          imageUrl={arTryOnImageUrl}
          shape={shape}
          nailTipCropUrls={nailTipCropUrls}
          onClose={() => setArTryOnImageUrl(null)}
        />
      )}

      {chatHistoryZoomImage && (
        <DesignImageDetailModal
          image={{ designId: null, imageUrl: chatHistoryZoomImage, liked: false, folder: null }}
          onClose={() => setChatHistoryZoomImage(null)}
          showDelete={false}
          showChatHistoryToggle={false}
          showDesignDetailsToggle={false}
          showLike={false}
          showShare={false}
          showAr={false}
          stackedAboveModal
        />
      )}
    </div>
  )
}
