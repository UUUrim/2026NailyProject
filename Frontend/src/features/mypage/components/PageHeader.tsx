import { memo } from 'react'
import { type SectionId, SECTION_META } from '@/features/mypage/shared'
import { SortControl, type SortOrder } from '@/features/mypage/components/SortControl'

type PageHeaderProps = {
    id: SectionId
    nickname?: string | null
    totalScanCount: number
    totalPrintCount: number
    totalDesignCount: number
    listSortOrder: SortOrder
    onChangeSort: (order: SortOrder) => void
}

export const PageHeader = memo(function PageHeader({
    id,
    nickname,
    totalScanCount,
    totalPrintCount,
    totalDesignCount,
    listSortOrder,
    onChangeSort,
}: PageHeaderProps) {
    const meta = SECTION_META[id]
    const sortable = id === 'scans' || id === 'prints' || id === 'designs'
    const totalCount =
        id === 'scans' ? totalScanCount
            : id === 'prints' ? totalPrintCount
                : id === 'designs' ? totalDesignCount
                    : 0
    const description =
        id === 'favorites'
            ? meta.description.replace('ㅇㅇ', nickname ?? '회원')
            : meta.description

    return (
        <header className="mypage-x__page-header">
            <p className="mypage-x__page-subtitle">{meta.subtitle}</p>
            <h1 className="mypage-x__title">{meta.title}</h1>
            <p className="mypage-x__desc">{description}</p>
            {sortable && (
                <div className="mypage-x__list-toolbar">
                    <p className="mypage-x__list-count">총 {totalCount}개</p>
                    <div className="mypage-x__list-toolbar-actions">
                        <SortControl value={listSortOrder} onChange={onChangeSort} />
                    </div>
                </div>
            )}
        </header>
    )
})
