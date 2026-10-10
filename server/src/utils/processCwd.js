import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const HELPER_SOURCE_DIR = path.join(HERE, 'processCwd')
const HELPER_CACHE_DIR = path.join(os.tmpdir(), 'codematrix-cwdprobe')
const HELPER_SCRIPT = path.join(HELPER_CACHE_DIR, 'Get-Cwd.ps1')
const QUERY_TIMEOUT_MS = 10000

function normalizePids(pids) {
  const unique = new Set()
  for (const raw of pids ?? []) {
    const pid = Number(raw)
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) unique.add(pid)
  }
  return [...unique]
}

function ensureHelperFiles() {
  fs.mkdirSync(HELPER_CACHE_DIR, { recursive: true })
  for (const name of ['CwdProbe.cs', 'Get-Cwd.ps1']) {
    const source = path.join(HELPER_SOURCE_DIR, name)
    const target = path.join(HELPER_CACHE_DIR, name)
    const contents = fs.readFileSync(source, 'utf8')
    let current = null
    try {
      current = fs.readFileSync(target, 'utf8')
    } catch {}
    if (current !== contents) fs.writeFileSync(target, contents)
  }
}

function decodeCwd(encoded) {
  if (!encoded) return null
  try {
    const bytes = Buffer.from(encoded, 'base64')
    if (bytes.length === 0 || bytes.length % 2 !== 0) return null
    return bytes.toString('utf16le').replace(/\0+$/, '') || null
  } catch {
    return null
  }
}

function queryWithPowerShell(pids) {
  return new Promise((resolve) => {
    ensureHelperFiles()
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', HELPER_SCRIPT, '-ProcessIds', pids.join(',')],
      { timeout: QUERY_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        const found = new Map()
        if (error && !stdout) {
          resolve(found)
          return
        }
        for (const line of String(stdout ?? '').split(/\r?\n/)) {
          const [pidText, encoded] = line.split('\t')
          const pid = Number.parseInt(String(pidText ?? '').trim(), 10)
          if (!Number.isInteger(pid)) continue
          const cwd = decodeCwd(String(encoded ?? '').trim())
          if (cwd) found.set(pid, cwd)
        }
        resolve(found)
      },
    )
  })
}

function queryWithProc(pids) {
  const found = new Map()
  for (const pid of pids) {
    try {
      const cwd = fs.readlinkSync(`/proc/${pid}/cwd`)
      if (cwd) found.set(pid, cwd)
    } catch {}
  }
  return found
}

export async function readProcessCwds(pids) {
  const targets = normalizePids(pids)
  if (targets.length === 0) return new Map()
  if (process.platform !== 'win32') return queryWithProc(targets)
  try {
    return await queryWithPowerShell(targets)
  } catch {
    return new Map()
  }
}

export function isProcessAlive(pid) {
  const target = Number(pid)
  if (!Number.isInteger(target) || target <= 0) return false
  try {
    process.kill(target, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}
