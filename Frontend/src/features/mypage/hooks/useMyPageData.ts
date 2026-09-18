import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getMyPrintOrders, type PrintOrderResponse as NailTipPrintOrder } from '@/entities/print/api'
import {
  getMyDesigns,
  getLikedDesigns,
  getSavedFolders,
  reorderSavedFolders,
  likeDesign,
  moveLikedDesign,
  unlikeDesign,
  createSavedFolder,
  getDesignChatHistory,
  deleteSavedFolder,
  type DesignImageResponse,
  type SavedDesignResponse,
  type SavedFolderResponse,
  type DesignChatMessage,
} from '@/entities/design/api'
import { type DesignImageDetailInput } from '@/features/mypage/components/DesignImageDetailModal'
import { getScanResult } from '@/entities/scan/api'
import { useMyScansQuery } from '@/entities/scan/queries'
import { ApiError } from '@/shared/utils/apiClient'
import { buildScanSessions, isFullyAnalyzedSession, type ScanSession } from '@/shared/utils/scanDetail'
import { type LikeModalTarget, buildScanDetail, type ScanDetail } from '@/features/mypage/shared'

const DESIGNS_KEY = ['mypage', 'designs'] as const
const FAVORITES_KEY = ['mypage', 'favorites'] as const
const PRINTS_KEY = ['mypage', 'prints'] as const
const FOLDERS_KEY = ['mypage', 'folders'] as const

