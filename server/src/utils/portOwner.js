import { spawnSync } from 'node:child_process'

const COMMAND_TIMEOUT_MS = 5000

function run(command, args) {
  try {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      timeout: COMMAND_TIMEOUT_MS,
      windowsHide: true,
    })
    if (result.error || typeof result.stdout !== 'string') return ''
    return result.stdout
  } catch {
    return ''
  }
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function findListeningPid(port) {
  const target = Number(port)
  if (!Number.isInteger(target) || target <= 0) return null

  if (process.platform === 'win32') {
    const output = run('netstat', ['-ano', '-p', 'tcp'])
    for (const line of output.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue
      const columns = line.trim().split(/\s+/)
      if (columns.length < 5) continue
      const local = columns[1]
      if (!local || !local.endsWith(`:${target}`)) continue
      const pid = parsePositiveInteger(columns[columns.length - 1])
      if (pid) return pid
    }
    return null
  }

  const output = run('lsof', ['-ti', `tcp:${target}`, '-sTCP:LISTEN'])
  const first = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  return parsePositiveInteger(first)
}

export function describeProcess(pid) {
  const target = parsePositiveInteger(pid)
  if (!target) return 'unknown'

  if (process.platform === 'win32') {
    const name = run('powershell.exe', [
      '-NoProfile',
      '-Command',
      `(Get-Process -Id ${target} -ErrorAction SilentlyContinue).ProcessName`,
    ])
    return name.trim() || 'unknown'
  }

  const name = run('ps', ['-p', String(target), '-o', 'comm='])
  return name.trim() || 'unknown'
}

export function killProcess(pid) {
  const target = parsePositiveInteger(pid)
  if (!target || target === process.pid) return false

  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/F', '/PID', String(target)], {
      encoding: 'utf8',
      windowsHide: true,
    })
    return result.status === 0
  }

  try {
    process.kill(target, 'SIGTERM')
    return true
  } catch {
    return false
  }
}

export async function isCodeMatrixServer(port, timeoutMs = 900) {
  const target = Number(port)
  if (!Number.isInteger(target) || target <= 0) return false

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`http://127.0.0.1:${target}/api/health`, {
      signal: controller.signal,
    })
    if (!response.ok) return false
    const body = await response.json()
    return (
      Boolean(body) &&
      body.status === 'ok' &&
      typeof body.database === 'string' &&
      typeof body.terminal === 'string'
    )
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
