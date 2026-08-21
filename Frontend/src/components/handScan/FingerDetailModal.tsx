import { useState } from 'react'
import type { FingerDetail } from '@/utils/handScanAnalysis'
import { ScanXModalShell } from '@/components/mypage/ScanXModalShell'
import '@/styles/hand-scan-result.css'

const HANDS_IMAGE = '/images/hands.png'

type FingerDetailModalProps = {
  fingers: FingerDetail[]
  onClose: () => void
}

// FINGER_NAMES에 붙는 "(왼손)"/"(오른손)" 표기 — 손 탭이 이미 어느 손인지 보여주므로 표에서는 뗀다.
function stripHandSuffix(name: string): string {
  return name.replace(/\s*\((왼손|오른손)\)\s*$/, '')
}

function HandsMetricsMap({
  fingers,
  pinnedIndex,
  hoveredIndex,
  onToggle,
  onHoverChange,
}: {
  fingers: FingerDetail[]
  pinnedIndex: number | null
  hoveredIndex: number | null
  onToggle: (index: number) => void
  onHoverChange: (index: number | null) => void
}) {
  return (
    <div className="finger-modal__diagram">
      <img src={HANDS_IMAGE} alt="양손 손등" className="finger-modal__hands-img" />

      <p className="finger-modal__hint">번호 배지와 표를 통해 손톱별 상세 수치를 확인하세요.</p>

      {fingers.map((finger, index) => {
        const isPinned = pinnedIndex === index
        // 툴팁은 고정됐거나(클릭) 지금 마우스가 올라와 있을 때(호버) 보인다.
        // 호버는 JS로 직접 추적해서, 고정 해제 클릭 시 마우스가 그대로 위에 있어도 확실히 닫히게 한다.
        const isTooltipVisible = isPinned || hoveredIndex === index
        return (
          <div
            key={finger.id}
            className={`finger-hotspot${index === 0 || index === 5 ? ' finger-hotspot--below' : ''}${isPinned ? ' is-pinned' : ''}${isTooltipVisible ? ' is-tooltip-visible' : ''}`}
            style={{ left: `${finger.overlay.x}%`, top: `${finger.overlay.y}%` }}
            onMouseEnter={() => onHoverChange(index)}
            onMouseLeave={() => onHoverChange(null)}
          >
            <button
              type="button"
              className="finger-hotspot__trigger"
              aria-label={`${finger.name} 손톱 수치 ${isPinned ? '고정 해제' : '고정해서 보기'}`}
              aria-describedby={`finger-tooltip-${finger.id}`}
              aria-pressed={isPinned}
              onClick={(event) => {
                onToggle(index)
                // 고정 해제하는 클릭이면 포커스도 같이 없애서, focus-within으로 툴팁이 남아있지 않게 한다.
                if (isPinned) event.currentTarget.blur()
              }}
            >
              <span className="finger-hotspot__index">{index + 1}</span>
            </button>

            <div
              id={`finger-tooltip-${finger.id}`}
              className="finger-hotspot__tooltip"
              role="tooltip"
            >
              <strong>{finger.name}</strong>
              <span>길이 {finger.lengthMm}mm</span>
              <span>너비 {finger.widthMm}mm</span>
              <span>C-curve {finger.cCurve}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// FINGER_NAMES/FINGER_OVERLAYS 관례상 앞 5개(index 0~4)는 왼손, 뒤 5개(index 5~9)는 오른손이다.
function handOf(index: number): 'L' | 'R' {
  return index < 5 ? 'L' : 'R'
}

export function FingerDetailModal({ fingers, onClose }: FingerDetailModalProps) {
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [activeHand, setActiveHand] = useState<'L' | 'R'>('L')

  const toggleFinger = (index: number) => {
    setPinnedIndex((prev) => {
      const next = prev === index ? null : index
      // 고정한 손가락이 지금 보고 있는 손 탭에 없으면, 표에서 바로 보이도록 탭도 같이 전환한다.
      if (next !== null) setActiveHand(handOf(next))
      return next
    })
    // 클릭 순간엔 마우스가 여전히 배지 위에 있을 수 있어, 고정 해제 후에도 호버 때문에
    // 툴팁이 계속 떠 있어 보일 수 있다 — 호버 상태를 초기화해서 확실히 닫히게 한다.
    setHoveredIndex(null)
  }

  const hasLeft = fingers.some((_, index) => handOf(index) === 'L')
  const hasRight = fingers.some((_, index) => handOf(index) === 'R')
  const visibleFingers = fingers
    .map((finger, index) => ({ finger, index }))
    .filter(({ index }) => handOf(index) === activeHand)

  return (
    <ScanXModalShell
      ariaLabel="10개 손가락 손톱 상세 수치"
      title="10개 손가락 손톱 상세 수치"
      onClose={onClose}
      maxWidth="720px"
    >
      <HandsMetricsMap
        fingers={fingers}
        pinnedIndex={pinnedIndex}
        hoveredIndex={hoveredIndex}
        onToggle={toggleFinger}
        onHoverChange={setHoveredIndex}
      />

      <div className="finger-modal__table" aria-label="손가락별 수치 표">
        {hasLeft && hasRight && (
          <div className="finger-modal__hand-tabs" role="tablist" aria-label="손 선택">
            <button
              type="button"
              role="tab"
              aria-selected={activeHand === 'L'}
              className={activeHand === 'L' ? 'is-active' : ''}
              onClick={() => setActiveHand('L')}
            >
              <em>L</em>
              <span>왼손</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeHand === 'R'}
              className={activeHand === 'R' ? 'is-active' : ''}
              onClick={() => setActiveHand('R')}
            >
              <em>R</em>
              <span>오른손</span>
            </button>
          </div>
        )}
        <div className="finger-modal__table-row finger-modal__table-row--head">
          <span>손가락</span>
          <span className="finger-modal__table-head-shift finger-modal__table-head-shift--length">길이</span>
          <span className="finger-modal__table-head-shift finger-modal__table-head-shift--width">너비</span>
          <span>곡률</span>
        </div>
        <div className="finger-modal__table-rows">
          {visibleFingers.map(({ finger, index }) => (
            <div
              key={finger.id}
              className={`finger-modal__table-row${pinnedIndex === index ? ' is-active' : ''}`}
            >
              <span className="finger-modal__table-name">
                <em className="finger-modal__table-badge">{index + 1}</em>
                {stripHandSuffix(finger.name)}
              </span>
              <span>
                {finger.lengthMm.toFixed(1)}
                <small>mm</small>
              </span>
              <span>
                {finger.widthMm.toFixed(1)}
                <small>mm</small>
              </span>
              <span>{finger.cCurve.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>
    </ScanXModalShell>
  )
}