export function useMyPageData() {
  const queryClient = useQueryClient()

  // ── 데이터 (서버 상태 — 각각 독립적으로 캐시/재검증된다) ──────
  const designsQuery = useQuery({ queryKey: DESIGNS_KEY, queryFn: getMyDesigns })
  const favoritesQuery = useQuery({ queryKey: FAVORITES_KEY, queryFn: getLikedDesigns })
  const scansQuery = useMyScansQuery()
  const printsQuery = useQuery({
    queryKey: PRINTS_KEY,
    queryFn: getMyPrintOrders,
    refetchInterval: (query) => {
      const prints = query.state.data ?? []
      const hasActive = prints.some(p =>
          p.status === 'PRINTING' ||
          p.status === 'MERGING' ||
          p.status === 'MERGED'
      )
      return hasActive ? 5000 : false
    }
  })
  const foldersQuery = useQuery({ queryKey: FOLDERS_KEY, queryFn: getSavedFolders })

  const designs = designsQuery.data ?? []
  const favorites = favoritesQuery.data ?? []
  const scans = scansQuery.data ?? []
  const prints = printsQuery.data ?? []
  const savedFolders = foldersQuery.data ?? []

  // 원래 코드처럼, 5개 목록이 전부 한 번은 응답(성공/실패 상관없이)받을 때까지만 로딩으로 본다.
  const isLoading =
      designsQuery.isLoading ||
      favoritesQuery.isLoading ||
      scansQuery.isLoading ||
      printsQuery.isLoading ||
      foldersQuery.isLoading

  useEffect(() => {
    if (favoritesQuery.error) console.error('찜 목록 조회 실패', favoritesQuery.error)
  }, [favoritesQuery.error])
  useEffect(() => {
    if (foldersQuery.error) console.error('찜 폴더 조회 실패', foldersQuery.error)
  }, [foldersQuery.error])

  const [detailImage, setDetailImage] = useState<DesignImageDetailInput | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  // ── 채팅 이력 보기 (모달 안에서 이미지 영역을 채팅 재연으로 토글) ──────
  const [showChatHistory, setShowChatHistory] = useState(false)
  const [chatHistory, setChatHistory] = useState<DesignChatMessage[]>([])
  const [isChatHistoryLoading, setIsChatHistoryLoading] = useState(false)
  const [chatHistoryError, setChatHistoryError] = useState<string | null>(null)
  const [confirmedDesignId, setConfirmedDesignId] = useState<number | null>(null)

  useEffect(() => {
    if (!showChatHistory || confirmedDesignId == null) return
    let cancelled = false
    setIsChatHistoryLoading(true)
    setChatHistoryError(null)
    getDesignChatHistory(confirmedDesignId)
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
  }, [showChatHistory, confirmedDesignId])

  const [likeModalTarget, setLikeModalTarget] = useState<LikeModalTarget | null>(null)
  const [selectedFavoriteFolderId, setSelectedFavoriteFolderId] = useState<number | null>(null)

  // ── 찜 탭 폴더 목록에서 바로 새 폴더 만들기 ──────
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderNameInStrip, setNewFolderNameInStrip] = useState('')
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [createFolderError, setCreateFolderError] = useState<string | null>(null)

  const startCreatingFolderInStrip = () => {
    setCreateFolderError(null)
    setCreatingFolder(true)
  }

  const cancelCreatingFolderInStrip = () => {
    setCreatingFolder(false)
    setNewFolderNameInStrip('')
    setCreateFolderError(null)
  }

  const handleCreateFolderInStrip = async () => {
    const name = newFolderNameInStrip.trim()
    if (!name) {
      setCreateFolderError('폴더 이름을 입력해 주세요.')
      return
    }
    setIsCreatingFolder(true)
    setCreateFolderError(null)
    try {
      const created = await createSavedFolder(name)
      queryClient.setQueryData<SavedFolderResponse[]>(FOLDERS_KEY, (prev) => [...(prev ?? []), created])
      cancelCreatingFolderInStrip()
    } catch (e) {
      setCreateFolderError(e instanceof ApiError ? e.message : '폴더를 만들지 못했습니다.')
    } finally {
      setIsCreatingFolder(false)
    }
  }

  const openDetailImage = (img: DesignImageDetailInput) => setDetailImage(img)
  const closeDetailImage = () => setDetailImage(null)

  // ── 이미지 상세 모달의 찜/공유/삭제 콜백 — 각자 자기 목록의 쿼리 캐시만 맞추면 된다 ──────
  const handleDetailLikeChange = (designId: number, imageUrl: string, saved: SavedDesignResponse | null) => {
    queryClient.setQueryData<SavedDesignResponse[]>(FAVORITES_KEY, (prev) => {
      const base = (prev ?? []).filter((f) => !(f.designId === designId && f.imageUrl === imageUrl))
      return saved ? [saved, ...base] : base
    })
    void queryClient.invalidateQueries({ queryKey: FOLDERS_KEY })
  }

  const handleDetailShareChange = (designId: number, shared: boolean) => {
    queryClient.setQueryData<DesignImageResponse[]>(DESIGNS_KEY, (prev) =>
        (prev ?? []).map((d) => (d.designId === designId ? { ...d, shared } : d)),
    )
  }

  const handleDetailDeleted = (designId: number) => {
    queryClient.setQueryData<DesignImageResponse[]>(DESIGNS_KEY, (prev) => (prev ?? []).filter((d) => d.designId !== designId))
    queryClient.setQueryData<SavedDesignResponse[]>(FAVORITES_KEY, (prev) => (prev ?? []).filter((f) => f.designId !== designId))
  }

  const likedKeySet = useMemo(
      () => new Set(favorites.map((f) => `${f.designId}-${f.imageUrl}`)),
      [favorites],
  )

  // 한 번의 촬영에서 나온 왼손/오른손 기록을 하나의 세션으로 묶고, 실제 분석 결과값이
  // 전부 채워진 것만 이력으로 노출한다 (utils/scanDetail — 출력/스캔 페이지와 동일한 기준 사용)
  const scanSessions = useMemo<ScanSession[]>(
      () => buildScanSessions(scans).filter(isFullyAnalyzedSession),
      [scans],
  )

  // ── 손 분석 세션 상세 모달 ──────
  const [scanDetailSession, setScanDetailSession] = useState<ScanSession | null>(null)
  const openScanDetail = (session: ScanSession) => setScanDetailSession(session)
  const closeScanDetail = () => setScanDetailSession(null)

  // ── 네일팁 출력 상세 모달 ──────
  const [printDetailOrder, setPrintDetailOrder] = useState<NailTipPrintOrder | null>(null)
  const [printDetailScan, setPrintDetailScan] = useState<ScanDetail | null>(null)
  const [isLoadingPrintDetail, setIsLoadingPrintDetail] = useState(false)

  const openPrintDetail = async (order: NailTipPrintOrder) => {
    setPrintDetailOrder(order)
    setPrintDetailScan(null)
    if (!order.leftScanId && !order.rightScanId) {
      setIsLoadingPrintDetail(false)
      return
    }
    setIsLoadingPrintDetail(true)
    try {
      const [left, right] = await Promise.all([
        order.leftScanId ? getScanResult(order.leftScanId).catch(() => null) : Promise.resolve(null),
        order.rightScanId ? getScanResult(order.rightScanId).catch(() => null) : Promise.resolve(null),
      ])
      setPrintDetailScan(buildScanDetail(left, right))
    } finally {
      setIsLoadingPrintDetail(false)
    }
  }

  const closePrintDetail = () => {
    setPrintDetailOrder(null)
    setPrintDetailScan(null)
    setIsLoadingPrintDetail(false)
  }

  const findFavoriteFolder = (designId: number, imageUrl: string) =>
      favorites.find((f) => f.designId === designId && f.imageUrl === imageUrl)?.folder ?? null

  const openLikeFolderModal = (designId: number, imageUrl: string) => {
    setLikeModalTarget({ designId, imageUrl, mode: 'like' })
  }

  const openMoveFolderModal = (designId: number, imageUrl: string) => {
    setLikeModalTarget({
      designId,
      imageUrl,
      mode: 'move',
      currentFolderId: findFavoriteFolder(designId, imageUrl)?.folderId ?? null,
    })
  }

  const toggleLikeFromGrid = async (designId: number, imageUrl: string) => {
    const key = `${designId}-${imageUrl}`
    const isLiked = likedKeySet.has(key)
    if (isLiked) {
      try {
        await unlikeDesign(designId, imageUrl)
        queryClient.setQueryData<SavedDesignResponse[]>(FAVORITES_KEY, (prev) =>
            (prev ?? []).filter((f) => !(f.designId === designId && f.imageUrl === imageUrl)),
        )
        void queryClient.invalidateQueries({ queryKey: FOLDERS_KEY })
        if (detailImage && detailImage.designId === designId && detailImage.imageUrl === imageUrl) {
          setDetailImage({ ...detailImage, liked: false, folder: null })
        }
      } catch (e) {
        alert(e instanceof ApiError ? e.message : '요청에 실패했습니다.')
      }
      return
    }
    openLikeFolderModal(designId, imageUrl)
  }

  const confirmLikeWithFolder = async (choice: { folderId?: number; newFolderName?: string }) => {
    if (!likeModalTarget) return
    const { designId, imageUrl, mode } = likeModalTarget
    const saved =
        mode === 'move'
            ? await moveLikedDesign(designId, imageUrl, choice)
            : await likeDesign(designId, imageUrl, choice)
    queryClient.setQueryData<SavedDesignResponse[]>(FAVORITES_KEY, (prev) => [
      saved,
      ...(prev ?? []).filter((f) => !(f.designId === designId && f.imageUrl === imageUrl)),
    ])
    await queryClient.invalidateQueries({ queryKey: FOLDERS_KEY })
    if (detailImage && detailImage.designId === designId && detailImage.imageUrl === imageUrl) {
      setDetailImage({ ...detailImage, liked: true, folder: saved.folder })
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 폴더 드래그 재정렬 UI가 아직 없어 미사용(원본 MyPage.tsx부터 이미 미사용 상태)
  const moveFolderOrder = async (folderId: number, direction: -1 | 1, sortedFolders: SavedFolderResponse[]) => {
    const ids = sortedFolders.map((f) => f.folderId)
    const idx = ids.indexOf(folderId)
    const next = idx + direction
    if (idx < 0 || next < 0 || next >= ids.length) return
        ;[ids[idx], ids[next]] = [ids[next], ids[idx]]
    queryClient.setQueryData<SavedFolderResponse[]>(FOLDERS_KEY, (prev) => {
      const byId = new Map((prev ?? []).map((f) => [f.folderId, f]))
      return ids.map((id, order) => {
        const folder = byId.get(id)!
        return { ...folder, sortOrder: order }
      })
    })
    try {
      await reorderSavedFolders(ids)
    } catch {
      void queryClient.invalidateQueries({ queryKey: FOLDERS_KEY })
    }
  }

  const [folderToDelete, setFolderToDelete] = useState<SavedFolderResponse | null>(null)
  const [folderDeleteError, setFolderDeleteError] = useState<string | null>(null)

  const openDeleteFolderModal = (folder: SavedFolderResponse) => {
    setFolderDeleteError(null)
    setFolderToDelete(folder)
  }

  const closeDeleteFolderModal = () => {
    if (isBusy) return
    setFolderToDelete(null)
    setFolderDeleteError(null)
  }

  const confirmDeleteFolder = async () => {
    if (!folderToDelete || isBusy) return
    setIsBusy(true)
    setFolderDeleteError(null)
    try {
      await deleteSavedFolder(folderToDelete.folderId)
      if (selectedFavoriteFolderId === folderToDelete.folderId) {
        setSelectedFavoriteFolderId(null)
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: FOLDERS_KEY }),
        queryClient.invalidateQueries({ queryKey: FAVORITES_KEY }),
      ])
      setFolderToDelete(null)
    } catch (e) {
      setFolderDeleteError(e instanceof ApiError ? e.message : '폴더 삭제에 실패했습니다.')
    } finally {
      setIsBusy(false)
    }
  }

  return {
    designs,
    favorites,
    scans,
    prints,
    isLoading,
    detailImage,
    openDetailImage,
    closeDetailImage,
    handleDetailLikeChange,
    handleDetailShareChange,
    handleDetailDeleted,
    isBusy,
    showChatHistory,
    setShowChatHistory,
    chatHistory,
    isChatHistoryLoading,
    chatHistoryError,
    confirmedDesignId,
    setConfirmedDesignId,
    savedFolders,
    likeModalTarget,
    setLikeModalTarget,
    selectedFavoriteFolderId,
    setSelectedFavoriteFolderId,
    creatingFolder,
    newFolderNameInStrip,
    setNewFolderNameInStrip,
    isCreatingFolder,
    createFolderError,
    startCreatingFolderInStrip,
    cancelCreatingFolderInStrip,
    handleCreateFolderInStrip,
    likedKeySet,
    scanSessions,
    scanDetailSession,
    openScanDetail,
    closeScanDetail,
    printDetailOrder,
    printDetailScan,
    isLoadingPrintDetail,
    openPrintDetail,
    closePrintDetail,
    findFavoriteFolder,
    openLikeFolderModal,
    openMoveFolderModal,
    toggleLikeFromGrid,
    confirmLikeWithFolder,
    moveFolderOrder,
    folderToDelete,
    folderDeleteError,
    openDeleteFolderModal,
    closeDeleteFolderModal,
    confirmDeleteFolder,
  }
}
