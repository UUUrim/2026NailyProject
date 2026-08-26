import { PageHeader } from '@/features/mypage/components/PageHeader'
import { EmptyState } from '@/features/mypage/components/EmptyState'
import { ScanSessionRow } from '@/features/mypage/components/ScanSessionRow'
import { Pagination } from '@/features/mypage/components/Pagination'
import { useMyPageContext } from '../context'

export function ScansTab() {
  const {
    profile,
    totalScanCount,
    totalPrintCount,
    totalDesignCount,
    listSortOrder,
    setListSortOrder,
    isLoading,
    sortedScanSessions,
    navigate,
    paginate,
    listPage,
    setListPage,
    activeActivityId,
    openScanDetail,
    handleActivityHover,
    handleActivitySelect,
  } = useMyPageContext()

  return (
      <section className="mypage-x__panel">
        <PageHeader
            id="scans"
            nickname={profile?.nickname}
            totalScanCount={totalScanCount}
            totalPrintCount={totalPrintCount}
            totalDesignCount={totalDesignCount}
            listSortOrder={listSortOrder}
            onChangeSort={setListSortOrder}
        />
        {isLoading ? (
            <p className="mypage-x__loading">불러오는 중...</p>
        ) : sortedScanSessions.length === 0 ? (
            <EmptyState
                icon="hand"
                title="손 분석 이력이 없어요"
                description="손을 스캔하면 퍼스널컬러와 맞춤 네일팁 쉐입을 추천해드려요."
                actionLabel="손 촬영하러 가기"
                onAction={() => navigate('/scan/hand')}
            />
        ) : (
            <>
              {(() => {
                const { slice, totalPages } = paginate(sortedScanSessions, 'scans')
                return (
                    <>
                      <div className="mypage-x__scan-list">
                        {slice.map((session) => (
                            <ScanSessionRow
                                key={session.key}
                                session={session}
                                activeActivityId={activeActivityId}
                                onOpenDetail={openScanDetail}
                                onSelectActivity={handleActivitySelect}
                                onHoverActivity={handleActivityHover}
                            />
                        ))}
                      </div>
                      <Pagination currentPage={listPage} totalPages={totalPages} onPageChange={setListPage} />
                    </>
                )
              })()}
            </>
        )}
      </section>
  )
}
