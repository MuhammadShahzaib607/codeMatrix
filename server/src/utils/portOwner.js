import { execFile, spawnSync } from 'node:child_process'
import path from 'node:path'
import { isProcessAlive, readProcessCwds } from './processCwd.js'
import { isOurServerScript, readServerLock, serverScriptPath } from './serverLock.js'

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

function normalizeForCompare(value) {
  const text = String(value ?? '')
  return process.platform === 'win32' ? text.replace(/\//g, '\\').toLowerCase() : text
}

function runAsync(command, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => resolve(error && !stdout ? '' : String(stdout ?? '')),
    )
  })
}

export async function getProcessTable() {
  const table = new Map()
  if (process.platform === 'win32') {
    const script = [
      'Get-CimInstance Win32_Process | ForEach-Object {',
      '  $cmd = $_.CommandLine; if ($null -eq $cmd) { $cmd = "" }',
      '  $cmd = $cmd -replace "[`t`r`n]", " "',
      '  Write-Output ("{0}\t{1}\t{2}" -f $_.ProcessId, $_.ParentProcessId, $cmd)',
      '}',
    ].join('\n')
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const output = await runAsync('powershell.exe', ['-NoProfile', '-EncodedCommand', encoded])
    for (const line of output.split(/\r?\n/)) {
      const [pidText, ppidText, commandLine] = line.split('\t')
      const pid = Number.parseInt(pidText, 10)
      const ppid = Number.parseInt(ppidText, 10)
      if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue
      table.set(pid, { pid, ppid, commandLine: commandLine ?? '' })
    }
    return table
  }

  const output = await runAsync('ps', ['-eo', 'pid=,ppid=,args='])
  for (const line of output.split(/\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)
    if (!match) continue
    table.set(Number(match[1]), {
      pid: Number(match[1]),
      ppid: Number(match[2]),
      commandLine: match[3] ?? '',
    })
  }
  return table
}

function commandLineRunsThisServer(commandLine) {
  return normalizeForCompare(commandLine).includes(normalizeForCompare(serverScriptPath()))
}

async function commandLineRunsServerFromThisFolder(holder) {
  if (!/server\.js\b/i.test(String(holder.commandLine ?? ''))) return false
  const cwds = await readProcessCwds([holder.pid])
  const cwd = cwds.get(holder.pid)
  if (!cwd) return false
  return isOurServerScript(path.join(cwd, 'server.js'))
}

function collectStaleServerPids(holderPid, table) {
  const ancestors = []
  let cursor = table.get(holderPid)
  while (cursor?.ppid) {
    const parent = table.get(cursor.ppid)
    if (!parent) break
    if (!/server\.js/i.test(parent.commandLine ?? '')) break
    ancestors.push(parent.pid)
    cursor = parent
  }

  const descendants = []
  const seen = new Set([holderPid])
  const queue = [holderPid]
  while (queue.length > 0) {
    const current = queue.shift()
    for (const entry of table.values()) {
      if (entry.ppid !== current || seen.has(entry.pid)) continue
      seen.add(entry.pid)
      descendants.push(entry.pid)
      queue.push(entry.pid)
    }
  }

  return [...ancestors.reverse(), holderPid, ...descendants]
}

async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return !isProcessAlive(pid)
}

async function stopOneProcess(pid) {
  if (!isProcessAlive(pid)) return true

  let gracefulAccepted = false
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(pid)], {
      encoding: 'utf8',
      windowsHide: true,
    })
    gracefulAccepted = result.status === 0
  } else {
    try {
      process.kill(pid, 'SIGTERM')
      gracefulAccepted = true
    } catch {
      gracefulAccepted = false
    }
  }

  if (gracefulAccepted) await waitForExit(pid, 1500)
  if (!isProcessAlive(pid)) return true

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
      encoding: 'utf8',
      windowsHide: true,
    })
  } else {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  }
  await waitForExit(pid, 3000)
  return !isProcessAlive(pid)
}

async function stopStaleServer(pids) {
  let allStopped = true
  for (const pid of pids) {
    const stopped = await stopOneProcess(pid)
    if (!stopped) allStopped = false
  }
  return allStopped
}

export async function waitForPortFree(port, attempts = 30) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!findListeningPid(port)) return true
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return !findListeningPid(port)
}

export async function resolvePortHolder(port) {
  const pid = findListeningPid(port)
  if (!pid) return { status: 'free' }

  const lock = readServerLock()
  const table = await getProcessTable()
  const holder = table.get(pid) ?? { pid, ppid: null, commandLine: '' }
  const name = describeProcess(pid)

  const lockMatch = Boolean(lock && lock.pid === pid && isOurServerScript(lock.script))
  const commandLineMatch = commandLineRunsThisServer(holder.commandLine)
  const folderMatch =
    !lockMatch && !commandLineMatch ? await commandLineRunsServerFromThisFolder(holder) : false

  if (!lockMatch && !commandLineMatch && !folderMatch) {
    return { status: 'held', pid, name }
  }

  const reason = lockMatch
    ? 'its PID matches the lock file'
    : commandLineMatch
      ? 'its command line runs this project\u2019s server.js'
      : 'it runs from this project\u2019s server folder'

  const pids = collectStaleServerPids(pid, table)
  const stopped = await stopStaleServer(pids)
  if (!stopped) return { status: 'failed', pid, name }
  return { status: 'stopped', pid, reason }
}
