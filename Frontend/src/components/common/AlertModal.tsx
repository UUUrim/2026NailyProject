import '@/styles/alert-modal.css'

type AlertModalProps = {
    message: string
    onClose: () => void
    confirmLabel?: string
}

export function AlertModal({ message, onClose, confirmLabel = '확인' }: AlertModalProps) {
    return (
        <div className="alert-modal" role="dialog" aria-modal="true" aria-labelledby="alert-modal-message">
            <button type="button" className="alert-modal__backdrop" onClick={onClose} aria-label="닫기" />
            <div className="alert-modal__panel">
                <p id="alert-modal-message" className="alert-modal__message">
                    {message}
                </p>
                <button type="button" className="alert-modal__confirm" onClick={onClose}>
                    {confirmLabel}
                </button>
            </div>
        </div>
    )
}