import { PageHeader } from '@/features/mypage/components/PageHeader'
import { FavBlockToolbar } from '@/features/mypage/components/FavBlockToolbar'
import { ImageGrid } from '@/features/mypage/components/ImageGrid'
import { Pagination } from '@/features/mypage/components/Pagination'
import { useMyPageContext } from '../context'
import { Icon } from '../shared'

export function FavoritesTab() {
  const {
    profile,
    totalScanCount,
    totalPrintCount,
    totalDesignCount,
    listSortOrder,
    setListSortOrder,
    folderSortOrder,
    setFolderSortOrder,
    isLoading,
    selectedFavoriteFolderId,
    sortedFolders,
    sortedFavorites,
    paginate,
    listPage,
    setListPage,
    setSelectedFavoriteFolderId,
    designs,
    likedKeySet,
    activeActivityId,
    findFavoriteFolder,
    handleActivityHover,
    handleActivitySelect,
    openDetailImage,
    openMoveFolderModal,
    toggleLikeFromGrid,
    creatingFolder,
    newFolderNameInStrip,
    setNewFolderNameInStrip,
    handleCreateFolderInStrip,
    isCreatingFolder,
    createFolderError,
    cancelCreatingFolderInStrip,
    startCreatingFolderInStrip,
    openDeleteFolderModal,
    isBusy,
    navigate,
  } = useMyPageContext()

  return (
      <section className="mypage-x__panel">
        <PageHeader
            id="favorites"
            nickname={profile?.nickname}
            totalScanCount={totalScanCount}
            totalPrintCount={totalPrintCount}
            totalDesignCount={totalDesignCount}
            listSortOrder={listSortOrder}
            onChangeSort={setListSortOrder}
        />
        {isLoading ? (
            <p className="mypage-x__loading">불러오는 중...</p>
        ) : (() => {
          const selectedFolder = selectedFavoriteFolderId != null
              ? sortedFolders.find((f) => f.folderId === selectedFavoriteFolderId) ?? null
              : null
          const folderImages = selectedFolder
              ? sortedFavorites.filter((f) => f.folder?.folderId === selectedFolder.folderId)
              : sortedFavorites

          if (selectedFolder) {
            const { slice, totalPages } = paginate(folderImages, 'favorites')
            return (
                <div className="mypage-x__fav-block">
                  <FavBlockToolbar
                      title={selectedFolder.name}
                      count={folderImages.length}
                      sortKind="image"
                      onBack={() => setSelectedFavoriteFolderId(null)}
                      listSortOrder={listSortOrder}
                      onChangeSort={setListSortOrder}
                      folderSortOrder={folderSortOrder}
                      onChangeFolderSort={setFolderSortOrder}
                  />
                  <ImageGrid
                      items={slice}
                      isFavoriteView
                      empty={{
                        title: '이 폴더에 찜한 이미지가 없어요',
                        description: '다른 폴더로 이동하거나 새 디자인을 찜해보세요.',
                        actionLabel: '전체 찜 보기',
                        onAction: () => setSelectedFavoriteFolderId(null),
                      }}
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
                </div>
            )
          }

          return (
              <>
                <div className="mypage-x__fav-block">
                  <FavBlockToolbar
                      title="폴더"
                      count={sortedFolders.length}
                      sortKind="folder"
                      listSortOrder={listSortOrder}
                      onChangeSort={setListSortOrder}
                      folderSortOrder={folderSortOrder}
                      onChangeFolderSort={setFolderSortOrder}
                  />
                  <div className="mypage-x__folder-strip">
                    {sortedFolders.map((folder) => {
                      const thumbs = folder.recentImageUrls ?? []
                      return (
                          <div key={folder.folderId} className="mypage-x__folder-card">
                            <button
                                type="button"
                                className="mypage-x__folder-card-open"
                                onClick={() => setSelectedFavoriteFolderId(folder.folderId)}
                            >
                              <div className="mypage-x__folder-thumbs" aria-hidden="true">
                                <div className="mypage-x__folder-thumb-main">
                                  {thumbs[0] ? <img src={thumbs[0]} alt="" /> : <span />}
                                </div>
                                <div className="mypage-x__folder-thumb-side">
                                  <div>{thumbs[1] ? <img src={thumbs[1]} alt="" /> : <span />}</div>
                                  <div>{thumbs[2] ? <img src={thumbs[2]} alt="" /> : <span />}</div>
                                </div>
                              </div>
                              <div className="mypage-x__folder-meta">
                                <div className="mypage-x__folder-meta-row">
                                  <p className="mypage-x__folder-name">{folder.name}</p>
                                </div>
                                <p className="mypage-x__folder-count">{folder.itemCount}개</p>
                              </div>
                            </button>
                            {!folder.isDefault && (
                                <button
                                    type="button"
                                    className="mypage-x__folder-delete-btn"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      openDeleteFolderModal(folder)
                                    }}
                                    disabled={isBusy}
                                    title="폴더 삭제"
                                    aria-label={`${folder.name} 폴더 삭제`}
                                >
                                  {Icon.trash}
                                </button>
                            )}
                          </div>
                      )
                    })}

                    {creatingFolder ? (
                        <div className="mypage-x__folder-card mypage-x__folder-card--new is-editing">
                          <div className="mypage-x__folder-new-thumb" aria-hidden="true">
                            {Icon.plus}
                          </div>
                          <div className="mypage-x__folder-meta">
                            <div className="mypage-x__folder-new-input-row">
                              <input
                                  value={newFolderNameInStrip}
                                  onChange={(e) => setNewFolderNameInStrip(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault()
                                      void handleCreateFolderInStrip()
                                    }
                                  }}
                                  placeholder="폴더 이름"
                                  maxLength={50}
                                  autoFocus
                                  disabled={isCreatingFolder}
                              />
                              <button
                                  type="button"
                                  className="mypage-x__folder-new-cancel"
                                  onClick={cancelCreatingFolderInStrip}
                                  aria-label="새 폴더 만들기 취소"
                                  disabled={isCreatingFolder}
                              >
                                {Icon.close}
                              </button>
                            </div>
                            {createFolderError && <p className="mypage-x__folder-new-error">{createFolderError}</p>}
                          </div>
                        </div>
                    ) : (
                        <button
                            type="button"
                            className="mypage-x__folder-card mypage-x__folder-card--new"
                            onClick={startCreatingFolderInStrip}
                        >
                          <div className="mypage-x__folder-new-thumb" aria-hidden="true">
                            {Icon.plus}
                          </div>
                          <div className="mypage-x__folder-meta">
                            <p className="mypage-x__folder-name">새 폴더 만들기</p>
                          </div>
                        </button>
                    )}
                  </div>
                </div>

                <div className="mypage-x__fav-block">
                  <FavBlockToolbar
                      title="전체 찜 이미지"
                      count={sortedFavorites.length}
                      sortKind="image"
                      listSortOrder={listSortOrder}
                      onChangeSort={setListSortOrder}
                      folderSortOrder={folderSortOrder}
                      onChangeFolderSort={setFolderSortOrder}
                  />
                  {(() => {
                    const { slice, totalPages } = paginate(sortedFavorites, 'favorites')
                    return (
                        <>
                          <ImageGrid
                              items={slice}
                              isFavoriteView
                              empty={{
                                title: '찜한 디자인이 없어요',
                                description: '마음에 드는 디자인에 ♥를 눌러 모아보세요.',
                                actionLabel: '디자인 둘러보기',
                                onAction: () => navigate('/mypage/designs'),
                              }}
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
                </div>
              </>
          )
        })()}
      </section>
  )
}
