import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  buildDesignPrompt,
  INITIAL_PREFERENCES,
  type NailDesignPreferences,
} from '@/constants/designPreferences'
import { AiNotConfiguredError } from '@/services/aiTypes'
import { useNailDesignGenerator } from '@/services/aiContext'
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

function pickResultImages(prompt: string): string[] {
  let hash = 0
  for (let i = 0; i < prompt.length; i += 1) {
    hash = (hash * 31 + prompt.charCodeAt(i)) >>> 0
  }

  const start = hash % RESULT_IMAGES.length
  return Array.from({ length: 4 }, (_, idx) => RESULT_IMAGES[(start + idx) % RESULT_IMAGES.length])
}

export function NailDesignResultPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const generator = useNailDesignGenerator()

  const preferences = (location.state?.preferences as NailDesignPreferences | undefined) ?? INITIAL_PREFERENCES
  const prompt = (location.state?.prompt as string | undefined) ?? buildDesignPrompt(preferences)

  const [apiImages, setApiImages] = useState<string[] | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const fallbackImages = useMemo(() => pickResultImages(prompt), [prompt])
  const images = apiImages ?? fallbackImages
  const selectedTags = useMemo(
    () =>
      Object.entries(preferences)
        .flatMap(([key, values]) => values.map((value) => `${key}: ${value}`))
        .slice(0, 12),
    [preferences],
  )

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
          // not wired yet: keep fallback images silently
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
  }, [generator, preferences, prompt])

  return (
    <div className="nail-design-page">
      <header className="nail-design-page__header">
        <Link to="/" className="nail-design-page__logo">
          Naily
        </Link>
        <button type="button" className="nail-design-page__back" onClick={() => navigate(-1)}>
          다시 선택하기
        </button>
      </header>

      <main className="nail-design-page__content">
        <h1 className="nail-design-page__title">네일 디자인 생성 결과</h1>
        <p className="nail-design-page__subtitle">선택한 선호도를 키워드로 프롬프트를 생성했습니다.</p>
        {loading && <p className="nail-design-page__hint">이미지 생성 중...</p>}
        {apiError && <p className="nail-design-page__error">{apiError}</p>}

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

        <section className="result-grid">
          {images.map((src, idx) => (
            <figure key={`${src}-${idx}`} className="result-card">
              <img src={src} alt={`생성된 네일 디자인 ${idx + 1}`} className="result-card__image" />
            </figure>
          ))}
        </section>

        <section className="pref-prompt-preview">
          <h2>생성에 사용된 프롬프트</h2>
          <pre>{prompt}</pre>
        </section>
      </main>
    </div>
  )
}
