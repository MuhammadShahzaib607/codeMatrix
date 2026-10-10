import { useEffect, useRef, useState } from 'react'
import './ConfirmModal.css'
import './MoveFolderModal.css'

export default function MoveFolderModal({ items = [], destinationName, onConfirm, onCancel }) {
  const [dontAskAgain, setDontAskAgain] = useState(false)
  const cardRef = useRef(null)
  const list = Array.isArray(items) ? items : []
  const single = list.length === 1 ? list[0] : null
  const title =
    list.length > 1
      ? `Move ${list.length} items?`
      : single?.type === 'folder'
        ? 'Move folder?'
        : 'Move file?'
  const names = list.map((item) => `“${item.name}”`).join(', ')
  const message = destinationName
    ? `Move ${names} into “${destinationName}”?`
    : `Move ${names} to the top level?`

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
        return
      }
      if (event.key !== 'Tab') return
      const card = cardRef.current
      if (!card) return
      const focusable = [...card.querySelectorAll('button, input[type="checkbox"]')]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (!card.contains(active)) {
        event.preventDefault()
        first.focus()
        return
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      }
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
      <div className="confirm-card move-confirm-card" ref={cardRef}>
        <h3 className="confirm-title">{title}</h3>
        <p className="confirm-message">{message}</p>

        <label className="move-confirm-check">
          <input
            type="checkbox"
            checked={dontAskAgain}
            onChange={(event) => setDontAskAgain(event.target.checked)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onConfirm(dontAskAgain)
            }}
          />
          <span>Don&apos;t ask me again</span>
        </label>

        <div className="confirm-actions">
          <button type="button" className="confirm-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="confirm-btn is-primary"
            autoFocus
            onClick={() => onConfirm(dontAskAgain)}
          >
            Move
          </button>
        </div>
      </div>
    </div>
  )
}
