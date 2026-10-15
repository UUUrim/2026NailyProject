import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    addDesignReaction,
    getCommunityDesigns,
    getDesignDetail,
    getLikedDesigns,
    likeDesign,
    moveLikedDesign,
    removeDesignReaction,
    unlikeDesign,
    type CommunityDesignResponse,
    type DesignExtractedDetails,
} from '@/entities/design/api'
import { ApiError } from '@/shared/utils/apiClient'
import { isLoggedIn } from '@/shared/utils/auth'
import { downloadImage } from '@/shared/utils/downloadImage'

type FolderRef = { folderId: number; name: string }

export type FavoriteModalTarget = {
    design: CommunityDesignResponse
    mode: 'like' | 'move'
}

export function favKeyOf(designId: number, imageUrl: string) {
    return `${designId}-${imageUrl}`
}

/**
 * 둘러보기(갤러리) 화면의 데이터와 동작.
 * 찜(폴더에 저장)과 좋아요(공감 수)는 서로 다른 기능이다 — 찜은 내 찜 목록, 좋아요는 공개 카운트.
 */
export function useCommunityGallery() {
    const navigate = useNavigate()

    const [designs, setDesigns] = useState<CommunityDesignResponse[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [loadFailed, setLoadFailed] = useState(false)
    const [reloadKey, setReloadKey] = useState(0)

    const [favoritedKeys, setFavoritedKeys] = useState<Set<string>>(new Set())
    const [favoriteFolders, setFavoriteFolders] = useState<Record<string, FolderRef>>({})
    const [favoriteModalTarget, setFavoriteModalTarget] = useState<FavoriteModalTarget | null>(null)
    const [isBusy, setIsBusy] = useState(false)

    const [detailDesign, setDetailDesign] = useState<CommunityDesignResponse | null>(null)
    const [detailDetails, setDetailDetails] = useState<DesignExtractedDetails | null>(null)
    const [detailLoading, setDetailLoading] = useState(false)
    // AR 미리보기용 — 목록 응답에는 없고 상세 조회에서만 내려온다
    const [detailShape, setDetailShape] = useState<string | null>(null)
    const [detailNailTipCropUrls, setDetailNailTipCropUrls] = useState<string[] | null>(null)
    // 상세를 연달아 열고 닫을 때, 앞서 연 디자인의 늦은 응답이 지금 모달을 덮어쓰지 않게 한다
    const detailRequestRef = useRef(0)

    useEffect(() => {
        let cancelled = false

        getCommunityDesigns()
            .then((data) => {
                if (cancelled) return
                setDesigns(data)
                setLoadFailed(false)
            })
            .catch(() => {
                if (!cancelled) setLoadFailed(true)
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
                    const folderMap: Record<string, FolderRef> = {}
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
    }, [reloadKey])

    const reload = useCallback(() => {
        setIsLoading(true)
        setLoadFailed(false)
        setReloadKey((key) => key + 1)
    }, [])

    // ── 상세 모달 열기/닫기 ──────
    const openDetail = (design: CommunityDesignResponse) => {
        const requestId = ++detailRequestRef.current
        setDetailDesign(design)
        setDetailDetails(design.details ?? null)
        setDetailShape(null)
        setDetailNailTipCropUrls(null)
        setDetailLoading(true)
        void getDesignDetail(design.designId)
            .then((detail) => {
                if (requestId !== detailRequestRef.current) return
                setDetailDesign((prev) =>
                    prev && prev.designId === design.designId
                        ? { ...prev, createdAt: detail.createdAt || prev.createdAt, details: detail.details }
                        : prev,
                )
                setDetailDetails(detail.details ?? null)
                setDetailShape(detail.shape ?? null)
                setDetailNailTipCropUrls(detail.nailTipCropUrls ?? null)
            })
            .catch(() => {
                /* 목록에 있던 details로 폴백 (AR은 2D·로컬 손톱 인식으로 폴백) */
            })
            .finally(() => {
                if (requestId === detailRequestRef.current) setDetailLoading(false)
            })
    }

    // 모달이 Esc 리스너를 이 함수에 걸어 두므로 렌더마다 새로 만들지 않는다
    const closeDetail = useCallback(() => {
        detailRequestRef.current += 1
        setDetailDesign(null)
        setDetailDetails(null)
        setDetailShape(null)
        setDetailNailTipCropUrls(null)
        setDetailLoading(false)
    }, [])

    // ── 로그인이 필요한 동작 공통 처리 ──────
    const requireLogin = () => {
        if (window.confirm('로그인 후 이용할 수 있는 기능이에요. 로그인 페이지로 이동할까요?')) {
            navigate('/login')
        }
    }

    // ── 찜 / 좋아요 (완전 분리) ──────
    const isFavorited = (design: CommunityDesignResponse) =>
        favoritedKeys.has(favKeyOf(design.designId, design.imageUrl))

    const folderNameOf = (design: CommunityDesignResponse) =>
        favoriteFolders[favKeyOf(design.designId, design.imageUrl)]?.name ?? '기본'

    const folderIdOf = (design: CommunityDesignResponse) =>
        favoriteFolders[favKeyOf(design.designId, design.imageUrl)]?.folderId ?? null

    const applyReactionState = (designId: number, likeCount: number, liked: boolean) => {
        const apply = (item: CommunityDesignResponse) =>
            item.designId === designId ? { ...item, likeCount, likedByMe: liked } : item
        setDesigns((prev) => prev.map(apply))
        setDetailDesign((prev) => (prev ? apply(prev) : prev))
    }

    const toggleFavorite = async (design: CommunityDesignResponse) => {
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

    const toggleReaction = async (design: CommunityDesignResponse) => {
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

    const download = async (design: CommunityDesignResponse) => {
        await downloadImage(design.imageUrl, `naily-design-${Date.now()}.png`)
    }

    return {
        designs,
        isLoading,
        loadFailed,
        reload,
        detailDesign,
        detailDetails,
        detailLoading,
        detailShape,
        detailNailTipCropUrls,
        openDetail,
        closeDetail,
        isBusy,
        isFavorited,
        folderNameOf,
        folderIdOf,
        toggleFavorite,
        toggleReaction,
        favoriteModalTarget,
        setFavoriteModalTarget,
        confirmFavoriteWithFolder,
        download,
    }
}
