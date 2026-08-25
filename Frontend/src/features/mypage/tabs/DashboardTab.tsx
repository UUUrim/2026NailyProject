import { ImageGrid } from '@/features/mypage/components/ImageGrid'
import { useMyPageContext } from '../context'
import { Icon } from '../shared'

export function DashboardTab() {
  const {
    profile,
    isLoading,
    designs,
    totalScanCount,
    totalPrintCount,
    totalDesignCount,
    totalFavoriteCount,
    navigate,
    likedKeySet,
    activeActivityId,
    findFavoriteFolder,
    handleActivityHover,
    handleActivitySelect,
    openDetailImage,
    openMoveFolderModal,
    toggleLikeFromGrid,
  } = useMyPageContext()

  return (
      <section className="mypage-x__panel">
        <div className="mypage-x__hero">
          <div className="mypage-x__hero-copy">
            <p className="mypage-x__hero-subtitle">My Naily</p>
            <h1 className="mypage-x__hero-title">
              {profile?.nickname ?? '회원'} 님,<br />
              오늘도 네일리와 함께해요!
            </h1>
            <p className="mypage-x__hero-desc">
              손 분석부터 네일팁 출력, 디자인까지 — 나의 네일 여정을 한곳에서 관리하세요.
            </p>
          </div>
        </div>

        <div className="mypage-x__stat-grid">
          <button type="button" className="mypage-x__stat-card" onClick={() => navigate('/mypage/scans')}>
            <span className="mypage-x__stat-icon">{Icon.hand}</span>
            <span className="mypage-x__stat-value">{totalScanCount}</span>
            <span className="mypage-x__stat-label">손 분석</span>
          </button>
          <button type="button" className="mypage-x__stat-card" onClick={() => navigate('/mypage/prints')}>
            <span className="mypage-x__stat-icon">{Icon.print}</span>
            <span className="mypage-x__stat-value">{totalPrintCount}</span>
            <span className="mypage-x__stat-label">네일팁 출력</span>
          </button>
          <button type="button" className="mypage-x__stat-card" onClick={() => navigate('/mypage/designs')}>
            <span className="mypage-x__stat-icon">{Icon.design}</span>
            <span className="mypage-x__stat-value">{totalDesignCount}</span>
            <span className="mypage-x__stat-label">생성 디자인</span>
          </button>
          <button type="button" className="mypage-x__stat-card" onClick={() => navigate('/mypage/favorites')}>
            <span className="mypage-x__stat-icon">{Icon.heart}</span>
            <span className="mypage-x__stat-value">{totalFavoriteCount}</span>
            <span className="mypage-x__stat-label">찜한 디자인</span>
          </button>
        </div>

        <div className="mypage-x__section-header">
          <h2 className="mypage-x__section-heading">최근 디자인</h2>
          <button type="button" className="mypage-x__see-all" onClick={() => navigate('/mypage/designs')}>
            전체 보기 {Icon.chevron}
          </button>
        </div>
        {isLoading ? (
            <p className="mypage-x__loading">불러오는 중...</p>
        ) : (
            <ImageGrid
                items={designs.slice(0, 4)}
                isFavoriteView={false}
                empty={{
                  title: '아직 생성한 디자인이 없어요',
                  description: 'AI와 대화하며 첫 네일 디자인을 만들어보세요.',
                  actionLabel: '디자인 만들러 가기',
                  onAction: () => navigate('/design/chat'),
                }}
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
        )}
      </section>
  )
}
