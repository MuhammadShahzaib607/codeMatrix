import {
  createTerminalSession,
  getTerminalUnavailableReason,
  isTerminalAvailable,
  killTerminal,
  killTerminalsForSocket,
  resizeTerminal,
  writeToTerminal,
} from '../utils/terminalManager.js'
import { isValidProjectId } from '../utils/workspaceManager.js'

/**
 * Registers every terminal-related Socket.IO event for each connected client.
 *
 * Events (client -> server):
 *   terminal:create  { terminalId, projectId }
 *   terminal:input   { terminalId, data }
 *   terminal:resize  { terminalId, cols, rows }
 *   terminal:close   { terminalId }
 *
 * Events (server -> client):
 *   terminal:ready   { terminalId, cwd, shell, pid }
 *   terminal:output  { terminalId, data }
 *   terminal:exit    { terminalId, exitCode, signal }
 *   terminal:error   { terminalId, message }
 */
export default function registerTerminalSocket(io) {
  io.on('connection', (socket) => {
    socket.on('terminal:create', (payload, acknowledge) => {
      const { terminalId, projectId, cols, rows } = payload ?? {}
      try {
        if (!terminalId) throw new Error('terminalId is required.')
        if (!isValidProjectId(projectId)) throw new Error('A valid projectId is required.')
        if (!isTerminalAvailable()) {
          throw new Error(getTerminalUnavailableReason() || 'Terminal is unavailable on this server.')
        }

        createTerminalSession(terminalId, projectId, socket, { cols, rows })
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

    // Prevent orphaned shell processes when a tab is closed or the network drops.
    socket.on('disconnect', () => {
      killTerminalsForSocket(socket.id)
    })
  })
}
