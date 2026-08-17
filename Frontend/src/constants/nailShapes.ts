export type NailShapeId = 'square' | 'oval' | 'round' | 'almond' | 'stiletto' | 'ballerina'

export type NailShapeInfo = {
  id: NailShapeId
  labelKo: string
  labelEn: string
  image: string
  description: string
}

export const NAIL_SHAPES: NailShapeInfo[] = [
  {
    id: 'square',
    labelKo: '스퀘어',
    labelEn: 'SQUARE',
    image: '/images/shapes/square.png',
    description: '직선적인 상단과 각진 모서리',
  },
  {
    id: 'oval',
    labelKo: '오발',
    labelEn: 'OVAL',
    image: '/images/shapes/oval.png',
    description: '부드럽게 좁아지는 긴 타원형',
  },
  {
    id: 'round',
    labelKo: '라운드',
    labelEn: 'ROUND',
    image: '/images/shapes/round.png',
    description: '손끝 곡선을 따라가는 둥근 형태',
  },
  {
    id: 'almond',
    labelKo: '아몬드',
    labelEn: 'ALMOND',
    image: '/images/shapes/almond.png',
    description: '뾰족하게 모이는 아몬드 실루엣',
  },
  {
    id: 'stiletto',
    labelKo: '스틸레토',
    labelEn: 'STILETTO',
    image: '/images/shapes/stiletto.png',
    description: '날카롭게 뾰족한 끝',
  },
  {
    id: 'ballerina',
    labelKo: '발레리나',
    labelEn: 'BALLERINA',
    image: '/images/shapes/ballerina.png',
    description: '끝이 평평한 코핀 형태',
  },
]

export const NAIL_SHAPE_MAP = Object.fromEntries(
  NAIL_SHAPES.map((shape) => [shape.id, shape]),
) as Record<NailShapeId, NailShapeInfo>

export function getNailShape(id: string): NailShapeInfo | undefined {
  return NAIL_SHAPE_MAP[id as NailShapeId]
}
