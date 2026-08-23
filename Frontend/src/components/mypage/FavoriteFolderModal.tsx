import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  getSavedFolders,
  type SavedFolderResponse,
} from '@/apis/design'
import { ApiError } from '@/utils/apiClient'
import '@/styles/mypage.css'

type Props = {
  open: boolean
  onClose: () => void
  onConfirm: (choice: { folderId?: number; newFolderName?: string }) => Promise<void> | void
  mode?: 'like' | 'move'
  initialFolderId?: number | null
}

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
      })
      .catch(() => {
        setFolders([])
        setSelectedFolderId(null)
      })
      .finally(() => setLoading(false))
  }, [open, initialFolderId])

  if (!open) return null

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

  return createPortal(
    <div className="mypage-x__modal" role="dialog" aria-modal="true" aria-label="저장 위치">
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
        <h2 className="mypage-x__fav-folder-title">저장 위치</h2>

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
                onClick={() => {
                  setCreatingNew(false)
                  setSelectedFolderId(folder.folderId)
                }}
              >
                <FolderThumb folder={folder} />
                <div className="mypage-x__fav-folder-card-meta">
                  <strong>{folder.name}</strong>
                  <span>{folder.itemCount}개</span>
                </div>
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          className={`mypage-x__fav-folder-new-btn${creatingNew ? ' is-open' : ''}`}
          onClick={() => {
            setCreatingNew(true)
            setSelectedFolderId('new')
          }}
        >
          새 폴더 만들기
        </button>

        {creatingNew && (
          <div className="mypage-x__fav-folder-new">
            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="폴더 이름"
              maxLength={50}
              autoFocus
            />
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
            {saving ? '저장 중...' : mode === 'move' ? '위치 변경' : '찜하기'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
