import { memo } from 'react'
import { type SectionId, SECTION_META } from '@/features/mypage/shared'
import { SortControl, type SortOrder } from '@/features/mypage/components/SortControl'
import { SharedFilterToggle } from '@/features/mypage/components/SharedFilterToggle'

type PageHeaderProps = {
    id: SectionId
    nickname?: string | null
    totalScanCount: number
    totalPrintCount: number
    totalDesignCount: number
    listSortOrder: SortOrder
    onChangeSort: (order: SortOrder) => void
    /** 넘기면 정렬 버튼 왼쪽에 "공유한 디자인" 필터 토글을 보여준다 (디자인 탭 전용) */
    sharedOnly?: boolean
    onToggleSharedOnly?: () => void
}

export const PageHeader = memo(function PageHeader({
    id,
    nickname,
    totalScanCount,
    totalPrintCount,
    totalDesignCount,
    listSortOrder,
    onChangeSort,
    sharedOnly,
    onToggleSharedOnly,
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
                        {onToggleSharedOnly && (
                            <SharedFilterToggle active={!!sharedOnly} onToggle={onToggleSharedOnly} />
                        )}
                        <SortControl value={listSortOrder} onChange={onChangeSort} />
                    </div>
                </div>
            )}
        </header>
    )
})
