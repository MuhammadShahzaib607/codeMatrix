import { AlertTriangle, FolderOpen, Loader2 } from 'lucide-react'
import { useDispatch, useSelector } from 'react-redux'
import { resetToDemo } from '../../features/fileSystemSlice'
import { WORKSPACE_MISSING_MESSAGE } from '../../utils/messages'
import useOpenFolder from '../../hooks/useOpenFolder'
import './Notices.css'

/**
 * Shown when the API answers 404 WORKSPACE_MISSING — i.e. the server's ephemeral
 * disk was reset (free-tier restart/sleep) and the files are gone. The only fix
 * is to import the project again from a local/exported backup.
 */
export default function WorkspaceMissingNotice() {
  const dispatch = useDispatch()
  const isMissing = useSelector((state) => state.fileSystem.workspaceMissing)
  const { openLocalFolder, isOpening } = useOpenFolder()

  if (!isMissing) return null

  function reimport() {
    // Drop the dead workspace first so the UI never points at a missing project.
    dispatch(resetToDemo())
    openLocalFolder()
  }

  return (
    <div className="workspace-missing" role="alert">
      <AlertTriangle size={18} className="workspace-missing-icon" />
      <div className="workspace-missing-text">
        <strong>Workspace unavailable</strong>
        <p>{WORKSPACE_MISSING_MESSAGE}</p>
      </div>
      <button type="button" className="text-btn" disabled={isOpening} onClick={reimport}>
        {isOpening ? <Loader2 size={16} className="spin" /> : <FolderOpen size={16} />}
        <span>{isOpening ? 'Importing…' : 'Re-import project'}</span>
      </button>
    </div>
  )
}
