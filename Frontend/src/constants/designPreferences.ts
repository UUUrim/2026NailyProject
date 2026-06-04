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
  { code: 'spring_bright', nameKo: '봄 브라이트', tone: '웜', brightness: '고명도', saturation: '중채도' },
  { code: 'spring_vivid', nameKo: '봄 비비드', tone: '웜', brightness: '고명도', saturation: '고채도' },
  { code: 'spring_soft', nameKo: '봄 소프트', tone: '웜', brightness: '중명도', saturation: '저채도' },
 
  { code: 'summer_light', nameKo: '여름 라이트', tone: '쿨', brightness: '고명도', saturation: '저채도' },
  { code: 'summer_mute', nameKo: '여름 뮤트', tone: '쿨', brightness: '고명도', saturation: '저채도'},
  { code: 'summer_bright', nameKo: '여름 브라이트', tone: '쿨', brightness: '고명도', saturation: '고채도'},
  { code: 'summer_soft', nameKo: '여름 소프트', tone: '쿨', brightness: '중명도', saturation: '저채도' },

  { code: 'autumn_dark', nameKo: '가을 다크', tone: '웜', brightness: '중명도', saturation: '중채도' },
  { code: 'autumn_deep', nameKo: '가을 딥', tone: '웜', brightness: '중명도', saturation: '고채도' },
  { code: 'autumn_mute', nameKo: '가을 뮤트', tone: '웜', brightness: '중명도', saturation: '저채도' },
  { code: 'autumn_soft', nameKo: '가을 소프트', tone: '웜', brightness: '중명도', saturation: '중채도' },

  { code: 'winter_dark', nameKo: '겨울 다크', tone: '쿨', brightness: '저명도', saturation: '저채도' },
  { code: 'winter_deep', nameKo: '겨울 딥', tone: '쿨', brightness: '중명도', saturation: '중채도' },
  { code: 'winter_light', nameKo: '겨울 라이트', tone: '쿨', brightness: '고명도', saturation: '저채도' },
  { code: 'winter_vivid', nameKo: '겨울 비비드', tone: '쿨', brightness: '고명도', saturation: '고채도' },
]

