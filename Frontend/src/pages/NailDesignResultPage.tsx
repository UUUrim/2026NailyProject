import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { PageBackLink } from '@/components/layout/PageBackLink'
import { NailPreview3D } from '@/components/nail3d/NailPreview3D'
import { getNailShape, type NailShapeId } from '@/constants/nailShapes'
import {
  buildDesignPrompt,
  INITIAL_PREFERENCES,
  type NailDesignPreferences,
  PREFERENCE_OPTIONS,
  PREFERENCE_SECTION_LABELS,
  type PreferenceKey,
} from '@/constants/designPreferences'
import { likeDesign, unlikeDesign } from '@/apis/design'
import { ApiError } from '@/utils/apiClient'
import '@/styles/nail-design.css'

export function NailDesignResultPage() {
  const location = useLocation()
  const navigate = useNavigate()

  // NailDesignPreferencePage에서 navigate state로 넘어온 값
  const initialDesignId = (location.state?.designId as number | undefined) ?? null
  const initialImageUrls = (location.state?.imageUrls as string[] | undefined) ?? []
  const preferences = (location.state?.preferences as NailDesignPreferences | undefined) ?? INITIAL_PREFERENCES
  const prompt = (location.state?.prompt as string | undefined) ?? buildDesignPrompt(preferences)

  const nailShapeId = (preferences.shape[0] ?? 'oval') as NailShapeId
  const nailShapeLabel =
      getNailShape(nailShapeId)?.labelKo ??
      PREFERENCE_OPTIONS.shape.find((o) => o.value === nailShapeId)?.label ??
      nailShapeId

  // ── 상태 ──────────────────────────────────────────────────────────────────
  const [designId, setDesignId] = useState<number | null>(initialDesignId)
  const [images, setImages] = useState<string[]>(initialImageUrls)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [likedUrls, setLikedUrls] = useState<Set<string>>(new Set())
  const [isLiking, setIsLiking] = useState(false)

  const selectedImage = images[selectedIndex] ?? images[0] ?? ''

  // ── 태그 ──────────────────────────────────────────────────────────────────
  const selectedTags = useMemo(() => {
    const keys: PreferenceKey[] = ['mood', 'designType', 'season', 'motif', 'shape', 'color']
    const tags = keys.flatMap((key) =>
        preferences[key].map((value) => {
          const label = PREFERENCE_OPTIONS[key].find((o) => o.value === value)?.label ?? value
          return `${PREFERENCE_SECTION_LABELS[key]}: ${label}`
        }),
    )
    if (preferences.freeText.trim()) tags.push(`추가 의견: ${preferences.freeText.trim()}`)
    return tags.slice(0, 12)
  }, [preferences])

  // 이미지는 NailDesignPreferencePage에서 생성 후 state로 전달받음

  // ── 찜하기 / 찜 취소 ──────────────────────────────────────────────────────
  const handleToggleLike = async (imageUrl: string) => {
    if (!designId || isLiking) return
    setIsLiking(true)
    try {
      if (likedUrls.has(imageUrl)) {
        // DELETE /designs/{designId}/likes
        await unlikeDesign(designId, imageUrl)
        setLikedUrls((prev) => { const next = new Set(prev); next.delete(imageUrl); return next })
      } else {
        // POST /designs/{designId}/likes
        await likeDesign(designId, imageUrl)
        setLikedUrls((prev) => new Set(prev).add(imageUrl))
      }
    } catch (e) {
      alert(e instanceof ApiError ? e.message : '요청에 실패했습니다.')
    } finally {
      setIsLiking(false)
    }
  }

  // ── 재생성: 선호도 페이지로 돌아가서 다시 생성 ─────────────────────────────
  const handleRegenerate = () => {
    navigate('/design/preferences')
  }

  return (
      <AppShell mainClassName="design-result-page">
        <PageBackLink to="/design/preferences" label="선호도 선택" />

        <header className="design-result-page__hero">
          <h1>네일 디자인 생성 결과</h1>
          <p>디자인을 선택해 3D 미리보기로 확인하고, 마음에 드는 디자인을 찜하세요.</p>
          {loading && <p className="nail-design-page__hint">이미지 생성 중...</p>}
          {error && <p className="nail-design-page__error">{error}</p>}
        </header>

        <section className="result-tags">
          {selectedTags.length > 0 ? (
              selectedTags.map((tag) => (
                  <span key={tag} className="result-tag">{tag}</span>
              ))
          ) : (
              <span className="result-tag">선택된 키워드 없음</span>
          )}
        </section>

        {images.length > 0 && (
            <section className="result-grid result-grid--selectable">
              {images.map((src, idx) => {
                const selected = selectedIndex === idx
                const liked = likedUrls.has(src)
                return (
                    <figure key={`${src}-${idx}`} className={`result-card ${selected ? 'is-selected' : ''}`}>
                      <button
                          type="button"
                          className="result-card__select"
                          onClick={() => setSelectedIndex(idx)}
                          aria-pressed={selected}
                      >
                        <img src={src} alt={`생성된 네일 디자인 ${idx + 1}`} className="result-card__image" />
                        {selected && <span className="result-card__check">선택됨</span>}
                      </button>
                      <div className="result-card__actions">
                        <button type="button" onClick={() => setPreviewIndex(idx)}>
                          3D로 보기
                        </button>
                        <button
                            type="button"
                            className={liked ? 'is-active' : ''}
                            onClick={() => void handleToggleLike(src)}
                            disabled={isLiking || !designId}
                        >
                          {liked ? '찜 해제' : '찜'}
                        </button>
                      </div>
                    </figure>
                )
              })}
            </section>
        )}

        <div className="design-result-regenerate-wrap">
          <button
              type="button"
              className="design-result-regenerate"
              onClick={handleRegenerate}
              disabled={loading}
          >
            {loading ? '디자인 생성 중…' : '디자인 다시 생성하기'}
          </button>
          <button
              type="button"
              className="design-result-print__link"
              onClick={() => navigate('/mypage', { state: { tab: 'favorites' } })}
          >
            찜 목록 보기
          </button>
        </div>

        {previewIndex !== null && (
            <div className="design-3d-modal" role="dialog" aria-modal="true">
              <button
                  type="button"
                  className="design-3d-modal__backdrop"
                  onClick={() => setPreviewIndex(null)}
                  aria-label="닫기"
              />
              <div className="design-3d-modal__panel">
                <header className="design-3d-modal__header">
                  <h2>3D로 네일팁 미리보기</h2>
                  <button type="button" onClick={() => setPreviewIndex(null)}>✕</button>
                </header>
                <p className="design-3d-modal__desc">
                  선택한 네일팁 쉐입({nailShapeLabel})에 디자인을 입힌 모습입니다.
                </p>
                <NailPreview3D textureUrl={images[previewIndex] ?? selectedImage} shapeId={nailShapeId} />
                <div className="design-3d-modal__footer">
                  <button type="button" onClick={() => setSelectedIndex(previewIndex)}>
                    이 디자인 선택
                  </button>
                  <button type="button" className="primary" onClick={() => setPreviewIndex(null)}>
                    닫기
                  </button>
                </div>
              </div>
            </div>
        )}
      </AppShell>
  )
}