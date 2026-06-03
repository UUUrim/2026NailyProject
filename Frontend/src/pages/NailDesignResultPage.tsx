import { useEffect, useMemo, useRef, useState } from 'react'
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
import { AiNotConfiguredError } from '@/services/aiTypes'
import { useNailDesignGenerator } from '@/services/aiContext'
import { getHandScanResult } from '@/utils/handScanStorage'
import {
  addPrintOrder,
  addSavedDesign,
  getFavorites,
  isFavorite,
  toggleFavorite,
} from '@/utils/mypageStorage'
import '@/styles/nail-design.css'

const RESULT_IMAGES = [
  '/images/nail1.png',
  '/images/nail2.png',
  '/images/nail3.png',
  '/images/nail4.png',
  '/images/nail5.png',
  '/images/nail6.png',
  '/images/nail7.png',
  '/images/nail8.png',
]

function pickResultImages(prompt: string, seed: number): string[] {
  const input = `${prompt}:${seed}`
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0
  }

  const start = hash % RESULT_IMAGES.length
  return Array.from({ length: 4 }, (_, idx) => RESULT_IMAGES[(start + idx) % RESULT_IMAGES.length])
}

export function NailDesignResultPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const generator = useNailDesignGenerator()
  const scanResult = getHandScanResult()

  const preferences = (location.state?.preferences as NailDesignPreferences | undefined) ?? INITIAL_PREFERENCES
  const prompt = (location.state?.prompt as string | undefined) ?? buildDesignPrompt(preferences)

  const nailShapeId = (preferences.shape[0] ?? scanResult?.recommendedShape ?? 'oval') as NailShapeId
  const nailShapeLabel =
    getNailShape(nailShapeId)?.labelKo ??
    PREFERENCE_OPTIONS.shape.find((option) => option.value === nailShapeId)?.label ??
    nailShapeId

  const [apiImages, setApiImages] = useState<string[] | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [printSubmitted, setPrintSubmitted] = useState(false)
  const [favoriteUrls, setFavoriteUrls] = useState<string[]>(() => getFavorites().map((f) => f.imageUrl))
  const [generationKey, setGenerationKey] = useState(0)

  const fallbackImages = useMemo(() => pickResultImages(prompt, generationKey), [prompt, generationKey])
  const images = apiImages ?? fallbackImages
  const selectedImage = images[selectedIndex] ?? images[0]

  const selectedTags = useMemo(() => {
    const preferenceKeys: PreferenceKey[] = ['mood', 'designType', 'season', 'motif', 'shape', 'color']
    const tags = preferenceKeys.flatMap((key) =>
      preferences[key].map((value) => {
        const label =
          PREFERENCE_OPTIONS[key].find((option) => option.value === value)?.label ?? value
        return `${PREFERENCE_SECTION_LABELS[key]}: ${label}`
      }),
    )
    if (preferences.freeText.trim()) {
      tags.push(`추가 의견: ${preferences.freeText.trim()}`)
    }
    return tags.slice(0, 12)
  }, [preferences])

  const savedDesignsRef = useRef(false)
  useEffect(() => {
    if (savedDesignsRef.current) return
    savedDesignsRef.current = true
    images.forEach((src) => {
      addSavedDesign({ imageUrl: src, prompt, shape: preferences.shape[0] })
    })
  }, [images, preferences.shape, prompt])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setLoading(true)
      setApiError(null)
      try {
        const output = await generator.generate({ prompt, preferences })
        if (cancelled) return
        setApiImages(output.images.map((img) => img.src))
      } catch (e) {
        if (cancelled) return
        if (e instanceof AiNotConfiguredError) {
          setApiImages(null)
          setApiError(null)
        } else {
          setApiImages(null)
          setApiError('이미지 생성 API 호출에 실패했습니다.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [generator, preferences, prompt, generationKey])

  const handleRegenerate = () => {
    setPrintSubmitted(false)
    setSelectedIndex(0)
    setPreviewIndex(null)
    setApiImages(null)
    setApiError(null)
    setGenerationKey((key) => key + 1)
  }

  const handleToggleFavorite = (imageUrl: string) => {
    const next = toggleFavorite({ imageUrl, prompt })
    setFavoriteUrls(next.map((f) => f.imageUrl))
  }

  const handlePrintOrder = () => {
    addPrintOrder({
      designId: `selected-${selectedIndex}`,
      imageUrl: selectedImage,
    })
    setPrintSubmitted(true)
  }

  return (
    <AppShell mainClassName="design-result-page">
      <PageBackLink to="/design/preferences" label="선호도 선택" />

      <header className="design-result-page__hero">
        <h1>네일 디자인 생성 결과</h1>
        <p>디자인을 선택해 3D 미리보기로 확인하고, 3D 프린터 출력을 신청할 수 있습니다.</p>
        {loading && <p className="nail-design-page__hint">이미지 생성 중...</p>}
        {apiError && <p className="nail-design-page__error">{apiError}</p>}
      </header>

      <section className="result-tags">
        {selectedTags.length > 0 ? (
          selectedTags.map((tag) => (
            <span key={tag} className="result-tag">
              {tag}
            </span>
          ))
        ) : (
          <span className="result-tag">선택된 키워드 없음</span>
        )}
      </section>

      <section className="result-grid result-grid--selectable">
        {images.map((src, idx) => {
          const selected = selectedIndex === idx
          const favorited = favoriteUrls.includes(src) || isFavorite(src)
          return (
            <figure
              key={`${src}-${idx}`}
              className={`result-card ${selected ? 'is-selected' : ''}`}
            >
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
                  className={favorited ? 'is-active' : ''}
                  onClick={() => handleToggleFavorite(src)}
                >
                  {favorited ? '찜 해제' : '찜'}
                </button>
              </div>
            </figure>
          )
        })}
      </section>

      <div className="design-result-regenerate-wrap">
        <button
          type="button"
          className="design-result-regenerate"
          onClick={handleRegenerate}
          disabled={loading}
        >
          {loading ? '디자인 생성 중…' : '디자인 다시 생성하기'}
        </button>
      </div>

      <section className="design-result-print">
        <h2>3D 프린터 출력</h2>
        <p>선택한 디자인으로 맞춤 네일팁을 제작합니다. (현재 선택: 디자인 {selectedIndex + 1})</p>
        <div className="design-result-print__preview">
          <img src={selectedImage} alt="선택된 디자인" />
        </div>
        {printSubmitted ? (
          <p className="design-result-print__success">
            출력 신청이 완료되었습니다. 마이페이지에서 진행 상황을 확인할 수 있습니다.
          </p>
        ) : (
          <button type="button" className="design-result-print__cta" onClick={handlePrintOrder}>
            이 디자인으로 3D 프린터 출력 신청
          </button>
        )}
        <button type="button" className="design-result-print__link" onClick={() => navigate('/mypage')}>
          마이페이지에서 확인
        </button>
      </section>

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
              <button type="button" onClick={() => setPreviewIndex(null)}>
                ✕
              </button>
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
