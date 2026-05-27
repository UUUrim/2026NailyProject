export type PreferenceKey =
  | 'mood'
  | 'designType'
  | 'season'
  | 'length'
  | 'motif'
  | 'shape'
  | 'color'

export type NailDesignPreferences = {
  mood: string[]
  designType: string[]
  season: string[]
  length: string[]
  motif: string[]
  shape: string[]
  color: string[]
}

export const INITIAL_PREFERENCES: NailDesignPreferences = {
  mood: [],
  designType: [],
  season: [],
  length: [],
  motif: [],
  shape: [],
  color: [],
}

export const PREFERENCE_LIMITS: Record<PreferenceKey, number> = {
  mood: 2,
  designType: 2,
  season: 1,
  length: 1,
  motif: 2,
  shape: 1,
  color: 2,
}

export const PREFERENCE_OPTIONS: Record<PreferenceKey, string[]> = {
  mood: ['lovely', 'simple', 'modern', 'chic', 'cute', 'kitschy', 'funky', 'feminine', 'elegant', 'pure', 'delicate'],
  designType: ['glitter', 'gradient', 'cheek', 'marble', 'french', 'magnetic', 'powder', 'matte', 'art'],
  season: ['spring', 'summer', 'autumn', 'winter', '상관없음'],
  length: ['short', 'medium', 'long'],
  motif: ['star', 'ribbon', 'floral', 'heart', 'crystal', 'pearl', 'swirl', 'polka dot', '없음', '기타'],
  shape: ['아몬드', '라운드', '스퀘어', '스틸레토', '발리나', '오발'],
  color: ['#FDE2EA', '#FFC0D0', '#FF90B3', '#DE869F', '#A98BFF', '#7CD6D6', '#FFF2A8', '#E6E6E6'],
}

export type SeasonRow = {
  code: string
  nameKo: string
  tone: string
  brightness: string
  saturation: string
}

export const SEASON_ROWS: SeasonRow[] = [
  { code: 'spring_light', nameKo: '봄 라이트', tone: '웜', brightness: '고명도', saturation: '저채도' },
  { code: 'spring_bright', nameKo: '봄 브라이트', tone: '웜', brightness: '고명도', saturation: '고채도' },
  { code: 'spring_true', nameKo: '봄 트루', tone: '웜', brightness: '중명도', saturation: '고채도' },
  { code: 'summer_true', nameKo: '여름 트루', tone: '쿨', brightness: '중명도', saturation: '중채도' },
  { code: 'summer_light', nameKo: '여름 라이트', tone: '쿨', brightness: '고명도', saturation: '저채도' },
  { code: 'summer_soft', nameKo: '여름 소프트', tone: '쿨', brightness: '중명도', saturation: '저채도' },
  { code: 'autumn_true', nameKo: '가을 트루', tone: '웜', brightness: '중명도', saturation: '고채도' },
  { code: 'autumn_soft', nameKo: '가을 소프트', tone: '웜', brightness: '중명도', saturation: '저채도' },
  { code: 'autumn_dark', nameKo: '가을 다크', tone: '웜', brightness: '저명도', saturation: '중채도' },
  { code: 'winter_bright', nameKo: '겨울 브라이트', tone: '쿨', brightness: '고명도', saturation: '고채도' },
  { code: 'winter_dark', nameKo: '겨울 다크', tone: '쿨', brightness: '저명도', saturation: '중채도' },
  { code: 'winter_true', nameKo: '겨울 트루', tone: '쿨', brightness: '저명도', saturation: '고채도' },
]

export const PERSONAL_COLOR_SWATCHES: Record<string, string[]> = {
  spring_light: ['#F8E5B9', '#F6C7B6', '#EEDFA7', '#D8E9B6', '#F9D8C6', '#E6D6A8'],
  spring_bright: ['#FFB482', '#FF9E4A', '#FF6F61', '#FF4B3E', '#7FD6C2', '#6EC3E6'],
  spring_true: ['#F68A42', '#E74C3C', '#F6D43A', '#4DB6AC', '#72A9F7', '#D97BD8'],
  summer_true: ['#E5AFCB', '#C8B8E8', '#A7C8E8', '#8FCBC4', '#B0B8C8', '#E6C8D8'],
  summer_light: ['#F7DCE6', '#E6DDF5', '#DCEAF8', '#DDF2EE', '#EDEDED', '#F2E2D5'],
  summer_soft: ['#C9B6C9', '#B8BACF', '#A6B8C1', '#A7BDB7', '#C9C0B7', '#C8AFA4'],
  autumn_true: ['#B85C38', '#D9733D', '#A7642B', '#8B6B33', '#4F7B5E', '#6F4A32'],
  autumn_soft: ['#B8927F', '#A88B76', '#8D8B6F', '#809276', '#94857C', '#A67B6C'],
  autumn_dark: ['#5D3A2C', '#6A422A', '#4E4A2E', '#3C4D3A', '#473839', '#2F3130'],
  winter_bright: ['#FF3D6E', '#FF0054', '#00B8FF', '#007BFF', '#9C4DFF', '#FF4BD8'],
  winter_dark: ['#3A1F2D', '#1E2A44', '#24323D', '#2A243D', '#3D2A2A', '#1D1D1F'],
  winter_true: ['#D70040', '#0033A0', '#00A3A3', '#6A0DAD', '#222222', '#F5F5F5'],
}

export function buildDesignPrompt(preferences: NailDesignPreferences): string {
  const lines = [
    'Create a custom nail tip design with the following preferences:',
    `mood: ${preferences.mood.join(', ') || 'not specified'}`,
    `designType: ${preferences.designType.join(', ') || 'not specified'}`,
    `season: ${preferences.season.join(', ') || 'not specified'}`,
    `length: ${preferences.length.join(', ') || 'not specified'}`,
    `motif: ${preferences.motif.join(', ') || 'not specified'}`,
    `shape: ${preferences.shape.join(', ') || 'not specified'}`,
    `color(HEX): ${preferences.color.join(', ') || 'not specified'}`,
  ]

  return lines.join('\n')
}
