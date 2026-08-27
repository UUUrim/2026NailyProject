// 대표 피부색(hex) 하나만으로 톤/명도/채도 슬라이더 값과 어울리는 컬러 팔레트를 계산한다.
// 더 이상 퍼스널컬러(16계절) 진단을 하지 않으므로, scan/personal_color.py가 쓰던 것과 같은
// sRGB → CIE Lab 변환식을 그대로 재사용해 피부색 자체의 색공간 값에서 직접 유도한다.

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const int = parseInt(full, 16)
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const toLinear = (v: number) => {
    const c = v / 255
    return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92
  }
  const rl = toLinear(r)
  const gl = toLinear(g)
  const bl = toLinear(b)
  const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047
  const y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722
  const z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883
  const fc = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116)
  const fx = fc(x)
  const fy = fc(y)
  const fz = fc(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l * 100]
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0))
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return [h * 60, s * 100, l * 100]
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360
  const sat = Math.min(100, Math.max(0, s)) / 100
  const light = Math.min(100, Math.max(0, l)) / 100
  const c = (1 - Math.abs(2 * light - 1)) * sat
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = light - c / 2

  // 60도 구간마다 (c, x, 0)의 자리가 회전하는 표준 HSL→RGB 규칙을 구간별 테이블로 조회한다.
  const segment = Math.min(5, Math.floor(hue / 60))
  const rgbBySegment: ReadonlyArray<readonly [number, number, number]> = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ]
  const [r, g, b] = rgbBySegment[segment]

  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase()
}

/**
 * 30색 팔레트(색상군별로 묶여 있어 인접 색끼리 색상각이 비슷함)에서 앞의 N개만 자르면
 * 같은 색상군 안에서만 뽑혀 미리보기 스와치가 죄다 비슷한 색으로 보인다 — 그 대신
 * 목록 전체에 걸쳐 고르게 간격을 두고 뽑아서, 짧은 미리보기에서도 서로 다른 색상군이
 * 골고루 섞여 보이게 한다.
 */
export function pickSpreadColors<T>(items: T[], count: number): T[] {
  if (count <= 0) return []
  if (items.length <= count) return items
  const step = items.length / count
  return Array.from({ length: count }, (_, i) => items[Math.floor(i * step)])
}

/** 낮음 → 높음 축의 3단계. 톤은 쿨→뉴트럴→웜에 대응한다. */
export type SkinLevel = '저' | '중' | '고'

export type SkinToneMetric = {
  /** 슬라이더에서 손잡이가 위치할 값 (0~100) */
  percent: number
  label: string
  /** label과 완전히 같은 실측 임계값으로 나눈 저/중/고 (칩 등 압축 표기용) */
  level: SkinLevel
}

export type SkinToneAnalysis = {
  tone: SkinToneMetric
  brightness: SkinToneMetric
  saturation: SkinToneMetric
}

function clampPercent(value: number, min: number, max: number): number {
  return Math.round(Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)))
}

// scan/skin_color.py의 tone 범주 경계값(warmness 스칼라 기준). 이 두 값 사이가 neutral 구간.
const WARMNESS_WARM_CUTOFF = 13.45
const WARMNESS_COOL_CUTOFF = 12.39

/**
 * 백엔드 warmness 스칼라(LAB b - a*0.5)를 0~100 슬라이더 위치로 변환한다.
 * neutral 구간 중앙 -> 50%, cool 경계 -> 33%, warm 경계 -> 67%로 맞추고(=라벨과 위치가
 * 서로 어긋나지 않게) 그 바깥은 같은 기울기로 이어지며 0~100에서 잘린다.
 */
function warmnessToTonePercent(warmness: number): number {
  const mid = (WARMNESS_WARM_CUTOFF + WARMNESS_COOL_CUTOFF) / 2
  const halfBand = (WARMNESS_WARM_CUTOFF - WARMNESS_COOL_CUTOFF) / 2
  return Math.round(Math.min(100, Math.max(0, 50 + ((warmness - mid) / halfBand) * 17)))
}

/**
 * scan/skin_color.py(recommend_nail_colors)가 10손가락 LAB 평균으로 계산해서
 * API로 내려주는 실제 진단값(tone/warmness/brightness/saturation)을 슬라이더 형태로 변환한다.
 * analyzeSkinTone()은 이 값이 없는(구버전 스캔 등) 경우에만 쓰는 대체 추정치다.
 */
