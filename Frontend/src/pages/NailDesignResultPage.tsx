import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import {
  likeDesign,
  moveLikedDesign,
  unlikeDesign,
  shareDesign,
  unshareDesign,
  getDesignDetail,
  type DesignExtractedDetails,
} from '@/apis/design'
import { FavoriteFolderModal } from '@/components/mypage/FavoriteFolderModal'
import { DesignDetailsPanel } from '@/components/design/DesignDetailsPanel'
import { getMyProfile } from '@/apis/user'
import { ApiError } from '@/utils/apiClient'
import '@/styles/nail-design.css'
import '@/styles/mypage.css'

// 이미지 생성 모델이 꺼져 있는 등, 실제 생성 결과 없이도 이 결과 페이지 UI를 미리 볼 수 있도록 하는 샘플 데이터.
// designId는 일부러 비워둬서 좋아요 등 실제 서버에 데이터를 남기는 액션은 자연히 비활성화된다.
const SAMPLE_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 312">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffd6e3"/>
      <stop offset="1" stop-color="#c9a8ff"/>
    </linearGradient>
  </defs>
  <rect width="400" height="312" rx="16" fill="url(#g)"/>
  <path d="M170 60c-24 0-40 22-40 55v70c0 30 16 47 40 47s40-17 40-47V115c0-33-16-55-40-55Z" fill="none" stroke="#ffffff" stroke-width="4" opacity="0.9"/>
  <path d="M230 60c-24 0-40 22-40 55v70c0 30 16 47 40 47s40-17 40-47V115c0-33-16-55-40-55Z" fill="none" stroke="#ffffff" stroke-width="4" opacity="0.55"/>
  <text x="200" y="272" font-family="sans-serif" font-size="20" font-weight="700" fill="#ffffff" text-anchor="middle">샘플 미리보기</text>
</svg>
`)}`

const SAMPLE_DETAILS: DesignExtractedDetails = {
  colorPalette: ['#FDE2EA', '#DE869F', '#C9A8FF'],
  textures: ['그라데이션', '펄'],
  nailParts: ['플로럴', '크리스탈'],
}

type GenerationContext = {
  source: string
  keywords: string[]
  referenceImageUrl: string | null
  handSummary: {
    seasonNameKo: string
    shapeLabel: string
    avgLength: number
    avgWidth: number
    avgCurve: number
  } | null
  revisionKeywords: string[]
}

const SAMPLE_CONTEXT: GenerationContext = {
  source: 'preference',
  keywords: ['우아', '그라데이션', '봄', '플로럴', '아몬드'],
  referenceImageUrl: null,
  handSummary: null,
  revisionKeywords: [],
}

