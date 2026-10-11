import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const jwt = require('../server/node_modules/jsonwebtoken')
const { io } = await import(
  new URL('../client/node_modules/socket.io-client/build/esm/index.js', import.meta.url)
)

const here = path.dirname(fileURLToPath(import.meta.url))
const serverDir = path.resolve(here, '..', 'server')
const API_URL = process.env.API_URL || 'http://localhost:4000'
const OWNER_ID = 'termrootverify'

function readEnvValue(name, fallback) {
  try {
    const raw = readFileSync(path.join(serverDir, '.env'), 'utf8')
    const line = raw.split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`))
    return line ? line.slice(name.length + 1).trim() : fallback
  } catch {
    return fallback
  }
}

const workspacesRoot = readEnvValue('WORKSPACES_ROOT', '')
  ? path.resolve(readEnvValue('WORKSPACES_ROOT', ''))
  : path.join(serverDir, 'workspaces')
const containerPath = path.join(workspacesRoot, `u-${OWNER_ID}`)
const jwtSecret = readEnvValue('JWT_SECRET', 'dev-insecure-secret-change-me')
const token = jwt.sign({ id: OWNER_ID }, jwtSecret, { expiresIn: '1h' })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const results = []
function check(name, ok, detail = '') {
  results.push(Boolean(ok))
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const norm = (value) => path.resolve(String(value ?? ''))

function connect() {
  const socket = io(API_URL, { transports: ['websocket'], forceNew: true, reconnection: false })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 8000)
    socket.on('connect', () => {
      clearTimeout(timer)
      resolve(socket)
    })
    socket.on('connect_error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

function emitAck(socket, event, payload, timeout = 10000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeout)
    socket.emit(event, payload, (response) => {
      clearTimeout(timer)
      resolve(response)
    })
  })
}

function nextEvent(socket, event, predicate = null, timeout = 8000) {
  return new Promise((resolve) => {
    const handler = (payload) => {
      if (predicate && !predicate(payload)) return
      clearTimeout(timer)
      socket.off(event, handler)
      resolve(payload)
    }
    const timer = setTimeout(() => {
      socket.off(event, handler)
      resolve(null)
    }, timeout)
    socket.on(event, handler)
  })
}

async function waitFor(predicate, timeout = 8000, interval = 150) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (predicate()) return true
    await sleep(interval)
  }
  return false
}

function isProcessAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function trackErrors(socket, sink) {
  socket.on('terminal:error', (payload) => sink.push(payload?.message ?? 'unknown error'))
}

async function main() {
  const t1 = crypto.randomUUID()
  const t2 = crypto.randomUUID()
  const t3 = crypto.randomUUID()

  rmSync(containerPath, { recursive: true, force: true })
  check('container folder is deleted before the run', !existsSync(containerPath), containerPath)

  const errors = []
  const s1 = await connect()
  trackErrors(s1, errors)
  const readyP1 = nextEvent(s1, 'terminal:ready')
  const ack1 = await emitAck(s1, 'terminal:create', {
    terminalId: t1,
    token,
    projectId: 'scratch-guest',
    cols: 80,
    rows: 24,
    reattach: false,
  })
  const ready1 = await readyP1
  check('terminal:create is accepted with no project folder', ack1?.ok === true, JSON.stringify(ack1))
  check('terminal:ready arrived', Boolean(ready1), JSON.stringify(ready1))
  check(
    'the pty starts at the per-user container root, not a project folder',
    Boolean(ready1) && norm(ready1.cwd) === norm(containerPath),
    ready1?.cwd,
  )
  check('the missing container was created automatically', existsSync(containerPath))
  await sleep(1200)
  check('no [terminal error] was sent to the client', errors.length === 0, errors.join(' | '))

  const marker1 = `MARK-${Date.now()}`
  s1.emit('terminal:input', { terminalId: t1, data: `echo ${marker1}\r` })
  let out1 = ''
  s1.on('terminal:output', (payload) => {
    if (payload?.terminalId === t1) out1 += payload.data ?? ''
  })
  const sawMarker = await waitFor(() => out1.includes(marker1))
  check('the shell runs a command in the container', sawMarker, out1.replace(/\s+/g, ' ').slice(-80))

  s1.disconnect()
  await sleep(5000)

  const s2 = await connect()
  trackErrors(s2, errors)
  const attachP = nextEvent(s2, 'terminal:attach')
  const ack2 = await emitAck(s2, 'terminal:create', {
    terminalId: t1,
    token,
    reattach: true,
  })
  const attach2 = await attachP
  check(
    'reload inside the grace window reattaches the same session',
    ack2?.ok === true && ack2?.reattached === true && attach2?.reattached === true,
    JSON.stringify(ack2),
  )
  check('scrollback is replayed on reattach', String(attach2?.data ?? '').includes(marker1))

  s2.disconnect()
  console.log('... waiting out the 60s grace period ...')
  await sleep(66000)
  check('the pty process is gone after the grace period', !isProcessAlive(ready1.pid), `pid=${ready1.pid}`)

  const s3 = await connect()
  trackErrors(s3, errors)
  const lostP = nextEvent(s3, 'terminal:lost')
  const ack3 = await emitAck(s3, 'terminal:create', {
    terminalId: t1,
    token,
    reattach: true,
  })
  const lost3 = await lostP
  check(
    'reattaching after the grace period reports SESSION_LOST',
    ack3?.ok === false && ack3?.code === 'SESSION_LOST' && Boolean(lost3),
    JSON.stringify(ack3),
  )

  const readyP2 = nextEvent(s3, 'terminal:ready')
  const ack4 = await emitAck(s3, 'terminal:create', {
    terminalId: t2,
    token,
    projectId: 'scratch-guest',
    reattach: false,
  })
  const ready2 = await readyP2
  check('a new terminal opens after the grace period', ack4?.ok === true && Boolean(ready2), JSON.stringify(ack4))
  check(
    'the new terminal starts at the container root',
    Boolean(ready2) && norm(ready2.cwd) === norm(containerPath),
    ready2?.cwd,
  )
  const marker2 = `FRESH-${Date.now()}`
  let out2 = ''
  s3.on('terminal:output', (payload) => {
    if (payload?.terminalId === t2) out2 += payload.data ?? ''
  })
  s3.emit('terminal:input', { terminalId: t2, data: `echo ${marker2}\r` })
  const sawFresh = await waitFor(() => out2.includes(marker2))
  check('the new terminal runs normally', sawFresh, out2.replace(/\s+/g, ' ').slice(-80))
  check('the new terminal has no old output', !out2.includes(marker1), `len=${out2.length}`)

  s3.emit('terminal:close', { terminalId: t2 })
  await sleep(1500)
  rmSync(containerPath, { recursive: true, force: true })
  check('the container can be wiped again after the pty exits', !existsSync(containerPath))

  const readyP3 = nextEvent(s3, 'terminal:ready')
  const ack5 = await emitAck(s3, 'terminal:create', {
    terminalId: t3,
    token,
    reattach: false,
  })
  const ready3 = await readyP3
  await sleep(1200)
  check(
    'a terminal opened after a second wipe starts normally at the recreated root',
    ack5?.ok === true && Boolean(ready3) && norm(ready3.cwd) === norm(containerPath) && existsSync(containerPath),
    `${JSON.stringify(ack5)} cwd=${ready3?.cwd}`,
  )
  check('no [terminal error] at any point', errors.length === 0, errors.join(' | '))

  if (process.env.SERVER_LOG && existsSync(process.env.SERVER_LOG)) {
    const log = readFileSync(process.env.SERVER_LOG, 'utf8')
    check(
      'the recreation is written to the server log',
      log.includes('recreated the missing container'),
      'log line present',
    )
  }

  s3.emit('terminal:close', { terminalId: t1 })
  s3.emit('terminal:close', { terminalId: t3 })
  s3.disconnect()

  const passed = results.filter(Boolean).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exitCode = passed === results.length ? 0 : 1
}

main().catch((error) => {
  console.error('harness error', error)
  process.exit(1)
})
