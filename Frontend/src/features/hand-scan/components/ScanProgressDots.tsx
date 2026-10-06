import { Fragment } from 'react'
import {
  FINGER_LABELS,
  HAND_LABELS,
  STEPS,
} from '@/features/hand-scan/hooks/useHandScanPage'

type ScanProgressDotsProps = {
  currentStepIndex: number
  uploadedSteps: Set<string>
}

/**
 * 촬영 진행 점 10개 — 글씨 없이 점과 잇는 선만. 촬영 준비 화면의 손가락 배지와 같은 색 규칙:
 * 끝낸 손가락은 초록(✓), 지금 손가락은 분홍으로 깜빡임, 남은 손가락은 흐린 빈 점.
 * 점 사이 선은 앞 손가락을 끝냈으면 초록으로 이어지고, 왼손→오른손으로 넘어가는
 * 구간만 조금 더 길게 그려 손이 바뀌는 지점을 보여준다.
 */
export function ScanProgressDots({ currentStepIndex, uploadedSteps }: ScanProgressDotsProps) {
  const current = Math.min(currentStepIndex + 1, STEPS.length)

  return (
    <div className="hand-scan-steps" role="img" aria-label={`${STEPS.length}개 중 ${current}번째 손가락 촬영 중`}>
      {STEPS.map((step, idx) => {
        const done = uploadedSteps.has(`${step.hand}-${step.finger}`)
        const state = done ? 'done' : idx === currentStepIndex ? 'current' : 'todo'
        const isLast = idx === STEPS.length - 1
        const handChange = !isLast && STEPS[idx + 1].hand !== step.hand
        return (
          <Fragment key={`${step.hand}-${step.finger}`}>
            <span
                className={`hand-scan-steps__dot hand-scan-steps__dot--${state}`}
                title={`${HAND_LABELS[step.hand]} ${FINGER_LABELS[step.finger]}`}
            >
              {done ? (
                <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
                  <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
            </span>
            {isLast ? null : (
              <span
                  className={[
                    'hand-scan-steps__line',
                    done ? 'hand-scan-steps__line--done' : '',
                    handChange ? 'hand-scan-steps__line--hand' : '',
                  ].filter(Boolean).join(' ')}
              />
            )}
          </Fragment>
        )
      })}
    </div>
  )
}