export function NailDesignResultPage() {
  const location = useLocation()
  const navigate = useNavigate()

  // 실제 생성 결과(채팅 흐름을 거쳐 넘어온 state)가 있는지 여부.
  // 없으면(=이 URL로 바로 들어왔거나, 생성 모델이 꺼져 있어 생성을 못 한 경우) 샘플로 대체해서 페이지 자체는 볼 수 있게 한다.
  const hasRealResult = Boolean((location.state?.imageUrls as string[] | undefined)?.length)

  const designId = (location.state?.designId as number | undefined) ?? null
  const imageUrls = hasRealResult ? (location.state!.imageUrls as string[]) : [SAMPLE_IMAGE]
  const image = imageUrls[0] ?? ''

  // 디자인 생성 모델이 함께 내려주는 세부 요소 (컬러팔레트 / 질감 / 네일 파츠) — 프론트는 표시만 함
  const details = hasRealResult ? ((location.state?.details as DesignExtractedDetails | undefined) ?? null) : SAMPLE_DETAILS
  const context = hasRealResult ? ((location.state?.context as GenerationContext | undefined) ?? null) : SAMPLE_CONTEXT

  const [liked, setLiked] = useState(false)
  const [likedFolder, setLikedFolder] = useState<{ folderId: number; name: string } | null>(null)
  const [isLiking, setIsLiking] = useState(false)
  const [likeModalMode, setLikeModalMode] = useState<'like' | 'move' | null>(null)
  const [userName, setUserName] = useState('')
  const [shared, setShared] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)

  useEffect(() => {
    // 샘플 미리보기(로그인 없이도 UI를 볼 수 있게 하는 모드)에서는 프로필을 불러오지 않는다 —
    // 401 응답이 전역 로그인 리다이렉트를 일으켜서 샘플 미리보기 자체가 막혀버리기 때문.
    if (!hasRealResult) return

    let cancelled = false
    void getMyProfile()
        .then((profile) => {
          if (!cancelled) setUserName(profile.nickname || profile.name || '')
        })
        .catch(() => {
          // 이름 못 가져와도 진행
        })

    if (designId != null) {
      void getDesignDetail(designId)
          .then((detail) => {
            if (!cancelled) setShared(Boolean(detail.shared))
          })
          .catch(() => {
            /* 공유 상태 조회 실패는 무시 */
          })
    }

    return () => {
      cancelled = true
    }
  }, [hasRealResult, designId])

  const handleToggleShare = async () => {
    if (!designId || shareBusy) return
    setShareBusy(true)
    try {
      const next = shared ? await unshareDesign(designId) : await shareDesign(designId)
      setShared(Boolean(next.shared))
    } catch (e) {
      alert(e instanceof ApiError ? e.message : '공유 처리에 실패했습니다.')
    } finally {
      setShareBusy(false)
    }
  }

  const handleToggleLike = async () => {
    if (!designId || !image || isLiking) return
    if (!liked) {
      setLikeModalMode('like')
      return
    }
    setIsLiking(true)
    try {
      await unlikeDesign(designId, image)
      setLiked(false)
      setLikedFolder(null)
    } catch (e) {
      alert(e instanceof ApiError ? e.message : '요청에 실패했습니다.')
    } finally {
      setIsLiking(false)
    }
  }

  const confirmLikeWithFolder = async (choice: { folderId?: number; newFolderName?: string }) => {
    if (!designId || !image || !likeModalMode) return
    const saved =
        likeModalMode === 'move'
            ? await moveLikedDesign(designId, image, choice)
            : await likeDesign(designId, image, choice)
    setLiked(true)
    setLikedFolder(saved.folder)
  }

  const handleRegenerate = () => {
    navigate('/design/chat')
  }

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
          <header className="design-result-v2__hero">
            <p className="design-result-v2__eyebrow">Final Design</p>
            <h1 className="design-result-v2__title">
              {userName ? `${userName}님의 네일 디자인이 완성됐어요.` : '나만의 네일 디자인이 완성됐어요.'}
            </h1>
            <p className="design-result-v2__lead">
              채팅에서 다듬고 고른 최종 이미지예요. 마이페이지에서 언제든 다시 확인하실 수 있어요.
            </p>
          </header>

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
                        alert('디자인 생성 결과에서만 공유할 수 있어요. 채팅으로 디자인을 만든 뒤 다시 열어 주세요.')
                        return
                      }
                      void handleToggleShare()
                    }}
                    disabled={shareBusy}
                    aria-label={shared ? '공유 해제' : '둘러보기에 공유하기'}
                    title={!designId ? '생성 완료된 디자인에서만 공유할 수 있어요' : undefined}
                >
                  {shareBusy
                      ? '처리 중...'
                      : shared
                          ? '공유 중'
                          : '둘러보기에 공유'}
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

            <DesignDetailsPanel details={details} />
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
                          <span className="design-result-v2__origin-stat-label">퍼스널 컬러</span>
                          <span className="design-result-v2__origin-stat-value">{context.handSummary.seasonNameKo}</span>
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
                      {context.revisionKeywords.length > 0 && (
                          <div className="design-result-v2__origin-keywords">
                            {context.revisionKeywords.map((keyword) => (
                                <span className="design-result-v2__keyword-chip" key={keyword}>
                                  {keyword}
                                </span>
                            ))}
                          </div>
                      )}
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
                      {context.revisionKeywords.length > 0 && (
                          <div className="design-result-v2__origin-keywords">
                            {context.revisionKeywords.map((keyword) => (
                                <span className="design-result-v2__keyword-chip" key={keyword}>
                                  {keyword}
                                </span>
                            ))}
                          </div>
                      )}
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
                onClick={handleRegenerate}
            >
              디자인 다시 생성하기
            </button>
            <button
                type="button"
                className="design-result-v2__btn design-result-v2__btn--primary"
                onClick={() => navigate('/mypage', { state: { tab: 'designs' } })}
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
