import { memo } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import { type DesignImageResponse, type SavedDesignResponse, type SavedFolderResponse } from '@/entities/design/api'
import { Icon, formatTimeHms, formatDateOnly, formatDateTimeFull } from '@/features/mypage/shared'
import { type DesignImageDetailInput } from '@/features/mypage/components/DesignImageDetailModal'
import { EmptyState } from '@/features/mypage/components/EmptyState'

type GridItem = DesignImageResponse | SavedDesignResponse

type ImageGridProps = {
    items: GridItem[]
    isFavoriteView: boolean
    empty?: { title: string; description: string; actionLabel?: string; onAction?: () => void }
    options?: {
        dateMode?: 'time' | 'date' | 'datetime'
        interactive?: boolean
        getActivityId?: (item: GridItem) => string
    }
    designs: DesignImageResponse[]
    likedKeySet: Set<string>
    activeActivityId: string | null
    findFavoriteFolder: (designId: number, imageUrl: string) => SavedFolderResponse | { folderId: number; name: string } | null
    onHoverActivity: (id: string | null) => void
    onSelectActivity: (id: string) => void
    onOpenDetailImage: (img: DesignImageDetailInput) => void
    onMoveFolder: (designId: number, imageUrl: string) => void
    onToggleLike: (designId: number, imageUrl: string) => void | Promise<void>
    navigate: NavigateFunction
}

export const ImageGrid = memo(function ImageGrid({
    items,
    isFavoriteView,
    empty,
    options,
    designs,
    likedKeySet,
    activeActivityId,
    findFavoriteFolder,
    onHoverActivity,
    onSelectActivity,
    onOpenDetailImage,
    onMoveFolder,
    onToggleLike,
    navigate,
}: ImageGridProps) {
    if (items.length === 0) {
        if (empty) {
            return <EmptyState icon={isFavoriteView ? 'heart' : 'design'} {...empty} />
        }
        return (
            <EmptyState
                icon="design"
                title="아직 디자인이 없어요"
                description="AI와 함께 첫 네일 디자인을 만들어보세요."
                actionLabel="디자인 만들러 가기"
                onAction={() => navigate('/design/chat')}
            />
        )
    }

    const dateMode = options?.dateMode ?? 'date'
    return (
        <div className="mypage-x__grid">
            {items.map((item) => {
                const key = `${item.designId}-${item.imageUrl}`
                const liked = likedKeySet.has(key)
                const rawDate = 'createdAt' in item ? item.createdAt : item.savedAt
                const cardDate =
                    dateMode === 'time'
                        ? (formatTimeHms(rawDate) || formatDateOnly(rawDate))
                        : dateMode === 'datetime'
                            ? formatDateTimeFull(rawDate)
                            : formatDateOnly(rawDate)
                const modalDate = formatDateTimeFull(rawDate)
                const activityId = options?.getActivityId?.(item)
                const highlighted = Boolean(options?.interactive && activityId && activeActivityId === activityId)
                const folder =
                    'folder' in item
                        ? item.folder
                        : liked
                            ? findFavoriteFolder(item.designId, item.imageUrl)
                            : null
                const isShared =
                    'shared' in item
                        ? Boolean(item.shared)
                        : designs.some((d) => d.designId === item.designId && d.shared)
                return (
                    <article
                        key={key}
                        data-activity-id={options?.interactive ? activityId : undefined}
                        data-activity-side={options?.interactive ? 'right' : undefined}
                        className={`mypage-x__card${highlighted ? ' is-highlighted' : ''}`}
                        onMouseEnter={() => options?.interactive && activityId && onHoverActivity(activityId)}
                        onMouseLeave={() => options?.interactive && onHoverActivity(null)}
                    >
                        <button
                            type="button"
                            className="mypage-x__card-image-btn"
                            onClick={() => {
                                if (options?.interactive && activityId) onSelectActivity(activityId)
                                onOpenDetailImage({
                                    designId: item.designId,
                                    imageUrl: item.imageUrl,
                                    createdAt: modalDate,
                                    liked,
                                    folder,
                                })
                            }}
                        >
                            <img src={item.imageUrl} alt="네일 디자인" />
                            {isShared && (
                                <span className="mypage-x__card-share-badge" aria-label="둘러보기에 공유 중">
                                    공유 중
                                </span>
                            )}
                            <span className="mypage-x__card-zoom-hint">확대해서 보기</span>
                        </button>
                        <div className="mypage-x__card-footer">
                            <span className="mypage-x__card-date">{cardDate}</span>
                            {liked && folder ? (
                                <div className="mypage-x__like-pill">
                                    <button
                                        type="button"
                                        className="mypage-x__like-pill-folder"
                                        onClick={() => onMoveFolder(item.designId, item.imageUrl)}
                                        title="저장 위치 변경"
                                    >
                                        {folder.name}
                                    </button>
                                    <span className="mypage-x__like-pill-divider" aria-hidden="true" />
                                    <button
                                        type="button"
                                        className="mypage-x__like-pill-heart is-liked"
                                        onClick={() => void onToggleLike(item.designId, item.imageUrl)}
                                        aria-label="찜 해제"
                                    >
                                        {Icon.heart}
                                    </button>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    className={`mypage-x__heart-btn${liked ? ' is-liked' : ''}`}
                                    onClick={() => onToggleLike(item.designId, item.imageUrl)}
                                    aria-label={liked ? '찜 해제' : '찜하기'}
                                >
                                    {Icon.heart}
                                </button>
                            )}
                        </div>
                    </article>
                )
            })}
        </div>
    )
})
