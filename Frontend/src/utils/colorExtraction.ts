/**
 * 이미지에서 대표 색상 팔레트를 추출합니다.
 * 별도 이미지 분석 서버 없이, 캔버스에 이미지를 그린 뒤 픽셀을 양자화(quantize)해서
 * 가장 많이 등장한 색상 순으로 대표색을 뽑아내는 방식입니다.
 */
export async function extractPaletteFromImage(imageUrl: string, count = 8): Promise<string[]> {
    const img = await loadImage(imageUrl)

    const canvas = document.createElement('canvas')
    const sampleSize = 96 // 성능을 위해 축소해서 샘플링
    canvas.width = sampleSize
    canvas.height = sampleSize
    const ctx = canvas.getContext('2d')
    if (!ctx) return []

    ctx.drawImage(img, 0, 0, sampleSize, sampleSize)

    let pixels: Uint8ClampedArray
    try {
        pixels = ctx.getImageData(0, 0, sampleSize, sampleSize).data
    } catch {
        // CORS로 픽셀 접근이 막히면 빈 배열 반환 (호출부에서 폴백 처리)
        return []
    }

    const buckets = new Map<string, { count: number; r: number; g: number; b: number }>()
    const STEP = 24 // 색상 양자화 간격

    for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i]
        const g = pixels[i + 1]
        const b = pixels[i + 2]
        const a = pixels[i + 3]
        if (a < 200) continue // 투명 픽셀 제외

        // 흰 배경(제품샷 배경) 및 거의 검은 픽셀은 대표색에서 제외
        const isNearWhite = r > 235 && g > 235 && b > 235
        const isNearBlack = r < 20 && g < 20 && b < 20
        if (isNearWhite || isNearBlack) continue

        const key = `${Math.round(r / STEP)}-${Math.round(g / STEP)}-${Math.round(b / STEP)}`
        const bucket = buckets.get(key)
        if (bucket) {
            bucket.count += 1
            bucket.r += r
            bucket.g += g
            bucket.b += b
        } else {
            buckets.set(key, { count: 1, r, g, b })
        }
    }

    const sorted = [...buckets.values()].sort((a, b) => b.count - a.count)

    const palette: string[] = []
    for (const bucket of sorted) {
        const hex = rgbToHex(
            Math.round(bucket.r / bucket.count),
            Math.round(bucket.g / bucket.count),
            Math.round(bucket.b / bucket.count),
        )
        // 이미 뽑힌 색과 너무 비슷하면 건너뛰기 (팔레트 다양성 확보)
        if (palette.some((existing) => colorDistance(existing, hex) < 40)) continue
        palette.push(hex)
        if (palette.length >= count) break
    }

    return palette
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = src
    })
}

function rgbToHex(r: number, g: number, b: number): string {
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

function hexToRgb(hex: string): [number, number, number] {
    const clean = hex.replace('#', '')
    return [
        parseInt(clean.slice(0, 2), 16),
        parseInt(clean.slice(2, 4), 16),
        parseInt(clean.slice(4, 6), 16),
    ]
}

function colorDistance(hexA: string, hexB: string): number {
    const [r1, g1, b1] = hexToRgb(hexA)
    const [r2, g2, b2] = hexToRgb(hexB)
    return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}