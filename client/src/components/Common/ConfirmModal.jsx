import { AlertTriangle } from 'lucide-react'
import { useEffect, useState } from 'react'
import './ConfirmModal.css'

/**
 * Small, reusable confirmation dialog. Used before destructive Explorer
 * operations (delete) and for the whole-project delete.
 *
 * Pass `confirmPhrase` to require the user to TYPE that exact text before the
 * confirm button enables — the extra safety step used for irreversible actions
 * like deleting an entire project. Escape and a click on the backdrop both
 * cancel; otherwise the confirm button is focused so Enter confirms.
 */
export default function ConfirmModal({
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  danger = true,
  confirmPhrase = null,
  onConfirm,
  onCancel,
}) {
  const [typed, setTyped] = useState('')
  const needsPhrase = typeof confirmPhrase === 'string' && confirmPhrase.length > 0
  const canConfirm = !needsPhrase || typed.trim() === confirmPhrase

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

        {needsPhrase && (
          <label className="confirm-typed">
            <span>
              Type <strong>{confirmPhrase}</strong> to confirm
            </span>
            <input
              autoFocus
              className="confirm-typed-input"
              value={typed}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canConfirm) onConfirm()
              }}
            />
          </label>
        )}

        <div className="confirm-actions">
          <button type="button" className="confirm-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-btn ${danger ? 'is-danger' : 'is-primary'}`}
            disabled={!canConfirm}
            autoFocus={!needsPhrase}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
