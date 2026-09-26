import {
  Bot,
  Download,
  FolderInput,
  FolderOutput,
  FolderSync,
  Loader2,
  LogOut,
  Save,
  Settings,
  TerminalSquare,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { logout } from '../../features/authSlice'
import { openSettings } from '../../features/settingsSlice'
import { togglePanel } from '../../features/terminalSlice'
import { openAuthModal, showToast, toggleAIPanel } from '../../features/uiSlice'
import useAuthGuard from '../../hooks/useAuthGuard'
import useExportToFolder from '../../hooks/useExportToFolder'
import useExportWorkspace from '../../hooks/useExportWorkspace'
import useOpenFolder from '../../hooks/useOpenFolder'
import useSaveActiveFile from '../../hooks/useSaveActiveFile'
import useSyncToLaptop from '../../hooks/useSyncToLaptop'
import { hasActiveWorkspace, isCloudWorkspace, workspaceLabel } from '../../utils/workspace'
import Tooltip from '../Common/Tooltip'
import Logo from '../Logo/Logo'
import TopbarSearch from './TopbarSearch'
import './Topbar.css'

const IMPORT_FIRST = 'Import a project first'
const UNSUPPORTED_FOLDER =
  "Your browser doesn't support local folder access. Please use Chrome, Edge, or Brave."

export default function Topbar() {
  const dispatch = useDispatch()
  const guard = useAuthGuard()
  const saveActiveFile = useSaveActiveFile()
  const exportWorkspace = useExportWorkspace()
  const { exportToFolder, isExporting, progress } = useExportToFolder()
  const { syncToLaptop, isSyncing } = useSyncToLaptop()
  const { importFolder, isImporting, isSupported } = useOpenFolder()

  const isAIPanelOpen = useSelector((state) => state.ui.isAIPanelOpen)
  const isTerminalOpen = useSelector((state) => state.terminal.isTerminalPanelOpen)
  const activeFileId = useSelector((state) => state.fileSystem.activeFileId)
  const workspace = useSelector((state) => state.fileSystem.workspace)
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)
  const hasUnsavedChanges = useSelector(
    (state) => !!activeFileId && state.editor.unsavedFileIds.includes(activeFileId),
  )

  // A scratch workspace can be saved into but cannot be exported or synced
  // (there is no imported folder on the laptop to sync back to).
  const hasProject = isCloudWorkspace(workspace)
  const hasWorkspace = hasActiveWorkspace(workspace)
  const label = workspaceLabel(workspace)
  const projectDisabled = !hasProject

  return (
    <header className="topbar">
      <div className="topbar-left">
        {/* The sidebar toggle now lives at the top of the Activity Bar. */}
        <Logo size={26} className="topbar-logo" />
        <span className="topbar-brand-name">CodeMatrix</span>

        <span
          className={`workspace-chip is-${workspace.source}`}
          title={label ? `Workspace: ${label}` : IMPORT_FIRST}
        >
          {label ?? 'No project imported'}
        </span>
      </div>

      <div className="topbar-center">
        <TopbarSearch />
      </div>

      <div className="topbar-right">
        <Tooltip
          label={
            !isSupported
              ? UNSUPPORTED_FOLDER
              : isAuthenticated
                ? 'Import a folder from your device'
                : 'Please sign in to import a project'
          }
        >
          <button
            type="button"
            className="text-btn"
            aria-label="Import Folder"
            disabled={isImporting}
            onClick={() => guard(importFolder, 'Please sign in to import a project')}
          >
            {isImporting ? <Loader2 size={16} className="spin" /> : <FolderInput size={16} />}
            <span>{isImporting ? 'Importing project…' : 'Import Folder'}</span>
          </button>
        </Tooltip>

        <Tooltip
          label={
            projectDisabled
              ? IMPORT_FIRST
              : isAuthenticated
                ? 'Download project as a ZIP file'
                : 'Please sign in to export your project'
          }
        >
          <button
            type="button"
            className="icon-btn"
            aria-label="Export ZIP"
            disabled={projectDisabled}
            onClick={() => guard(exportWorkspace, 'Please sign in to export your project')}
          >
            <Download size={18} />
          </button>
        </Tooltip>

        <Tooltip
          label={
            !isSupported
              ? UNSUPPORTED_FOLDER
              : projectDisabled
                ? IMPORT_FIRST
                : isAuthenticated
                  ? 'Export project as files to a local folder (excludes node_modules)'
                  : 'Please sign in to export your project'
          }
        >
          <button
            type="button"
            className="icon-btn"
            aria-label="Export project to a local folder"
            disabled={projectDisabled || isExporting}
            onClick={() => guard(exportToFolder, 'Please sign in to export your project')}
          >
            {isExporting ? <Loader2 size={18} className="spin" /> : <FolderOutput size={18} />}
          </button>
        </Tooltip>

        <Tooltip
          label={
            projectDisabled
              ? IMPORT_FIRST
              : isAuthenticated
                ? 'Sync changes back to your originally imported local folder'
                : 'Please sign in to sync your project'
          }
        >
          <button
            type="button"
            className="icon-btn"
            aria-label="Sync to laptop folder"
            disabled={projectDisabled || isSyncing}
            onClick={() => guard(syncToLaptop, 'Please sign in to sync your project')}
          >
            {isSyncing ? <Loader2 size={18} className="spin" /> : <FolderSync size={18} />}
          </button>
        </Tooltip>

        <Tooltip
          label={
            !activeFileId
              ? 'No file open'
              : !hasWorkspace
                ? 'Create a file or import a folder first'
                : isAuthenticated
                  ? 'Save the active file (Ctrl+S)'
                  : 'Please sign in to save files'
          }
        >
          <button
            type="button"
            className={`icon-btn ${hasUnsavedChanges ? 'is-dirty' : ''}`}
            aria-label="Save file"
            disabled={!hasWorkspace || !activeFileId}
            onClick={() => guard(saveActiveFile, 'Please sign in to save files')}
          >
            <Save size={18} />
          </button>
        </Tooltip>

        <Tooltip label={isTerminalOpen ? 'Hide terminal panel' : 'Show terminal panel'}>
          <button
            type="button"
            className={`icon-btn ${isTerminalOpen ? 'is-active' : ''}`}
            aria-label="Toggle terminal panel"
            onClick={() => dispatch(togglePanel())}
          >
            <TerminalSquare size={18} />
          </button>
        </Tooltip>

        <Tooltip label={isAIPanelOpen ? 'Hide AI assistant' : 'Show AI assistant'}>
          <button
            type="button"
            className={`icon-btn ${isAIPanelOpen ? 'is-active' : ''}`}
            aria-label="Toggle AI assistant"
            onClick={() => dispatch(toggleAIPanel())}
          >
            <Bot size={18} />
          </button>
        </Tooltip>

        <Tooltip label="Settings">
          <button
            type="button"
            className="icon-btn"
            aria-label="Settings"
            onClick={() => dispatch(openSettings())}
          >
            <Settings size={18} />
          </button>
        </Tooltip>

        <span className="topbar-divider" />

        <AuthSection />
      </div>

      {isExporting && (
        <div className="export-progress" role="status" aria-live="polite">
          <Loader2 size={14} className="spin" />
          <span>
            Exporting… {progress.done} of {progress.total || '?'} files
          </span>
        </div>
      )}
    </header>
  )
}

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
              dispatch(openSettings())
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
