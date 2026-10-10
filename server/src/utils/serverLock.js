import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER_SCRIPT = fileURLToPath(new URL('../../server.js', import.meta.url))
const LOCK_PATH = path.join(path.dirname(SERVER_SCRIPT), '.server.pid')

export function serverScriptPath() {
  return SERVER_SCRIPT
}

export function serverLockPath() {
  return LOCK_PATH
}

export function isOurServerScript(script) {
  if (typeof script !== 'string' || !script) return false
  const left = process.platform === 'win32' ? path.resolve(script).toLowerCase() : path.resolve(script)
  const right =
    process.platform === 'win32' ? SERVER_SCRIPT.toLowerCase() : SERVER_SCRIPT
  return left === right
}

export function readServerLock() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'))
    const pid = Number(parsed?.pid)
    const script = typeof parsed?.script === 'string' ? parsed.script : ''
    if (!Number.isInteger(pid) || pid <= 0 || !script) return null
    return { pid, script }
  } catch {
    return null
  }
}

export function writeServerLock() {
  const payload = `${JSON.stringify({
    pid: process.pid,
    script: SERVER_SCRIPT,
    startedAt: new Date().toISOString(),
  })}\n`
  try {
    fs.writeFileSync(LOCK_PATH, payload, 'utf8')
    return true
  } catch (error) {
    console.warn(`[server] could not write ${LOCK_PATH}: ${error?.message ?? error}`)
    return false
  }
}

export function removeServerLock() {
  try {
    const lock = readServerLock()
    if (lock && lock.pid !== process.pid) return false
    fs.rmSync(LOCK_PATH, { force: true })
    return true
  } catch {
    return false
  }
}
