import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  getSavedFolders,
  type SavedFolderResponse,
} from '@/entities/design/api'
import { ApiError } from '@/shared/utils/apiClient'
import '@/styles/mypage.css'

type Props = {
  open: boolean
  onClose: () => void
  onConfirm: (choice: { folderId?: number; newFolderName?: string }) => Promise<void> | void
  mode?: 'like' | 'move'
  initialFolderId?: number | null
}

const PlusIcon = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
)

const CloseIcon = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
)

function FolderThumb({ folder }: { folder: SavedFolderResponse }) {
  const thumbs = folder.recentImageUrls ?? []
  return (
    <div className="mypage-x__folder-thumbs mypage-x__folder-thumbs--sm" aria-hidden="true">
      <div className="mypage-x__folder-thumb-main">
        {thumbs[0] ? <img src={thumbs[0]} alt="" /> : <span />}
      </div>
      <div className="mypage-x__folder-thumb-side">
        <div>{thumbs[1] ? <img src={thumbs[1]} alt="" /> : <span />}</div>
        <div>{thumbs[2] ? <img src={thumbs[2]} alt="" /> : <span />}</div>
      </div>
    </div>
  )
}

export function FavoriteFolderModal({
  open,
  onClose,
  onConfirm,
  mode = 'like',
  initialFolderId = null,
}: Props) {
  const [folders, setFolders] = useState<SavedFolderResponse[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedFolderId, setSelectedFolderId] = useState<number | 'new' | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creatingNew, setCreatingNew] = useState(false)
  // "새 폴더 만들기"로 들어가기 전에 골라뒀던 폴더 — 취소하면 여기로 되돌아간다
  const lastPickedFolderIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setNewFolderName('')
    setCreatingNew(false)
    setLoading(true)
    void getSavedFolders()
      .then((list) => {
        setFolders(list)
        const preferred =
          (initialFolderId != null && list.find((f) => f.folderId === initialFolderId)?.folderId) ||
          list.find((f) => f.isDefault)?.folderId ||
          list[0]?.folderId ||
          null
        setSelectedFolderId(preferred)
        lastPickedFolderIdRef.current = preferred
      })
      .catch(() => {
        setFolders([])
        setSelectedFolderId(null)
      })
      .finally(() => setLoading(false))
  }, [open, initialFolderId])

  if (!open) return null

  const startCreatingNew = () => {
    setError(null)
    setCreatingNew(true)
    setSelectedFolderId('new')
  }

  const cancelCreatingNew = () => {
    setError(null)
    setCreatingNew(false)
    setNewFolderName('')
    setSelectedFolderId(lastPickedFolderIdRef.current)
  }

  const pickFolder = (folderId: number) => {
    setError(null)
    setCreatingNew(false)
    setSelectedFolderId(folderId)
    lastPickedFolderIdRef.current = folderId
  }

  const handleSubmit = async () => {
    setSaving(true)
    setError(null)
    try {
      if (creatingNew || selectedFolderId === 'new') {
        const name = newFolderName.trim()
        if (!name) {
          setError('새 폴더 이름을 입력해 주세요.')
          setSaving(false)
          return
        }
        await onConfirm({ newFolderName: name })
      } else if (selectedFolderId == null) {
        setError('저장할 폴더를 선택해 주세요.')
        setSaving(false)
        return
      } else {
        await onConfirm({ folderId: selectedFolderId })
      }
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : mode === 'move' ? '저장 위치 변경에 실패했습니다.' : '찜하기에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const confirmLabel = saving
    ? '저장 중...'
    : creatingNew
      ? mode === 'move'
        ? '새 폴더 만들고 옮기기'
        : '새 폴더 만들고 찜하기'
      : mode === 'move'
        ? '이 폴더로 옮기기'
        : '이 폴더에 찜하기'

  return createPortal(
    <div className="mypage-x__modal" role="dialog" aria-modal="true" aria-label="폴더 선택">
      <button type="button" className="mypage-x__modal-backdrop" onClick={onClose} />
      <div className="mypage-x__modal-panel mypage-x__fav-folder-modal">
        <button
          type="button"
          className="mypage-x__modal-close mypage-x__modal-close--plain"
          onClick={onClose}
          aria-label="닫기"
        >
          ✕
        </button>
        <h2 className="mypage-x__fav-folder-title">폴더 선택</h2>

        {loading ? (
          <p className="mypage-x__loading">폴더를 불러오는 중...</p>
        ) : (
          <div className="mypage-x__fav-folder-grid" role="listbox">
            {folders.map((folder) => (
              <button
                key={folder.folderId}
                type="button"
                role="option"
                aria-selected={selectedFolderId === folder.folderId && !creatingNew}
                className={`mypage-x__fav-folder-card${selectedFolderId === folder.folderId && !creatingNew ? ' is-selected' : ''}`}
                onClick={() => pickFolder(folder.folderId)}
              >
                <FolderThumb folder={folder} />
                <div className="mypage-x__fav-folder-card-meta">
                  <strong>{folder.name}</strong>
                  <span>{folder.itemCount}개</span>
                </div>
              </button>
            ))}

            {creatingNew ? (
              <div className="mypage-x__fav-folder-card mypage-x__fav-folder-card--new is-selected">
                <div className="mypage-x__fav-folder-new-thumb" aria-hidden="true">
                  {PlusIcon}
                </div>
                <div className="mypage-x__fav-folder-card-meta mypage-x__fav-folder-card-meta--input">
                  <input
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void handleSubmit()
                      }
                    }}
                    placeholder="폴더 이름"
                    maxLength={50}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="mypage-x__fav-folder-new-cancel"
                    onClick={cancelCreatingNew}
                    aria-label="새 폴더 만들기 취소"
                  >
                    {CloseIcon}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="mypage-x__fav-folder-card mypage-x__fav-folder-card--new"
                onClick={startCreatingNew}
              >
                <div className="mypage-x__fav-folder-new-thumb" aria-hidden="true">
                  {PlusIcon}
                </div>
                <div className="mypage-x__fav-folder-card-meta">
                  <strong>새 폴더 만들기</strong>
                </div>
              </button>
            )}
          </div>
        )}

        {error && <p className="mypage-x__message">{error}</p>}

        <div className="mypage-x__modal-actions">
          <button type="button" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button
            type="button"
            className="mypage-x__modal-action--accent"
            onClick={() => void handleSubmit()}
            disabled={saving || loading}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
