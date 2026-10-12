import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CommunityDesignResponse } from '@/entities/design/api'
import { CommunityDesignModal } from '@/features/gallery/components/CommunityDesignModal'
import { useCommunityGallery } from '@/features/gallery/hooks/useCommunityGallery'
import {
  collectTextureOptions,
  sortDesigns,
  textureKeysOf,
  textureLabelOf,
  type GallerySort,
} from '@/features/gallery/utils/galleryFilters'
import { FavoriteFolderModal } from '@/shared/components/FavoriteFolderModal'
import { Pagination } from '@/shared/components/Pagination'
import { AppShell } from '@/shared/layout/AppShell'
import { PageHero } from '@/shared/layout/PageHero'
import { isLoggedIn } from '@/shared/utils/auth'
import '@/styles/gallery.css'

// 4열 4행 = 한 페이지 16개
const PAGE_SIZE = 16
const SKELETON_COUNT = 16

const SORT_OPTIONS: { value: GallerySort; label: string }[] = [
  { value: 'popular', label: '인기순' },
  { value: 'latest', label: '최신순' },
]

const LikeIcon = ({ filled }: { filled?: boolean }) => (
  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
    <path
      d="M7 11v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h2a2 2 0 0 1 1.6.8L14 4.5A2.5 2.5 0 0 1 18 6.3V10h2.2a1.8 1.8 0 0 1 1.76 2.2l-1.3 6A2 2 0 0 1 18.7 20H9.5"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  </svg>
)

const HeartIcon = (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path
      d="M12 20s-7-4.35-9.5-8.8C.8 8 2 4.5 5.4 4a4.9 4.9 0 0 1 6.6 2 4.9 4.9 0 0 1 6.6-2c3.4.5 4.6 4 3.9 7.2C19 15.65 12 20 12 20z"
      fill="currentColor"
    />
  </svg>
)

type GalleryCardProps = {
  design: CommunityDesignResponse
  favorited: boolean
  onOpen: () => void
}

function GalleryCard({ design, favorited, onOpen }: GalleryCardProps) {
  const textures = textureKeysOf(design).slice(0, 2)
  const likeCount = design.likeCount ?? 0

  return (
    <li className="gallery-card">
      <button type="button" className="gallery-card__media" onClick={onOpen} aria-label="네일 디자인 크게 보기">
        <img
          src={design.imageUrl}
          alt="네일리 사용자가 만든 네일 디자인"
          className="gallery-card__image"
          loading="lazy"
          decoding="async"
        />
        {textures.length > 0 && (
          <span className="gallery-card__tags" aria-hidden="true">
            {textures.map((key) => (
              <span key={key}>{textureLabelOf(key)}</span>
            ))}
          </span>
        )}
        {favorited && (
          <span className="gallery-card__saved" aria-label="찜한 디자인">
            {HeartIcon}
          </span>
        )}
        <span className="gallery-card__hint" aria-hidden="true">
          크게 보기
        </span>
      </button>
      <div className="gallery-card__meta">
        <span className="gallery-card__date">{design.createdAt}</span>
        <span
          className={`gallery-card__likes${design.likedByMe ? ' is-liked' : ''}`}
          aria-label={`좋아요 ${likeCount}개${design.likedByMe ? ', 내가 좋아요 누름' : ''}`}
        >
          <LikeIcon filled={design.likedByMe} />
          {likeCount}
        </span>
      </div>
    </li>
  )
}

