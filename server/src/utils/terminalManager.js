import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import ApiError from './ApiError.js'
import { WORKSPACE_MISSING_MESSAGE, getTerminalRootPath, workspaceExists } from './workspaceManager.js'

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
 * Which shells this SERVER can actually spawn. This is derived at runtime from
 * process.platform (plus a real check for bash on Windows), never hardcoded, so
 * a Windows dev machine offers PowerShell/CMD/bash while the Linux deployment
 * offers only bash.
 */
let cachedShells = null

function findWindowsBash() {
  // Windows-ONLY probe: this function is called only when process.platform is
  // 'win32', so none of it runs on the Linux deployment. Every path is composed
  // with path.win32.join — there are no hardcoded backslashes or drive-letter
  // string literals — which keeps the file portable and lint-clean.
  const programFiles = process.env.ProgramFiles || path.win32.join('C:', 'Program Files')
  const programFilesX86 =
    process.env['ProgramFiles(x86)'] || path.win32.join('C:', 'Program Files (x86)')

  const candidates = [
    path.win32.join(programFiles, 'Git', 'bin', 'bash.exe'),
    path.win32.join(programFilesX86, 'Git', 'bin', 'bash.exe'),
  ]
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {}
  }
  try {
    const result = spawnSync('where', ['bash.exe'], { stdio: 'ignore' })
    if (result.status === 0) return 'bash.exe'
  } catch {}
  return null
}

export function getAvailableShells() {
  if (cachedShells) return cachedShells

  if (process.platform === 'win32') {
    const shells = [
      { id: 'powershell', label: 'PowerShell', command: 'powershell.exe' },
      { id: 'cmd', label: 'CMD', command: process.env.ComSpec || 'cmd.exe' },
    ]
    const bash = findWindowsBash()
    if (bash) shells.push({ id: 'bash', label: 'bash', command: bash })
    cachedShells = { platform: process.platform, default: 'powershell', shells }
  } else {
    cachedShells = {
      platform: process.platform,
      default: 'bash',
      shells: [{ id: 'bash', label: 'bash', command: process.env.SHELL || '/bin/bash' }],
    }
  }

  return cachedShells
}

/** Public, credential-free view for the API / client dropdown. */
export function getShellOptions() {
  const { platform, default: fallback, shells } = getAvailableShells()
  return {
    platform,
    default: fallback,
    shells: shells.map(({ id, label }) => ({ id, label })),
  }
}

/**
 * Maps a requested shell id to a spawnable descriptor, falling back to the
 * platform default when the id is unknown or unavailable on this server (e.g. a
 * stale 'bash' request arriving at a Windows host without Git Bash).
 */
function resolveShell(shellType) {
  const { shells, default: fallback } = getAvailableShells()
  return (
    shells.find((shell) => shell.id === shellType) ??
    shells.find((shell) => shell.id === fallback) ??
    shells[0]
  )
}

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

  // Terminals start ONE LEVEL ABOVE the project folder (the per-user container),
  // so the project appears as a genuine, enterable subfolder whose name matches
  // what the Explorer shows as its root — `cd <project name>` just works.
  const cwd = getTerminalRootPath(projectId)
  const shellInfo = resolveShell(options.shell)

  let ptyProcess
  try {
    ptyProcess = pty.spawn(shellInfo.command, [], {
      name: 'xterm-256color',
      cols: Number(options.cols) || 80,
      rows: Number(options.rows) || 24,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      // WINDOWS ONLY: force the older winpty backend instead of ConPTY.
      // node-pty's ConPTY kill path does, inside a fire-and-forget promise:
      //     this._getConsoleProcessList().then((list) => list.forEach(...))
      // getConsoleProcessList() forks a helper that reports the console's
      // process ids. If the shell has ALREADY exited by the time the helper
      // answers, the message carries no `consoleProcessList`, so `.forEach`
      // throws inside a .then() — an unhandled rejection, which Node treats as
      // fatal and kills the whole server. winpty has no such path (it calls the
      // synchronous native getProcessList), so we avoid that crash entirely.
      // Linux/macOS keep node-pty's defaults.
      ...(process.platform === 'win32' ? { useConpty: false } : {}),
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

  socket.emit('terminal:ready', {
    terminalId,
    cwd,
    shell: shellInfo.label,
    shellId: shellInfo.id,
    pid: ptyProcess.pid,
  })

  return {
    terminalId,
    cwd,
    shell: shellInfo.label,
    shellId: shellInfo.id,
    pid: ptyProcess.pid,
  }
}

export function writeToTerminal(terminalId, data) {
  const session = sessions.get(terminalId)
  if (!session || typeof data !== 'string') return false
  try {
    session.ptyProcess.write(data)
  } catch (error) {
    console.error(`[terminal] write to ${terminalId} failed: ${error?.message ?? error}`)
    return false
  }
  return true
}

export function resizeTerminal(terminalId, cols, rows) {
  const session = sessions.get(terminalId)
  if (!session) return false
  const safeCols = Math.max(1, Math.floor(Number(cols) || 0))
  const safeRows = Math.max(1, Math.floor(Number(rows) || 0))
  try {
    session.ptyProcess.resize(safeCols, safeRows)
  } catch {
    return false
  }
  return true
}

/**
 * Kills one pty. node-pty's Windows kill path can throw *or* reject after the
 * shell has already exited, so the kill is wrapped and the session is always
 * dropped from the map: a broken pty must never take the server process down.
 */
export function killTerminal(terminalId) {
  const session = sessions.get(terminalId)
  if (!session) return false
  // Delete first, so the session is gone even when kill() throws below.
  sessions.delete(terminalId)
  try {
    session.ptyProcess.kill()
  } catch (error) {
    console.error(
      `[terminal] kill(${terminalId}) failed (session dropped anyway): ${error?.message ?? error}`,
    )
    return false
  }
  return true
}

export function killTerminalsForSocket(socketId) {
  let killed = 0
  for (const [terminalId, session] of sessions) {
    if (session.socketId !== socketId) continue
    sessions.delete(terminalId)
    try {
      session.ptyProcess.kill()
    } catch (error) {
      console.error(
        `[terminal] kill(${terminalId}) during disconnect failed: ${error?.message ?? error}`,
      )
    }
    killed += 1
  }
  return killed
}

export function killAllTerminals() {
  for (const [terminalId, session] of sessions) {
    try {
      session.ptyProcess.kill()
    } catch (error) {
      console.error(
        `[terminal] kill(${terminalId}) during shutdown failed: ${error?.message ?? error}`,
      )
    }
  }
  sessions.clear()
}
