import '@/styles/legal-modal.css'
import type { LegalSection } from '@/constants/legalDocuments'

type LegalDocumentModalProps = {
  title: string
  updatedAt: string
  sections: LegalSection[]
  onClose: () => void
}

export function LegalDocumentModal({ title, updatedAt, sections, onClose }: LegalDocumentModalProps) {
  return (
    <div className="legal-modal" role="dialog" aria-modal="true" aria-labelledby="legal-modal-title">
      <button type="button" className="legal-modal__backdrop" onClick={onClose} aria-label="닫기" />
      <div className="legal-modal__panel">
        <header className="legal-modal__header">
          <div>
            <h2 id="legal-modal-title">{title}</h2>
            <p className="legal-modal__updated-at">최종 개정일 {updatedAt}</p>
          </div>
          <button type="button" className="legal-modal__close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </header>

        <div className="legal-modal__body">
          {sections.map((section) => (
            <section key={section.heading} className="legal-modal__section">
              <h3>{section.heading}</h3>
              {section.body.map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </section>
          ))}
        </div>

        <div className="legal-modal__footer">
          <button type="button" className="legal-modal__confirm" onClick={onClose}>
            확인
          </button>
        </div>
      </div>
    </div>
  )
}
