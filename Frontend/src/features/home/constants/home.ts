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

/**
 * 마지막 섹션의 나선형 궤도 카드에 들어가는 사용자 디자인 이미지 (생성 이미지와 같은 3:2).
 * 카드 자리(120칸)보다 이미지가 적으면 처음부터 다시 돌아가며 채운다.
 * 파일이 없거나 열리지 않는 자리는 번호가 적힌 회색 카드로 보인다.
 */
export const SHOWCASE_IMAGES: string[] = [
    '/images/showcase/01.png', '/images/showcase/02.png', '/images/showcase/03.png', '/images/showcase/04.png', '/images/showcase/05.png',
    '/images/showcase/06.png', '/images/showcase/07.png', '/images/showcase/08.png', '/images/showcase/09.png', '/images/showcase/10.png',
    '/images/showcase/11.png', '/images/showcase/12.png', '/images/showcase/13.png', '/images/showcase/14.png', '/images/showcase/15.png',
    '/images/showcase/16.png', '/images/showcase/17.png', '/images/showcase/18.png', '/images/showcase/19.png', '/images/showcase/20.png',
    '/images/showcase/21.png', '/images/showcase/22.png', '/images/showcase/23.png', '/images/showcase/24.png', '/images/showcase/25.png',
    '/images/showcase/26.png', '/images/showcase/27.png', '/images/showcase/28.png', '/images/showcase/29.png', '/images/showcase/30.png',
    '/images/showcase/31.png', '/images/showcase/32.png', '/images/showcase/33.png', '/images/showcase/34.png', '/images/showcase/35.png',
    '/images/showcase/36.png', '/images/showcase/37.png', '/images/showcase/38.png', '/images/showcase/39.png', '/images/showcase/40.png',
    '/images/showcase/41.png', '/images/showcase/42.png' ]

// 디자인 섹션 채팅 데모 — 요청 문구와 생성 결과 이미지가 서로 맞아야 한다
export const DESIGN_DEMO = {
  image: '/images/showcase/11.png',
  request: '리본과 하트를 넣어서 화려한 핑크색 네일을 만들어줘',
  reply: '리본과 하트로 화려한 핑크 네일을 완성했어요!',
}
