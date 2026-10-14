import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { TEXTURE_INFO } from '@/shared/constants/designPreferences'
import type { DesignDetailItem, DesignExtractedDetails } from '@/entities/design/api'
import { sortByColorPath } from '@/shared/utils/colorSort'
import '@/styles/nail-design.css'

const TEXTURE_INFO_BY_KO = Object.fromEntries(Object.entries(TEXTURE_INFO).map(([, v]) => [v.labelKo, v]))

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

const LIGHTBOX_ZOOM_MIN = 1
const LIGHTBOX_ZOOM_MAX = 4
const LIGHTBOX_WHEEL_ZOOM_SENSITIVITY = 0.0015

// 질감(텍스처) 썸네일을 눌렀을 때 원본 이미지를 화면 중앙에 크게 띄우는 라이트박스.
// document.body에 포탈로 붙여서, 이 패널이 어떤 모달(마이페이지 상세모달 등) 안에
// 중첩되어 있어도 그 모달 경계에 잘리지 않고 항상 화면 전체를 덮는다.
// 확대/이동은 DesignImageDetailModal의 이미지 뷰포트와 동일한 방식 - 휠로 zoom을
// 조절하고, 확대된 상태에서만 드래그로 pan한다. transform(scale/translate)만
// 건드리므로 레이아웃 크기는 그대로 유지되고, 넘치는 부분은 overflow:hidden으로 잘린다.
//
// 박스는 고정 크기 대신 이미지의 실제 픽셀 크기(뷰포트 한도 내)에 맞춰 잡는다 - 원본보다
// 더 키워서 보여주면(업스케일) 흐려지므로, 스와치는 실제 해상도 그대로 보여주는 쪽이 더 선명하다.
function ImageLightbox({
                            imageUrl,
                            alt,
                            onClose,
                        }: {
    imageUrl: string
    alt: string
    onClose: () => void
}) {
    const [zoom, setZoom] = useState(1)
    const [pan, setPan] = useState({ x: 0, y: 0 })
    const [isDragging, setIsDragging] = useState(false)
    const [naturalBoxSize, setNaturalBoxSize] = useState<{ w: number; h: number } | null>(null)
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

    // 로드된 이미지의 naturalWidth/Height를 읽어, 뷰포트 한도(60vw/50vh) 안에서
    // 원본 비율 그대로 박스 크기를 정한다. 원본보다 크게 키우지 않는다(스케일 <= 1).
    const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
        const img = event.currentTarget
        const maxW = window.innerWidth * 0.6
        const maxH = window.innerHeight * 0.5
        const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight)
        setNaturalBoxSize({ w: img.naturalWidth * scale, h: img.naturalHeight * scale })
    }

    const contentStyle = naturalBoxSize ? { width: `${naturalBoxSize.w}px`, height: `${naturalBoxSize.h}px` } : undefined

    return createPortal(
        <div className="design-result-v2__lightbox" role="dialog" aria-modal="true" aria-label={alt}>
            <button type="button" className="design-result-v2__lightbox-backdrop" aria-label="닫기" onClick={onClose} />
            <div
                ref={viewportRef}
                className={`design-result-v2__lightbox-content${zoom > 1 ? ' is-zoomed' : ''}${isDragging ? ' is-dragging' : ''}`}
                style={contentStyle}
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
                    onLoad={handleImageLoad}
                />
            </div>
        </div>,
        document.body,
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

// Clipboard API는 보안 컨텍스트(HTTPS/localhost)에서만 쓸 수 있어서, 막혀 있으면
// 숨긴 textarea + execCommand('copy') 방식으로 한 번 더 시도한다.
async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch {
        // 아래 폴백으로 진행
    }
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
        return document.execCommand('copy')
    } catch {
        return false
    } finally {
        textarea.remove()
    }
}

