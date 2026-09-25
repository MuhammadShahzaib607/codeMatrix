import { AlertTriangle, Loader2, FolderInput } from 'lucide-react'
import { useDispatch, useSelector } from 'react-redux'
import { clearWorkspace } from '../../features/fileSystemSlice'
import useOpenFolder from '../../hooks/useOpenFolder'
import { WORKSPACE_MISSING_MESSAGE } from '../../utils/messages'
import './Notices.css'

export default function WorkspaceMissingNotice() {
  const dispatch = useDispatch()
  const isMissing = useSelector((state) => state.fileSystem.workspaceMissing)
  const { importFolder, isImporting } = useOpenFolder()

  if (!isMissing) return null

  function reimport() {
    dispatch(clearWorkspace())
    importFolder()
  }

  return (
    <div className="workspace-missing" role="alert">
      <AlertTriangle size={18} className="workspace-missing-icon" />
      <div className="workspace-missing-text">
        <strong>Workspace unavailable</strong>
        <p>{WORKSPACE_MISSING_MESSAGE}</p>
      </div>
      <button type="button" className="text-btn" disabled={isImporting} onClick={reimport}>
        {isImporting ? <Loader2 size={16} className="spin" /> : <FolderInput size={16} />}
        <span>{isImporting ? 'Importing project…' : 'Re-import project'}</span>
      </button>
    </div>
  )
}
