import { Check, ChevronDown, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { fetchAvailableShells } from '../../features/terminalSlice'
import {
  openSidebarTerminal,
  restartSidebarTerminal,
  setSidebarTerminalShell,
} from '../../features/sidebarTerminalSlice'
import { getSocket } from '../../services/socket'
import { scratchProjectIdFor } from '../../utils/workspace'
import TerminalView from '../Terminal/TerminalView'
import './SidebarTerminal.css'

// Labels used before the server's shell list arrives (or if it never does).
const SHELL_LABELS = { powershell: 'PowerShell', cmd: 'CMD', bash: 'bash' }

/**
 * The terminal that fills the right sidebar when the Terminal tab is selected.
 * It renders the SAME xterm component the docked panel uses, against its own
 * terminalId, so the two never share a pty. The component stays mounted while
 * the Agent tab is shown (the parent keeps it in the DOM but hidden), so its
 * shell keeps running and its scrollback survives every switch.
 */
export default function SidebarTerminal() {
  const dispatch = useDispatch()
  const { terminalId, shell } = useSelector((state) => state.sidebarTerminal)
  const projectId = useSelector((state) => state.fileSystem.workspace.projectId)
  const userId = useSelector((state) => state.auth.user?.id)
  const isAIPanelOpen = useSelector((state) => state.ui.isAIPanelOpen)
  const isTerminalTab = useSelector(
    (state) => (state.ui.rightPanelTab ?? 'agent') === 'terminal',
  )
  const isAuthResolved = useSelector((state) => state.auth.isAuthResolved)
  const { availableShells, defaultShell, shellStatus } = useSelector((state) => state.terminal)
  const preferredShell = useSelector((state) => state.settings.terminal.preferredShell)
  const [isShellMenuOpen, setIsShellMenuOpen] = useState(false)
  const shellMenuRef = useRef(null)
  const shellRetryRef = useRef(false)

  // Same working-directory logic as the docked panel: the active project, or the
  // per-user scratch workspace before anything is imported.
  const effectiveProjectId = projectId || scratchProjectIdFor(userId)
  const isActive = isTerminalTab && isAIPanelOpen
  const fallbackShell = preferredShell ?? defaultShell ?? null
  const shellsSettled = shellStatus === 'ready' || shellStatus === 'failed'

  function shellLabel(shellId) {
    if (!shellId) return 'shell'
    return (
      availableShells.find((entry) => entry.id === shellId)?.label ??
      SHELL_LABELS[shellId] ??
      shellId
    )
  }

  // Create the terminal the first time this view is shown, but ONLY once the
  // auth session and the server's shell list have both settled: creating it
  // sooner would spawn in the "scratch-guest" workspace (the user id is not
  // restored yet) and then tear that pty down and respawn as soon as the real
  // user/shell arrives — the first-load guest-then-real flicker. Waiting means
  // exactly ONE spawn, already in the correct per-user workspace. The reducer
  // ignores the call once an id exists, so React StrictMode cannot mint two.
  useEffect(() => {
    if (terminalId) return
    if (!isAuthResolved || !shellsSettled) return
    dispatch(openSidebarTerminal({ shell: fallbackShell }))
  }, [terminalId, isAuthResolved, shellsSettled, fallbackShell, dispatch])

  // If the pty started before the shell list arrived, label it with the shell
  // the server defaulted to once that list is known.
  useEffect(() => {
    if (!terminalId || shell || !defaultShell) return
    dispatch(setSidebarTerminalShell(defaultShell))
  }, [terminalId, shell, defaultShell, dispatch])

  // The shell list is fetched once on app load. Retry once here in case the API
  // was not reachable yet, mirroring the docked panel.
  useEffect(() => {
    if (shellRetryRef.current) return
    shellRetryRef.current = true
    if (availableShells.length === 0) dispatch(fetchAvailableShells())
  }, [availableShells.length, dispatch])

  useEffect(() => {
    if (!isShellMenuOpen) return undefined
    function handlePointerDown(event) {
      if (!shellMenuRef.current?.contains(event.target)) setIsShellMenuOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [isShellMenuOpen])

  function toggleShellMenu() {
    const next = !isShellMenuOpen
    setIsShellMenuOpen(next)
    if (next && availableShells.length === 0) dispatch(fetchAvailableShells())
  }

  function replaceTerminal(shellId) {
    if (terminalId) getSocket().emit('terminal:close', { terminalId })
    dispatch(restartSidebarTerminal({ shell: shellId }))
  }

  function chooseShell(shellId) {
    replaceTerminal(shellId)
    setIsShellMenuOpen(false)
  }

  function newTerminal() {
    replaceTerminal(shell ?? fallbackShell)
  }

  return (
    <div className="sidebar-terminal">
      <div className="sidebar-terminal-toolbar">
        <div className="sidebar-terminal-shell" ref={shellMenuRef}>
          <button
            type="button"
            className="sidebar-terminal-shell-btn"
            title="Choose a shell"
            aria-label="Choose a shell"
            aria-haspopup="menu"
            aria-expanded={isShellMenuOpen}
            onClick={toggleShellMenu}
          >
            <span className={`terminal-tab-shell is-${shell ?? 'bash'}`} aria-hidden="true" />
            <span className="sidebar-terminal-shell-label">{shellLabel(shell)}</span>
            <ChevronDown
              size={12}
              className={`sidebar-terminal-chevron ${isShellMenuOpen ? 'is-open' : ''}`}
            />
          </button>

          {isShellMenuOpen && (
            <div className="sidebar-terminal-shell-menu" role="menu" aria-label="Shell">
              {availableShells.length === 0 && (
                <span className="sidebar-terminal-shell-loading">Loading shells…</span>
              )}
              {availableShells.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="menuitem"
                  className={`sidebar-terminal-shell-option ${
                    option.id === fallbackShell ? 'is-default' : ''
                  }`}
                  onClick={() => chooseShell(option.id)}
                >
                  <span className={`terminal-tab-shell is-${option.id}`} aria-hidden="true" />
                  <span>{option.label}</span>
                  {option.id === fallbackShell && <Check size={13} />}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          className="sidebar-terminal-new"
          title="New terminal"
          aria-label="New terminal"
          onClick={newTerminal}
        >
          <Plus size={15} />
        </button>
      </div>

      <div className="sidebar-terminal-body">
        {terminalId ? (
          <TerminalView
            terminalId={terminalId}
            projectId={effectiveProjectId}
            shell={shell}
            isActive={isActive}
            autoFocus={isActive}
          />
        ) : (
          <div className="sidebar-terminal-empty">Starting terminal…</div>
        )}
      </div>
    </div>
  )
}
