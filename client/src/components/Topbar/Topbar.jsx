import { Bot, FolderOpen, Loader2, PanelLeft, Save, Settings, Sparkles } from 'lucide-react'
import { useDispatch, useSelector } from 'react-redux'
import { toggleAIPanel, toggleSidebar } from '../../features/uiSlice'
import useOpenFolder from '../../hooks/useOpenFolder'
import useSaveActiveFile from '../../hooks/useSaveActiveFile'
import './Topbar.css'

export default function Topbar() {
  const dispatch = useDispatch()
  const saveActiveFile = useSaveActiveFile()
  const { openLocalFolder, isOpening, isSupported } = useOpenFolder()

  const isSidebarOpen = useSelector((state) => state.ui.isSidebarOpen)
  const isAIPanelOpen = useSelector((state) => state.ui.isAIPanelOpen)
  const activeFileId = useSelector((state) => state.fileSystem.activeFileId)
  const workspace = useSelector((state) => state.fileSystem.workspace)
  const hasUnsavedChanges = useSelector(
    (state) => !!activeFileId && state.editor.unsavedFileIds.includes(activeFileId),
  )

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
            workspace.source === 'local'
              ? `Local folder: ${workspace.name}`
              : 'Demo workspace — no real folder opened yet'
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
              ? "Open Folder — pick a folder from your computer"
              : "Your browser doesn't support local folder access. Please use Chrome, Edge, or Brave."
          }
          disabled={isOpening}
          onClick={openLocalFolder}
        >
          {isOpening ? <Loader2 size={16} className="spin" /> : <FolderOpen size={16} />}
          <span>{isOpening ? 'Opening…' : 'Open Folder'}</span>
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

        <button
          type="button"
          className={`icon-btn ${isAIPanelOpen ? 'is-active' : ''}`}
          title="Toggle AI assistant"
          aria-label="Toggle AI assistant"
          onClick={() => dispatch(toggleAIPanel())}
        >
          <Bot size={18} />
        </button>

        <button type="button" className="icon-btn" title="Settings" aria-label="Settings">
          <Settings size={18} />
        </button>
      </div>
    </header>
  )
}
