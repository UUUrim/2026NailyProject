import { memo } from 'react'
import { Icon } from '@/features/mypage/shared'
import { SortControl, type SortOrder } from '@/features/mypage/components/SortControl'
import { FolderSortControl, type FolderSortOrder } from '@/features/mypage/components/FolderSortControl'

type FavBlockToolbarProps = {
    title: string
    count: number
    sortKind: 'folder' | 'image'
    onBack?: () => void
    listSortOrder: SortOrder
    onChangeSort: (order: SortOrder) => void
    folderSortOrder: FolderSortOrder
    onChangeFolderSort: (order: FolderSortOrder) => void
}

export const FavBlockToolbar = memo(function FavBlockToolbar({
    title,
    count,
    sortKind,
    onBack,
    listSortOrder,
    onChangeSort,
    folderSortOrder,
    onChangeFolderSort,
}: FavBlockToolbarProps) {
    return (
        <div className="mypage-x__fav-block-toolbar">
            <div className="mypage-x__fav-block-title">
                {onBack && (
                    <button
                        type="button"
                        className="mypage-x__fav-back"
                        onClick={onBack}
                        aria-label="폴더 목록으로"
                    >
                        {Icon.chevronLeft}
                    </button>
                )}
                <h3 className="mypage-x__section-heading mypage-x__section-heading--inline">{title}</h3>
                <p className="mypage-x__list-count">총 {count}개</p>
            </div>
            <div className="mypage-x__list-toolbar-actions">
                {sortKind === 'folder' ? (
                    <FolderSortControl value={folderSortOrder} onChange={onChangeFolderSort} />
                ) : (
                    <SortControl value={listSortOrder} onChange={onChangeSort} />
                )}
            </div>
        </div>
    )
})
