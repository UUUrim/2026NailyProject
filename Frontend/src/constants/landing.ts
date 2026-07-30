export const MAIN_BG = '/images/main-bg.png'

export const BRAND_COLOR = '#DE869F'

export type FeatureIcon = 'fit' | 'design' | 'printing'

export type FeatureItem = {
  title: string
  description: string
  icon: FeatureIcon
  accent: string
}

export const FEATURES: FeatureItem[] = [
  {
    title: 'Fit',
    icon: 'fit',
    accent: '#fdeff4',
    description:
        '손 촬영을 통해 당신의 손톱 모양에 딱 맞는\n네일팁을 만듭니다.',
  },
  {
    title: 'Design',
    icon: 'design',
    accent: '#f3eeff',
    description: '당신이 원하는 디자인을 만듭니다.',
  },
  {
    title: 'Printing',
    icon: 'printing',
    accent: '#eef8ff',
    description: '3D 프린터로 당신의 네일팁을 제작합니다.',
  },
]

export const HERO_SUBTITLE =
    '지금 바로 세상에 단 하나뿐인 당신만의 네일팁을 만드세요'