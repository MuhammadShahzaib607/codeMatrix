import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import { useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  TERMINAL_COLLAPSED_HEIGHT,
  TERMINAL_MAX_HEIGHT_RATIO,
  TERMINAL_MIN_HEIGHT,
  addTerminal,
  removeTerminal,
  setActiveTerminal,
  setPanelHeight,
  toggleMinimize,
} from '../../features/terminalSlice'
import { getSocket } from '../../services/socket'
import TerminalView from './TerminalView'
import './TerminalPanel.css'

export default function TerminalPanel() {
  const dispatch = useDispatch()
  const { terminals, activeTerminalId, isMinimized, panelHeight } = useSelector(
    (state) => state.terminal,
  )
  const projectId = useSelector((state) => state.fileSystem.workspace.projectId)
  const userId = useSelector((state) => state.auth.user?.id)
  const counterRef = useRef(0)

  // With no imported project, terminals run in a temporary server-side scratch
  // workspace (server/workspaces/scratch-<userId>/). Once a project is
  // imported, its real projectId takes over for new terminals.
  const effectiveProjectId = projectId || (userId ? `scratch-${userId}` : 'scratch-guest')

  function createTerminal() {
    counterRef.current += 1
    const id = crypto.randomUUID()
    dispatch(addTerminal({ id, title: `bash ${counterRef.current}` }))
    if (isMinimized) dispatch(toggleMinimize())
  }

  function closeTerminal(event, terminalId) {
    event.stopPropagation()
    getSocket().emit('terminal:close', { terminalId })
    dispatch(removeTerminal(terminalId))
  }

  function startResize(event) {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = panelHeight

    function onMove(moveEvent) {
      const maxHeight = Math.max(
        TERMINAL_MIN_HEIGHT,
        window.innerHeight * TERMINAL_MAX_HEIGHT_RATIO,
      )
      const next = startHeight + (startY - moveEvent.clientY)
      dispatch(setPanelHeight(Math.min(maxHeight, Math.max(TERMINAL_MIN_HEIGHT, next))))
    }

    function onUp() {
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
          title="Drag to resize"
          onMouseDown={startResize}
        />
      )}

      <div className="terminal-tabs">
        <div className="terminal-tab-list">
          {terminals.map((terminal) => (
            <div
              key={terminal.id}
              role="tab"
              aria-selected={terminal.id === activeTerminalId}
              className={`terminal-tab ${terminal.id === activeTerminalId ? 'is-active' : ''}`}
              onClick={() => dispatch(setActiveTerminal(terminal.id))}
            >
              <span className="terminal-tab-title">{terminal.title}</span>
              <button
                type="button"
                className="terminal-tab-close"
                title={`Close ${terminal.title}`}
                aria-label={`Close ${terminal.title}`}
                onClick={(event) => closeTerminal(event, terminal.id)}
              >
                <X size={13} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="terminal-new"
            title="New terminal"
            aria-label="New terminal"
            onClick={createTerminal}
          >
            <Plus size={15} />
          </button>
        </div>

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

      <div className="terminal-body">
        {terminals.length === 0 && (
          <div className="terminal-empty">
            No terminals open — click the <strong>+</strong> button to start one.
          </div>
        )}
        {terminals.map((terminal) => (
          <div
            key={terminal.id}
            className={`terminal-slot ${terminal.id === activeTerminalId ? 'is-active' : ''}`}
          >
            <TerminalView
              terminalId={terminal.id}
              projectId={effectiveProjectId}
              isActive={terminal.id === activeTerminalId && !isMinimized}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
