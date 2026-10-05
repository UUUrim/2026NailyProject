import { CAPTURE_COPY, captureFill, type CaptureStatus } from '@/features/hand-scan/utils/captureStatus'

type CaptureButtonProps = {
  status: CaptureStatus
  /** 0~1 — 스캔 서버 /capture/stability의 ratio (연속 측정이 얼마나 쌓였는지) */
  ratio: number
  onCapture: () => void
}

/**
 * 촬영 버튼 겸 측정 정확도 막대. 버튼 안이 ratio만큼 차오르고(측정 중엔 줄무늬가
 * 흐름), 가득 차서 촬영 가능해지면 버튼 전체가 분홍으로 바뀌며 눌린다.
 * 누르면 예전과 똑같이 서버에 촬영 요청 한 번만 보낸다.
 */
export function CaptureButton({ status, ratio, onCapture }: CaptureButtonProps) {
  const fill = captureFill(status, ratio)

  return (
    <button
        type="button"
        className={`hand-scan-capture hand-scan-capture--${status}`}
        onClick={onCapture}
        disabled={status !== 'ready'}
    >
      <span
          className="hand-scan-capture__fill"
          style={{ width: `${fill * 100}%` }}
          role="progressbar"
          aria-label="측정 정확도"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fill * 100)}
      />
      <span className="hand-scan-capture__label">
        {status === 'ready' ? (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
            <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.4-2h5.8l1.4 2h2.2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <circle cx="12" cy="13" r="3.2" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        ) : status === 'capturing' ? (
          <span className="hand-scan-capture__spinner" aria-hidden="true" />
        ) : null}
        {CAPTURE_COPY[status].button}
      </span>
    </button>
  )
}
