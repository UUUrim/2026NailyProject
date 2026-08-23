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
    swatchLoading?: boolean  // ★ 스와치 폴링 중 여부
}

export function DesignDetailsPanel({ details, loading = false, swatchLoading = false }: Props) {
    if (loading) {
        return (
            <section className="design-result-v2__details" aria-label="디자인 구성 요소">
                <p className="design-result-v2__panel-hint">디자인 정보를 불러오는 중...</p>
            </section>
        )
    }

    const normalizedPalette = (details?.colorPalette ?? []).map((item, i) => normalizeDetailItem(item, i, 'palette'))

    const normalizedCharms = (details?.nailParts ?? []).map((item, i) => normalizeDetailItem(item, i, 'charm'))

    // ★ 스와치: details.swatches의 모든 항목을 직접 렌더링
    // textures 리스트가 아닌 swatches 맵 기준으로 렌더링해서 모든 스와치가 표시됨
    const swatchEntries = details?.swatches
        ? Object.entries(details.swatches).filter(([key]) => key !== '3d_charm')
        : []

    const charmSwatchEntries = details?.swatches
        ? Object.entries(details.swatches).filter(([key]) => key === '3d_charm')
        : []

    return (
        <section className="design-result-v2__details" aria-label="디자인 구성 요소">
            {/* 컬러 팔레트 */}
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

            {/* ★ 질감 스와치 — swatches 맵의 모든 항목 렌더링 */}
            <div className="design-result-v2__detail-block">
                <p className="design-result-v2__detail-label">질감 · 텍스처</p>
                {swatchLoading ? (
                    <p className="design-result-v2__panel-hint" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid #e8b4c0', borderTopColor: '#c47a90', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                        스와치 생성 중...
                    </p>
                ) : swatchEntries.length > 0 ? (
                    <div className="design-result-v2__texture-row">
                        {swatchEntries.map(([textureKey, swatchUrl]) => {
                            const info = TEXTURE_INFO[textureKey]
                            return (
                                <div className="design-result-v2__texture-item" key={textureKey}>
                                    <DetailThumb
                                        imageUrl={swatchUrl}
                                        shape="circle"
                                        background={info?.swatchStyle?.background}
                                        alt={info?.labelKo ?? textureKey}
                                    >
                                        <span className="design-result-v2__thumb-icon">✧</span>
                                    </DetailThumb>
                                    <span className="design-result-v2__texture-label">
                    {info?.labelKo ?? textureKey}
                  </span>
                                </div>
                            )
                        })}
                    </div>
                ) : (
                    // 스와치 없을 때 textures 리스트로 폴백 (CSS 스와치)
                    (details?.textures ?? []).length > 0 ? (
                        <div className="design-result-v2__texture-row">
                            {(details?.textures ?? []).map((item, i) => {
                                const norm = normalizeDetailItem(item, i, 'texture')
                                const info = norm.label ? TEXTURE_INFO[norm.label] ?? TEXTURE_INFO_BY_KO[norm.label] : undefined
                                return (
                                    <div className="design-result-v2__texture-item" key={norm.key}>
                                        <DetailThumb
                                            imageUrl={norm.imageUrl}
                                            shape="circle"
                                            background={info?.swatchStyle?.background}
                                            alt={info?.labelKo ?? norm.label ?? '텍스처'}
                                        >
                                            <span className="design-result-v2__thumb-icon">✧</span>
                                        </DetailThumb>
                                        <span className="design-result-v2__texture-label">{info?.labelKo ?? norm.label}</span>
                                    </div>
                                )
                            })}
                        </div>
                    ) : (
                        <p className="design-result-v2__panel-hint">질감 정보가 없어요.</p>
                    )
                )}
            </div>

            {/* 네일 참 · 파츠 */}
            <div className="design-result-v2__detail-block">
                <p className="design-result-v2__detail-label">네일 참 · 파츠</p>
                {normalizedCharms.length > 0 || charmSwatchEntries.length > 0 ? (
                    <div className="design-result-v2__charm-row">
                        {/* 스와치에서 온 3d_charm */}
                        {charmSwatchEntries.map(([key, url]) => (
                            <div className="design-result-v2__charm-item" key={key}>
                                <DetailThumb imageUrl={url} shape="square" alt="3D 참">
                                    <span className="design-result-v2__thumb-icon">✧</span>
                                </DetailThumb>
                                <span className="design-result-v2__charm-label">3D 참</span>
                            </div>
                        ))}
                        {/* designPlan에서 온 파츠 */}
                        {normalizedCharms.map((item) => {
                            const info = item.label ? CHARM_INFO[item.label] ?? CHARM_INFO_BY_KO[item.label] : undefined
                            return (
                                <div className="design-result-v2__charm-item" key={item.key}>
                                    <DetailThumb imageUrl={item.imageUrl} shape="square" alt={info?.labelKo ?? item.label ?? '네일 파츠'}>
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