// 컬러 팔레트 - 색을 가로 한 줄 띠로 이어 붙이고, 호버한 색 구간을 넓혀
// 그 위에 HEX 값을 띄운다. 클릭하면 HEX 값을 클립보드에 복사한다.
function PaletteStrip({ items }: { items: NormalizedDetail[] }) {
    const [copiedKey, setCopiedKey] = useState<string | null>(null)
    const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => () => {
        if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }, [])

    const handleCopy = async (item: NormalizedDetail) => {
        if (!item.hex) return
        if (!(await copyText(item.hex.toUpperCase()))) return
        setCopiedKey(item.key)
        if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
        copiedTimerRef.current = setTimeout(() => setCopiedKey(null), 1200)
    }

    return (
        <div className="design-result-v2__palette-strip">
            {items.map((item) => {
                const hex = item.hex?.toUpperCase() ?? null
                const copied = copiedKey === item.key
                return (
                    <button
                        type="button"
                        key={item.key}
                        className={`design-result-v2__palette-seg${copied ? ' is-copied' : ''}`}
                        style={{ background: hex ?? (item.imageUrl ? `center / cover no-repeat url("${item.imageUrl}")` : '#eee') }}
                        onClick={() => void handleCopy(item)}
                        disabled={!hex}
                        aria-label={hex ? `${hex} 복사하기` : '컬러'}
                    >
                        {hex && <span className="design-result-v2__palette-hex">{copied ? '복사됨' : hex}</span>}
                    </button>
                )
            })}
        </div>
    )
}

// 컬러 팔레트·질감 스와치가 비동기로 만들어지는 동안 보여주는 스피너 + 문구
function GeneratingHint({ label }: { label: string }) {
    return (
        <p className="design-result-v2__panel-hint design-result-v2__panel-hint--loading" role="status">
            <span className="design-result-v2__spinner" aria-hidden="true" />
            {label}
        </p>
    )
}

type Props = {
    details?: DesignExtractedDetails | null
    loading?: boolean
    paletteLoading?: boolean // 컬러 팔레트 폴링 중 여부
    swatchLoading?: boolean  // ★ 스와치 폴링 중 여부
}

export function DesignDetailsPanel({ details, loading = false, paletteLoading = false, swatchLoading = false }: Props) {
    const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null)

    if (loading) {
        return (
            <section className="design-result-v2__details" aria-label="디자인 구성 요소">
                <p className="design-result-v2__panel-hint">디자인 정보를 불러오는 중...</p>
            </section>
        )
    }

    // 추천 컬러·이달의 컬러와 같은 순서 — 가장 연한 색에서 출발해 비슷한 색끼리 잇는 TSP 경로 (hex 없는 칩은 맨 끝)
    const normalizedPalette = sortByColorPath(
        (details?.colorPalette ?? []).map((item, i) => normalizeDetailItem(item, i, 'palette')),
        (item) => item.hex,
    )

    // 예전에 만들어진 디자인엔 3D 참(파츠) 스와치가 섞여 있을 수 있어서 질감 목록에서 뺀다.
    const swatchEntries = details?.swatches
        ? Object.entries(details.swatches).filter(([key]) => !key.startsWith('3d_charm'))
        : []

    return (
        <section className="design-result-v2__details" aria-label="디자인 구성 요소">
            {lightbox && (
                <ImageLightbox imageUrl={lightbox.url} alt={lightbox.alt} onClose={() => setLightbox(null)} />
            )}

            {/* 컬러 팔레트 */}
            <div className="design-result-v2__detail-block design-result-v2__detail-block--palette">
                <p className="design-result-v2__detail-label">컬러 팔레트</p>
                {normalizedPalette.length > 0 ? (
                    <PaletteStrip items={normalizedPalette} />
                ) : paletteLoading ? (
                    <GeneratingHint label="컬러 팔레트 생성 중..." />
                ) : (
                    <p className="design-result-v2__panel-hint">컬러 정보가 없어요.</p>
                )}
            </div>

            {/* ★ 질감 스와치 — swatches 맵의 모든 항목 렌더링 */}
            <div className="design-result-v2__detail-block design-result-v2__detail-block--texture">
                <p className="design-result-v2__detail-label">질감 · 텍스처</p>
                {swatchLoading ? (
                    <GeneratingHint label="스와치 생성 중..." />
                ) : swatchEntries.length > 0 ? (
                    <div className="design-result-v2__texture-row">
                        {swatchEntries.map(([textureKey, swatchUrl]) => {
                            const info = TEXTURE_INFO[textureKey]
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
        </section>
    )
}
