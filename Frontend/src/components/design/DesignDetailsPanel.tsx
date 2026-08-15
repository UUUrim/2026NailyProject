import { useState, type ReactNode } from 'react'
import { TEXTURE_INFO, CHARM_INFO } from '@/constants/designPreferences'
import type { DesignDetailItem, DesignExtractedDetails } from '@/apis/design'
import '@/styles/nail-design.css'

const TEXTURE_INFO_BY_KO = Object.fromEntries(Object.entries(TEXTURE_INFO).map(([, v]) => [v.labelKo, v]))
const CHARM_INFO_BY_KO = Object.fromEntries(Object.entries(CHARM_INFO).map(([, v]) => [v.labelKo, v]))

type NormalizedDetail = { key: string; label: string; hex: string | null; imageUrl: string | null }

function isImageLikeString(value: string): boolean {
  return /^(https?:|data:image\/|blob:)/i.test(value.trim())
}

function isHexColorString(value: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())
}

function normalizeDetailItem(item: DesignDetailItem, index: number, keyPrefix: string): NormalizedDetail {
  if (typeof item === 'string') {
    const trimmed = item.trim()
    if (isImageLikeString(trimmed)) return { key: `${keyPrefix}-${index}`, label: '', hex: null, imageUrl: trimmed }
    if (isHexColorString(trimmed)) return { key: `${keyPrefix}-${index}`, label: trimmed, hex: trimmed, imageUrl: null }
    return { key: `${keyPrefix}-${index}`, label: trimmed, hex: null, imageUrl: null }
  }
  return {
    key: `${keyPrefix}-${index}`,
    label: item.label ?? item.hex ?? '',
    hex: item.hex ?? null,
    imageUrl: item.imageUrl ?? null,
  }
}

function DetailThumb({
  imageUrl,
  shape,
  background,
  alt,
  children,
}: {
  imageUrl: string | null
  shape: 'square' | 'circle'
  background?: string
  alt: string
  children?: ReactNode
}) {
  const [broken, setBroken] = useState(false)
  const showImage = !!imageUrl && !broken

  return (
    <div
      className={`design-result-v2__thumb design-result-v2__thumb--${shape}`}
      style={!showImage && background ? { background } : undefined}
    >
      {showImage ? (
        <img src={imageUrl as string} alt={alt} loading="lazy" onError={() => setBroken(true)} />
      ) : (
        children
      )}
    </div>
  )
}

type Props = {
  details?: DesignExtractedDetails | null
  loading?: boolean
}

/** 디자인 생성 결과 페이지와 동일한 컬러/질감/파츠 UI */
export function DesignDetailsPanel({ details, loading = false }: Props) {
  if (loading) {
    return (
      <section className="design-result-v2__details" aria-label="디자인 구성 요소">
        <p className="design-result-v2__panel-hint">디자인 정보를 불러오는 중...</p>
      </section>
    )
  }

  const normalizedPalette = (details?.colorPalette ?? []).map((item, i) => normalizeDetailItem(item, i, 'palette'))
  const normalizedTextures = (details?.textures ?? []).map((item, i) => normalizeDetailItem(item, i, 'texture'))
  const normalizedCharms = (details?.nailParts ?? []).map((item, i) => normalizeDetailItem(item, i, 'charm'))

  return (
    <section className="design-result-v2__details" aria-label="디자인 구성 요소">
      <div className="design-result-v2__detail-block">
        <p className="design-result-v2__detail-label">컬러 팔레트</p>
        {normalizedPalette.length > 0 ? (
          <div className="design-result-v2__color-row">
            {normalizedPalette.map((item) => (
              <div className="design-result-v2__color-item" key={item.key}>
                <DetailThumb
                  imageUrl={item.imageUrl}
                  shape="square"
                  background={item.hex ?? '#eee'}
                  alt={item.hex ?? item.label ?? '컬러 팔레트'}
                />
                {(item.hex || item.label) && (
                  <span className="design-result-v2__color-hex">{item.hex ?? item.label}</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="design-result-v2__panel-hint">컬러 정보가 없어요.</p>
        )}
      </div>

      <div className="design-result-v2__detail-block">
        <p className="design-result-v2__detail-label">질감 · 텍스처</p>
        {normalizedTextures.length > 0 ? (
          <div className="design-result-v2__texture-row">
            {normalizedTextures.map((item) => {
              const info = item.label ? TEXTURE_INFO[item.label] ?? TEXTURE_INFO_BY_KO[item.label] : undefined
              return (
                <div className="design-result-v2__texture-item" key={item.key}>
                  <DetailThumb
                    imageUrl={item.imageUrl}
                    shape="circle"
                    background={info?.swatchStyle.background}
                    alt={info?.labelKo ?? item.label ?? '텍스처'}
                  >
                    <span className="design-result-v2__thumb-icon">✧</span>
                  </DetailThumb>
                  <span className="design-result-v2__texture-label">{info?.labelKo ?? item.label}</span>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="design-result-v2__panel-hint">질감 정보가 없어요.</p>
        )}
      </div>

      <div className="design-result-v2__detail-block">
        <p className="design-result-v2__detail-label">네일 참 · 파츠</p>
        {normalizedCharms.length > 0 ? (
          <div className="design-result-v2__charm-row">
            {normalizedCharms.map((item) => {
              const info = item.label ? CHARM_INFO[item.label] ?? CHARM_INFO_BY_KO[item.label] : undefined
              return (
                <div className="design-result-v2__charm-item" key={item.key}>
                  <DetailThumb
                    imageUrl={item.imageUrl}
                    shape="square"
                    alt={info?.labelKo ?? item.label ?? '네일 파츠'}
                  >
                    <span className="design-result-v2__thumb-icon">{info?.icon ?? '✧'}</span>
                  </DetailThumb>
                  <span className="design-result-v2__charm-label">{info?.labelKo ?? item.label}</span>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="design-result-v2__panel-hint">사용된 파츠가 없어요.</p>
        )}
      </div>
    </section>
  )
}
