import type { CommunityDesignResponse, DesignDetailItem } from '@/entities/design/api'
import { TEXTURE_INFO } from '@/shared/constants/designPreferences'

export type GallerySort = 'popular' | 'latest'

export type TextureOption = {
    key: string
    label: string
    count: number
    swatch?: string
}

const TEXTURE_KEY_BY_KO = Object.fromEntries(Object.entries(TEXTURE_INFO).map(([key, info]) => [info.labelKo, key]))

// textures는 키("glitter") · 한글 라벨 · {label} 객체가 섞여 올 수 있어 TEXTURE_INFO 키 하나로 맞춘다
function textureKeyOf(item: DesignDetailItem): string | null {
    const raw = typeof item === 'string' ? item : item.label
    if (!raw) return null
    if (TEXTURE_INFO[raw]) return raw
    return TEXTURE_KEY_BY_KO[raw] ?? raw
}

export function textureKeysOf(design: CommunityDesignResponse): string[] {
    const keys = (design.details?.textures ?? []).map(textureKeyOf).filter((key): key is string => Boolean(key))
    return [...new Set(keys)]
}

export function textureLabelOf(key: string) {
    return TEXTURE_INFO[key]?.labelKo ?? key
}

/** 지금 공유된 디자인들에 실제로 있는 질감만, 많이 쓰인 순서로 */
export function collectTextureOptions(designs: CommunityDesignResponse[]): TextureOption[] {
    const counts = new Map<string, number>()
    designs.forEach((design) => {
        textureKeysOf(design).forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1))
    })
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || textureLabelOf(a[0]).localeCompare(textureLabelOf(b[0]), 'ko'))
        .map(([key, count]) => ({
            key,
            label: textureLabelOf(key),
            count,
            swatch: TEXTURE_INFO[key]?.swatchStyle.background,
        }))
}

// designId는 생성 순서대로 커지므로 최신순 기준으로 쓴다 (createdAt은 "2026. 9. 3." 같은 문자열이라 정렬에 부적합)
export function sortDesigns(designs: CommunityDesignResponse[], sort: GallerySort) {
    return [...designs].sort((a, b) => {
        if (sort === 'popular') {
            const diff = (b.likeCount ?? 0) - (a.likeCount ?? 0)
            if (diff !== 0) return diff
        }
        return b.designId - a.designId
    })
}
