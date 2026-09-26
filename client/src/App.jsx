import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import ActivityBar from './components/ActivityBar/ActivityBar'
import AIPanel from './components/AIPanel/AIPanel'
import AuthModal from './components/Auth/AuthModal'
import EditorArea from './components/Editor/EditorArea'
import StorageNotice from './components/Notices/StorageNotice'
import WorkspaceMissingNotice from './components/Notices/WorkspaceMissingNotice'
import SettingsModal from './components/Settings/SettingsModal'
import SidebarContainer from './components/Sidebar/SidebarContainer'
import TerminalPanel from './components/Terminal/TerminalPanel'
import Toast from './components/Toast/Toast'
import Topbar from './components/Topbar/Topbar'
import { fetchCurrentUser } from './features/authSlice'
import { clearExplorerHistory } from './features/explorerHistorySlice'
import { clearWorkspace } from './features/fileSystemSlice'
import { fetchAvailableShells, resetTerminals } from './features/terminalSlice'
import { clearTsConfig } from './features/tsconfigSlice'
import { loadWorkspaceTsConfig } from './features/workspaceThunks'
import { SIDEBAR_WIDTH_KEY, setSidebarWidth } from './features/uiSlice'
import useGlobalShortcuts from './hooks/useGlobalShortcuts'
import useRestoreWorkspace from './hooks/useRestoreWorkspace'
import useWorkspaceWatcher from './hooks/useWorkspaceWatcher'
import { clearFileContentCache } from './services/fileContentCache'
import { writeSettings } from './services/settingsStorage'
import { clearWorkspaceRef } from './services/workspaceStorage'
import { getTheme } from './utils/themes'
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
  const settings = useSelector((state) => state.settings)

  useGlobalShortcuts()
  useRestoreWorkspace()
  // Live-refresh the Explorer when the workspace folder changes on disk.
  useWorkspaceWatcher()

  useEffect(() => {
    dispatch(fetchCurrentUser())
  }, [dispatch])

  // Themes are DATA: utils/themes.js holds every palette, and applying one just
  // writes its CSS custom properties onto <html>. index.css keeps the default
  // palette as a fallback for the first paint, before React has mounted. Keeping
  // the data-attribute as well means CSS written against [data-theme='…'] still
  // works for the few structural colours (color-scheme, type).
  useEffect(() => {
    const root = document.documentElement
    const theme = getTheme(settings.theme)
    root.setAttribute('data-theme', theme.id)
    root.style.colorScheme = theme.dark ? 'dark' : 'light'
    for (const [property, value] of Object.entries(theme.palette)) {
      root.style.setProperty(property, value)
    }
  }, [settings.theme])

  // Persist preferences whenever they change (theme + editor + terminal only).
  useEffect(() => {
    writeSettings({
      theme: settings.theme,
      editor: settings.editor,
      terminal: settings.terminal,
    })
  }, [settings.theme, settings.editor, settings.terminal])

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

  // Load the project's tsconfig/jsconfig so Monaco resolves its path aliases
  // (@/…) and type-checks JSX instead of underlining valid imports. The
  // Explorer undo history is scoped to a workspace, so it resets alongside.
  useEffect(() => {
    dispatch(clearExplorerHistory())
    if (!workspace.projectId) {
      dispatch(clearTsConfig())
      return
    }
    dispatch(loadWorkspaceTsConfig({ projectId: workspace.projectId }))
  }, [workspace.projectId, dispatch])

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
      <SettingsModal />
    </div>
  )
}
