export const HERO_TITLE = 'Own your Nail'

// 좁은 화면에서 한 줄로 넣으면 글자가 너무 작아질 때 사용하는 2줄 배치
export const HERO_TITLE_STACKED = ['Own Your', 'Nail']

export const HERO_SUBTITLE =
  '지금 바로 세상에 단 하나뿐인 당신만의 네일 팁을 만들어 보세요.'

export type StoryStepId = 'scan' | 'print' | 'design' | 'ar'

export type StoryStep = {
  id: StoryStepId
  index: string
  title: string
  summary: string
  /** 상세 섹션의 id — 소개 섹션의 단계를 누르면 이 섹션으로 스크롤한다 */
  anchor: string
}

export const STORY_STEPS: StoryStep[] = [
  {
    id: 'scan',
    index: '01',
    title: '손 스캔',
    summary: '카메라로 손톱을 측정하고 피부 톤을 분석해요.',
    anchor: 'story-scan',
  },
  {
    id: 'print',
    index: '02',
    title: '네일 팁 출력',
    summary: '내 손톱에 꼭 맞는 네일 팁을 3D 프린터로 출력해요.',
    anchor: 'story-print',
  },
  {
    id: 'design',
    index: '03',
    title: 'AI 디자인 생성',
    summary: '원하는 분위기를 말하면 AI가 디자인을 생성해 줘요.',
    anchor: 'story-design',
  },
  {
    id: 'ar',
    index: '04',
    title: 'AR 미리보기',
    summary: '카메라 속 내 손 위에 네일 팁을 입혀 디자인을 미리 확인해요.',
    anchor: 'story-ar',
  },
]

const SHOWCASE_IMAGE_COUNT = 120

const showcaseImage = (n: number) => `/images/showcase/${String(n).padStart(3, '0')}.webp`

/**
 * 특히 잘 나온 디자인 번호 — FEATURED_SLOTS 자리에 이 순서대로 놓는다.
 * 번호가 이어지는 디자인은 색이 비슷해서, 나선에서 바로 옆·한 칸 건너 놓이는 것끼리 색이 겹치지 않게 순서를 섞었다.
 */
const FEATURED_DESIGNS = [
  2, 69, 12, 96, 41, 120, 11, 72, 42, 8, 73, 7, 95, 17, 70, 92, 80, 25,
  112, 46, 107, 13, 47, 118, 79, 67, 22, 75, 61, 23, 43, 14, 28, 45, 19, 4,
]

/**
 * 궤도에서 크고 또렷하게 보이는 카드 자리(카드 순번, 0부터) — 섹션이 보이기 시작한 뒤 1분 남짓 동안을 기준으로,
 * 1366×768 ~ 2560×1440 · 768×1024 · 390×844 화면에서 카드마다 크기·불투명도·화면에 든 정도를 재어 골랐다.
 * 22~49는 글 둘레 안쪽 바퀴라 어느 화면에서나 보이고 곧 바깥 바퀴로 커지며 흘러나가고,
 * 54~58 · 66~68은 처음부터 양옆에 크게 보이는 자리다. 그보다 안쪽은 글 뒤의 흰 원에 거의 묻혀서 뺐다.
 * useShowcaseOrbit의 나선 상수나 흰 원(.story-showcase__center::before) 크기를 바꾸면 다시 재야 한다.
 */
const FEATURED_SLOTS = [
  22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
  40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 54, 55, 56, 57, 58, 66, 67, 68,
]

/**
 * 마지막 섹션의 나선형 궤도 카드에 들어가는 사용자 디자인 이미지 (생성 이미지와 같은 3:2), 카드 순번대로.
 * 잘 나온 디자인을 잘 보이는 자리에 먼저 놓고, 나머지 자리는 남은 디자인을 번호순으로 채운다.
 * 파일이 없거나 열리지 않는 자리는 번호가 적힌 회색 카드로 보인다.
 */
export const SHOWCASE_IMAGES: string[] = (() => {
  const others = Array.from({ length: SHOWCASE_IMAGE_COUNT }, (_, i) => i + 1).filter(
    (n) => !FEATURED_DESIGNS.includes(n),
  )
  return Array.from({ length: SHOWCASE_IMAGE_COUNT }, (_, slot) => {
    const featured = FEATURED_SLOTS.indexOf(slot)
    return showcaseImage(featured >= 0 ? FEATURED_DESIGNS[featured] : others.shift()!)
  })
})()

// 디자인 섹션 채팅 데모 — 요청 문구와 생성 결과 이미지가 서로 맞아야 한다
export const DESIGN_DEMO = {
  image: '/images/showcase/002.webp',
  request: '리본과 하트를 넣어서 화려한 핑크색 네일을 만들어줘',
  reply: '리본과 하트로 화려한 핑크 네일을 완성했어요!',
}
