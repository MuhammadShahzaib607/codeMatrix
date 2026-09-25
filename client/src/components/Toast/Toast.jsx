import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { hideToast } from '../../features/uiSlice'
import './Toast.css'

const ICONS = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
}

const AUTO_DISMISS_MS = { success: 2600, info: 3600, error: 6000 }

export default function Toast() {
  const dispatch = useDispatch()
  const toast = useSelector((state) => state.ui.toast)
  const toastId = toast?.id
  const toastType = toast?.type ?? 'info'

  useEffect(() => {
    if (!toastId) return undefined
    const timer = setTimeout(() => dispatch(hideToast()), AUTO_DISMISS_MS[toastType] ?? 4000)
    return () => clearTimeout(timer)
  }, [toastId, toastType, dispatch])

  if (!toast) return null

  const Icon = ICONS[toast.type] ?? Info

  return (
    <div className={`toast is-${toast.type}`} role="status" aria-live="polite">
      <Icon size={16} className="toast-icon" />
      <span className="toast-message">{toast.message}</span>
      <button
        type="button"
        className="toast-close"
        title="Dismiss"
        aria-label="Dismiss notification"
        onClick={() => dispatch(hideToast())}
      >
        <X size={14} />
      </button>
    </div>
  )
}
