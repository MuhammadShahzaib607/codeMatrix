import {
  attachTerminalSession,
  createTerminalSession,
  detachTerminalsForSocket,
  getTerminalUnavailableReason,
  isTerminalAvailable,
  killTerminal,
  resizeTerminal,
  writeToTerminal,
} from '../utils/terminalManager.js'
import {
  ensureScratchWorkspace,
  isScratchProjectId,
  isValidProjectId,
} from '../utils/workspaceManager.js'

export default function registerTerminalSocket(io) {
  io.on('connection', (socket) => {
    socket.on('terminal:create', (payload, acknowledge) => {
      const { terminalId, projectId, shell, cols, rows } = payload ?? {}
      try {
        if (!terminalId) throw new Error('terminalId is required.')
        if (!isTerminalAvailable()) {
          throw new Error(
            getTerminalUnavailableReason() || 'Terminal is unavailable on this server.',
          )
        }

        // A reconnecting client re-uses its terminalId: reattach the SAME pty
        // (and its scrollback) instead of spawning a second shell.
        if (attachTerminalSession(terminalId, socket)) {
          acknowledge?.({ ok: true, terminalId, reattached: true })
          return
        }

        // No project imported -> spawn in a throwaway scratch workspace so the
        // terminal works even before any folder is imported. Real projectIds
        // keep the existing behaviour (404 if the workspace folder is gone).
        let resolvedProjectId = projectId || 'scratch-guest'
        if (isScratchProjectId(resolvedProjectId)) {
          ensureScratchWorkspace(resolvedProjectId)
        } else if (!isValidProjectId(resolvedProjectId)) {
          throw new Error('A valid projectId is required.')
        }

        createTerminalSession(terminalId, resolvedProjectId, socket, { cols, rows, shell })
        acknowledge?.({ ok: true, terminalId })
      } catch (error) {
        socket.emit('terminal:error', { terminalId, message: error.message })
        acknowledge?.({ ok: false, message: error.message })
      }
    })

    socket.on('terminal:input', (payload) => {
      const { terminalId, data } = payload ?? {}
      if (terminalId) writeToTerminal(terminalId, data)
    })

    socket.on('terminal:resize', (payload) => {
      const { terminalId, cols, rows } = payload ?? {}
      if (terminalId) resizeTerminal(terminalId, cols, rows)
    })

    socket.on('terminal:close', (payload) => {
      const { terminalId } = payload ?? {}
      if (terminalId) killTerminal(terminalId)
    })

    // Keep ptys alive for a grace period so a reconnect reattaches them; the
    // grace timer kills anything that is never reclaimed.
    socket.on('disconnect', () => {
      detachTerminalsForSocket(socket.id)
    })
  })
}
