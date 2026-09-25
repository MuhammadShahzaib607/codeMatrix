import { AlertTriangle } from 'lucide-react'
import { useEffect } from 'react'
import './ConfirmModal.css'

/**
 * Small, reusable confirmation dialog. Used before destructive Explorer
 * operations (delete). Escape and a click on the backdrop both cancel; the
 * confirm button is focused so Enter confirms.
 */
export default function ConfirmModal({
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  danger = true,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  return (
    <div
      className="confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div className="confirm-card">
        {danger && (
          <span className="confirm-icon" aria-hidden="true">
            <AlertTriangle size={18} />
          </span>
        )}
        <h3 className="confirm-title">{title}</h3>
        {message && <p className="confirm-message">{message}</p>}

        <div className="confirm-actions">
          <button type="button" className="confirm-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-btn ${danger ? 'is-danger' : 'is-primary'}`}
            autoFocus
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
