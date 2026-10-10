import { memo } from 'react'
import '@/styles/mypage.css'

type PaginationProps = {
    currentPage: number
    totalPages: number
    onPageChange: (page: number) => void
}

// 페이지 번호는 10개씩 묶어서 보여주고 (1~10, 11~20, 21~30 ...),
// «/» 버튼으로 10페이지씩 건너뛴다.
const PAGE_GROUP_SIZE = 10

const ChevronLeftIcon = (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="m15 6-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
)
const ChevronRightIcon = (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
)
const ChevronsLeftIcon = (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="m12 6-6 6 6 6M18 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
)
const ChevronsRightIcon = (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="m6 6 6 6-6 6M12 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
)

export const Pagination = memo(function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
    if (totalPages <= 1) return null
    const current = Math.min(currentPage, totalPages)
    const groupStart = Math.floor((current - 1) / PAGE_GROUP_SIZE) * PAGE_GROUP_SIZE + 1
    const groupEnd = Math.min(groupStart + PAGE_GROUP_SIZE - 1, totalPages)
    // 페이지가 한 묶음(10개) 안에 다 들어가면 건너뛰기 버튼은 항상 비활성이라 아예 숨긴다
    const showJump = totalPages > PAGE_GROUP_SIZE
    return (
        <div className="mypage-x__pagination">
            {showJump && (
                <button
                    type="button"
                    className="mypage-x__page-arrow"
                    disabled={groupStart <= 1}
                    onClick={() => onPageChange(Math.max(1, current - PAGE_GROUP_SIZE))}
                    aria-label={`이전 ${PAGE_GROUP_SIZE}페이지`}
                >
                    {ChevronsLeftIcon}
                </button>
            )}
            <button
                type="button"
                className="mypage-x__page-arrow"
                disabled={current <= 1}
                onClick={() => onPageChange(Math.max(1, current - 1))}
                aria-label="이전 페이지"
            >
                {ChevronLeftIcon}
            </button>
            <div className="mypage-x__page-numbers">
                {Array.from({ length: groupEnd - groupStart + 1 }, (_, i) => groupStart + i).map((pageNum) => (
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
                {ChevronRightIcon}
            </button>
            {showJump && (
                <button
                    type="button"
                    className="mypage-x__page-arrow"
                    disabled={groupEnd >= totalPages}
                    onClick={() => onPageChange(Math.min(totalPages, current + PAGE_GROUP_SIZE))}
                    aria-label={`다음 ${PAGE_GROUP_SIZE}페이지`}
                >
                    {ChevronsRightIcon}
                </button>
            )}
        </div>
    )
})
