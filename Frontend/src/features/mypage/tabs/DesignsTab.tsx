import { PageHeader } from '@/features/mypage/components/PageHeader'
import { ImageGrid } from '@/features/mypage/components/ImageGrid'
import { Pagination } from '@/features/mypage/components/Pagination'
import { useMyPageContext } from '../context'

export function DesignsTab() {
  const {
    profile,
    totalScanCount,
    totalPrintCount,
    totalDesignCount,
    listSortOrder,
    setListSortOrder,
    isLoading,
    paginate,
    sortedDesigns,
    listPage,
    setListPage,
    designs,
    likedKeySet,
    activeActivityId,
    findFavoriteFolder,
    handleActivityHover,
    handleActivitySelect,
    openDetailImage,
    openMoveFolderModal,
    toggleLikeFromGrid,
    navigate,
  } = useMyPageContext()

  return (
      <section className="mypage-x__panel">
        <PageHeader
            id="designs"
            nickname={profile?.nickname}
            totalScanCount={totalScanCount}
            totalPrintCount={totalPrintCount}
            totalDesignCount={totalDesignCount}
            listSortOrder={listSortOrder}
            onChangeSort={setListSortOrder}
        />
        {isLoading ? (
            <p className="mypage-x__loading">불러오는 중...</p>
        ) : (
            <>
              {(() => {
                const { slice, totalPages } = paginate(sortedDesigns, 'designs')
                return (
                    <>
                      <ImageGrid
                          items={slice}
                          isFavoriteView={false}
                          options={{ dateMode: 'date' }}
                          designs={designs}
                          likedKeySet={likedKeySet}
                          activeActivityId={activeActivityId}
                          findFavoriteFolder={findFavoriteFolder}
                          onHoverActivity={handleActivityHover}
                          onSelectActivity={handleActivitySelect}
                          onOpenDetailImage={openDetailImage}
                          onMoveFolder={openMoveFolderModal}
                          onToggleLike={toggleLikeFromGrid}
                          navigate={navigate}
                      />
                      <Pagination currentPage={listPage} totalPages={totalPages} onPageChange={setListPage} />
                    </>
                )
              })()}
            </>
        )}
      </section>
  )
}
