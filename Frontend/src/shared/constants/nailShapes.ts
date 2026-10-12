export type NailShapeId = 'square' | 'oval' | 'round' | 'almond' | 'stiletto' | 'ballerina'

export type NailShapeInfo = {
  id: NailShapeId
  labelKo: string
  labelEn: string
  image: string
  description: string
  /** 추천 결과 화면용 — 손톱 분석 문장. 'ㅇㅇ'는 사용자 이름 자리, '**'로 감싼 부분은 강조 표시 */
  analysis: string
  /** 추천 결과 화면용 — 이 쉐입을 추천하는 이유. '**'로 감싼 부분은 강조 표시 */
  reason: string
}

export const NAIL_SHAPES: NailShapeInfo[] = [
  {
    id: 'round',
    labelKo: '라운드',
    labelEn: 'ROUND',
    image: '/images/nail-shapes/round.svg',
    description: '끝 부분이 동그랗게 둥근 모양',
    analysis: 'ㅇㅇ 님의 손톱은 평균보다 **폭이 좁고 길이가 긴 편**이에요.',
    reason: '끝을 더 좁히지 않고 둥글게 감싸 손톱을 **부드럽고 안정적으로** 보이게 해주는 라운드를 추천해요.',
  },
  {
    id: 'oval',
    labelKo: '오발',
    labelEn: 'OVAL',
    image: '/images/nail-shapes/oval.svg',
    description: '끝으로 갈수록 좁아지는 타원형 모양',
    analysis: 'ㅇㅇ 님의 손톱은 **폭·길이 비율이 평균과 비슷**해요.',
    reason: '**어떤 손톱에도 무난하게 어울리는** 오발을 추천해요.',
  },
  {
    id: 'almond',
    labelKo: '아몬드',
    labelEn: 'ALMOND',
    image: '/images/nail-shapes/almond.svg',
    description: '양옆이 좁아져 끝이 살짝 뾰족한 모양',
    analysis: 'ㅇㅇ 님의 손톱은 평균보다 **폭이 조금 넓고 길이가 짧은 편**이에요.',
    reason: '끝이 부드럽게 좁아지면서 **길이감을 더해주는** 아몬드를 추천해요.',
  },
  {
    id: 'stiletto',
    labelKo: '스틸레토',
    labelEn: 'STILETTO',
    image: '/images/nail-shapes/stiletto.svg',
    description: '끝이 길고 날카롭게 뾰족한 모양',
    analysis: 'ㅇㅇ 님의 손톱은 평균보다 **폭이 꽤 넓고 길이가 짧은 편**이에요.',
    reason: '손톱이 **가장 길고 날씬해 보이도록** 끝을 길고 뾰족하게 빼는 스틸레토를 추천해요.',
  },
  {
    id: 'ballerina',
    labelKo: '발레리나',
    labelEn: 'BALLERINA',
    image: '/images/nail-shapes/ballerina.svg',
    description: '양옆은 좁고 끝은 일자로 평평한 모양',
    analysis: 'ㅇㅇ 님의 손톱은 평균보다 **폭이 넓고 길이가 짧은 편**이에요.',
    reason: '양옆을 좁히면서 끝을 길게 빼 **손톱이 길어 보이게** 해주는 발레리나를 추천해요.',
  },
  {
    id: 'square',
    labelKo: '스퀘어',
    labelEn: 'SQUARE',
    image: '/images/nail-shapes/square.svg',
    description: '양옆과 끝이 각지고 반듯한 사각형 모양',
    analysis: 'ㅇㅇ 님의 손톱은 평균보다 **폭이 조금 좁고 길이가 긴 편**이에요.',
    reason: '끝이 반듯해서 손톱이 너무 가늘어 보이지 않게 **폭을 살려주는** 스퀘어를 추천해요.',
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
