import { Eye, Loader2, Pencil, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import { revealApiKey, updateApiKey } from '../../features/aiSlice'

/**
 * Password-gated dialog shared by "reveal" and "edit" for one saved key.
 *
 * The account password is ALWAYS required (and re-verified server-side against
 * the login hash) so someone with temporary access to an unlocked session
 * cannot read or tamper with a key. In 'edit' mode the same dialog also lets
 * the user rename the key and/or replace its value.
 */
export default function KeyAccessModal({ mode, keyMeta, onClose, onRevealed }) {
  const dispatch = useDispatch()
  const [password, setPassword] = useState('')
  const [label, setLabel] = useState(keyMeta?.label ?? '')
  const [newKey, setNewKey] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const passwordRef = useRef(null)

  const isReveal = mode === 'reveal'

  useEffect(() => {
    passwordRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    if (!password) {
      setError('Enter your account password to continue.')
      return
    }
    if (!isReveal && !label.trim() && !newKey.trim()) {
      setError('Change the label or paste a new key value first.')
      return
    }

    setBusy(true)
    try {
      if (isReveal) {
        const result = await dispatch(
          revealApiKey({ keyId: keyMeta.id, password }),
        ).unwrap()
        onRevealed(result.value)
      } else {
        await dispatch(
          updateApiKey({
            keyId: keyMeta.id,
            password,
            label: label.trim(),
            key: newKey.trim() || undefined,
          }),
        ).unwrap()
      }
      onClose()
    } catch (err) {
      setError(typeof err === 'string' ? err : err?.message ?? 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="key-access-overlay"
      onMouseDown={(event) => {
        // Keep the click from bubbling to the Settings overlay underneath,
        // which would close BOTH dialogs.
        event.stopPropagation()
        onClose()
      }}
    >
      <form
        className="key-access-card"
        role="dialog"
        aria-modal="true"
        aria-label={isReveal ? 'Reveal API key' : 'Edit API key'}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="key-access-title">
          {isReveal ? <Eye size={15} /> : <Pencil size={14} />}
          <span>{isReveal ? 'Reveal API key' : 'Edit API key'}</span>
        </div>

        <p className="key-access-desc">
          For your security, confirm your CodeMatrix account password
          {isReveal ? ' before the full key is shown.' : ' before saving changes.'}
        </p>

        <span className="key-access-masked">{keyMeta?.masked}</span>

        {!isReveal && (
          <>
            <label className="key-access-field">
              <span>Label</span>
              <input
                type="text"
                className="key-access-input"
                value={label}
                maxLength={60}
                placeholder="Label (optional)"
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
            <label className="key-access-field">
              <span>Replace key value (leave blank to keep the current one)</span>
              <input
                type="password"
                className="key-access-input"
                value={newKey}
                spellCheck={false}
                autoComplete="off"
                placeholder="gsk_… (optional)"
                onChange={(event) => setNewKey(event.target.value)}
              />
            </label>
          </>
        )}

        <label className="key-access-field">
          <span>Account password</span>
          <input
            ref={passwordRef}
            type="password"
            className="key-access-input"
            value={password}
            autoComplete="current-password"
            placeholder="Your CodeMatrix login password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error && (
          <p className="key-access-error">
            <ShieldCheck size={13} />
            {error}
          </p>
        )}

        <div className="key-access-actions">
          <button type="button" className="settings-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="settings-btn is-primary" disabled={busy}>
            {busy && <Loader2 size={14} className="spin" />}
            <span>{isReveal ? 'Reveal key' : 'Save changes'}</span>
          </button>
        </div>
      </form>
    </div>
  )
}
