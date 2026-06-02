export type PreferenceKey = 'mood' | 'designType' | 'season' | 'motif' | 'shape' | 'color'

export type NailDesignPreferences = {
  mood: string[]
  designType: string[]
  season: string[]
  motif: string[]
  shape: string[]
  color: string[]
  freeText: string
}

export const INITIAL_PREFERENCES: NailDesignPreferences = {
  mood: [],
  designType: [],
  season: [],
  motif: [],
  shape: [],
  color: [],
  freeText: '',
}

export const PREFERENCE_LIMITS: Record<PreferenceKey, number> = {
  mood: 2,
  designType: 2,
  season: 1,
  motif: 2,
  shape: 1,
  color: 2,
}

export type PreferenceOption = {
  value: string
  label: string
}

export const PREFERENCE_OPTIONS: Record<PreferenceKey, PreferenceOption[]> = {
  mood: [
    { value: 'lovely', label: '러블리' },
    { value: 'simple', label: '심플' },
    { value: 'modern', label: '모던' },
    { value: 'chic', label: '시크' },
    { value: 'cute', label: '큐트' },
    { value: 'kitschy', label: '키치' },
    { value: 'funky', label: '펑키' },
    { value: 'feminine', label: '페미닌' },
    { value: 'elegant', label: '엘레강트' },
    { value: 'pure', label: '퓨어' },
    { value: 'delicate', label: '섬세' },
  ],
  designType: [
    { value: 'glitter', label: '글리터' },
    { value: 'gradient', label: '그라데이션' },
    { value: 'cheek', label: '치크' },
    { value: 'marble', label: '마블' },
    { value: 'french', label: '프렌치' },
    { value: 'magnetic', label: '마그네틱' },
    { value: 'powder', label: '파우더' },
    { value: 'matte', label: '매트' },
    { value: 'art', label: '아트' },
  ],
  season: [
    { value: 'spring', label: '봄' },
    { value: 'summer', label: '여름' },
    { value: 'autumn', label: '가을' },
    { value: 'winter', label: '겨울' },
    { value: '상관없음', label: '상관없음' },
  ],
  motif: [
    { value: 'star', label: '별' },
    { value: 'ribbon', label: '리본' },
    { value: 'floral', label: '플로럴' },
    { value: 'heart', label: '하트' },
    { value: 'crystal', label: '크리스탈' },
    { value: 'pearl', label: '펄' },
    { value: 'swirl', label: '스월' },
    { value: 'polka dot', label: '도트' },
    { value: '없음', label: '없음' },
    { value: '기타', label: '기타' },
  ],
  shape: [
    { value: 'square', label: '스퀘어' },
    { value: 'oval', label: '오발' },
    { value: 'round', label: '라운드' },
    { value: 'almond', label: '아몬드' },
    { value: 'stiletto', label: '스틸레토' },
    { value: 'ballerina', label: '발레리나' },
  ],
  color: [
    { value: '#FDE2EA', label: '#FDE2EA' },
    { value: '#FFC0D0', label: '#FFC0D0' },
    { value: '#FF90B3', label: '#FF90B3' },
    { value: '#DE869F', label: '#DE869F' },
    { value: '#A98BFF', label: '#A98BFF' },
    { value: '#7CD6D6', label: '#7CD6D6' },
    { value: '#FFF2A8', label: '#FFF2A8' },
    { value: '#E6E6E6', label: '#E6E6E6' },
  ],
}

export const PREFERENCE_SECTION_LABELS: Record<PreferenceKey, string> = {
  mood: '무드',
  designType: '디자인 타입',
  season: '시즌',
  motif: '모티프',
  shape: '네일 쉐입',
  color: '컬러',
}

export const SHAPE_PREVIEW_IMAGES: Record<string, string> = {
  square: '/images/shapes/square.png',
  oval: '/images/shapes/oval.png',
  round: '/images/shapes/round.png',
  almond: '/images/shapes/almond.png',
  stiletto: '/images/shapes/stiletto.png',
  ballerina: '/images/shapes/ballerina.png',
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

function formatPreferenceValues(key: PreferenceKey, values: string[]): string {
  if (values.length === 0) return 'not specified'
  return values
    .map((value) => PREFERENCE_OPTIONS[key].find((option) => option.value === value)?.label ?? value)
    .join(', ')
}

export function buildDesignPrompt(preferences: NailDesignPreferences): string {
  const lines = [
    'Create a custom nail tip design with the following preferences:',
    `mood: ${formatPreferenceValues('mood', preferences.mood)}`,
    `designType: ${formatPreferenceValues('designType', preferences.designType)}`,
    `season: ${formatPreferenceValues('season', preferences.season)}`,
    `motif: ${formatPreferenceValues('motif', preferences.motif)}`,
    `shape: ${formatPreferenceValues('shape', preferences.shape)}`,
    `color(HEX): ${preferences.color.join(', ') || 'not specified'}`,
  ]

  if (preferences.freeText.trim()) {
    lines.push(`additional notes: ${preferences.freeText.trim()}`)
  }

  return lines.join('\n')
}
