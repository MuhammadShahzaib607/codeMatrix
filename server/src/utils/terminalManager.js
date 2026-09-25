import ApiError from './ApiError.js'
import {
  WORKSPACE_MISSING_MESSAGE,
  getWorkspacePath,
  workspaceExists,
} from './workspaceManager.js'

/**
 * Owns the real terminal sessions (one node-pty process per terminal tab).
 *
 * node-pty is a native module and is declared as an optionalDependency, so the
 * server must still boot when it is missing (e.g. no build toolchain on a dev
 * machine). It is therefore imported dynamically and any failure is captured in
 * `ptyLoadError` instead of crashing the process.
 */
let pty = null
let ptyLoadError = null

try {
  const module = await import('node-pty')
  pty = module.default ?? module
} catch (error) {
  ptyLoadError = error
  console.warn(
    `[terminal] node-pty is unavailable (${error.message}). The terminal feature is disabled.`,
  )
}

/** terminalId -> { terminalId, projectId, socketId, ptyProcess } */
const sessions = new Map()

export function isTerminalAvailable() {
  return pty !== null && typeof pty.spawn === 'function'
}

export function getTerminalUnavailableReason() {
  if (isTerminalAvailable()) return null
  return ptyLoadError
    ? `node-pty could not be loaded on this server: ${ptyLoadError.message}`
    : 'node-pty is not installed on this server.'
}

export function getSession(terminalId) {
  return sessions.get(terminalId) ?? null
}

export function getSessionCount() {
  return sessions.size
}

/**
 * Production (Replit, Linux) uses bash. Windows dev machines have no bash by
 * default, so fall back to PowerShell — this is a development convenience only.
 */
function resolveShell() {
  if (process.platform === 'win32') return process.env.COMSPEC || 'powershell.exe'
  return process.env.SHELL || 'bash'
}

/**
 * Spawns a shell process inside the project's workspace and streams its output
 * to the client over the given socket.
 */
export function createTerminalSession(terminalId, projectId, socket, options = {}) {
  if (!terminalId || typeof terminalId !== 'string') {
    throw new ApiError(400, 'A terminalId is required.', 'INVALID_TERMINAL_ID')
  }
  if (!isTerminalAvailable()) {
    throw new ApiError(503, getTerminalUnavailableReason(), 'TERMINAL_UNAVAILABLE')
  }
  if (sessions.has(terminalId)) {
    throw new ApiError(409, `Terminal "${terminalId}" already exists.`, 'TERMINAL_EXISTS')
  }
  if (!workspaceExists(projectId)) {
    throw new ApiError(404, WORKSPACE_MISSING_MESSAGE, 'WORKSPACE_MISSING')
  }

  const cwd = getWorkspacePath(projectId)
  const shell = resolveShell()

  let ptyProcess
  try {
    ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: Number(options.cols) || 80,
      rows: Number(options.rows) || 24,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    })
  } catch (error) {
    throw new ApiError(500, `Could not start a shell process: ${error.message}`, 'SPAWN_FAILED')
  }

  sessions.set(terminalId, {
    terminalId,
    projectId,
    socketId: socket.id,
    ptyProcess,
  })

  ptyProcess.onData((data) => {
    if (socket.connected) socket.emit('terminal:output', { terminalId, data })
  })

  ptyProcess.onExit(({ exitCode, signal }) => {
    sessions.delete(terminalId)
    if (socket.connected) socket.emit('terminal:exit', { terminalId, exitCode, signal })
  })

  socket.emit('terminal:ready', { terminalId, cwd, shell, pid: ptyProcess.pid })

  return { terminalId, cwd, shell, pid: ptyProcess.pid }
}

/** Forwards user keystrokes to the shell. */
export function writeToTerminal(terminalId, data) {
  const session = sessions.get(terminalId)
  if (!session || typeof data !== 'string') return false
  session.ptyProcess.write(data)
  return true
}

/** Keeps the PTY's window size in sync with the visible xterm.js instance. */
export function resizeTerminal(terminalId, cols, rows) {
  const session = sessions.get(terminalId)
  if (!session) return false
  const safeCols = Math.max(1, Math.floor(Number(cols) || 0))
  const safeRows = Math.max(1, Math.floor(Number(rows) || 0))
  try {
    session.ptyProcess.resize(safeCols, safeRows)
  } catch {
    // A pty can reject a resize while it is shutting down; not worth reporting.
    return false
  }
  return true
}

/** Kills a terminal and drops it from the session map. */
export function killTerminal(terminalId) {
  const session = sessions.get(terminalId)
  if (!session) return false
  sessions.delete(terminalId)
  try {
    session.ptyProcess.kill()
  } catch {
    // Already dead.
  }
  return true
}

/** Kills every terminal owned by a socket — called on disconnect to avoid orphans. */
export function killTerminalsForSocket(socketId) {
  let killed = 0
  for (const [terminalId, session] of sessions) {
    if (session.socketId !== socketId) continue
    sessions.delete(terminalId)
    try {
      session.ptyProcess.kill()
    } catch {
      // Already dead.
    }
    killed += 1
  }
  return killed
}

/** Used on shutdown so no shell processes outlive the server. */
export function killAllTerminals() {
  for (const [, session] of sessions) {
    try {
      session.ptyProcess.kill()
    } catch {
      // Already dead.
    }
  }
  sessions.clear()
}
