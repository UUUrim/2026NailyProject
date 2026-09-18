import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { TEXTURE_INFO, CHARM_INFO } from '@/shared/constants/designPreferences'
import type { DesignDetailItem, DesignExtractedDetails } from '@/entities/design/api'
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

// 색상환(hue)에서 이 값보다 간격이 벌어진 지점을 "다른 색상 묶음"의 경계로 본다.
// (30도 단위 같은 고정 그리드로 자르면, 예를 들어 hue 179와 181처럼 사실상 같은 색인데
// 그리드 경계에 걸려 서로 다른 묶음으로 쪼개지는 문제가 생긴다. 그래서 고정 그리드 대신
// 팔레트에 실제로 존재하는 색들 사이의 "빈 간격"을 기준으로 묶음을 나눈다.)
const HUE_GAP_THRESHOLD = 28
// 채도가 이보다 낮으면 색상값(hue)이 거의 의미 없는 무채색/톤다운 컬러로 보고, hue와 무관하게
// 하나의 "무채색" 묶음으로 합친다. (예: 베이지·라벤더그레이·그레이지·다크그레이는 hue가 서로
// 크게 달라도 채도가 다 낮으면 사람 눈엔 "같은 무채색 계열"로 보인다 — 8% 같은 낮은 기준이면
// 이런 색들이 hue만으로 갈라져서 따로따로 묶여버린다)
const MIN_CHROMA_SATURATION = 15

function hexToHsl(hex: string): [number, number, number] {
    const clean = hex.replace('#', '')
    const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
    const int = parseInt(full, 16)
    const r = (int >> 16) & 255
    const g = (int >> 8) & 255
    const b = int & 255
    const rn = r / 255
    const gn = g / 255
    const bn = b / 255
    const max = Math.max(rn, gn, bn)
    const min = Math.min(rn, gn, bn)
    const l = (max + min) / 2
    const d = max - min
    if (d === 0) return [0, 0, l * 100]
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    let h: number
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    return [h * 60, s * 100, l * 100]
}

type HueLight = { hue: number; light: number }

function hueLightOf(hex: string): HueLight {
    const [h, , l] = hexToHsl(hex)
    return { hue: ((h % 360) + 360) % 360, light: l }
}

/**
 * 색상환(hue) 위에서 색들이 실제로 몰려 있는 구간끼리 묶는다. 색상값 순으로 원을 한 바퀴
 * 돌면서 "가장 크게 비어 있는 구간"을 찾아 그 자리를 이음매로 삼아 원을 펼치고(그래야 빨강
 * 계열처럼 0도 근처에 몰린 색이 이음매에 걸려 반으로 쪼개지지 않는다), 이어서 이웃한 색끼리
 * 간격이 HUE_GAP_THRESHOLD보다 벌어지는 지점마다 새 묶음으로 자른다.
 */
function clusterBySimilarHue<T extends { key: string }>(items: T[], hueOf: (item: T) => number): T[][] {
    if (items.length <= 1) return items.length === 1 ? [items] : []

    const sorted = [...items].sort((a, b) => hueOf(a) - hueOf(b))
    const n = sorted.length

    let seamIndex = 0
    let largestGap = -1
    for (let i = 0; i < n; i += 1) {
        const current = hueOf(sorted[i])
        const next = hueOf(sorted[(i + 1) % n])
        const gap = i === n - 1 ? 360 - current + next : next - current
        if (gap > largestGap) {
            largestGap = gap
            seamIndex = i
        }
    }
    const opened = [...sorted.slice(seamIndex + 1), ...sorted.slice(0, seamIndex + 1)]

    const groups: T[][] = [[opened[0]]]
    for (let i = 1; i < opened.length; i += 1) {
        const gap = (hueOf(opened[i]) - hueOf(opened[i - 1]) + 360) % 360
        if (gap > HUE_GAP_THRESHOLD) groups.push([opened[i]])
        else groups[groups.length - 1].push(opened[i])
    }
    return groups
}

/**
 * 1) 추출된 컬러 칩들을 색상값(hue)이 비슷한 것끼리 묶고(채도가 낮은 무채색은 별도 묶음),
 * 2) 각 묶음은 묶음의 평균 명도를 기준으로 밝은 묶음 → 어두운 묶음 순으로 배치하고,
 * 3) 묶음 내부도 밝은 색 → 어두운 색 순으로 정렬한다.
 */
