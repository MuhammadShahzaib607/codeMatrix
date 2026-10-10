import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import ActivityBar from './components/ActivityBar/ActivityBar'
import AuthModal from './components/Auth/AuthModal'
import EditorArea from './components/Editor/EditorArea'
import HelpModal from './components/Help/HelpModal'
import StorageNotice from './components/Notices/StorageNotice'
import WorkspaceMissingNotice from './components/Notices/WorkspaceMissingNotice'
import SettingsModal from './components/Settings/SettingsModal'
import RightPanel from './components/RightPanel/RightPanel'
import SidebarContainer from './components/Sidebar/SidebarContainer'
import TerminalPanel from './components/Terminal/TerminalPanel'
import Toast from './components/Toast/Toast'
import Topbar from './components/Topbar/Topbar'
import { fetchCurrentUser } from './features/authSlice'
import { fetchApiKeys, fetchKeyUsage } from './features/aiSlice'
import { clearExplorerHistory } from './features/explorerHistorySlice'
import { clearProjectTrees } from './features/projectsSlice'
import { clearWorkspace } from './features/fileSystemSlice'
import { resetSidebarTerminal } from './features/sidebarTerminalSlice'
import { fetchAvailableShells, resetTerminals } from './features/terminalSlice'
import { clearTsConfig } from './features/tsconfigSlice'
import { loadWorkspaceTsConfig } from './features/workspaceThunks'
import {
  AI_PANEL_WIDTH_KEY,
  RIGHT_PANEL_TAB_KEY,
  SIDEBAR_WIDTH_KEY,
  resetStorageNotice,
  setAiPanelWidth,
  setSidebarWidth,
} from './features/uiSlice'
import useAgentEvents from './hooks/useAgentEvents'
import useGlobalShortcuts from './hooks/useGlobalShortcuts'
import useRestoreWorkspace from './hooks/useRestoreWorkspace'
import useWorkspaceWatcher from './hooks/useWorkspaceWatcher'
import { clearFileContentCache } from './services/fileContentCache'
import { writeSettings } from './services/settingsStorage'
import { clearWorkspaceRef } from './services/workspaceStorage'
import { getTheme } from './utils/themes'
import './App.css'
import './themeExtremes.css'

export default function App() {
  const dispatch = useDispatch()
  const isSidebarOpen = useSelector((state) => state.ui.isSidebarOpen)
  const isAIPanelOpen = useSelector((state) => state.ui.isAIPanelOpen)
  const sidebarWidth = useSelector((state) => state.ui.sidebarWidth)
  const aiPanelWidth = useSelector((state) => state.ui.aiPanelWidth)
  const rightPanelTab = useSelector((state) => state.ui.rightPanelTab)
  const isTerminalOpen = useSelector((state) => state.terminal.isTerminalPanelOpen)
  const workspace = useSelector((state) => state.fileSystem.workspace)
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)
  const isAdmin = useSelector((state) => state.auth.user?.role === 'admin')
  const settings = useSelector((state) => state.settings)

  useGlobalShortcuts()
  useRestoreWorkspace()
  // Live-refresh the Explorer when the workspace folder changes on disk.
  useWorkspaceWatcher()
  // Stream the AI agent's actions (agent:action / agent:done) into the feed.
  useAgentEvents()

  useEffect(() => {
    dispatch(fetchCurrentUser())
  }, [dispatch])

  // The temporary-storage warning must reappear for every new session: reset
  // its dismissed flag whenever the auth state changes (sign in or sign out).
  useEffect(() => {
    dispatch(resetStorageNotice())
  }, [isAuthenticated, dispatch])

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
    if (theme.extreme) root.setAttribute('data-extreme', 'true')
    else root.removeAttribute('data-extreme')
    for (const [property, value] of Object.entries(theme.palette)) {
      root.style.setProperty(property, value)
    }
  }, [settings.theme])

  // Persist preferences whenever they change (theme + editor + terminal only).
  useEffect(() => {
    writeSettings({
      theme: settings.theme,
      askBeforeMovingFolders: settings.askBeforeMovingFolders,
      editor: settings.editor,
      terminal: settings.terminal,
      agent: settings.agent,
    })
  }, [
    settings.theme,
    settings.askBeforeMovingFolders,
    settings.editor,
    settings.terminal,
    settings.agent,
  ])

  // The available shells are decided by the server's OS, so ask the server once
  // on load (Windows dev sees PowerShell/CMD/bash, the Linux deploy sees bash).
  useEffect(() => {
    dispatch(fetchAvailableShells())
  }, [dispatch])

  // The agent runs on a key the USER saved, so load the masked list whenever
  // an ADMIN signs in (the panel needs it to show the zero-key prompt). The
  // keys API is admin-only, so a non-admin never receives a 403 here.
  useEffect(() => {
    if (isAuthenticated && isAdmin) dispatch(fetchApiKeys())
    if (isAuthenticated && isAdmin) dispatch(fetchKeyUsage())
  }, [isAuthenticated, isAdmin, dispatch])

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

  useEffect(() => {
    if (isAuthenticated) return
    dispatch(clearWorkspace())
    dispatch(clearProjectTrees())
    dispatch(resetTerminals())
    dispatch(resetSidebarTerminal())
    clearWorkspaceRef()
    clearFileContentCache()
  }, [isAuthenticated, dispatch])

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth))
    } catch {}
  }, [sidebarWidth])

  useEffect(() => {
    try {
      localStorage.setItem(AI_PANEL_WIDTH_KEY, String(aiPanelWidth))
    } catch {}
  }, [aiPanelWidth])

  useEffect(() => {
    if (!rightPanelTab) return
    try {
      localStorage.setItem(RIGHT_PANEL_TAB_KEY, rightPanelTab)
    } catch {}
  }, [rightPanelTab])

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

  // The AI panel mirrors the sidebar: drag its LEFT edge, width = start - dx
  // (pulling left widens it), clamped 280–600px by the reducer.
  function startAiResize(event) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = aiPanelWidth
    const slot = event.currentTarget.closest('.panel-slot-ai')
    slot?.classList.add('is-resizing')

    function handleMove(moveEvent) {
      dispatch(setAiPanelWidth(startWidth - (moveEvent.clientX - startX)))
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

        <div
          className={`panel-slot panel-slot-ai ${isAIPanelOpen ? 'is-open' : ''}`}
          style={{ width: isAIPanelOpen ? aiPanelWidth : 0 }}
        >
          <RightPanel />
          {isAIPanelOpen && (
            <div
              className="ai-resize-handle"
              role="separator"
              aria-orientation="vertical"
              title="Drag to resize the AI panel"
              onMouseDown={startAiResize}
            />
          )}
        </div>
      </div>

      <Toast />
      <AuthModal />
      <SettingsModal />
      <HelpModal />
    </div>
  )
}
