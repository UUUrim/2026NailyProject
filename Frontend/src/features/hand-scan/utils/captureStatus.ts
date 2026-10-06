import type { FingerGuidePhase } from '@/features/hand-scan/components/TopViewFingerGuide'

/**
 * 촬영 화면에서 사용자에게 보여줄 현재 상황. 스캔 서버가 이미 주는 값
 * (/capture/stability의 ratio·ready·guide)과 버튼을 눌렀는지만으로 정한다 —
 * 화면 표시용일 뿐 측정/촬영 로직에는 아무것도 되돌려 보내지 않는다.
 *
 * camera    : 마커를 아직 못 잡아 가이드 위치를 모름
 * place     : 손가락을 기다리는 중 (측정 이력 없음)
 * measuring : 손가락이 잡혀 연속 측정이 쌓이는 중
 * unsteady  : 측정은 다 찼지만 값들이 서로 안 맞음 (손가락이 흔들림)
 * ready     : 연속 측정값이 합의 — 촬영 가능
 * capturing : 촬영 버튼을 눌러 저장 중
 */
export type CaptureStatus = 'camera' | 'place' | 'measuring' | 'unsteady' | 'ready' | 'capturing'

export function getCaptureStatus({
  cameraReady,
  ratio,
  stable,
  capturing,
}: {
  cameraReady: boolean
  ratio: number
  stable: boolean
  capturing: boolean
}): CaptureStatus {
  if (capturing) return 'capturing'
  if (stable) return 'ready'
  // 측정이 돌고 있으면 카메라는 당연히 준비된 것 — guide가 안 와도 측정 상태를 우선한다.
  if (ratio >= 1) return 'unsteady'
  if (ratio > 0) return 'measuring'
  if (!cameraReady) return 'camera'
  return 'place'
}

type CaptureCopy = {
  /** 상단 큰 안내 — target은 "왼손 엄지"처럼 현재 손가락 */
  title: (target: string) => string
  /** 촬영 버튼(겸 정확도 막대) 문구 */
  button: string
}

export const CAPTURE_COPY: Record<CaptureStatus, CaptureCopy> = {
  camera: {
    title: () => '카메라를 준비하고 있어요',
    button: '카메라 준비 중',
  },
  place: {
    title: (target) => `${target}를 가이드에 맞춰 넣어주세요`,
    button: '손가락을 올려주세요',
  },
  measuring: {
    title: () => '좋아요, 그대로 멈춰주세요',
    button: '측정 중…',
  },
  unsteady: {
    title: () => '손가락이 조금 흔들렸어요',
    button: '다시 맞추는 중…',
  },
  ready: {
    title: () => '지금 촬영할 수 있어요',
    button: '지금 촬영',
  },
  capturing: {
    title: () => '촬영하고 있어요',
    button: '촬영 중…',
  },
}

/** 촬영 버튼 안 막대가 차오른 정도(0~1) — 서버 ratio를 그대로, 촬영 가능 이후엔 가득 */
export function captureFill(status: CaptureStatus, ratio: number): number {
  if (status === 'ready' || status === 'capturing') return 1
  if (status === 'camera' || status === 'place') return 0
  return Math.min(Math.max(ratio, 0), 1)
}

/** 탑뷰 가이드 오버레이 단계 — 가이드 선 위치와는 무관, 표시 방식만 바뀐다. */
export function toGuidePhase(status: CaptureStatus): FingerGuidePhase {
  if (status === 'ready' || status === 'capturing') return 'ready'
  if (status === 'measuring' || status === 'unsteady') return 'measuring'
  return 'place'
}
