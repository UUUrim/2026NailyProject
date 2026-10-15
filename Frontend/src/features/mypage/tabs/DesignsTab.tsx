import { useMemo, useState } from 'react'
import { PageHeader } from '@/features/mypage/components/PageHeader'
import { ImageGrid } from '@/features/mypage/components/ImageGrid'
import { Pagination } from '@/shared/components/Pagination'
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

  // "공유한 디자인" 토글 — 둘러보기에 공유한 디자인만 모아 본다.
  // 상세 모달에서 공유/해제하면 designs가 바로 갱신되므로 목록도 그에 맞춰 바뀐다.
  const [sharedOnly, setSharedOnly] = useState(false)
  const visibleDesigns = useMemo(
      () => (sharedOnly ? sortedDesigns.filter((d) => d.shared) : sortedDesigns),
      [sortedDesigns, sharedOnly],
  )
  const toggleSharedOnly = () => {
    setSharedOnly((prev) => !prev)
    setListPage(1)
  }

  return (
      <section className="mypage-x__panel">
        <PageHeader
            id="designs"
            nickname={profile?.nickname}
            totalScanCount={totalScanCount}
            totalPrintCount={totalPrintCount}
            totalDesignCount={sharedOnly ? visibleDesigns.length : totalDesignCount}
            listSortOrder={listSortOrder}
            onChangeSort={setListSortOrder}
            sharedOnly={sharedOnly}
            onToggleSharedOnly={toggleSharedOnly}
        />
        {isLoading ? (
            <p className="mypage-x__loading">불러오는 중...</p>
        ) : (
            <>
              {(() => {
                const { slice, totalPages } = paginate(visibleDesigns, 'designs')
                return (
                    <>
                      <ImageGrid
                          items={slice}
                          isFavoriteView={false}
                          gridClassName="mypage-x__grid--cols-4"
                          empty={
                            sharedOnly
                                ? {
                                  title: '아직 공유한 디자인이 없어요',
                                  description: '디자인을 눌러 상세 화면에서 "공유하기"를 누르면 둘러보기에 올라가요.',
                                  actionLabel: '전체 디자인 보기',
                                  onAction: toggleSharedOnly,
                                }
                                : undefined
                          }
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
