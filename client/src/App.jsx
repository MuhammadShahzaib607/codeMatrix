import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import AIPanel from './components/AIPanel/AIPanel'
import EditorArea from './components/Editor/EditorArea'
import StorageNotice from './components/Notices/StorageNotice'
import WorkspaceMissingNotice from './components/Notices/WorkspaceMissingNotice'
import Sidebar from './components/Sidebar/Sidebar'
import TerminalPanel from './components/Terminal/TerminalPanel'
import Toast from './components/Toast/Toast'
import Topbar from './components/Topbar/Topbar'
import { resetTerminals } from './features/terminalSlice'
import useGlobalShortcuts from './hooks/useGlobalShortcuts'
import useRestoreWorkspace from './hooks/useRestoreWorkspace'
import './App.css'

export default function App() {
  const dispatch = useDispatch()
  const isSidebarOpen = useSelector((state) => state.ui.isSidebarOpen)
  const isAIPanelOpen = useSelector((state) => state.ui.isAIPanelOpen)
  const isTerminalOpen = useSelector((state) => state.terminal.isTerminalPanelOpen)
  const source = useSelector((state) => state.fileSystem.workspace.source)
  const projectId = useSelector((state) => state.fileSystem.workspace.projectId)

  useGlobalShortcuts()
  useRestoreWorkspace()

  // A new (or lost) project must not keep terminals bound to the old workspace.
  useEffect(() => {
    dispatch(resetTerminals())
  }, [projectId, dispatch])

  const showTerminal = isTerminalOpen && source === 'cloud' && Boolean(projectId)

  return (
    <div className="app">
      <Topbar />
      <StorageNotice />
      <WorkspaceMissingNotice />

      <div className="app-body">
        <div className={`panel-slot panel-slot-sidebar ${isSidebarOpen ? 'is-open' : ''}`}>
          <Sidebar />
        </div>

        <div className="editor-column">
          <EditorArea />
          {showTerminal && <TerminalPanel />}
        </div>

        <div className={`panel-slot panel-slot-ai ${isAIPanelOpen ? 'is-open' : ''}`}>
          <AIPanel />
        </div>
      </div>

      <Toast />
    </div>
  )
}