export function GalleryPageContent() {
  const navigate = useNavigate()
  const gallery = useCommunityGallery()
  const [sort, setSort] = useState<GallerySort>('popular')
  const [texture, setTexture] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const listTopRef = useRef<HTMLDivElement>(null)

  const textureOptions = useMemo(() => collectTextureOptions(gallery.designs), [gallery.designs])

  const visibleDesigns = useMemo(() => {
    const filtered = texture
      ? gallery.designs.filter((design) => textureKeysOf(design).includes(texture))
      : gallery.designs
    return sortDesigns(filtered, sort)
  }, [gallery.designs, sort, texture])

  const totalPages = Math.max(1, Math.ceil(visibleDesigns.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageDesigns = visibleDesigns.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const changeSort = (next: GallerySort) => {
    setSort(next)
    setPage(1)
  }

  const changeTexture = (next: string | null) => {
    setTexture(next)
    setPage(1)
  }

  const changePage = (next: number) => {
    setPage(next)
    listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleCreateClick = () => navigate(isLoggedIn() ? '/design/chat' : '/login')

  const renderList = () => {
    if (gallery.isLoading) {
      return (
        <ul className="gallery-grid" aria-busy="true" aria-label="디자인 불러오는 중">
          {Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <li key={index} className="gallery-card gallery-card--skeleton" />
          ))}
        </ul>
      )
    }

    if (gallery.loadFailed) {
      return (
        <div className="gallery-page__state">
          <p className="gallery-page__state-title">디자인을 불러오지 못했어요</p>
          <p className="gallery-page__state-desc">잠시 후 다시 시도해 주세요.</p>
          <button type="button" className="gallery-page__state-btn" onClick={gallery.reload}>
            다시 불러오기
          </button>
        </div>
      )
    }

    if (gallery.designs.length === 0) {
      return (
        <div className="gallery-page__state">
          <p className="gallery-page__state-title">아직 공유된 디자인이 없어요</p>
          <p className="gallery-page__state-desc">가장 먼저 나만의 네일 디자인을 만들어 공유해 보세요!</p>
          <button type="button" className="gallery-page__state-btn" onClick={handleCreateClick}>
            디자인 만들기
          </button>
        </div>
      )
    }

    if (visibleDesigns.length === 0) {
      return (
        <div className="gallery-page__state">
          <p className="gallery-page__state-title">이 질감의 디자인은 아직 없어요</p>
          <button type="button" className="gallery-page__state-btn" onClick={() => changeTexture(null)}>
            전체 디자인 보기
          </button>
        </div>
      )
    }

    return (
      <ul className="gallery-grid">
        {pageDesigns.map((design) => (
          <GalleryCard
            key={`${design.designId}-${design.imageUrl}`}
            design={design}
            favorited={gallery.isFavorited(design)}
            onOpen={() => gallery.openDetail(design)}
          />
        ))}
      </ul>
    )
  }

  const { detailDesign, favoriteModalTarget } = gallery

  return (
    <AppShell mainClassName="gallery-page">
      <PageHero
        eyebrow="Gallery"
        title="디자인 둘러보기"
        description="네일리 사용자들이 직접 만들고 공유한 네일 디자인이에요. 마음에 드는 디자인은 찜해 두고, 좋아요로 응원해 보세요."
      />

      <div ref={listTopRef} className="gallery-page__toolbar">
        <div className="gallery-page__sort" role="group" aria-label="정렬">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`gallery-page__sort-btn${sort === option.value ? ' is-active' : ''}`}
              aria-pressed={sort === option.value}
              onClick={() => changeSort(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {!gallery.isLoading && !gallery.loadFailed && (
          <p className="gallery-page__count">
            <b>{visibleDesigns.length}</b>개의 디자인
          </p>
        )}
      </div>

      {textureOptions.length > 0 && (
        <div className="gallery-page__filters" role="group" aria-label="질감으로 보기">
          <button
            type="button"
            className={`gallery-page__filter${texture === null ? ' is-active' : ''}`}
            aria-pressed={texture === null}
            onClick={() => changeTexture(null)}
          >
            전체
            <em>{gallery.designs.length}</em>
          </button>
          {textureOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`gallery-page__filter${texture === option.key ? ' is-active' : ''}`}
              aria-pressed={texture === option.key}
              onClick={() => changeTexture(option.key)}
            >
              {option.swatch && (
                <span
                  className="gallery-page__filter-swatch"
                  style={{ '--swatch': option.swatch } as CSSProperties}
                  aria-hidden="true"
                />
              )}
              {option.label}
              <em>{option.count}</em>
            </button>
          ))}
        </div>
      )}

      {renderList()}

      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={changePage} />

      <section className="gallery-page__cta" aria-labelledby="gallery-cta-title">
        <div className="gallery-page__cta-copy">
          <p className="gallery-page__cta-eyebrow">Your turn</p>
          <h2 id="gallery-cta-title">마음에 드는 무드를 찾았나요?</h2>
          <p>내 손톱 쉐입과 피부 톤에 맞춘 나만의 디자인을 AI와 함께 만들어 보세요.</p>
        </div>
        <button type="button" className="gallery-page__cta-btn" onClick={handleCreateClick}>
          디자인 만들기
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
            <path d="M5 12h12M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </section>

      {detailDesign && (
        <CommunityDesignModal
          key={detailDesign.designId}
          design={detailDesign}
          details={gallery.detailDetails}
          detailsLoading={gallery.detailLoading}
          favorited={gallery.isFavorited(detailDesign)}
          folderName={gallery.folderNameOf(detailDesign)}
          busy={gallery.isBusy}
          closeOnEscape={!favoriteModalTarget}
          onClose={gallery.closeDetail}
          onToggleFavorite={() => void gallery.toggleFavorite(detailDesign)}
          onMoveFolder={() => gallery.setFavoriteModalTarget({ design: detailDesign, mode: 'move' })}
          onToggleReaction={() => void gallery.toggleReaction(detailDesign)}
          onDownload={() => void gallery.download(detailDesign)}
        />
      )}

      <FavoriteFolderModal
        open={!!favoriteModalTarget}
        onClose={() => gallery.setFavoriteModalTarget(null)}
        onConfirm={gallery.confirmFavoriteWithFolder}
        mode={favoriteModalTarget?.mode ?? 'like'}
        initialFolderId={favoriteModalTarget ? gallery.folderIdOf(favoriteModalTarget.design) : null}
      />
    </AppShell>
  )
}
