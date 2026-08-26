import { useMemo, useState } from 'react'
import { AppShell } from '@/shared/layout/AppShell'
import { PageHero } from '@/shared/layout/PageHero'
import { FavoriteFolderModal } from '@/shared/components/FavoriteFolderModal'
import { DesignDetailsPanel } from '@/shared/components/DesignDetailsPanel'
import { PillButton } from '@/shared/components/PillButton'
import { ModalActionIcons } from '@/shared/components/ModalActionIcons'
import { DesignImageDetailModal, Icon as MypageImageIcon } from '@/features/mypage/components/DesignImageDetailModal'
import { NailArTryOnModal } from '@/features/mypage/components/NailArTryOnModal'
import { ShareStatusBadge } from '@/shared/components/ShareStatusBadge'
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
    shared,
    shape,
    nailTipCropUrls,
    detailsWithSwatches,
    handleToggleLike,
    confirmLikeWithFolder,
    applyLikeChange,
    applyShareChange,
  } = useNailDesignResultPage()

  const [detailOpen, setDetailOpen] = useState(false)
  const [arPreviewOpen, setArPreviewOpen] = useState(false)
  const [referencePhotoOpen, setReferencePhotoOpen] = useState(false)

  // DesignImageDetailModal은 image prop이 "새 객체"로 바뀔 때마다(참조가 달라지면) 내부 공유/찜
  // 상태를 초기화하고 다시 불러온다. 매 렌더마다 새 객체 리터럴을 넘기면, 모달 안에서 공유하기를
  // 눌러 부모의 shared 상태가 바뀌어 리렌더될 때도 매번 새 객체가 만들어져 모달이 자기가 방금
  // 반영한 공유 상태를 스스로 초기화해버린다 — 그 결과 공유 직후 배지가 "비공개"로 되돌아가 보인다.
  // 실제로 값이 바뀔 때만 새 객체를 만들도록 메모이즈해서 이 불필요한 리셋을 막는다.
  const detailImage = useMemo(
      () => ({ designId, imageUrl: image, liked, folder: likedFolder }),
      [designId, image, liked, likedFolder],
  )

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

  const allKeywords = context ? Array.from(new Set([...context.keywords, ...context.revisionKeywords])) : []

  return (
      <AppShell mainClassName="design-result-page">
        <div className="design-result-v2">
          <PageHero
              eyebrow="Final Design Result"
              title="최종 디자인 결과"
              description="채팅에서 다듬고 고른 최종 이미지예요. 마이페이지에서 언제든 다시 확인하실 수 있어요."
          />

          <div className="design-result-v2__body">
            <div className="design-result-v2__stage">
              <div className="design-result-v2__image-wrap">
                <img
                    src={image}
                    alt="완성된 네일 디자인"
                    className="design-result-v2__image"
                    onClick={() => setDetailOpen(true)}
                    style={{ cursor: 'zoom-in' }}
                />

                {/* 찜하기 + 찜 폴더명 — 마이페이지 이미지 상세모달의 이미지 위 오버레이(mypage-x__modal-image-tools)를 그대로 재사용 */}
                <div className="mypage-x__modal-image-tools">
                  <button
                      type="button"
                      className={`mypage-x__modal-heart${liked ? ' is-liked' : ''}`}
                      onClick={() => void handleToggleLike()}
                      disabled={isLiking || !designId}
                      aria-label={liked ? '찜 해제' : '찜하기'}
                  >
                    {MypageImageIcon.heart}
                  </button>
                  {liked && likedFolder && (
                      <button
                          type="button"
                          className="mypage-x__modal-folder-pill"
                          onClick={() => setLikeModalMode('move')}
                          title="저장 위치 변경"
                          aria-label={`저장 위치 변경 (현재: ${likedFolder.name})`}
                      >
                        <span className="mypage-x__modal-folder-pill-text">{likedFolder.name}</span>
                        <span className="mypage-x__modal-folder-pill-icon" aria-hidden="true">
                          {MypageImageIcon.chevronDown}
                        </span>
                      </button>
                  )}
                </div>

                {/* 공유 상태 배지 — 이미지 상세모달과 동일한 ShareStatusBadge 컴포넌트를 그대로 재사용 */}
                {shared && <ShareStatusBadge shared={shared} className="mypage-x__modal-share-corner" />}

                <button
                    type="button"
                    className="design-result-v2__ar-chip"
                    onClick={() => setArPreviewOpen(true)}
                >
                  {ModalActionIcons.ar}
                  <span>AR 미리보기</span>
                </button>
              </div>
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

                    {context.referenceImageUrl && context.source === 'photo' ? (
                        <div className="design-result-v2__origin-block">
                          <h2>참고 사진을 반영했어요</h2>
                          <div className="design-result-v2__origin-photo-row">
                            <div className="design-result-v2__origin-photo design-result-v2__origin-photo--lg">
                              <img
                                  src={context.referenceImageUrl}
                                  alt="업로드한 참고 사진"
                                  onClick={() => setReferencePhotoOpen(true)}
                                  style={{ cursor: 'zoom-in' }}
                              />
                            </div>
                            {allKeywords.length > 0 && (
                                <>
                                  <div className="design-result-v2__origin-divider" aria-hidden="true" />
                                  <div className="design-result-v2__origin-keywords design-result-v2__origin-keywords--inline">
                                    {allKeywords.map((keyword) => (
                                        <span className="design-result-v2__keyword-chip" key={keyword}>
                                      {keyword}
                                    </span>
                                    ))}
                                  </div>
                                </>
                            )}
                          </div>
                          <p className="design-result-v2__origin-desc">
                            업로드하신 참고 사진의 분위기와 색감을 반영하여 디자인을 생성했어요.
                          </p>
                        </div>
                    ) : (
                        <>
                          {context.referenceImageUrl && (
                              <div className="design-result-v2__origin-block">
                                <h2>참고 사진을 반영했어요</h2>
                                <div className="design-result-v2__origin-photo">
                                  <img
                                      src={context.referenceImageUrl}
                                      alt="업로드한 참고 사진"
                                      onClick={() => setReferencePhotoOpen(true)}
                                      style={{ cursor: 'zoom-in' }}
                                  />
                                </div>
                                <p className="design-result-v2__origin-desc">
                                  업로드하신 참고 사진의 분위기와 색감을 반영하여 디자인을 생성했어요.
                                </p>
                              </div>
                          )}

                          {allKeywords.length > 0 && (
                              <div className="design-result-v2__origin-block">
                                <h2>{context.source === 'freeform' ? '대화에서 나눈 스타일을 반영하여 디자인을 생성했어요.' : '선택하신 옵션을 반영하여 디자인을 생성했어요.'}</h2>
                                <div className="design-result-v2__origin-keywords">
                                  {allKeywords.map((keyword) => (
                                      <span className="design-result-v2__keyword-chip" key={keyword}>
                                    {keyword}
                                  </span>
                                  ))}
                                </div>
                              </div>
                          )}
                        </>
                    )}
                  </section>
              )}

          <div className="design-result-v2__actions">
            <PillButton
                variant="ghost"
                className="design-result-v2__btn"
                onClick={() => navigate('/design/chat')}
            >
              디자인 다시 생성하기
            </PillButton>
            <PillButton
                variant="primary"
                className="design-result-v2__btn"
                onClick={() => navigate('/mypage/designs')}
            >
              마이페이지에서 확인하기
            </PillButton>
          </div>
        </div>

        <FavoriteFolderModal
            open={!!likeModalMode}
            onClose={() => setLikeModalMode(null)}
            onConfirm={confirmLikeWithFolder}
            mode={likeModalMode ?? 'like'}
            initialFolderId={likedFolder?.folderId ?? null}
        />

        {/* 디자인 결과 화면에서는 채팅 이력/삭제/이미지 상세보기 없이 저장·AR·공유만 노출 */}
        {detailOpen && (
            <DesignImageDetailModal
                image={detailImage}
                onClose={() => setDetailOpen(false)}
                onLikeChange={(_designId, _imageUrl, saved) => applyLikeChange(saved)}
                onShareChange={(_designId, nextShared) => applyShareChange(nextShared)}
                showDelete={false}
                showChatHistoryToggle={false}
                showDesignDetailsToggle={false}
            />
        )}

        {arPreviewOpen && (
            <NailArTryOnModal
                imageUrl={image}
                shape={shape}
                nailTipCropUrls={nailTipCropUrls}
                onClose={() => setArPreviewOpen(false)}
            />
        )}

        {/* 참고 사진 확대 보기 — 확대/이동 말고는 아무 기능도 없는 축소판 상세모달 */}
        {referencePhotoOpen && context?.referenceImageUrl && (
            <DesignImageDetailModal
                image={{ designId: null, imageUrl: context.referenceImageUrl, liked: false, folder: null }}
                onClose={() => setReferencePhotoOpen(false)}
                showDelete={false}
                showChatHistoryToggle={false}
                showDesignDetailsToggle={false}
                showLike={false}
                showShare={false}
                showAr={false}
                showDownload={false}
            />
        )}
      </AppShell>
  )
}
