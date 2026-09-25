import { AlertTriangle, X } from 'lucide-react'
import { useDispatch, useSelector } from 'react-redux'
import { dismissStorageNotice } from '../../features/uiSlice'
import { TEMPORARY_STORAGE_MESSAGE } from '../../utils/messages'
import './Notices.css'

export default function StorageNotice() {
  const dispatch = useDispatch()
  const workspace = useSelector((state) => state.fileSystem.workspace)
  const isDismissed = useSelector((state) => state.ui.isStorageNoticeDismissed)

  if (workspace.source !== 'cloud' || isDismissed) return null

  return (
    <div className="storage-notice" role="status">
      <AlertTriangle size={15} />
      <span>{TEMPORARY_STORAGE_MESSAGE}</span>
      <button
        type="button"
        className="storage-notice-close"
        title="Dismiss"
        aria-label="Dismiss storage warning"
        onClick={() => dispatch(dismissStorageNotice())}
      >
        <X size={14} />
      </button>
    </div>
  )
}