function sortPaletteByShade(items: NormalizedDetail[]): NormalizedDetail[] {
    const withHex = items.filter((item) => item.hex)
    const withoutHex = items.filter((item) => !item.hex)

    const infoByKey = new Map(withHex.map((item) => [item.key, hueLightOf(item.hex as string)]))
    const saturationOf = (item: NormalizedDetail) => hexToHsl(item.hex as string)[1]
    const chroma = withHex.filter((item) => saturationOf(item) >= MIN_CHROMA_SATURATION)
    const gray = withHex.filter((item) => saturationOf(item) < MIN_CHROMA_SATURATION)

    const hueGroups = clusterBySimilarHue(chroma, (item) => infoByKey.get(item.key)!.hue)
    const groups = [...hueGroups, ...(gray.length > 0 ? [gray] : [])].map((group) => {
        const sorted = [...group].sort((a, b) => infoByKey.get(b.key)!.light - infoByKey.get(a.key)!.light)
        const avgLight = sorted.reduce((sum, item) => sum + infoByKey.get(item.key)!.light, 0) / sorted.length
        return { sorted, avgLight }
    })
    groups.sort((a, b) => b.avgLight - a.avgLight)

    return [...groups.flatMap((group) => group.sorted), ...withoutHex]
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

const LIGHTBOX_ZOOM_MIN = 1
const LIGHTBOX_ZOOM_MAX = 4
const LIGHTBOX_WHEEL_ZOOM_SENSITIVITY = 0.0015

// 텍스처·파츠 썸네일을 눌렀을 때 원본 이미지를 화면 중앙에 크게 띄우는 라이트박스.
// document.body에 포탈로 붙여서, 이 패널이 어떤 모달(마이페이지 상세모달 등) 안에
// 중첩되어 있어도 그 모달 경계에 잘리지 않고 항상 화면 전체를 덮는다.
// 확대/이동은 DesignImageDetailModal의 이미지 뷰포트와 동일한 방식 - 휠로 zoom을
// 조절하고, 확대된 상태에서만 드래그로 pan한다. transform(scale/translate)만
// 건드리므로 레이아웃 크기는 그대로 유지되고, 넘치는 부분은 overflow:hidden으로 잘린다.
function ImageLightbox({ imageUrl, alt, onClose }: { imageUrl: string; alt: string; onClose: () => void }) {
    const [zoom, setZoom] = useState(1)
    const [pan, setPan] = useState({ x: 0, y: 0 })
    const [isDragging, setIsDragging] = useState(false)
    const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
    const viewportRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [onClose])

    // 휠 이벤트로 페이지 스크롤이 함께 일어나지 않도록 preventDefault가 필요한데,
    // React의 합성 이벤트는 이 리스너를 passive로 등록해 preventDefault를 무시하므로
    // ref에 직접 네이티브 리스너를 붙인다.
    useEffect(() => {
        const viewport = viewportRef.current
        if (!viewport) return

        const handleWheel = (event: WheelEvent) => {
            event.preventDefault()
            setZoom((z) => {
                const next = Math.min(
                    LIGHTBOX_ZOOM_MAX,
                    Math.max(LIGHTBOX_ZOOM_MIN, Number((z - event.deltaY * LIGHTBOX_WHEEL_ZOOM_SENSITIVITY).toFixed(2))),
                )
                if (next === LIGHTBOX_ZOOM_MIN) setPan({ x: 0, y: 0 })
                return next
            })
        }

        viewport.addEventListener('wheel', handleWheel, { passive: false })
        return () => viewport.removeEventListener('wheel', handleWheel)
    }, [])

    const handlePointerDown = (event: ReactMouseEvent<HTMLImageElement>) => {
        if (zoom <= LIGHTBOX_ZOOM_MIN) return
        setIsDragging(true)
        dragStartRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }
    }

    const handlePointerMove = (event: ReactMouseEvent<HTMLImageElement>) => {
        if (!isDragging) return
        const dx = event.clientX - dragStartRef.current.x
        const dy = event.clientY - dragStartRef.current.y
        setPan({ x: dragStartRef.current.panX + dx, y: dragStartRef.current.panY + dy })
    }

    const stopDragging = () => setIsDragging(false)

    return createPortal(
        <div className="design-result-v2__lightbox" role="dialog" aria-modal="true" aria-label={alt}>
            <button type="button" className="design-result-v2__lightbox-backdrop" aria-label="닫기" onClick={onClose} />
            <div
                ref={viewportRef}
                className={`design-result-v2__lightbox-content${zoom > 1 ? ' is-zoomed' : ''}${isDragging ? ' is-dragging' : ''}`}
                onMouseUp={stopDragging}
                onMouseLeave={stopDragging}
            >
                <button type="button" className="design-result-v2__lightbox-close" aria-label="닫기" onClick={onClose}>
                    ✕
                </button>
                <img
                    src={imageUrl}
                    alt={alt}
                    draggable={false}
                    style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
                    onMouseDown={handlePointerDown}
                    onMouseMove={handlePointerMove}
                />
            </div>
        </div>,
        document.body,
    )
}

// 팔레트/텍스처와 달리 참·파츠는 이미 배경이 제거된 낱장 이미지라, 박스에 가두지
// 않고 그 이미지 자체를 보여준다 - 로드 실패시에만 최소한의 아이콘으로 대체한다.
function CharmImage({
                         imageUrl,
                         alt,
                         fallbackIcon,
                         onClick,
                     }: {
    imageUrl: string
    alt: string
    fallbackIcon: string
    onClick: () => void
}) {
    const [broken, setBroken] = useState(false)

    if (broken) {
        return (
            <span className="design-result-v2__charm-fallback" role="img" aria-label={alt}>
                {fallbackIcon}
            </span>
        )
    }

    return (
        <button type="button" className="design-result-v2__charm-image-button" onClick={onClick} aria-label={`${alt} 확대 보기`}>
            <img
                className="design-result-v2__charm-image"
                src={imageUrl}
                alt={alt}
                loading="lazy"
                onError={() => setBroken(true)}
            />
        </button>
    )
}

