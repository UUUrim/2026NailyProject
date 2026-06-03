import type { FingerDetail } from '@/utils/handScanAnalysis'
import '@/styles/hand-scan-result.css'

const HANDS_IMAGE = '/images/hands.png'

type FingerDetailModalProps = {
  fingers: FingerDetail[]
  onClose: () => void
}

function HandsMetricsMap({ fingers }: { fingers: FingerDetail[] }) {
  return (
    <div className="finger-modal__diagram">
      <img src={HANDS_IMAGE} alt="양손 손등" className="finger-modal__hands-img" />

      <p className="finger-modal__hint">손톱에 마우스를 올리면 상세 수치를 확인할 수 있습니다.</p>

      {fingers.map((finger, index) => (
        <div
          key={finger.id}
          className={`finger-hotspot${index === 0 || index === 5 ? ' finger-hotspot--below' : ''}`}
          style={{ left: `${finger.overlay.x}%`, top: `${finger.overlay.y}%` }}
        >
          <button
            type="button"
            className="finger-hotspot__trigger"
            aria-label={`${finger.name} 손톱 수치 보기`}
            aria-describedby={`finger-tooltip-${finger.id}`}
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
      ))}
    </div>
  )
}

export function FingerDetailModal({ fingers, onClose }: FingerDetailModalProps) {
  return (
    <div className="finger-modal" role="dialog" aria-modal="true" aria-labelledby="finger-modal-title">
      <button type="button" className="finger-modal__backdrop" onClick={onClose} aria-label="닫기" />
      <div className="finger-modal__panel">
        <header className="finger-modal__header">
          <h2 id="finger-modal-title">10개 손가락 손톱 상세 수치</h2>
          <button type="button" className="finger-modal__close" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="finger-modal__body">
          <HandsMetricsMap fingers={fingers} />

          <ul className="finger-modal__list" aria-label="손가락별 수치 목록">
            {fingers.map((finger, index) => (
              <li key={finger.id}>
                <span className="finger-modal__list-index">{index + 1}</span>
                <span className="finger-modal__list-name">{finger.name}</span>
                <span>길이 {finger.lengthMm}mm</span>
                <span>너비 {finger.widthMm}mm</span>
                <span>곡률 {finger.cCurve}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
