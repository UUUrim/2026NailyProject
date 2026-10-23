// AR 미리보기 카메라의 화질/색감 조절.
// 카메라(드라이버)가 해당 항목을 지원하면 track.applyConstraints로 카메라 자체를 바꾸고,
// 지원하지 않는 밝기/대비/채도는 화면에 그릴 때 canvas 필터로 보정한다(카메라 원본은 그대로).
// 손/손톱 인식은 보정 전 원본 프레임으로 하므로 인식 결과에는 영향이 없다.

export type CameraAdjustKey = 'brightness' | 'contrast' | 'saturation' | 'sharpness' | 'colorTemperature'

export type CameraControl = {
  key: CameraAdjustKey
  label: string
  /** camera: 카메라 하드웨어 설정 / filter: 화면 보정(canvas 필터) */
  source: 'camera' | 'filter'
  min: number
  max: number
  step: number
  defaultValue: number
}

type RangeCapability = { min: number; max: number; step?: number }

// lib.dom의 MediaTrackCapabilities/ConstraintSet에는 이 항목들이 아직 없어서 직접 선언한다.
type ExtendedCapabilities = MediaTrackCapabilities &
  Partial<Record<CameraAdjustKey, RangeCapability>> & { whiteBalanceMode?: string[] }
type ExtendedSettings = MediaTrackSettings & Partial<Record<CameraAdjustKey, number>>

const CONTROL_LABELS: Record<CameraAdjustKey, string> = {
  brightness: '밝기',
  contrast: '대비',
  saturation: '채도',
  sharpness: '선명도',
  colorTemperature: '색온도',
}

const KEYS: CameraAdjustKey[] = ['brightness', 'contrast', 'saturation', 'sharpness', 'colorTemperature']
// 화면 보정이 가능한 항목 (선명도/색온도는 카메라가 지원할 때만 나온다)
const FILTER_KEYS: CameraAdjustKey[] = ['brightness', 'contrast', 'saturation', 'sharpness']

// 웹캠 영상은 대체로 대비가 낮고 색이 밋밋하게 나와서, 화면 보정으로 조절하는 항목은
// 보통 카메라 앱처럼 보이도록 살짝 끌어올린 값을 기본값으로 쓴다. (카메라가 직접 지원하는
// 항목은 카메라 자체 기본값을 그대로 둔다.)
const NATURAL_LOOK: Partial<Record<CameraAdjustKey, number>> = {
  brightness: 1.03,
  contrast: 1.05,
  saturation: 1.08,
  sharpness: 0,
}

/** 화면 보정(filter) 항목의 기본값만 모은다 - 처음 켤 때와 '초기화' 때 canvas에 적용할 값. */
export function defaultFilterValues(controls: CameraControl[]) {
  const values: Partial<Record<CameraAdjustKey, number>> = {}
  for (const control of controls) {
    if (control.source === 'filter') values[control.key] = control.defaultValue
  }
  return values
}

export const CAMERA_FILTER_SUPPORTED =
  typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype

function isRange(value: unknown): value is RangeCapability {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RangeCapability).min === 'number' &&
    typeof (value as RangeCapability).max === 'number' &&
    (value as RangeCapability).max > (value as RangeCapability).min
  )
}

export function readCameraControls(track: MediaStreamTrack | null): CameraControl[] {
  let caps: ExtendedCapabilities = {}
  let settings: ExtendedSettings = {}
  try {
    caps = (track?.getCapabilities?.() ?? {}) as ExtendedCapabilities
    settings = (track?.getSettings?.() ?? {}) as ExtendedSettings
  } catch {
    // 기능 조회가 막힌 브라우저 - 화면 보정만 쓴다
  }

  const controls: CameraControl[] = []
  for (const key of KEYS) {
    const range = caps[key]
    if (isRange(range)) {
      const span = range.max - range.min
      const current = settings[key]
      controls.push({
        key,
        label: CONTROL_LABELS[key],
        source: 'camera',
        min: range.min,
        max: range.max,
        step: range.step && range.step > 0 ? range.step : span / 100,
        defaultValue: typeof current === 'number' ? current : range.min + span / 2,
      })
    } else if (FILTER_KEYS.includes(key) && CAMERA_FILTER_SUPPORTED) {
      // 선명도는 0(원본)~1(가장 강함), 나머지는 1이 원본
      const isSharpness = key === 'sharpness'
      controls.push({
        key,
        label: CONTROL_LABELS[key],
        source: 'filter',
        min: isSharpness ? 0 : 0.5,
        max: isSharpness ? 1 : 1.5,
        step: 0.01,
        defaultValue: NATURAL_LOOK[key] ?? (isSharpness ? 0 : 1),
      })
    }
  }
  return controls
}