function DetailThumb({
                         imageUrl,
                         shape,
                         background,
                         alt,
                         children,
                         onClick,
                     }: {
    imageUrl: string | null
    shape: 'square' | 'circle'
    background?: string
    alt: string
    children?: ReactNode
    onClick?: () => void
}) {
    const [broken, setBroken] = useState(false)
    const showImage = !!imageUrl && !broken
    const className = `design-result-v2__thumb design-result-v2__thumb--${shape}`
    const style = !showImage && background ? { background } : undefined
    const content = showImage ? (
        <img src={imageUrl as string} alt={alt} loading="lazy" onError={() => setBroken(true)} />
    ) : (
        children
    )

    if (showImage && onClick) {
        return (
            <button type="button" className={`${className} design-result-v2__thumb--zoomable`} style={style} onClick={onClick} aria-label={`${alt} 확대 보기`}>
                {content}
            </button>
        )
    }

    return (
        <div className={className} style={style}>
            {content}
        </div>
    )
}

type Props = {
    details?: DesignExtractedDetails | null
    loading?: boolean
    swatchLoading?: boolean  // ★ 스와치 폴링 중 여부
}

export function DesignDetailsPanel({ details, loading = false, swatchLoading = false }: Props) {
    const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null)

    if (loading) {
        return (
            <section className="design-result-v2__details" aria-label="디자인 구성 요소">
                <p className="design-result-v2__panel-hint">디자인 정보를 불러오는 중...</p>
            </section>
        )
    }

    const normalizedPalette = sortPaletteByShade(
        (details?.colorPalette ?? []).map((item, i) => normalizeDetailItem(item, i, 'palette')),
)

    const normalizedCharms = (details?.nailParts ?? []).map((item, i) => normalizeDetailItem(item, i, 'charm'))

    const swatchEntries = details?.swatches
        ? Object.entries(details.swatches).filter(([key]) => !key.startsWith('3d_charm'))
        : []

    const charmSwatchEntries = details?.swatches
        ? Object.entries(details.swatches).filter(([key]) => key.startsWith('3d_charm'))
        : []

    return (
        <section className="design-result-v2__details" aria-label="디자인 구성 요소">
            {lightbox && (
                <ImageLightbox imageUrl={lightbox.url} alt={lightbox.alt} onClose={() => setLightbox(null)} />
            )}

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
                            const infoKey = textureKey.startsWith('3d_charm') ? '3d_charm' : textureKey
                            const info = TEXTURE_INFO[infoKey]
                            const alt = info?.labelKo ?? textureKey
                            return (
                                <div className="design-result-v2__texture-item" key={textureKey}>
                                    <DetailThumb
                                        imageUrl={swatchUrl}
                                        shape="circle"
                                        background={info?.swatchStyle?.background}
                                        alt={alt}
                                        onClick={() => setLightbox({ url: swatchUrl, alt })}
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
                                const alt = info?.labelKo ?? norm.label ?? '텍스처'
                                return (
                                    <div className="design-result-v2__texture-item" key={norm.key}>
                                        <DetailThumb
                                            imageUrl={norm.imageUrl}
                                            shape="circle"
                                            background={info?.swatchStyle?.background}
                                            alt={alt}
                                            onClick={norm.imageUrl ? () => setLightbox({ url: norm.imageUrl as string, alt }) : undefined}
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

                        {charmSwatchEntries.map(([key, url]) => {
                            const shapePart = key
                                .replace(/^3d_charm_?/, '')
                                .replace(/_\d+$/, '')
                                .replace(/_/g, ' ')
                            const label = shapePart ? shapePart : '3D 참'
                            return url ? (
                                <CharmImage
                                    key={key}
                                    imageUrl={url}
                                    alt={label}
                                    fallbackIcon="✧"
                                    onClick={() => setLightbox({ url, alt: label })}
                                />
                            ) : (
                                <span className="design-result-v2__charm-fallback" key={key} role="img" aria-label={label}>
            ✧
        </span>
                            )
                        })}
                        {/* designPlan에서 온 파츠 */}
                        {normalizedCharms.map((item) => {
                            const info = item.label ? CHARM_INFO[item.label] ?? CHARM_INFO_BY_KO[item.label] : undefined
                            const alt = info?.labelKo ?? item.label ?? '네일 파츠'
                            return item.imageUrl ? (
                                <CharmImage
                                    key={item.key}
                                    imageUrl={item.imageUrl}
                                    alt={alt}
                                    fallbackIcon={info?.icon ?? '✧'}
                                    onClick={() => setLightbox({ url: item.imageUrl as string, alt })}
                                />
                            ) : (
                                <span className="design-result-v2__charm-fallback" key={item.key} role="img" aria-label={alt}>
            {info?.icon ?? '✧'}
        </span>
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
