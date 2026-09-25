import { Check, ChevronDown, ChevronUp, Columns2, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  TERMINAL_COLLAPSED_HEIGHT,
  TERMINAL_MAX_HEIGHT_RATIO,
  TERMINAL_MIN_HEIGHT,
  addTerminal,
  fetchAvailableShells,
  removeTerminal,
  setActiveGroup,
  setPanelHeight,
  splitActiveGroup,
  toggleMinimize,
} from '../../features/terminalSlice'
import { getSocket } from '../../services/socket'
import { scratchProjectIdFor } from '../../utils/workspace'
import SplitTerminalView from './SplitTerminalView'
import TerminalSessionList from './TerminalSessionList'
import TerminalView from './TerminalView'
import './TerminalPanel.css'

// Labels used before the server's shell list arrives (or if it never does).
// `shell` on a pane is the requested id until terminal:ready corrects it with
// the shell that was really spawned.
const SHELL_LABELS = { powershell: 'PowerShell', cmd: 'CMD', bash: 'bash' }

export default function TerminalPanel() {
  const dispatch = useDispatch()
  const {
    groups,
    activeGroupId,
    activePaneId,
    isMinimized,
    panelHeight,
    availableShells,
    defaultShell,
  } = useSelector((state) => state.terminal)
  const projectId = useSelector((state) => state.fileSystem.workspace.projectId)
  const userId = useSelector((state) => state.auth.user?.id)
  const shellMenuRef = useRef(null)
  const shellRetryRef = useRef(false)
  const [isShellMenuOpen, setIsShellMenuOpen] = useState(false)

  // With no imported project, terminals run in the per-user scratch workspace
  // (server/workspaces/scratch-<userId>/). Once a project is imported — or the
  // Explorer starts the scratch workspace — `workspace.projectId` becomes that
  // id, so the terminal and the Explorer always agree on one folder.
  const effectiveProjectId = projectId || scratchProjectIdFor(userId)
  const activeGroup = groups.find((group) => group.groupId === activeGroupId) ?? groups[0] ?? null

  // App fetches the shell list once on load. If the API was not up yet (or was
  // restarted), that attempt failed and every terminal would be requested as
  // "bash" — so retry once each time the panel is opened. The ref guard keeps
  // this from looping when the retry also fails.
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

  function shellLabel(shellId) {
    if (!shellId) return 'shell'
    return (
      availableShells.find((shell) => shell.id === shellId)?.label ??
      SHELL_LABELS[shellId] ??
      shellId
    )
  }

  // A terminal is NOT numbered: its title is just its shell's label (and the
  // server corrects it to the shell it really spawned). Two terminals of the
  // same shell therefore show the same label — that is expected. They stay
  // distinct because every pane carries a unique `terminalId` (crypto.randomUUID),
  // which is what React keys, the xterm instances and the socket messages use.
  function nextPane(requestedShell) {
    const shell = requestedShell ?? defaultShell ?? null
    return { shell, title: shellLabel(shell) }
  }

  function createTerminal(shellId) {
    const id = crypto.randomUUID()
    const pane = nextPane(shellId)
    dispatch(addTerminal({ id, title: pane.title, shell: pane.shell }))
    setIsShellMenuOpen(false)
    if (isMinimized) dispatch(toggleMinimize())
  }

  function splitActiveTerminal() {
    const panes = activeGroup?.panes ?? []
    const activePane =
      panes.find((pane) => pane.terminalId === activePaneId) ?? panes[0] ?? null
    const id = crypto.randomUUID()
    const pane = nextPane(activePane?.shell)
    dispatch(
      splitActiveGroup({
        groupId: activeGroup?.groupId ?? null,
        terminalId: id,
        title: pane.title,
        shell: pane.shell,
      }),
    )
    if (isMinimized) dispatch(toggleMinimize())
  }

  function toggleShellMenu() {
    const next = !isShellMenuOpen
    setIsShellMenuOpen(next)
    // Manual retry: a click is a user gesture, so this also recovers from an
    // initial fetch that failed before the API was reachable.
    if (next && availableShells.length === 0) dispatch(fetchAvailableShells())
  }

  function closeGroup(event, group) {
    event.stopPropagation()
    // Close every pane in the group; each one kills its own pty server-side.
    group.panes.forEach((pane) => {
      getSocket().emit('terminal:close', { terminalId: pane.terminalId })
      dispatch(removeTerminal(pane.terminalId))
    })
  }

  /**
   * Drag the thin bar at the top of the panel to resize it. The move/up
   * listeners live on `document` (not the handle) so the drag keeps working
   * when the cursor outruns the 4px handle, and a class on <body> keeps the
   * row-resize cursor for the whole drag, even outside the handle.
   */
  function startResize(event) {
    if (event.button !== 0) return
    event.preventDefault()
    const startY = event.clientY
    const startHeight = panelHeight

    document.body.classList.add('is-resizing-rows')

    function onMove(moveEvent) {
      const maxHeight = Math.max(
        TERMINAL_MIN_HEIGHT,
        window.innerHeight * TERMINAL_MAX_HEIGHT_RATIO,
      )
      const next = startHeight + (startY - moveEvent.clientY)
      dispatch(setPanelHeight(Math.min(maxHeight, Math.max(TERMINAL_MIN_HEIGHT, next))))
    }

    function onUp() {
      document.body.classList.remove('is-resizing-rows')
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div
      className={`terminal-panel ${isMinimized ? 'is-minimized' : ''}`}
      style={{ height: isMinimized ? TERMINAL_COLLAPSED_HEIGHT : panelHeight }}
    >
      {!isMinimized && (
        <div
          className="terminal-resize-handle"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize terminal panel"
          title="Drag to resize"
          onMouseDown={startResize}
        />
      )}

      <div className="terminal-tabs">
        <div className="terminal-tab-list">
          {groups.map((group) => {
            const tabPane =
              group.panes.find((pane) => pane.terminalId === activePaneId) ?? group.panes[0]
            const isActive = group.groupId === activeGroup?.groupId
            return (
              <div
                key={group.groupId}
                role="tab"
                aria-selected={isActive}
                className={`terminal-tab ${isActive ? 'is-active' : ''}`}
                onClick={() => dispatch(setActiveGroup(group.groupId))}
              >
                {group.panes.length > 1 && <Columns2 size={12} className="terminal-tab-split" />}
                <span
                  className={`terminal-tab-shell is-${tabPane?.shell ?? 'bash'}`}
                  title={shellLabel(tabPane?.shell)}
                  aria-hidden="true"
                />
                <span className="terminal-tab-title">{tabPane?.title}</span>
                <button
                  type="button"
                  className="terminal-tab-close"
                  title={`Close ${tabPane?.title}`}
                  aria-label={`Close ${tabPane?.title}`}
                  onClick={(event) => closeGroup(event, group)}
                >
                  <X size={13} />
                </button>
              </div>
            )
          })}
        </div>

        <div className="terminal-tab-actions">
          <div className="terminal-new-group" ref={shellMenuRef}>
            <button
              type="button"
              className="terminal-new"
              title="New terminal"
              aria-label="New terminal"
              onClick={() => createTerminal()}
            >
              <Plus size={15} />
            </button>
            <button
              type="button"
              className="terminal-new-caret"
              title="Choose a shell"
              aria-label="Choose a shell"
              aria-haspopup="menu"
              aria-expanded={isShellMenuOpen}
              onClick={toggleShellMenu}
            >
              <ChevronDown size={11} />
            </button>

            {isShellMenuOpen && (
              <div className="terminal-shell-menu" role="menu">
                {availableShells.length === 0 && (
                  <span className="terminal-shell-loading">Loading shells…</span>
                )}
                {availableShells.map((shell) => (
                  <button
                    key={shell.id}
                    type="button"
                    role="menuitem"
                    className={`terminal-shell-option ${
                      shell.id === defaultShell ? 'is-default' : ''
                    }`}
                    onClick={() => createTerminal(shell.id)}
                  >
                    <span className={`terminal-tab-shell is-${shell.id}`} aria-hidden="true" />
                    <span>{shell.label}</span>
                    {shell.id === defaultShell && <Check size={13} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            className="terminal-new terminal-split-btn"
            title="Split terminal"
            aria-label="Split terminal"
            disabled={!activeGroup}
            onClick={splitActiveTerminal}
          >
            <Columns2 size={15} />
          </button>

          <button
            type="button"
            className="terminal-minimize"
            title={isMinimized ? 'Expand terminal' : 'Minimize terminal'}
            aria-label={isMinimized ? 'Expand terminal' : 'Minimize terminal'}
            onClick={() => dispatch(toggleMinimize())}
          >
            {isMinimized ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* [tab bar] -> [content | session list] */}
      <div className="terminal-workspace">
        <div className="terminal-body">
          {groups.length === 0 && (
            <div className="terminal-empty">
              No terminals open — click the <strong>+</strong> button to start one.
            </div>
          )}

          {/* Every group (and every pane inside it) stays mounted; only the
              active group is visible, so switching or minimizing never kills a
              shell. */}
          {groups.map((group) => {
            const isVisible = group.groupId === activeGroup?.groupId && !isMinimized
            return (
              <div
                key={group.groupId}
                className={`terminal-group ${isVisible ? 'is-active' : ''}`}
              >
                {group.panes.length === 1 ? (
                  <TerminalView
                    terminalId={group.panes[0].terminalId}
                    projectId={effectiveProjectId}
                    shell={group.panes[0].shell}
                    isActive={isVisible}
                    autoFocus={isVisible}
                  />
                ) : (
                  <SplitTerminalView
                    group={group}
                    projectId={effectiveProjectId}
                    activePaneId={activePaneId}
                    isVisible={isVisible}
                  />
                )}
              </div>
            )
          })}
        </div>

        <TerminalSessionList />
      </div>
    </div>
  )
}