export const PERSONAL_COLOR_SWATCHES: Record<string, string[]> = {
  spring_light: ['#FBDBDD', '#F8C8CA', '#F7B7BA',	'#FFFCEF', '#FEE2CB', '#FEDBB3', '#F9BF97',	'#FFF0DD',
                 '#FBF5B9',	'#FFF0AD', '#FFE88B',	'#FDE1B5', '#e3edcb', '#e0ebbf', '#d2e091', '#f6bdbd',
                 '#E9F5F2', '#C6E7F4', '#A5DAEC', '#F7B7B4', '#EDDDEE', '#F8D4E8', '#E3B2D4', '#F7BBAE'],
  spring_bright: ['#ED6C79', '#EB5C5A', '#EB5A49', '#FFF7D2', '#F7A55A', '#F7A743', '#EF7E2F', '#FEE4BE',
                  '#FBEC50', '#FFDC38', '#FFD019', '#FED59A', '#d0dc70', '#cddb63', '#c5d546', '#ec5f5d',
                  '#9DD1D8', '#6FB3DF', '#60AEDC', '#E66B63', '#D182B4', '#AE79B2', '#7F5EA3', '#F07858'],
  spring_vivid: ['#E94040', '#E20E15', '#E42321',	'#FFF7D2', '#F38F2F',	'#F08212', '#EB6010', '#FEE4BE',
                 '#FFEB33', '#FED606', '#FCC909', '#fed59a', '#d2d81e', '#b7ce22', '#39aa37', '#e51f1f',
                 '#3ABCE7', '#40A3DA', '#407FBF', '#e4231b', '#AB5CA0', '#844190', '#6F3C8E', '#E6341F'],
  spring_soft: ['#F1C2BF', '#EDB9AE', '#E8A79F', '#F5F1E4', '#F6DAC3', '#F0D3B3', '#E5BA9D', '#DAC6AD',
                '#E8E3D0', '#E9DFB6', '#EADB9C', '#E0BB8F', '#e7e4d0', '#cfcc9b', '#b0bf97', '#eaa1a2',
                '#DFEBE8', '#A2CDCB', '#A3C7D3', '#ECAFA6', '#E0D2E5', '#DCC1D7', '#DBB1D4', '#F4AE98'],

  summer_light:['#FAE5E8', '#F6D1DC', '#E3ACCB', '#FFFFFF', '#FDF6C6', '#F6ECB3', '#FDEA75', '#EDEDED',
                '#C2E2D9', '#B8D7C2', '#A2D2B7', '#D9B9B9', '#a8cfe4', '#a5d7d9', '#91ced2', '#f5bad5',
                '#D2E1EB', '#9a9dca', '#7c84c0', '#f7bace', '#E1D9ED', '#D1BCD7', '#B798C8', '#F4AAB6'],
  summer_mute:['#998B8E', '#B58D98', '#A76B8B', '#FFFFFF', '#A09C7B', '#AEA560', '#C1AF41', '#767675',
               '#6E7875', '#778B7D', '#638771', '#554544', '#667f89', '#6e9094', '#588c92', '#a47488',
               '#778690', '#7e8991', '#40456d', '#a37481', '#78787a', '#837384', '#6c5571', '#a26971'],
  summer_bright:['#EC5F74', '#EA6293', '#E777AC', '#FFFFFF', '#FDEB34', '#FBEC50', '#F3E949', '#C6C6C6',
                 '#7DC5A6', '#79C39E', '#6EC1BB', '#878787', '#59b4e1', '#67a0ce', '#757bb7', '#e26fa7',
                 '#6a6baf', '#8083b6', '#9369a7', '#ea6ca2', '#E56BA5', '#E06895', '#D976AD', '#E95D82'],
  summer_soft:['#DAAEB6', '#DD9EAC', '#D78DB0', '#FFFFFF', '#ECE6AC', '#D8CE73', '#E8D870', '#E2E2E2',
               '#B7D8CE', '#9CCAAB', '#9FCFB1', '#C49997', '#95c1d7', '#91c5c9', '#8ccbd1', '#f3bfd4',
               '#afcddf', '#8b91b9', '#6b78ae', '#f3c0cc', '#D3C3D9', '#C29FC0', '#AF8DB5', '#F3B0B6'],

  autumn_dark:['#5B4241', '#6E2831', '#75160E', '#FFF7D2', '#655240', '#7A5431', '#782E0F', '#634E43',
               '#6F6C44', '#887628', '#8C6D14', '#432918', '#494929', '#565a2c', '#1e371d', '#7d1713',
               '#41575f', '#3d5c67', '#0f334d', '#7c3112', '#3A2B3A', '#352839', '#3B2257', '#7F4411'],
  autumn_deep:['#BF3E4E', '#BE312F', '#C23A1A', '#FFF7D2', '#C9772D', '#C87F1B', '#C26516', '#936037',
               '#CDBD24', '#D1AF13', '#D2B207', '#7C4E24', '#a0ac40', '#9fac35', '#7da82a', '#cb3e3a',
               '#65a4ac', '#3c85b4', '#204f90', '#cb483d', '#a44f85', '#834986', '#362562', '#ce5636'],
  autumn_mute:['#8A6F6C', '#AB877F', '#BB7570', '#F5F1E4', '#8E7D6F', '#B29B85', '#B58B6B', '#DAC6AD',
               '#827F74', '#AAA183', '#B9AA6B', '#E0BB8F', '#7f7e73', '#8e8d6b', '#7f8e66', '#a36062',
               '#7d8482', '#718d8b', '#6f97a2', '#a26c64', '#7b737c', '#9b8998', '#ac7ba1', '#aa6e5b'],
  autumn_soft:['#DDC1C3', '#DAAEB4', '#CF9A9F', '#FFFCEF', '#DFC5B2', '#DEBF9D', '#DDA785', '#E4D5C4',
               '#DED7A4', '#E2D396', '#E1CB79', '#E4C7A2', '#c6d0b2', '#c5cda6', '#b8c17d', '#d8a6a8',
               '#ced7d5', '#adcbd9', '#90becd', '#d9a09d', '#c4b8d2', '#d5b0d3', '#ba91c1', '#daa499'],

  winter_dark:['#513E40', '#632139', '#5A0E33', '#FFFFFF', '#615D3E', '#756E20', '#665C1A', '#29245B',
               '#292929', '#1D3C2C', '#043934', '#1D1D1B', '#334046', '#2a2a4a', '#242754', '#612142',
               '#26263b', '#2a2a4a', '#241d48', '#68213f', '#493d42', '#482733', '#380c26', '#671a2e'],
  winter_deep:['#B91818', '#AF144A', '#A81258', '#FFFFFF', '#008E40', '#00784A', '#0C8067', '#282A5E',
               '#0E8E87', '#02726D', '#055E5B', '#1D1D1B', '#0169a3', '#015089', '#223565', '#aa1643',
               '#25356f', '#252e60', '#262c5f', '#ac182e', '#8b1d6b', '#78216c', '#591b50', '#ac1916'],
  winter_light:['#FCE9F2', '#F9CEDF', '#F195B6', '#FFFFFF', '#FEFBD9', '#FCF7CA', '#FEF292', '#29245B',
                '#E4F1E7', '#D3EAE9', '#A5D8E5', '#1D1D1B', '#e9f6fc', '#c7e8f7', '#96c0e7', '#f4cfd9',
                '#d9effc', '#d0d0e9', '#9ab6e0', '#f6d2e5', '#fbe6f1', '#f0d0e7', '#e09ac3', '#f0cce2'],
  winter_vivid:['#E51A4D', '#E6074C', '#CD0B5C', '#FFFFFF', '#FFE008', '#FCDB03', '#E5C703', '#29245B',
                '#53BBB3', '#2CAA56', '#00A471', '#1D1D1B', '#29a5df', '#217fc2', '#16438f', '#dd0a76',
                '#3a8aca', '#4459a4', '#243064', '#df1a70', '#ab63a5', '#9b3f8f', '#c40d60', '#df144c'],
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
