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
    id: 'round',
    labelKo: '라운드',
    labelEn: 'ROUND',
    image: '/images/nail-shapes/round.svg',
    description: '끝 부분이 동그랗게 둥근 모양',
  },
  {
    id: 'oval',
    labelKo: '오발',
    labelEn: 'OVAL',
    image: '/images/nail-shapes/oval.svg',
    description: '끝으로 갈수록 좁아지는 타원형 모양',
  },
  {
    id: 'almond',
    labelKo: '아몬드',
    labelEn: 'ALMOND',
    image: '/images/nail-shapes/almond.svg',
    description: '양옆이 좁아져 끝이 살짝 뾰족한 모양',
  },
  {
    id: 'stiletto',
    labelKo: '스틸레토',
    labelEn: 'STILETTO',
    image: '/images/nail-shapes/stiletto.svg',
    description: '끝이 길고 날카롭게 뾰족한 모양',
  },
  {
    id: 'ballerina',
    labelKo: '발레리나',
    labelEn: 'BALLERINA',
    image: '/images/nail-shapes/ballerina.svg',
    description: '양옆은 좁고 끝은 일자로 평평한 모양',
  },
  {
    id: 'square',
    labelKo: '스퀘어',
    labelEn: 'SQUARE',
    image: '/images/nail-shapes/square.svg',
    description: '양옆과 끝이 각지고 반듯한 사각형 모양',
  },
]

export const NAIL_SHAPE_MAP = Object.fromEntries(
  NAIL_SHAPES.map((shape) => [shape.id, shape]),
) as Record<NailShapeId, NailShapeInfo>

export function getNailShape(id: string): NailShapeInfo | undefined {
  return NAIL_SHAPE_MAP[id as NailShapeId]
}
