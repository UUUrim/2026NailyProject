import { AppShell } from '@/shared/layout/AppShell'
import { PageHero } from '@/shared/layout/PageHero'
import { FavoriteFolderModal } from '@/shared/components/FavoriteFolderModal'
import { DesignDetailsPanel } from '@/shared/components/DesignDetailsPanel'
import { useNailDesignResultPage } from '@/features/nail-design/hooks/useNailDesignResultPage'
import '@/styles/nail-design.css'
import '@/styles/mypage.css'

export function NailDesignResultPageContent() {
  const {
    navigate,
    image,
    designId,
    context,
    swatchLoading,
    liked,
    likedFolder,
    isLiking,
    likeModalMode,
    setLikeModalMode,
    userName,
    shared,
    shareBusy,
    detailsWithSwatches,
    handleToggleShare,
    handleToggleLike,
    confirmLikeWithFolder,
  } = useNailDesignResultPage()

  if (!image) {
    return (
        <AppShell mainClassName="design-result-page">
          <div className="design-result-empty">
            <p>표시할 디자인이 없어요. 먼저 디자인을 생성해 주세요.</p>
            <button type="button" className="design-result-cta" onClick={() => navigate('/design/chat')}>
              디자인 생성하러 가기
            </button>
          </div>
        </AppShell>
    )
  }

  return (
      <AppShell mainClassName="design-result-page">
        <div className="design-result-v2">
          <PageHero
              eyebrow="Final Design"
              title={userName ? `${userName}님의 네일 디자인이 완성됐어요.` : '나만의 네일 디자인이 완성됐어요.'}
              description="채팅에서 다듬고 고른 최종 이미지예요. 마이페이지에서 언제든 다시 확인하실 수 있어요."
          />

          <div className="design-result-v2__body">
            <div className="design-result-v2__stage">
              <div className="design-result-v2__image-wrap">
                <img src={image} alt="완성된 네일 디자인" className="design-result-v2__image" />
                <button
                    type="button"
                    className={`design-result-v2__heart${liked ? ' is-liked' : ''}`}
                    onClick={() => void handleToggleLike()}
                    disabled={isLiking || !designId}
                    aria-label={liked ? '찜 해제' : '찜하기'}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} aria-hidden="true">
                    <path
                        d="M12 20s-7-4.35-9.5-8.8C.8 8 2 4.5 5.4 4a4.9 4.9 0 0 1 6.6 2 4.9 4.9 0 0 1 6.6-2c3.4.5 4.6 4 3.9 7.2C19 15.65 12 20 12 20z"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <button
                    type="button"
                    className={`design-result-v2__share-chip${shared ? ' is-on' : ''}`}
                    onClick={() => {
                      if (!designId) {
                        alert('디자인 생성 결과에서만 공유할 수 있어요.')
                        return
                      }
                      void handleToggleShare()
                    }}
                    disabled={shareBusy}
                >
                  {shareBusy ? '처리 중...' : shared ? '공유 중' : '둘러보기에 공유'}
                </button>
              </div>

              {liked && (
                  <button
                      type="button"
                      className="design-result-v2__folder-pill"
                      onClick={() => setLikeModalMode('move')}
                  >
                    <span>저장 위치</span>
                    <strong>{likedFolder?.name ?? '기본'}</strong>
                    <em>변경</em>
                  </button>
              )}
            </div>

            {/* ★ swatchLoading 상태 전달 */}
            <DesignDetailsPanel
                details={detailsWithSwatches}
                swatchLoading={swatchLoading}
            />
          </div>

          {context &&
              (context.handSummary ||
                  context.referenceImageUrl ||
                  context.keywords.length > 0 ||
                  context.revisionKeywords.length > 0) && (
                  <section className="design-result-v2__origin">
                    <p className="design-result-v2__detail-label">How It Was Made</p>

                    {context.handSummary && (
                        <div className="design-result-v2__origin-block">
                          <h2>내 손 분석 정보를 반영했어요</h2>
                          <div className="design-result-v2__origin-hand">
                            <div className="design-result-v2__origin-stat">
                              <span className="design-result-v2__origin-stat-label">피부 톤</span>
                              <span className="design-result-v2__origin-stat-value">{context.handSummary.toneLabel}</span>
                            </div>
                            <div className="design-result-v2__origin-stat">
                              <span className="design-result-v2__origin-stat-label">추천 쉐입</span>
                              <span className="design-result-v2__origin-stat-value">{context.handSummary.shapeLabel}</span>
                            </div>
                            <div className="design-result-v2__origin-stat">
                              <span className="design-result-v2__origin-stat-label">손톱 측정값</span>
                              <span className="design-result-v2__origin-stat-value">
                            길이 {context.handSummary.avgLength}mm · 너비 {context.handSummary.avgWidth}mm · 곡률{' '}
                                {context.handSummary.avgCurve}
                          </span>
                            </div>
                          </div>
                          <p className="design-result-v2__origin-desc">
                            손 스캔에서 분석한 퍼스널 컬러와 손톱 형태를 반영하여 디자인을 생성했어요.
                          </p>
                        </div>
                    )}

                    {context.referenceImageUrl && (
                        <div className="design-result-v2__origin-block">
                          <h2>참고 사진을 반영했어요</h2>
                          <div className="design-result-v2__origin-photo">
                            <img src={context.referenceImageUrl} alt="업로드한 참고 사진" />
                          </div>
                          <p className="design-result-v2__origin-desc">
                            업로드하신 참고 사진의 분위기와 색감을 반영하여 디자인을 생성했어요.
                          </p>
                        </div>
                    )}

                    {(context.keywords.length > 0 || context.revisionKeywords.length > 0) && (
                        <div className="design-result-v2__origin-block">
                          <h2>{context.source === 'freeform' ? '대화에서 나눈 스타일을 반영하여 디자인을 생성했어요.' : '선택하신 옵션을 반영하여 디자인을 생성했어요.'}</h2>
                          <div className="design-result-v2__origin-keywords">
                            {Array.from(new Set([...context.keywords, ...context.revisionKeywords])).map((keyword) => (
                                <span className="design-result-v2__keyword-chip" key={keyword}>
                              {keyword}
                            </span>
                            ))}
                          </div>
                        </div>
                    )}
                  </section>
              )}

          <div className="design-result-v2__actions">
            <button
                type="button"
                className="design-result-v2__btn design-result-v2__btn--ghost"
                onClick={() => navigate('/design/chat')}
            >
              디자인 다시 생성하기
            </button>
            <button
                type="button"
                className="design-result-v2__btn design-result-v2__btn--primary"
                onClick={() => navigate('/mypage/designs')}
            >
              마이페이지에서 확인하기
            </button>
          </div>
        </div>

        <FavoriteFolderModal
            open={!!likeModalMode}
            onClose={() => setLikeModalMode(null)}
            onConfirm={confirmLikeWithFolder}
            mode={likeModalMode ?? 'like'}
            initialFolderId={likedFolder?.folderId ?? null}
        />
      </AppShell>
  )
}
