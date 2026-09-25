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
import { clearWorkspace } from './features/fileSystemSlice'
import { fetchAvailableShells, resetTerminals } from './features/terminalSlice'
import { SIDEBAR_WIDTH_KEY, setSidebarWidth } from './features/uiSlice'
import useGlobalShortcuts from './hooks/useGlobalShortcuts'
import useRestoreWorkspace from './hooks/useRestoreWorkspace'
import { clearFileContentCache } from './services/fileContentCache'
import { clearWorkspaceRef } from './services/workspaceStorage'
import { isCloudWorkspace } from './utils/workspace'
import './App.css'

export default function App() {
  const dispatch = useDispatch()
  const isSidebarOpen = useSelector((state) => state.ui.isSidebarOpen)
  const isAIPanelOpen = useSelector((state) => state.ui.isAIPanelOpen)
  const sidebarWidth = useSelector((state) => state.ui.sidebarWidth)
  const isTerminalOpen = useSelector((state) => state.terminal.isTerminalPanelOpen)
  const workspace = useSelector((state) => state.fileSystem.workspace)
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)

  useGlobalShortcuts()
  useRestoreWorkspace()

  useEffect(() => {
    dispatch(fetchCurrentUser())
  }, [dispatch])

  // The available shells are decided by the server's OS, so ask the server once
  // on load (Windows dev sees PowerShell/CMD/bash, the Linux deploy sees bash).
  useEffect(() => {
    dispatch(fetchAvailableShells())
  }, [dispatch])

  // The content cache is keyed by workspace id, so drop it whenever the active
  // workspace changes (scratch included).
  useEffect(() => {
    clearFileContentCache()
  }, [workspace.projectId])

  // Terminals only reset for a REAL imported project: entering the scratch
  // workspace must not tear down terminals that already run in that same folder
  // (the Explorer and the terminal share scratch-<userId>).
  const cloudProjectId = isCloudWorkspace(workspace) ? workspace.projectId : null
  useEffect(() => {
    if (!cloudProjectId) return
    dispatch(resetTerminals())
  }, [cloudProjectId, dispatch])

  useEffect(() => {
    if (isAuthenticated) return
    dispatch(clearWorkspace())
    dispatch(resetTerminals())
    clearWorkspaceRef()
    clearFileContentCache()
  }, [isAuthenticated, dispatch])

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth))
    } catch {}
  }, [sidebarWidth])

  function startSidebarResize(event) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth
    const slot = event.currentTarget.closest('.panel-slot-sidebar')
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

  // The terminal is always available: with no project imported it runs in a
  // server-side "scratch" workspace (see TerminalPanel).
  const showTerminal = isTerminalOpen

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
