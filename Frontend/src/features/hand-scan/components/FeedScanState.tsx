import type { CaptureStatus } from '@/features/hand-scan/utils/captureStatus'

/**
 * 카메라 화면 하나 위에 겹치는 측정 상태 표시 — 두 카메라 화면 모두에 같은 상태가 뜬다.
 * 측정 중(불안정): 위→아래로 훑는 스캔 빛 + 깜빡이는 모서리 표시 (흔들림은 노랑)
 * 촬영 가능(안정): 스캔이 멈추고 모서리가 초록으로 고정, 바뀌는 순간 초록 테두리가 한 번 번쩍
 * 그 외(손가락 놓기 전·카메라 준비·촬영 중): 표시 없음
 */
export function FeedScanState({ status }: { status: CaptureStatus }) {
  return (
    <div className={`hand-scan-scan hand-scan-scan--${status}`} aria-hidden="true">
      <span className="hand-scan-scan__sweep" />
      <span className="hand-scan-scan__corner hand-scan-scan__corner--tl" />
      <span className="hand-scan-scan__corner hand-scan-scan__corner--tr" />
      <span className="hand-scan-scan__corner hand-scan-scan__corner--bl" />
      <span className="hand-scan-scan__corner hand-scan-scan__corner--br" />
    </div>
  )
}
