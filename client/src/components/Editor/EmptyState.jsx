import { FileCode2, FolderOpen, FolderTree, Sparkles } from 'lucide-react'
import { useSelector } from 'react-redux'
import { isFileSystemAccessSupported } from '../../services/fileSystemAccess'
import './Editor.css'

const SHORTCUTS = [
  { keys: 'Ctrl + B', label: 'Toggle the file explorer' },
  { keys: 'Ctrl + S', label: 'Save the active file to disk' },
  { keys: 'Ctrl + J', label: 'Toggle the AI assistant' },
]

export default function EmptyState() {
  const workspace = useSelector((state) => state.fileSystem.workspace)
  const isLocal = workspace.source === 'local'
  const isSupported = isFileSystemAccessSupported()

  return (
    <div className="empty-state">
      <div className="empty-state-card">
        <div className="empty-state-logo">
          <Sparkles size={34} />
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
            <FolderOpen size={15} />
            <span>
              Your browser doesn&apos;t support local folder access. Please use Chrome, Edge, or
              Brave.
            </span>
          </div>
        )}

        {isSupported && !isLocal && (
          <div className="empty-state-banner">
            <FolderOpen size={15} />
            <span>
              No folder opened. Click <strong>Open Folder</strong> in the top bar to edit real
              files from your laptop — the explorer is showing demo files for now.
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
          <span>
            {isLocal
              ? `Local folder: ${workspace.name}`
              : 'Demo workspace — open a local folder to edit real files'}
          </span>
        </div>
      </div>
    </div>
  )
}