export function skinToneAnalysisFromMetrics(
  tone: string | null,
  warmness: number | null,
  brightness: number | null,
  saturation: number | null,
): SkinToneAnalysis | null {
  if (tone == null || brightness == null || saturation == null) return null

  // 백엔드가 'warm'/'WARM'/' Warm ' 등 대소문자·공백이 섞여 내려줘도 웜/쿨로 인식되도록
  // 정규화한다 — 정확 일치만 보던 이전 코드는 이런 값을 전부 '뉴트럴톤'으로 떨어뜨렸다.
  const normalizedTone = tone.trim().toLowerCase()
  const toneLabel = normalizedTone === 'warm' ? '웜톤' : normalizedTone === 'cool' ? '쿨톤' : '뉴트럴톤'
  const toneLevel: SkinLevel = normalizedTone === 'warm' ? '고' : normalizedTone === 'cool' ? '저' : '중'
  // 바 위치는 연속 스칼라(warmness)가 있으면 그 실측값으로 잡고, 없으면(구버전 스캔) 범주별
  // 고정 위치로 폴백한다.
  const toneScore =
    warmness != null
      ? warmnessToTonePercent(warmness)
      : normalizedTone === 'warm' ? 80 : normalizedTone === 'cool' ? 20 : 50

  const brightnessLabel = brightness > 0.65 ? '밝은 편' : brightness < 0.55 ? '어두운 편' : '보통 밝기'
  const brightnessLevel: SkinLevel = brightness > 0.65 ? '고' : brightness < 0.55 ? '저' : '중'
  // skin_color.py: saturation = chroma / 40.0 — 기존 chroma 기준(20/12)을 같은 스케일로 환산
  const saturationLabel = saturation > 0.5 ? '혈색이 있는 편' : saturation < 0.3 ? '혈색이 적은 편' : '보통'
  const saturationLevel: SkinLevel = saturation > 0.5 ? '고' : saturation < 0.3 ? '저' : '중'

  return {
    tone: { percent: toneScore, label: toneLabel, level: toneLevel },
    brightness: { percent: Math.round(Math.min(100, Math.max(0, brightness * 100))), label: brightnessLabel, level: brightnessLevel },
    saturation: { percent: Math.round(Math.min(100, Math.max(0, saturation * 100))), label: saturationLabel, level: saturationLevel },
  }
}

/** 대표 피부색 hex만으로 톤(쿨~웜)/명도/채도(혈색) 슬라이더 값을 계산한다 (백엔드 값이 없을 때의 대체 추정치) */
export function analyzeSkinTone(hex: string): SkinToneAnalysis {
  const [r, g, b] = hexToRgb(hex)
  const [L, a, bLab] = rgbToLab(r, g, b)

  // 웜/쿨 축: b*(황색기)에서 a*(적색기)를 절반만큼 뺀 값이 클수록 웜(황금빛), 작을수록 쿨(핑크빛)
  const warmScore = bLab - a * 0.5
  const toneLabel = warmScore > 8 ? '웜톤' : warmScore < 5 ? '쿨톤' : '뉴트럴톤'
  const toneLevel: SkinLevel = warmScore > 8 ? '고' : warmScore < 5 ? '저' : '중'

  const brightnessLabel = L > 65 ? '밝은 편' : L < 55 ? '어두운 편' : '보통 밝기'
  const brightnessLevel: SkinLevel = L > 65 ? '고' : L < 55 ? '저' : '중'

  const chroma = Math.sqrt(a * a + bLab * bLab)
  const saturationLabel = chroma > 20 ? '혈색이 있는 편' : chroma < 12 ? '혈색이 적은 편' : '보통'
  const saturationLevel: SkinLevel = chroma > 20 ? '고' : chroma < 12 ? '저' : '중'

  return {
    tone: { percent: clampPercent(warmScore, -10, 30), label: toneLabel, level: toneLevel },
    brightness: { percent: clampPercent(L, 20, 95), label: brightnessLabel, level: brightnessLevel },
    saturation: { percent: clampPercent(chroma, 8, 32), label: saturationLabel, level: saturationLevel },
  }
}

/**
 * 대표 피부색 hex를 기준으로 어울리는 컬러 30색을 만든다.
 * 피부색의 실제 색상각(hue)을 기준 삼아 60도 간격의 6개 색상군을 두고,
 * 각 색상군마다 밝기를 달리한 5가지 톤을 뽑아 6*5=30색을 구성한다.
 */
export function generateSkinTonePalette(hex: string, count = 30): string[] {
  const [r, g, b] = hexToRgb(hex)
  const [baseHue] = rgbToHsl(r, g, b)

  const familyCount = 6
  const perFamily = Math.round(count / familyCount)
  const lightnessSteps = [88, 76, 64, 52, 40]
  const saturationSteps = [38, 50, 62, 58, 46]

  const colors: string[] = []
  for (let f = 0; f < familyCount; f += 1) {
    const hue = baseHue + f * (360 / familyCount)
    for (let i = 0; i < perFamily; i += 1) {
      colors.push(hslToHex(hue, saturationSteps[i % saturationSteps.length], lightnessSteps[i % lightnessSteps.length]))
    }
  }
  return colors
}
