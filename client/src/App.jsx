import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import ActivityBar from './components/ActivityBar/ActivityBar'
import AIPanel from './components/AIPanel/AIPanel'
import AuthModal from './components/Auth/AuthModal'
import EditorArea from './components/Editor/EditorArea'
import StorageNotice from './components/Notices/StorageNotice'
import WorkspaceMissingNotice from './components/Notices/WorkspaceMissingNotice'
import SidebarContainer from './components/Sidebar/SidebarContainer'
import TerminalPanel from './components/Terminal/TerminalPanel'
import Toast from './components/Toast/Toast'
import Topbar from './components/Topbar/Topbar'
import { fetchCurrentUser } from './features/authSlice'
import { resetToDemo } from './features/fileSystemSlice'
import { resetTerminals } from './features/terminalSlice'
import { SIDEBAR_WIDTH_KEY, setSidebarWidth } from './features/uiSlice'
import useGlobalShortcuts from './hooks/useGlobalShortcuts'
import useRestoreWorkspace from './hooks/useRestoreWorkspace'
import { clearFileContentCache } from './services/fileContentCache'
import { clearWorkspaceRef } from './services/workspaceStorage'
import './App.css'

export default function App() {
  const dispatch = useDispatch()
  const isSidebarOpen = useSelector((state) => state.ui.isSidebarOpen)
  const isAIPanelOpen = useSelector((state) => state.ui.isAIPanelOpen)
  const sidebarWidth = useSelector((state) => state.ui.sidebarWidth)
  const isTerminalOpen = useSelector((state) => state.terminal.isTerminalPanelOpen)
  const source = useSelector((state) => state.fileSystem.workspace.source)
  const projectId = useSelector((state) => state.fileSystem.workspace.projectId)
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)

  useGlobalShortcuts()
  useRestoreWorkspace()

  // Validate any stored token once on load, so a reload restores the session.
  useEffect(() => {
    dispatch(fetchCurrentUser())
  }, [dispatch])

  // Terminals and the file-content cache belong to exactly one project.
  useEffect(() => {
    dispatch(resetTerminals())
    clearFileContentCache()
  }, [projectId, dispatch])

  // Cloud projects only exist for a signed-in user, so hide them on sign-out.
  useEffect(() => {
    if (isAuthenticated) return
    dispatch(resetToDemo())
    clearWorkspaceRef()
    clearFileContentCache()
  }, [isAuthenticated, dispatch])

  // Remember the sidebar width for the next visit.
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth))
    } catch {
      // Storage unavailable — the width is simply not remembered.
    }
  }, [sidebarWidth])

  function startSidebarResize(event) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth
    const slot = event.currentTarget.closest('.panel-slot-sidebar')
    // Disable the width transition while dragging so it tracks the cursor exactly.
    slot?.classList.add('is-resizing')

    function handleMove(moveEvent) {
      dispatch(setSidebarWidth(startWidth + (moveEvent.clientX - startX)))
    }

    function handleUp() {
      slot?.classList.remove('is-resizing')
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }

  const showTerminal = isTerminalOpen && source === 'cloud' && Boolean(projectId)

  return (
    <div className="app">
      <Topbar />
      <StorageNotice />
      <WorkspaceMissingNotice />

      <div className="app-body">
        <ActivityBar />

        <div
          className={`panel-slot panel-slot-sidebar ${isSidebarOpen ? 'is-open' : ''}`}
          style={{ width: isSidebarOpen ? sidebarWidth : 0 }}
        >
          <SidebarContainer />
          {isSidebarOpen && (
            <div
              className="sidebar-resize-handle"
              role="separator"
              aria-orientation="vertical"
              title="Drag to resize the sidebar"
              onMouseDown={startSidebarResize}
            />
          )}
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
      <AuthModal />
    </div>
  )
}