async function applyAdvanced(track: MediaStreamTrack, constraint: Record<string, unknown>) {
  try {
    await track.applyConstraints({ advanced: [constraint] } as MediaTrackConstraints)
    return true
  } catch {
    return false
  }
}

/** 카메라 하드웨어 항목 하나를 바꾼다. 색온도는 화이트밸런스를 수동으로 바꿔야 먹는다. */
export async function applyCameraControl(track: MediaStreamTrack, control: CameraControl, value: number) {
  if (control.source !== 'camera') return true
  if (control.key === 'colorTemperature') {
    await applyAdvanced(track, { whiteBalanceMode: 'manual' })
  }
  return applyAdvanced(track, { [control.key]: value })
}

/** 하드웨어 항목을 처음 값으로 되돌린다. 색온도는 화이트밸런스도 다시 자동으로. */
export async function resetCameraControl(track: MediaStreamTrack, control: CameraControl) {
  if (control.source !== 'camera') return
  if (control.key === 'colorTemperature') {
    await applyAdvanced(track, { whiteBalanceMode: 'continuous' })
    return
  }
  await applyAdvanced(track, { [control.key]: control.defaultValue })
}

// 선명도 화면 보정에 쓰는 SVG 필터(모달이 같은 id로 <svg>를 그려 둔다)
export const SHARPEN_FILTER_ID = 'nail-ar-sharpen'

/** 선명도 0~1을 3x3 샤프닝 커널로 바꾼다 (합이 1이라 전체 밝기는 그대로). */
export function sharpenKernel(amount: number) {
  const a = amount * 1.2
  return `0 ${-a} 0 ${-a} ${1 + 4 * a} ${-a} 0 ${-a} 0`
}

/** 화면 보정 값(밝기/대비/채도는 1, 선명도는 0이 원본)으로 canvas 필터 문자열을 만든다. 보정이 없으면 'none'. */
export function buildCanvasFilter(values: Partial<Record<CameraAdjustKey, number>>) {
  const parts: string[] = []
  if (values.sharpness != null && values.sharpness > 0) parts.push(`url(#${SHARPEN_FILTER_ID})`)
  if (values.brightness != null && values.brightness !== 1) parts.push(`brightness(${values.brightness})`)
  if (values.contrast != null && values.contrast !== 1) parts.push(`contrast(${values.contrast})`)
  if (values.saturation != null && values.saturation !== 1) parts.push(`saturate(${values.saturation})`)
  return parts.length ? parts.join(' ') : 'none'
}

export type ResolutionOption = { width: number; height: number; label: string }

const RESOLUTION_PRESETS: ResolutionOption[] = [
  { width: 640, height: 480, label: '480p' },
  { width: 1280, height: 720, label: '720p' },
  { width: 1920, height: 1080, label: '1080p' },
  { width: 2560, height: 1440, label: '1440p' },
  { width: 3840, height: 2160, label: '4K' },
]

/** 카메라가 낼 수 있는 최대 해상도 이하의 프리셋만 돌려준다. */
export function readResolutionOptions(track: MediaStreamTrack | null): ResolutionOption[] {
  try {
    const caps = track?.getCapabilities?.()
    const maxW = caps?.width?.max
    const maxH = caps?.height?.max
    if (typeof maxW !== 'number' || typeof maxH !== 'number') return []
    return RESOLUTION_PRESETS.filter((p) => p.width <= maxW && p.height <= maxH)
  } catch {
    return []
  }
}

/** 지금 트랙의 실제 해상도에 가장 가까운 프리셋의 "가로x세로" 키. */
export function currentResolutionKey(track: MediaStreamTrack | null, options: ResolutionOption[]) {
  const settings = track?.getSettings?.()
  if (!settings?.width || !settings.height || options.length === 0) return ''
  const closest = options.reduce((best, o) =>
    Math.abs(o.height - settings.height!) < Math.abs(best.height - settings.height!) ? o : best,
  )
  return `${closest.width}x${closest.height}`
}

export async function applyResolution(track: MediaStreamTrack, option: ResolutionOption) {
  try {
    await track.applyConstraints({ width: { ideal: option.width }, height: { ideal: option.height } })
    return true
  } catch {
    return false
  }
}
