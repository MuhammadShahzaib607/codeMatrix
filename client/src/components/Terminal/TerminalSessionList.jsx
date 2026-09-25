import { SquareTerminal, Terminal, TerminalSquare, X } from 'lucide-react'
import { useDispatch, useSelector } from 'react-redux'
import { removeTerminal, setActivePane } from '../../features/terminalSlice'
import { getSocket } from '../../services/socket'

// One small icon per shell family (coloured by the .is-<shell> class).
const SHELL_ICONS = {
  powershell: TerminalSquare,
  cmd: SquareTerminal,
  bash: Terminal,
}

/**
 * VS Code style session list down the right edge of the terminal panel. It
 * flattens every pane of every tab group/split into one flat list, so a
 * terminal can be found, focused and closed without hunting through tabs.
 * Purely an addition: the top tab bar still switches groups/splits.
 */
export default function TerminalSessionList() {
  const dispatch = useDispatch()
  const { groups, activeGroupId, activePaneId } = useSelector((state) => state.terminal)

  const sessions = groups.flatMap((group) =>
    group.panes.map((pane) => ({ ...pane, groupId: group.groupId })),
  )

  function closeSession(event, terminalId) {
    // Clicking the X must not also activate the row underneath it.
    event.stopPropagation()
    getSocket().emit('terminal:close', { terminalId })
    dispatch(removeTerminal(terminalId))
  }

  return (
    <aside className="terminal-session-list" aria-label="Open terminal sessions">
      <div className="terminal-session-list-header">Terminals</div>

      {sessions.length === 0 ? (
        <div className="terminal-session-empty">No open terminals</div>
      ) : (
        <div className="terminal-session-items">
          {sessions.map((session) => {
            const Icon = SHELL_ICONS[session.shell] ?? Terminal
            const isActive =
              session.groupId === activeGroupId && session.terminalId === activePaneId
            return (
              <div
                key={session.terminalId}
                role="button"
                tabIndex={0}
                aria-current={isActive}
                className={`terminal-session-item is-${session.shell ?? 'bash'} ${
                  isActive ? 'is-active' : ''
                }`}
                title={session.title}
                onClick={() => dispatch(setActivePane(session.terminalId))}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  dispatch(setActivePane(session.terminalId))
                }}
              >
                <Icon size={13} className="terminal-session-icon" />
                <span className="terminal-session-name">{session.title}</span>
                <button
                  type="button"
                  className="terminal-session-close"
                  title={`Close ${session.title}`}
                  aria-label={`Close ${session.title}`}
                  onClick={(event) => closeSession(event, session.terminalId)}
                >
                  <X size={12} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </aside>
  )
}
