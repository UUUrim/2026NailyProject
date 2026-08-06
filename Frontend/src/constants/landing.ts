export const MAIN_BG = '/images/main-bg.png'

export const BRAND_COLOR = '#DE869F'

export const HERO_SUBTITLE =
  '지금 바로 세상에 단 하나뿐인 당신만의 네일팁을 만드세요.'

export type FeatureIcon = 'scan' | 'print' | 'design'

export type FeatureItem = {
  title: string
  description: string
  icon: FeatureIcon
  gradient: string
}

export const FEATURES: FeatureItem[] = [
  {
    title: '정밀 손 스캔',
    icon: 'scan',
    gradient: 'linear-gradient(135deg, #fdeff4 0%, #f8d4e0 100%)',
    description:
      '카메라로 손을 촬영하면 AI가 손톱 모양·크기·곡률을 정밀 분석해요.',
  },
  {
    title: '맞춤형 네일팁',
    icon: 'print',
    gradient: 'linear-gradient(135deg, #eef8ff 0%, #d4ecff 100%)',
    description:
      '분석 데이터를 바탕으로 맞춤형 네일팁을 3D 프린터로 출력할 수 있어요.',
  },
  {
    title: 'AI 맞춤 디자인',
    icon: 'design',
    gradient: 'linear-gradient(135deg, #f3eeff 0%, #e4d4ff 100%)',
    description:
      'AI와 대화하며 원하는 컬러·패턴·무드의 네일 디자인을 생성해요.',
  },
]

export const STATS = [
  {
    value: 'Web',
    label: '웹 전용',
    description: '앱 설치 없이 브라우저에서 바로 이용해요.',
  },
  {
    value: 'Fit',
    label: '정밀 핏 분석',
    description: '손 스캔 데이터로 내 손톱에 맞는 사이즈를 계산해요.',
  },
  {
    value: 'AI',
    label: '맞춤 디자인',
    description: 'AI가 원하는 스타일의 네일 아트 이미지를 만들어 줘요.',
  },
]

export type HowItWorksStep = {
  step: number
  title: string
  description: string
  accent: string
}

export const HOW_IT_WORKS_STEPS: HowItWorksStep[] = [
  {
    step: 1,
    title: '손 스캔 및 분석',
    description: '손을 촬영하면 AI가 손톱 모양·크기·곡률을 정밀하게 분석해요.',
    accent: '#fdeff4',
  },
  {
    step: 2,
    title: '네일팁 출력',
    description: '분석 결과를 바탕으로 맞춤형 네일팁을 3D 프린터로 출력할 수 있어요.',
    accent: '#eef8ff',
  },
  {
    step: 3,
    title: '디자인 생성',
    description: 'AI와 함께 원하는 스타일의 네일 디자인 이미지를 생성해요.',
    accent: '#f3eeff',
  },
  {
    step: 4,
    title: '셀프 네일아트/네일샵',
    description: '생성한 디자인으로 직접 네일아트를 하거나, 네일샵에 가져가 요청할 수 있어요.',
    accent: '#e8f8ef',
  },
]

export type BenefitItem = {
  title: string
  description: string
  icon: 'fit' | 'transparent' | 'design' | 'web'
}

export const NAILY_BENEFITS: BenefitItem[] = [
  {
    icon: 'fit',
    title: '내 손톱에 딱 맞는 핏',
    description: '손 스캔 기반 정밀 분석으로 편안한 착용감',
  },
  {
    icon: 'transparent',
    title: '맞춤형 네일팁',
    description: '3D 프린터로 출력, 셀프 네일아트의 좋은 베이스',
  },
  {
    icon: 'design',
    title: 'AI 디자인 생성',
    description: '말로 설명하면 나만의 네일 디자인 이미지 완성',
  },
  {
    icon: 'web',
    title: '웹에서 바로',
    description: '앱·배송 없이 브라우저에서 전 과정 이용',
  },
]

export type FaqItem = {
  question: string
  answer: string
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: '네일리는 어떤 서비스인가요?',
    answer:
      '네일리는 웹에서 손 스캔, 맞춤 반투명 네일팁 3D 출력(선택), AI 네일 디자인 생성을 제공하는 서비스예요. 디자인이 적용된 네일팁을 출력하거나 배송해 드리지는 않아요.',
  },
  {
    question: '3D 프린팅은 무엇을 출력하나요?',
    answer:
      '손 스캔 분석 결과를 바탕으로 한 맞춤형 반투명 네일팁만 출력해요. AI로 만든 디자인이 프린팅되는 것은 아니며, 출력 여부는 사용자가 선택할 수 있어요.',
  },
  {
    question: '생성한 디자인은 어떻게 활용하나요?',
    answer:
      'AI가 만들어 준 디자인 이미지를 저장한 뒤, 직접 셀프 네일아트에 참고하거나 네일샵에 가져가 "이 디자인으로 해주세요"라고 요청하면 돼요.',
  },
  {
    question: '앱을 설치해야 하나요?',
    answer:
      '아니요. 네일리는 웹 전용 서비스예요. PC나 모바일 브라우저에서 바로 이용할 수 있습니다.',
  },
  {
    question: '네일팁을 집으로 배송해 주나요?',
    answer:
      '아니요. 네일리는 배송 서비스를 제공하지 않아요. 반투명 네일팁 3D 출력은 별도 안내에 따라 진행돼요.',
  },
  {
    question: '로그인 없이도 이용할 수 있나요?',
    answer:
      '메인 페이지와 커뮤니티 둘러보기는 로그인 없이 가능해요. 손 스캔, 디자인 생성, 저장 등은 회원가입 후 이용할 수 있습니다.',
  },
]
