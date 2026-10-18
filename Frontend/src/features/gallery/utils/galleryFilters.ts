import type { CommunityDesignResponse, DesignDetailItem } from '@/entities/design/api'
import { TEXTURE_INFO } from '@/shared/constants/designPreferences'

export type GallerySort = 'popular' | 'latest'

export type TextureOption = {
    key: string
    label: string
    count: number
    swatchImage: string
}

// 갤러리 질감 필터에 보여 주는 질감 — 스와치가 있는 질감만, 이 이름으로.
// 스와치 이미지는 백엔드 swatch/bases/*_base.png에 질감마다 다른 색을 입혀 만든 작은 그림
// (SwatchColorizer와 같은 수식). 마블처럼 여기 없는 질감은 필터에서 뺀다.
const GALLERY_TEXTURES: { key: string; label: string }[] = [
    { key: 'plain_solid', label: '기본 젤' },
    { key: 'syrup', label: '시럽' },
    { key: 'glitter', label: '글리터' },
    { key: 'chrome', label: '파우더' },
    { key: 'magnetic_chrome', label: '자석' },
    { key: 'matte', label: '매트' },
    { key: 'knit', label: '니트' },
]
const GALLERY_TEXTURE_LABEL = new Map(GALLERY_TEXTURES.map((t) => [t.key, t.label]))

const TEXTURE_KEY_BY_KO: Record<string, string> = {
    ...Object.fromEntries(Object.entries(TEXTURE_INFO).map(([key, info]) => [info.labelKo, key])),
    // 예전에 저장된 한글 라벨도 같은 질감으로 인식한다 ("마그네틱 크롬" → "자석")
    '마그네틱 크롬': 'magnetic_chrome',
}

// textures는 키("glitter") · 한글 라벨 · {label} 객체가 섞여 올 수 있어 TEXTURE_INFO 키 하나로 맞춘다
// 예전에 powder로 저장된 질감은 chrome과 같은 재료라 하나로 센다
const TEXTURE_KEY_ALIASES: Record<string, string> = { powder: 'chrome' }

function textureKeyOf(item: DesignDetailItem): string | null {
    const raw = typeof item === 'string' ? item : item.label
    if (!raw) return null
    const key = TEXTURE_INFO[raw] ? raw : (TEXTURE_KEY_BY_KO[raw] ?? raw)
    return TEXTURE_KEY_ALIASES[key] ?? key
}

export function textureKeysOf(design: CommunityDesignResponse): string[] {
    const keys = (design.details?.textures ?? [])
        .map(textureKeyOf)
        .filter((key): key is string => key != null && GALLERY_TEXTURE_LABEL.has(key))
    return [...new Set(keys)]
}

export function textureSwatchOf(key: string) {
    return `/images/texture-swatches/${key}.png`
}

/** 갤러리 질감 7개를 항상 모두, 이름 가나다순으로 (아직 디자인이 없는 질감은 0개) */
export function collectTextureOptions(designs: CommunityDesignResponse[]): TextureOption[] {
    const counts = new Map<string, number>()
    designs.forEach((design) => {
        textureKeysOf(design).forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1))
    })
    return GALLERY_TEXTURES.map(({ key, label }) => ({
        key,
        label,
        count: counts.get(key) ?? 0,
        swatchImage: textureSwatchOf(key),
    })).sort((a, b) => a.label.localeCompare(b.label, 'ko'))
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
