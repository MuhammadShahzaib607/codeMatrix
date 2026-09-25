import { FileCode2, FolderInput, FolderTree } from 'lucide-react'
import { useSelector } from 'react-redux'
import { isFileSystemAccessSupported } from '../../services/fileSystemAccess'
import { UNSUPPORTED_MESSAGE } from '../../utils/messages'
import { workspaceLabel } from '../../utils/workspace'
import Logo from '../Logo/Logo'
import './Editor.css'

const SHORTCUTS = [
  { keys: 'Ctrl + B', label: 'Toggle the file explorer' },
  { keys: 'Ctrl + P', label: 'Quick open a file' },
  { keys: 'Ctrl + S', label: 'Save the active file' },
]

export default function EmptyState() {
  const workspace = useSelector((state) => state.fileSystem.workspace)
  const label = workspaceLabel(workspace)
  const isSupported = isFileSystemAccessSupported()

  return (
    <div className="empty-state">
      <div className="empty-state-card">
        <div className="empty-state-logo">
          <Logo size={68} />
        </div>
        <h2 className="empty-state-title">No file selected</h2>
        <p className="empty-state-subtitle">
          Pick a file from the explorer to start editing, or create a new one with the
          <span className="empty-state-inline">
            <FileCode2 size={13} /> New File
          </span>
          button.
        </p>

        {!isSupported && (
          <div className="empty-state-banner is-warning">
            <FolderInput size={15} />
            <span>{UNSUPPORTED_MESSAGE}</span>
          </div>
        )}

        {isSupported && !label && (
          <div className="empty-state-banner">
            <FolderInput size={15} />
            <span>
              No project imported. Click <strong>New File</strong> in the Explorer to start a
              scratch workspace, or <strong>Import Folder</strong> in the top bar to import a folder
              from your device.
            </span>
          </div>
        )}

        <div className="empty-state-hints">
          {SHORTCUTS.map((item) => (
            <div className="empty-state-hint" key={item.keys}>
              <kbd>{item.keys}</kbd>
              <span>{item.label}</span>
            </div>
          ))}
        </div>

        <div className="empty-state-footer">
          <FolderTree size={14} />
          <span>{label ? `Workspace: ${label}` : 'No project imported yet'}</span>
        </div>
      </div>
    </div>
  )
}
