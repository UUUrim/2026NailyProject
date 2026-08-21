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
    { value: 'kitsch', label: '키치' },
    { value: 'funky', label: '펑키' },
    { value: 'feminine', label: '페미닌' },
    { value: 'elegant', label: '우아' },
    { value: 'pure', label: '순수' },
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
    { value: 'pearl', label: '진주' },
    { value: 'swirl', label: '소용돌이' },
    { value: 'polka dot', label: '도트' },
    { value: '없음', label: '없음' },
    // { value: '기타', label: '기타' },
  ],
  shape: [
    { value: 'round', label: '라운드' },
    { value: 'oval', label: '오발' },
    { value: 'almond', label: '아몬드' },
    { value: 'stiletto', label: '스틸레토' },
    { value: 'ballerina', label: '발레리나' },
    { value: 'square', label: '스퀘어' },
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

/**
 * 선택지 호버 시 보여줄 "이게 어떤 느낌인지" 미리보기 정보.
 * public/images/sample 폴더에 있는 실제 예시 사진 경로(image)와 짧은 설명(desc)으로 구성된다.
 */
export type PreferenceOptionInfo = {
  desc: string
  /** public/images/sample 안에 실제 예시 이미지를 넣으면 이 경로로 노출된다 */
  image: string
}

export const PREFERENCE_OPTION_INFO: Partial<Record<PreferenceKey, Record<string, PreferenceOptionInfo>>> = {
  mood: {
    lovely: { desc: '부드러운 핑크와 화사한 컬러에 하트, 리본, 진주 등의 장식을 더해 사랑스럽고 로맨틱한 분위기.', image: '/images/nail-sample/mood/lovely.png' },
    simple: { desc: '장식을 최소화한 깔끔한 단색 위주의 디자인.', image: '/images/nail-sample/mood/simple.png' },
    modern: { desc: '직선과 무채색 계열로 세련되고 도시적인 느낌.', image: '/images/nail-sample/mood/modern.png' },
    chic: { desc: '차분한 컬러와 깔끔하고 절제된 디자인으로 도시적이고 세련된 분위기', image: '/images/nail-sample/mood/chic.png' },
    cute: { desc: '발랄하고 귀여운 색감과 아기자기한 디테일.', image: '/images/nail-sample/mood/cute.png' },
    kitsch: { desc: '과감한 색 조합과 유머러스한 패턴이 특징.', image: '/images/nail-sample/mood/kitsch.jpg' },
    funky: { desc: '튀는 컬러와 대담한 패턴으로 개성 있는 스타일.', image: '/images/nail-sample/mood/funky.jpg' },
    feminine: { desc: '부드러운 곡선과 로맨틱한 파스텔 톤.', image: '/images/nail-sample/mood/feminine.png' },
    elegant: { desc: '은은한 광택과 절제된 포인트로 고급스러운 분위기.', image: '/images/nail-sample/mood/elegant.png' },
    pure: { desc: '화이트·베이지 계열의 맑고 깨끗한 느낌.', image: '/images/nail-sample/mood/pure.png' },
    delicate: { desc: '가느다란 라인과 정교한 디테일이 돋보이는 스타일.', image: '/images/nail-sample/mood/delicate.png' },
  },
  designType: {
    glitter: { desc: '반짝이는 펄·글리터 가루로 화려한 광채를 내는 디자인.', image: '/images/nail-sample/design-type/glitter.png' },
    gradient: { desc: '두 가지 이상의 색이 자연스럽게 번지듯 이어지는 디자인.', image: '/images/nail-sample/design-type/gradient.png' },
    cheek: { desc: '손톱 중앙에 볼터치처럼 은은하게 색을 입히는 디자인.', image: '/images/nail-sample/design-type/cheek.png' },
    marble: { desc: '대리석 무늬처럼 색이 불규칙하게 퍼지는 패턴.', image: '/images/nail-sample/design-type/marble.jpg' },
    french: { desc: '손톱 끝부분만 다른 컬러로 라인을 그리는 클래식 디자인.', image: '/images/nail-sample/design-type/french.jpg' },
    magnetic: { desc: '자석 젤로 오로라 같은 입체적인 빛 무늬를 만드는 디자인.', image: '/images/nail-sample/design-type/magnetic.jpg' },
    powder: { desc: '고운 컬러 파우더를 발라 매트하고 벨벳 같은 광을 내는 디자인.', image: '/images/nail-sample/design-type/powder.jpg' },
    matte: { desc: '광택 없이 무광으로 마무리해 차분한 느낌을 주는 디자인.', image: '/images/nail-sample/design-type/matte.png' },
    art: { desc: '손그림·스톤 등으로 직접 그림을 그려 넣는 디자인.', image: '/images/nail-sample/design-type/art.png' },
  },
  motif: {
    star: { desc: '별 모양 포인트로 반짝이는 느낌.', image: '/images/nail-sample/motif/star.png' },
    ribbon: { desc: '리본 모양 장식으로 사랑스러운 포인트.', image: '/images/nail-sample/motif/ribbon.png' },
    floral: { desc: '꽃 패턴으로 화사하고 로맨틱한 느낌.', image: '/images/nail-sample/motif/floral.png' },
    heart: { desc: '하트 모양으로 사랑스럽고 귀여운 포인트.', image: '/images/nail-sample/motif/heart.png' },
    crystal: { desc: '크고 작은 큐빅 장식으로 화려한 반짝임.', image: '/images/nail-sample/motif/crystal.png' },
    pearl: { desc: '진주알의 은은한 광택 장식.', image: '/images/nail-sample/motif/pearl.png' },
    swirl: { desc: '빙글빙글 돌아가는 곡선 패턴.', image: '/images/nail-sample/motif/swirl.jpg' },
    'polka dot': { desc: '동글동글한 도트 무늬 포인트.', image: '/images/nail-sample/motif/polka-dot.jpg' },
    // '없음'은 말 그대로 모티프를 넣지 않겠다는 선택지라 설명 툴팁이 필요 없어 의도적으로 비워둔다.
  },
}

export const PREFERENCE_SECTION_LABELS: Record<PreferenceKey, string> = {
  mood: '분위기',
  designType: '디자인 타입',
  season: '계절',
  motif: '핵심 요소',
  shape: '네일 쉐입',
  color: '컬러',
}

export const SHAPE_PREVIEW_IMAGES: Record<string, string> = {
  square: '/images/nail-shapes/square.svg',
  oval: '/images/nail-shapes/oval.svg',
  round: '/images/nail-shapes/round.svg',
  almond: '/images/nail-shapes/almond.svg',
  stiletto: '/images/nail-shapes/stiletto.svg',
  ballerina: '/images/nail-shapes/ballerina.svg',
}

export type TextureInfo = {
  labelKo: string
  swatchStyle: {
    background: string
  }
}

// 디자인 타입(design_type) 키워드 → 결과 페이지 [texture] 패널용 시각 표현
export const TEXTURE_INFO: Record<string, TextureInfo> = {
  glitter: {
    labelKo: '글리터',
    swatchStyle: {
      background:
          'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.9) 0 6%, transparent 7%),' +
          'radial-gradient(circle at 65% 55%, rgba(255,255,255,0.85) 0 5%, transparent 6%),' +
          'radial-gradient(circle at 45% 80%, rgba(255,255,255,0.8) 0 5%, transparent 6%),' +
          'linear-gradient(135deg, #cfcfcf, #efefef)',
    },
  },
  gradient: {
    labelKo: '그라데이션',
    swatchStyle: { background: 'linear-gradient(135deg, #ffc0d0, #a98bff)' },
  },
  cheek: {
    labelKo: '치크',
    swatchStyle: {
      background: 'radial-gradient(circle at 50% 50%, #ff90b3 0%, #ffe3ea 70%)',
    },
  },
  marble: {
    labelKo: '마블',
    swatchStyle: {
      background:
          'radial-gradient(circle at 30% 30%, rgba(120,120,120,0.5) 0 15%, transparent 16%),' +
          'radial-gradient(circle at 70% 60%, rgba(120,120,120,0.4) 0 20%, transparent 21%),' +
          'linear-gradient(135deg, #f6f6f6, #e2e2e2)',
    },
  },
  french: {
    labelKo: '프렌치',
    swatchStyle: { background: 'linear-gradient(0deg, #fff 0%, #fff 30%, #f7d8e2 30%, #f7d8e2 100%)' },
  },
  magnetic: {
    labelKo: '마그네틱',
    swatchStyle: { background: 'conic-gradient(from 180deg, #7a8899, #3f4d63, #7a8899)' },
  },
  powder: {
    labelKo: '파우더',
    swatchStyle: { background: 'linear-gradient(135deg, #f6e9ee, #ded4e6)' },
  },
  matte: {
    labelKo: '매트',
    swatchStyle: { background: '#c9a2ad' },
  },
  art: {
    labelKo: '아트',
    swatchStyle: { background: 'linear-gradient(135deg, #de869f 0%, #a98bff 50%, #7cd6d6 100%)' },
  },
}

export type CharmInfo = {
  labelKo: string
  icon: string
}

// 모티프(motif) 키워드 → 결과 페이지 [nail charms] 패널용 아이콘
export const CHARM_INFO: Record<string, CharmInfo> = {
  star: { labelKo: '별', icon: '✦' },
  ribbon: { labelKo: '리본', icon: '🎀' },
  floral: { labelKo: '플로럴', icon: '✿' },
  heart: { labelKo: '하트', icon: '♥' },
  crystal: { labelKo: '크리스탈', icon: '💎' },
  pearl: { labelKo: '진주', icon: '⚪' },
  swirl: { labelKo: '소용돌이', icon: '@' },
  'polka dot': { labelKo: '도트', icon: '●' },
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

  { code: 'autumn_dark', nameKo: '가을 다크', tone: '웜', brightness: '저명도', saturation: '중채도' },
  { code: 'autumn_deep', nameKo: '가을 딥', tone: '웜', brightness: '중명도', saturation: '고채도' },
  { code: 'autumn_mute', nameKo: '가을 뮤트', tone: '웜', brightness: '중명도', saturation: '저채도' },
  { code: 'autumn_soft', nameKo: '가을 소프트', tone: '웜', brightness: '중명도', saturation: '저채도' },

  { code: 'winter_dark', nameKo: '겨울 다크', tone: '쿨', brightness: '저명도', saturation: '중채도' },
  { code: 'winter_deep', nameKo: '겨울 딥', tone: '쿨', brightness: '중명도', saturation: '중채도' },
  { code: 'winter_light', nameKo: '겨울 라이트', tone: '쿨', brightness: '고명도', saturation: '저채도' },
  { code: 'winter_vivid', nameKo: '겨울 비비드', tone: '쿨', brightness: '고명도', saturation: '고채도' },
]

export const PERSONAL_COLOR_SWATCHES: Record<string, string[]> = {
  spring_light: [
    '#FFFCEF', '#FFF0DD', '#FEE2CB', '#FBF5B9', '#f6bdbd', '#FDE1B5', '#FEDBB3', '#FFF0AD',
    '#F7B7B4', '#F7BBAE', '#F9BF97', '#FFE88B', '#e3edcb', '#e0ebbf', '#d2e091', '#E9F5F2',
    '#C6E7F4', '#A5DAEC', '#EDDDEE', '#FBDBDD', '#F8D4E8', '#F8C8CA', '#F7B7BA', '#E3B2D4'],
  spring_bright: [
    '#FFF7D2', '#FEE4BE', '#FED59A', '#F7A55A', '#FBEC50', '#ec5f5d', '#E66B63', '#F07858',
    '#EB5C5A', '#F7A743', '#FFDC38', '#EB5A49', '#EF7E2F', '#FFD019', '#d0dc70', '#cddb63',
    '#c5d546', '#9DD1D8', '#6FB3DF', '#60AEDC', '#AE79B2', '#7F5EA3', '#ED6C79', '#D182B4'],
  spring_vivid: [
    '#FFF7D2', '#FEE4BE', '#fed59a', '#FFEB33', '#E94040', '#F38F2F', '#E42321', '#FCC909',
    '#E6341F', '#FED606', '#e51f1f', '#F08212', '#e4231b', '#EB6010', '#d2d81e', '#b7ce22',
    '#39aa37', '#3ABCE7', '#40A3DA', '#407FBF', '#844190', '#6F3C8E', '#AB5CA0', '#E20E15'],
  spring_soft: [
    '#F5F1E4', '#F6DAC3', '#E8E3D0', '#e7e4d0', '#F1C2BF', '#F0D3B3', '#E9DFB6', '#EDB9AE',
    '#ECAFA6', '#F4AE98', '#E8A79F', '#DAC6AD', '#EADB9C', '#E5BA9D', '#E0BB8F', '#cfcc9b',
    '#b0bf97', '#DFEBE8', '#A2CDCB', '#A3C7D3', '#E0D2E5', '#DCC1D7', '#DBB1D4', '#eaa1a2'],

  summer_light: [
    '#FFFFFF', '#EDEDED', '#FDF6C6', '#F6ECB3', '#D9B9B9', '#FDEA75', '#C2E2D9', '#B8D7C2',
    '#A2D2B7', '#D2E1EB', '#a8cfe4', '#a5d7d9', '#9a9dca', '#91ced2', '#7c84c0', '#E1D9ED',
    '#D1BCD7', '#B798C8', '#FAE5E8', '#F6D1DC', '#f7bace', '#f5bad5', '#F4AAB6', '#E3ACCB'],
  summer_mute: [
    '#FFFFFF', '#A09C7B', '#AEA560', '#C1AF41', '#554544', '#767675', '#778B7D', '#638771',
    '#6E7875', '#7e8991', '#778690', '#6e9094', '#667f89', '#588c92', '#40456d', '#837384',
    '#78787a', '#6c5571', '#B58D98', '#998B8E', '#a47488', '#a37481', '#A76B8B', '#a26971'],
  summer_bright: [
    '#FFFFFF', '#C6C6C6', '#FBEC50', '#F3E949', '#FDEB34', '#878787', '#7DC5A6', '#79C39E',
    '#6EC1BB', '#59b4e1', '#8083b6', '#67a0ce', '#757bb7', '#6a6baf', '#9369a7', '#E777AC',
    '#ea6ca2', '#e26fa7', '#E56BA5', '#D976AD', '#EA6293', '#EC5F74', '#E06895', '#E95D82'],
  summer_soft: [
    '#FFFFFF', '#E2E2E2', '#ECE6AC', '#C49997', '#E8D870', '#D8CE73', '#B7D8CE', '#9FCFB1',
    '#9CCAAB', '#afcddf', '#95c1d7', '#8ccbd1', '#91c5c9', '#8b91b9', '#6b78ae', '#D3C3D9',
    '#AF8DB5', '#f3c0cc', '#f3bfd4', '#F3B0B6', '#DAAEB6', '#DD9EAC', '#D78DB0', '#C29FC0'],

  autumn_dark: [
    '#FFF7D2', '#6F6C44', '#887628', '#7A5431', '#634E43', '#655240', '#8C6D14', '#5B4241',
    '#7d1713', '#7F4411', '#7c3112', '#782E0F', '#75160E', '#432918', '#565a2c', '#494929',
    '#1e371d', '#3d5c67', '#41575f', '#0f334d', '#3B2257', '#352839', '#6E2831', '#3A2B3A'],
  autumn_deep: [
    '#FFF7D2', '#cb483d', '#cb3e3a', '#ce5636', '#C9772D', '#CDBD24', '#BE312F', '#D1AF13',
    '#C87F1B', '#C23A1A', '#D2B207', '#C26516', '#936037', '#7C4E24', '#a0ac40', '#9fac35',
    '#7da82a', '#65a4ac', '#3c85b4', '#204f90', '#834986', '#362562', '#BF3E4E', '#a44f85'],
  autumn_mute: [
    '#F5F1E4', '#DAC6AD', '#E0BB8F', '#B29B85', '#AAA183', '#BB7570', '#AB877F', '#B9AA6B',
    '#B58B6B', '#a26c64', '#aa6e5b', '#8E7D6F', '#8e8d6b', '#8A6F6C', '#827F74', '#7f7e73',
    '#7f8e66', '#7d8482', '#718d8b', '#6f97a2', '#7b737c', '#ac7ba1', '#9b8998', '#a36062'],
  autumn_soft: [
    '#FFFCEF', '#E4D5C4', '#DFC5B2', '#E4C7A2', '#DED7A4', '#DEBF9D', '#E2D396', '#d9a09d',
    '#daa499', '#DDA785', '#E1CB79', '#c6d0b2', '#c5cda6', '#b8c17d', '#ced7d5', '#adcbd9',
    '#90becd', '#c4b8d2', '#ba91c1', '#DDC1C3', '#DAAEB4', '#d5b0d3', '#d8a6a8', '#CF9A9F'],

  winter_dark: [
    '#FFFFFF', '#615D3E', '#756E20', '#665C1A', '#292929', '#1D1D1B', '#1D3C2C', '#043934',
    '#334046', '#242754', '#29245B', '#2a2a4a', '#2a2a4a', '#241d48', '#26263b', '#513E40',
    '#68213f', '#493d42', '#632139', '#612142', '#671a2e', '#482733', '#5A0E33', '#380c26'],
  winter_deep: [
    '#FFFFFF', '#B91818', '#ac1916', '#1D1D1B', '#0E8E87', '#008E40', '#0C8067', '#00784A',
    '#02726D', '#055E5B', '#0169a3', '#25356f', '#015089', '#223565', '#282A5E', '#252e60',
    '#262c5f', '#ac182e', '#AF144A', '#aa1643', '#A81258', '#8b1d6b', '#78216c', '#591b50'],
  winter_light: [
    '#FFFFFF', '#FEFBD9', '#FCF7CA', '#FEF292', '#1D1D1B', '#E4F1E7', '#D3EAE9', '#e9f6fc',
    '#d9effc', '#c7e8f7', '#A5D8E5', '#96c0e7', '#9ab6e0', '#d0d0e9', '#29245B', '#FCE9F2',
    '#fbe6f1', '#f6d2e5', '#F9CEDF', '#f4cfd9', '#f0d0e7', '#f0cce2', '#F195B6', '#e09ac3'],
  winter_vivid: [
    '#FFFFFF', '#FFE008', '#FCDB03', '#E5C703', '#1D1D1B', '#53BBB3', '#2CAA56', '#00A471',
    '#29a5df', '#3a8aca', '#4459a4', '#217fc2', '#16438f', '#243064', '#29245B', '#ab63a5',
    '#E51A4D', '#df1a70', '#df144c', '#E6074C', '#dd0a76', '#9b3f8f', '#CD0B5C', '#c40d60'],
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