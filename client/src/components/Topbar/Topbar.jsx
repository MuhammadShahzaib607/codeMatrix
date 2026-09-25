import {
  Bot,
  Download,
  FolderOpen,
  FolderSync,
  Loader2,
  LogOut,
  PanelLeft,
  Save,
  Settings,
  TerminalSquare,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { logout } from '../../features/authSlice'
import { togglePanel } from '../../features/terminalSlice'
import { openAuthModal, showToast, toggleAIPanel, toggleSidebar } from '../../features/uiSlice'
import useAuthGuard from '../../hooks/useAuthGuard'
import useExportWorkspace from '../../hooks/useExportWorkspace'
import useOpenFolder from '../../hooks/useOpenFolder'
import useSaveActiveFile from '../../hooks/useSaveActiveFile'
import useSyncToLaptop from '../../hooks/useSyncToLaptop'
import TopbarSearch from './TopbarSearch'
import './Topbar.css'

export default function Topbar() {
  const dispatch = useDispatch()
  const guard = useAuthGuard()
  const saveActiveFile = useSaveActiveFile()
  const exportWorkspace = useExportWorkspace()
  const { syncToLaptop, isSyncing } = useSyncToLaptop()
  const { openLocalFolder, isOpening, isSupported } = useOpenFolder()

  const isSidebarOpen = useSelector((state) => state.ui.isSidebarOpen)
  const isAIPanelOpen = useSelector((state) => state.ui.isAIPanelOpen)
  const isTerminalOpen = useSelector((state) => state.terminal.isTerminalPanelOpen)
  const activeFileId = useSelector((state) => state.fileSystem.activeFileId)
  const workspace = useSelector((state) => state.fileSystem.workspace)
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)
  const hasUnsavedChanges = useSelector(
    (state) => !!activeFileId && state.editor.unsavedFileIds.includes(activeFileId),
  )

  const isCloud = workspace.source === 'cloud' && Boolean(workspace.projectId)
  const cloudHint = isAuthenticated ? undefined : 'Please sign in to continue'

  return (
    <header className="topbar">
      {/* ---------------- LEFT: brand + workspace ---------------- */}
      <div className="topbar-left">
        <button
          type="button"
          className={`icon-btn ${isSidebarOpen ? 'is-active' : ''}`}
          title="Toggle sidebar"
          aria-label="Toggle sidebar"
          onClick={() => dispatch(toggleSidebar())}
        >
          <PanelLeft size={18} />
        </button>

        {/* TODO: logo will be added later */}
        <div className="topbar-logo-placeholder" aria-hidden="true" />
        <span className="topbar-brand-name">CodeMatrix</span>

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

      {/* ---------------- CENTER: quick open ---------------- */}
      <div className="topbar-center">
        <TopbarSearch />
      </div>

      {/* ---------------- RIGHT: actions + auth ---------------- */}
      <div className="topbar-right">
        <button
          type="button"
          className="text-btn"
          title={
            !isSupported
              ? "Your browser doesn't support local folder access. Please use Chrome, Edge, or Brave."
              : `Import Folder${cloudHint ? ` — ${cloudHint}` : ' — pick a folder from your computer'}`
          }
          disabled={isOpening}
          onClick={() => guard(openLocalFolder, 'Please sign in to import a project')}
        >
          {isOpening ? <Loader2 size={16} className="spin" /> : <FolderOpen size={16} />}
          <span>{isOpening ? 'Importing…' : 'Open Folder'}</span>
        </button>

        <button
          type="button"
          className="icon-btn"
          title={
            !isAuthenticated
              ? cloudHint
              : isCloud
                ? 'Export project as .zip'
                : 'Import a project to export it'
          }
          aria-label="Export ZIP"
          disabled={!isCloud}
          onClick={() => guard(exportWorkspace, 'Please sign in to export your project')}
        >
          <Download size={18} />
        </button>

        <button
          type="button"
          className="icon-btn"
          title={
            !isAuthenticated
              ? cloudHint
              : isCloud
                ? 'Sync the workspace back to the imported laptop folder'
                : 'Import a project to sync it to a laptop folder'
          }
          aria-label="Sync to laptop folder"
          disabled={!isCloud || isSyncing}
          onClick={() => guard(syncToLaptop, 'Please sign in to sync your project')}
        >
          {isSyncing ? <Loader2 size={18} className="spin" /> : <FolderSync size={18} />}
        </button>

        <button
          type="button"
          className={`icon-btn ${hasUnsavedChanges ? 'is-dirty' : ''}`}
          title={
            !activeFileId ? 'No file open' : `Save file (Ctrl+S)${cloudHint ? ` — ${cloudHint}` : ''}`
          }
          aria-label="Save file"
          disabled={!activeFileId}
          onClick={() => guard(saveActiveFile, 'Please sign in to save files')}
        >
          <Save size={18} />
        </button>

        <button
          type="button"
          className={`icon-btn ${isTerminalOpen ? 'is-active' : ''}`}
          title={
            !isAuthenticated
              ? cloudHint
              : isCloud
                ? 'Toggle terminal'
                : 'The terminal needs a cloud project — import a folder first'
          }
          aria-label="Toggle terminal"
          disabled={!isCloud}
          onClick={() => guard(() => dispatch(togglePanel()), 'Please sign in to use the terminal')}
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

        <span className="topbar-divider" />

        <AuthSection />
      </div>
    </header>
  )
}

/** Sign In / Sign Up buttons, or the signed-in user's avatar menu. */
function AuthSection() {
  const dispatch = useDispatch()
  const { isAuthenticated, user } = useSelector((state) => state.auth)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    function handlePointerDown(event) {
      if (!menuRef.current?.contains(event.target)) setIsMenuOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  if (!isAuthenticated || !user) {
    return (
      <div className="topbar-auth">
        <button
          type="button"
          className="auth-btn auth-btn-ghost"
          onClick={() => dispatch(openAuthModal({ mode: 'signin' }))}
        >
          Sign In
        </button>
        <button
          type="button"
          className="auth-btn auth-btn-primary"
          onClick={() => dispatch(openAuthModal({ mode: 'signup' }))}
        >
          Sign Up
        </button>
      </div>
    )
  }

  const initial = (user.name || user.email || '?').charAt(0).toUpperCase()

  return (
    <div className="topbar-auth" ref={menuRef}>
      <button
        type="button"
        className="user-chip"
        title={user.email}
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        onClick={() => setIsMenuOpen((open) => !open)}
      >
        <span className="user-avatar">{initial}</span>
        <span className="user-name">{user.name}</span>
      </button>

      {isMenuOpen && (
        <div className="user-menu" role="menu">
          <div className="user-menu-header">
            <span className="user-menu-name">{user.name}</span>
            <span className="user-menu-email">{user.email}</span>
          </div>
          <button
            type="button"
            role="menuitem"
            className="user-menu-item"
            onClick={() => {
              setIsMenuOpen(false)
              dispatch(showToast({ message: 'Settings are coming soon.', type: 'info' }))
            }}
          >
            <Settings size={15} />
            <span>Settings</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="user-menu-item"
            onClick={() => {
              setIsMenuOpen(false)
              dispatch(logout())
              dispatch(showToast({ message: 'Signed out.', type: 'info' }))
            }}
          >
            <LogOut size={15} />
            <span>Logout</span>
          </button>
        </div>
      )}
    </div>
  )
}
