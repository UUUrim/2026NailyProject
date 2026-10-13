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

// 쉐입별 기본 팁 연장 길이(mm) — scan/nail_exact_stl.py의 TIP_EXTENSION_DEFAULT_MM와
// 동일한 값이어야 한다. STL 생성 시 이 길이만큼 실측 손톱 길이 위에 더해서 출력하는데,
// 출력 페이지의 길이 조절 UI 기본값도 이 "현재 보정하고 있는 길이" 그대로 맞춘다.
export const TIP_EXTENSION_DEFAULT_MM: Record<NailShapeId, number> = {
  round: 5.0,
  oval: 5.0,
  square: 5.0,
  almond: 7.0,
  stiletto: 15.0,
  ballerina: 7.0,
}

export const TIP_EXTENSION_MIN_MM = 1
export const TIP_EXTENSION_MAX_MM = 20

export function getDefaultTipExtensionMm(shapeId: string | null | undefined): number {
  if (!shapeId) return TIP_EXTENSION_DEFAULT_MM.round
  return TIP_EXTENSION_DEFAULT_MM[shapeId as NailShapeId] ?? TIP_EXTENSION_DEFAULT_MM.round
}

export function clampTipExtensionMm(value: number): number {
  return Math.min(TIP_EXTENSION_MAX_MM, Math.max(TIP_EXTENSION_MIN_MM, value))
}
