import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import ApiError from './ApiError.js'
import { isProcessAlive, readProcessCwds } from './processCwd.js'
import { WORKSPACE_MISSING_MESSAGE, getTerminalRootPath, getWorkspacePath, workspaceExists } from './workspaceManager.js'

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
const detachTimers = new Map()

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
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        LANG: process.env.LANG || 'en_US.UTF-8',
        LC_ALL: process.env.LC_ALL || 'en_US.UTF-8',
      },
      // WINDOWS ONLY: use ConPTY rather than the legacy winpty backend. winpty
      // does not pass through the escape sequences, arrow/Tab/Esc keys and mouse
      // reporting that full-screen TUIs (freebuff, vim, htop) need, so ConPTY is
      // required for them to be usable. Its known quirk — a kill-path helper
      // rejecting after the shell already exited — is neutralised by the
      // process-wide unhandledRejection guard in server.js.
      ...(process.platform === 'win32' ? { useConpty: true } : {}),
    })
  } catch (error) {
    throw new ApiError(500, `Could not start a shell process: ${error.message}`, 'SPAWN_FAILED')
  }

  const session = {
    terminalId,
    projectId,
    socket,
    socketId: socket.id,
    cwd,
    ptyProcess,
  }
  sessions.set(terminalId, session)

  // Output always goes to the session's CURRENT socket, which a reconnect can
  // swap (see attachTerminalSession) without touching the running pty.
  ptyProcess.onData((data) => {
    const target = sessions.get(terminalId)?.socket
    if (target?.connected) target.emit('terminal:output', { terminalId, data })
  })

  ptyProcess.onExit(({ exitCode, signal }) => {
    sessions.delete(terminalId)
    if (session.socket?.connected) {
      session.socket.emit('terminal:exit', { terminalId, exitCode, signal })
    }
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

/**
 * Re-binds an existing pty to a new socket (a reconnect reuses the SAME
 * terminalId). Returns false when the session no longer exists, so the caller
 * can spawn a fresh one instead.
 */
export function attachTerminalSession(terminalId, socket) {
  const session = sessions.get(terminalId)
  if (!session) return false
  const timer = detachTimers.get(terminalId)
  if (timer) {
    clearTimeout(timer)
    detachTimers.delete(terminalId)
  }
  session.socket = socket
  session.socketId = socket.id
  return true
}

/**
 * A socket dropped: keep its ptys alive for a grace period so a transient
 * reconnect reattaches them with their scrollback intact, and only kill what
 * was never reclaimed.
 */
export function detachTerminalsForSocket(socketId, graceMs = 120000) {
  for (const [terminalId, session] of sessions) {
    if (session.socketId !== socketId) continue
    const existing = detachTimers.get(terminalId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      detachTimers.delete(terminalId)
      const current = sessions.get(terminalId)
      if (current && current.socketId === socketId) killTerminal(terminalId)
    }, graceMs)
    timer.unref?.()
    detachTimers.set(terminalId, timer)
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

/**
 * Every live terminal whose working directory is the given folder or sits
 * inside it. Windows refuses to remove such a folder (EBUSY) until the shell
 * leaves, so the delete path uses this to explain the failure to the user.
 */
export function findTerminalsCwdInside(absolutePath) {
  const target = String(path.resolve(absolutePath ?? ''))
    .split(path.sep)
    .join('/')
    .toLowerCase()
  if (!target) return []
  const matches = []
  for (const session of sessions.values()) {
    const cwd = String(session.cwd ?? '')
      .split(path.sep)
      .join('/')
      .toLowerCase()
    if (!cwd) continue
    if (cwd === target || cwd.startsWith(`${target}/`)) {
      matches.push({ terminalId: session.terminalId, cwd: session.cwd })
    }
  }
  return matches
}

function normalizeCwdPath(value) {
  const normalized = String(value ?? '')
    .split(path.sep)
    .join('/')
    .replace(/\/+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export async function listTerminalsCwdInside(absolutePath) {
  if (!absolutePath) return []
  const target = normalizeCwdPath(path.resolve(absolutePath))
  if (!target) return []

  const candidates = []
  for (const session of sessions.values()) {
    candidates.push({
      terminalId: session.terminalId,
      pid: session.ptyProcess?.pid ?? null,
      cwd: session.cwd,
    })
  }
  for (const [commandId, agentProcess] of agentCommands) {
    candidates.push({ terminalId: commandId, pid: agentProcess?.pid ?? null, cwd: null })
  }
  if (candidates.length === 0) return []

  const cwds = await readProcessCwds(candidates.map((candidate) => candidate.pid))
  const matches = []
  for (const candidate of candidates) {
    const cwd = normalizeCwdPath(cwds.get(candidate.pid) ?? candidate.cwd)
    if (!cwd) continue
    if (cwd === target || cwd.startsWith(`${target}/`)) {
      matches.push({ terminalId: candidate.terminalId, pid: candidate.pid })
    }
  }
  return matches
}

export function killTerminalsInside(terminals) {
  let killed = 0
  for (const entry of terminals ?? []) {
    const terminalId = entry?.terminalId
    if (!terminalId) continue
    if (sessions.has(terminalId)) {
      if (killTerminal(terminalId)) killed += 1
      continue
    }
    const agentProcess = agentCommands.get(terminalId)
    if (agentProcess) {
      agentCommands.delete(terminalId)
      try {
        agentProcess.kill()
        killed += 1
      } catch (error) {
        console.error(`[terminal] kill of ${terminalId} failed: ${error?.message ?? error}`)
      }
    }
  }
  return killed
}

export async function waitForTerminalsExit(terminals, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const remaining = (terminals ?? []).filter((entry) => entry?.pid && isProcessAlive(entry.pid))
    if (remaining.length === 0) return true
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return false
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
  const timer = detachTimers.get(terminalId)
  if (timer) {
    clearTimeout(timer)
    detachTimers.delete(terminalId)
  }
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

// ---------------------------------------------------------------------------
// One-shot command execution for the AI AGENT (agentService's run_command tool).
//
// It reuses the SAME pty infrastructure as the interactive terminal (node-pty,
// resolveShell, workspace cwd), but spawns the shell NON-interactively with the
// command as an argument, captures everything it prints, and resolves when the
// process exits or the timeout hits. The output is handed back to the model as
// the tool result, and the same text is streamed to the UI in the action feed.
// ---------------------------------------------------------------------------

// Live agent commands, so shutdown can kill them too.
const agentCommands = new Map()

/**
 * The shell to run agent commands in. Bash is preferred everywhere it exists:
 * model-authored commands are usually POSIX-flavoured (&&, |, rm -rf) and bash
 * propagates exit codes reliably — unlike `powershell -Command`, which often
 * exits 0 even when the command failed.
 */
function resolveAgentShell() {
  const { shells, default: fallback } = getAvailableShells()
  const preferred =
    process.platform === 'win32' ? ['bash', 'cmd', 'powershell'] : ['bash', 'sh', fallback]
  for (const id of preferred) {
    const found = shells.find((shell) => shell.id === id)
    if (found) return found
  }
  return shells.find((shell) => shell.id === fallback) ?? shells[0]
}

function shellArgsFor(shellId, command) {
  if (shellId === 'bash' || shellId === 'sh') return ['-c', command]
  if (shellId === 'cmd') return ['/d', '/s', '/c', command]
  // PowerShell (Windows fallback)
  return ['-NoProfile', '-NonInteractive', '-Command', command]
}

// Strips ANSI colour codes + carriage returns so the model (and the feed) get
// plain readable text instead of "\x1b[32m...\x1b[0m".
function toPlainText(raw) {
  return raw
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '')
}

/**
 * Runs ONE shell command inside a project's workspace and resolves with
 * { ok, output, exitCode, timedOut, durationMs, shell }.
 *
 * Never rejects: a failed/timed-out command is a normal tool result the model
 * must read and react to. Output is capped to its tail so a chatty `npm install`
 * cannot blow up the agent's context window.
 */
export function runWorkspaceCommand(projectId, command, options = {}) {
  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || 180000, 5000), 300000)
  const commandId = `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const startedAt = Date.now()
  const MAX_BUFFER = 40000

  const failed = (message) => ({
    ok: false,
    commandId,
    shell: null,
    exitCode: null,
    timedOut: false,
    durationMs: Date.now() - startedAt,
    output: message,
  })

  return new Promise((resolve) => {
    if (!isTerminalAvailable()) {
      resolve(
        failed(
          `run_command is unavailable on this server: ${getTerminalUnavailableReason() ?? 'terminal disabled'}`,
        ),
      )
      return
    }

    let cwd
    try {
      if (!workspaceExists(projectId)) {
        throw new ApiError(404, WORKSPACE_MISSING_MESSAGE, 'WORKSPACE_MISSING')
      }
      cwd = getWorkspacePath(projectId)
    } catch (error) {
      resolve(failed(error.message))
      return
    }

    const shell = resolveAgentShell()
    let ptyProcess
    try {
      ptyProcess = pty.spawn(shell.command, shellArgsFor(shell.id, command), {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
        // Same winpty-vs-ConPTY rationale as createTerminalSession: node-pty's
        // ConPTY kill path can reject after exit and take the server down.
        ...(process.platform === 'win32' ? { useConpty: false } : {}),
      })
    } catch (error) {
      resolve(failed(`Could not start the shell: ${error.message}`))
      return
    }

    let raw = ''
    let settled = false
    let timedOut = false
    let lastExitCode = 0

    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      agentCommands.delete(commandId)
      const text = toPlainText(raw)
      resolve({
        ok: true,
        commandId,
        shell: shell.label,
        exitCode: timedOut ? null : lastExitCode,
        timedOut,
        durationMs: Date.now() - startedAt,
        output: text
          ? text
          : timedOut
            ? '(no output before the timeout)'
            : '(command produced no output)',
      })
    }

    const timer = setTimeout(() => {
      timedOut = true
      raw += `\n[agent] Command timed out after ${Math.round(timeoutMs / 1000)}s and was killed.`
      finish()
      try {
        ptyProcess.kill()
      } catch {}
    }, timeoutMs)

    agentCommands.set(commandId, ptyProcess)

    ptyProcess.onData((data) => {
      raw += data
      // Keep only the tail: a giant install log must not exhaust the buffer.
      if (raw.length > MAX_BUFFER * 2) {
        raw = `[… earlier output trimmed …]\n${raw.slice(-MAX_BUFFER)}`
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      lastExitCode = Number(exitCode) || 0
      finish()
    })
  })
}

export function killAllAgentCommands() {
  for (const agentProcess of agentCommands.values()) {
    try {
      agentProcess.kill()
    } catch (error) {
      console.error(`[terminal] kill of agent command failed: ${error?.message ?? error}`)
    }
  }
  agentCommands.clear()
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
  killAllAgentCommands()
}
