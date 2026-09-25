import {
  Bot,
  Download,
  FolderOpen,
  FolderSync,
  Loader2,
  PanelLeft,
  Save,
  Settings,
  Sparkles,
  TerminalSquare,
} from 'lucide-react'
import { useDispatch, useSelector } from 'react-redux'
import { showToast, toggleAIPanel, toggleSidebar } from '../../features/uiSlice'
import { togglePanel } from '../../features/terminalSlice'
import useExportWorkspace from '../../hooks/useExportWorkspace'
import useOpenFolder from '../../hooks/useOpenFolder'
import useSaveActiveFile from '../../hooks/useSaveActiveFile'
import useSyncToLaptop from '../../hooks/useSyncToLaptop'
import './Topbar.css'

export default function Topbar() {
  const dispatch = useDispatch()
  const saveActiveFile = useSaveActiveFile()
  const exportWorkspace = useExportWorkspace()
  const { syncToLaptop, isSyncing } = useSyncToLaptop()
  const { openLocalFolder, isOpening, isSupported } = useOpenFolder()

  const isSidebarOpen = useSelector((state) => state.ui.isSidebarOpen)
  const isAIPanelOpen = useSelector((state) => state.ui.isAIPanelOpen)
  const isTerminalOpen = useSelector((state) => state.terminal.isTerminalPanelOpen)
  const activeFileId = useSelector((state) => state.fileSystem.activeFileId)
  const workspace = useSelector((state) => state.fileSystem.workspace)
  const hasUnsavedChanges = useSelector(
    (state) => !!activeFileId && state.editor.unsavedFileIds.includes(activeFileId),
  )

  const isCloud = workspace.source === 'cloud' && Boolean(workspace.projectId)

  return (
    <header className="topbar">
      <div className="topbar-group">
        <button
          type="button"
          className={`icon-btn ${isSidebarOpen ? 'is-active' : ''}`}
          title="Toggle sidebar"
          aria-label="Toggle sidebar"
          onClick={() => dispatch(toggleSidebar())}
        >
          <PanelLeft size={18} />
        </button>

        <div className="topbar-brand">
          <Sparkles size={18} className="topbar-brand-icon" />
          <span className="topbar-brand-name">AI Code Editor</span>
        </div>

        <span
          className={`workspace-chip is-${workspace.source}`}
          title={
            isCloud
              ? `Cloud workspace: ${workspace.name}`
              : 'Demo workspace — no project imported yet'
          }
        >
          {workspace.name}
        </span>
      </div>

      <div className="topbar-group">
        <button
          type="button"
          className="text-btn"
          title={
            isSupported
              ? 'Import Folder — pick a folder from your computer'
              : "Your browser doesn't support local folder access. Please use Chrome, Edge, or Brave."
          }
          disabled={isOpening}
          onClick={openLocalFolder}
        >
          {isOpening ? <Loader2 size={16} className="spin" /> : <FolderOpen size={16} />}
          <span>{isOpening ? 'Importing…' : 'Open Folder'}</span>
        </button>

        <button
          type="button"
          className="icon-btn"
          title={isCloud ? 'Export project as .zip' : 'Import a project to export it'}
          aria-label="Export ZIP"
          disabled={!isCloud}
          onClick={exportWorkspace}
        >
          <Download size={18} />
        </button>

        <button
          type="button"
          className="icon-btn"
          title={
            isCloud
              ? 'Sync the workspace back to the imported laptop folder'
              : 'Import a project to sync it to a laptop folder'
          }
          aria-label="Sync to laptop folder"
          disabled={!isCloud || isSyncing}
          onClick={syncToLaptop}
        >
          {isSyncing ? <Loader2 size={18} className="spin" /> : <FolderSync size={18} />}
        </button>

        <button
          type="button"
          className={`icon-btn ${hasUnsavedChanges ? 'is-dirty' : ''}`}
          title={activeFileId ? 'Save file (Ctrl+S)' : 'No file open'}
          aria-label="Save file"
          disabled={!activeFileId}
          onClick={saveActiveFile}
        >
          <Save size={18} />
        </button>

        <span className="topbar-divider" />

        <button
          type="button"
          className={`icon-btn ${isTerminalOpen ? 'is-active' : ''}`}
          title={
            isCloud
              ? 'Toggle terminal'
              : 'The terminal needs a cloud project — import a folder first'
          }
          aria-label="Toggle terminal"
          disabled={!isCloud}
          onClick={() => dispatch(togglePanel())}
        >
          <TerminalSquare size={18} />
        </button>

        <button
          type="button"
          className={`icon-btn ${isAIPanelOpen ? 'is-active' : ''}`}
          title="Toggle AI assistant"
          aria-label="Toggle AI assistant"
          onClick={() => dispatch(toggleAIPanel())}
        >
          <Bot size={18} />
        </button>

        <button
          type="button"
          className="icon-btn"
          title="Settings"
          aria-label="Settings"
          onClick={() => dispatch(showToast({ message: 'Settings are coming soon.', type: 'info' }))}
        >
          <Settings size={18} />
        </button>
      </div>
    </header>
  )
}
