import { memo } from 'react'
import { Icon } from '@/features/mypage/shared'

type PaginationProps = {
    currentPage: number
    totalPages: number
    onPageChange: (page: number) => void
}

export const Pagination = memo(function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
    if (totalPages <= 1) return null
    const current = Math.min(currentPage, totalPages)
    return (
        <div className="mypage-x__pagination">
            <button
                type="button"
                className="mypage-x__page-arrow"
                disabled={current <= 1}
                onClick={() => onPageChange(Math.max(1, current - 1))}
                aria-label="이전 페이지"
            >
                {Icon.chevronLeft}
            </button>
            <div className="mypage-x__page-numbers">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                    <button
                        key={pageNum}
                        type="button"
                        className={`mypage-x__page-num${pageNum === current ? ' is-active' : ''}`}
                        onClick={() => onPageChange(pageNum)}
                        aria-current={pageNum === current ? 'page' : undefined}
                    >
                        {pageNum}
                    </button>
                ))}
            </div>
            <button
                type="button"
                className="mypage-x__page-arrow"
                disabled={current >= totalPages}
                onClick={() => onPageChange(Math.min(totalPages, current + 1))}
                aria-label="다음 페이지"
            >
                {Icon.chevronRight}
            </button>
        </div>
    )
})
