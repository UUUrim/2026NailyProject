import { PageHeader } from '@/features/mypage/components/PageHeader'
import { EmptyState } from '@/features/mypage/components/EmptyState'
import { PrintOrderRow } from '@/features/mypage/components/PrintOrderRow'
import { Pagination } from '@/features/mypage/components/Pagination'
import { useMyPageContext } from '../context'

export function PrintsTab() {
  const {
    profile,
    totalScanCount,
    totalPrintCount,
    totalDesignCount,
    listSortOrder,
    setListSortOrder,
    sortedPrints,
    navigate,
    paginate,
    listPage,
    setListPage,
    activeActivityId,
    openPrintDetail,
    handleActivityHover,
    handleActivitySelect,
  } = useMyPageContext()

  return (
      <section className="mypage-x__panel">
        <PageHeader
            id="prints"
            nickname={profile?.nickname}
            totalScanCount={totalScanCount}
            totalPrintCount={totalPrintCount}
            totalDesignCount={totalDesignCount}
            listSortOrder={listSortOrder}
            onChangeSort={setListSortOrder}
        />
        {sortedPrints.length === 0 ? (
            <EmptyState
                icon="print"
                title="출력 신청 내역이 없어요"
                description="손 분석 후 맞춤 네일팁 3D 출력을 신청할 수 있어요."
                actionLabel="출력하러 가기"
                onAction={() => navigate('/print')}
            />
        ) : (
            <>
              {(() => {
                const { slice, totalPages } = paginate(sortedPrints, 'prints')
                return (
                    <>
                      <div className="mypage-x__print-list">
                        {slice.map((order) => (
                            <PrintOrderRow
                                key={order.id}
                                order={order}
                                activeActivityId={activeActivityId}
                                onOpenDetail={openPrintDetail}
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
