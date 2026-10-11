import crypto from 'node:crypto'
import fs from 'node:fs'
import { io } from 'socket.io-client'

const URL = 'http://localhost:4000'
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`)
}

function readSecret() {
  const env = fs.readFileSync('../server/.env', 'utf8')
  const line = env.split(/\r?\n/).find((entry) => entry.startsWith('JWT_SECRET='))
  return line ? line.slice('JWT_SECRET='.length).replace(/^"|"$/g, '').trim() : ''
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function mintToken(id) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify({ id, iat: Math.floor(Date.now() / 1000) }))
  const body = `${header}.${payload}`
  const signature = crypto
    .createHmac('sha256', readSecret())
    .update(body)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `${body}.${signature}`
}

function connect() {
  return new Promise((resolve, reject) => {
    const socket = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false })
    const timer = setTimeout(() => reject(new Error('connect timeout')), 8000)
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

function once(socket, event, ms = 8000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    socket.once(event, (payload) => {
      clearTimeout(timer)
      resolve(payload)
    })
  })
}

function emitAck(socket, event, payload, ms = 8000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    socket.emit(event, payload, (response) => {
      clearTimeout(timer)
      resolve(response)
    })
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const socket = await connect()

  const id1 = crypto.randomUUID()
  const readyPromise = once(socket, 'terminal:ready')
  const ack1 = await emitAck(socket, 'terminal:create', { terminalId: id1, projectId: 'scratch-guest', cols: 80, rows: 24, reattach: false })
  const ready1 = await readyPromise
  check('new session spawns', Boolean(ack1?.ok) && ready1?.terminalId === id1, JSON.stringify(ack1))

  let output = ''
  const collect = (payload) => {
    if (payload?.terminalId === id1) output += payload.data
  }
  socket.on('terminal:output', collect)
  socket.emit('terminal:input', { terminalId: id1, data: 'echo HELLO_PERSIST_MARKER\n' })
  for (let attempt = 0; attempt < 40 && !output.includes('HELLO_PERSIST_MARKER'); attempt += 1) await sleep(150)
  check('command output streams', output.includes('HELLO_PERSIST_MARKER'))
  socket.off('terminal:output', collect)

  const pongPromise = once(socket, 'terminal:pong')
  socket.emit('terminal:ping', { terminalId: id1 })
  const pong = await pongPromise
  check('heartbeat ping/pong', pong?.terminalId === id1)

  socket.disconnect()
  await sleep(300)

  const socket2 = await connect()
  const attachPromise = once(socket2, 'terminal:attach')
  const ack2 = await emitAck(socket2, 'terminal:create', { terminalId: id1, projectId: 'scratch-guest', cols: 80, rows: 24, reattach: true })
  const attach = await attachPromise
  check('reattach after disconnect', Boolean(ack2?.ok) && ack2?.reattached === true, JSON.stringify(ack2))
  check('replayed scrollback contains prior output', typeof attach?.data === 'string' && attach.data.includes('HELLO_PERSIST_MARKER'), `bytes=${attach?.data?.length ?? 0}`)
  socket2.disconnect()
  await sleep(300)

  const socket3 = await connect()
  const lostPromise = once(socket3, 'terminal:lost')
  const ack3 = await emitAck(socket3, 'terminal:create', { terminalId: crypto.randomUUID(), projectId: 'scratch-guest', reattach: true })
  const lost = await lostPromise
  check('unknown reattach reports session lost', Boolean(lost) && ack3?.code === 'SESSION_LOST', JSON.stringify(ack3))
  socket3.disconnect()
  await sleep(200)

  const token = mintToken('task1-verify-user')
  const socket4 = await connect()
  const exits = []
  socket4.on('terminal:exit', (payload) => exits.push(payload))
  const limitIds = []
  for (let index = 0; index < 6; index += 1) {
    const terminalId = crypto.randomUUID()
    limitIds.push(terminalId)
    await emitAck(socket4, 'terminal:create', { terminalId, projectId: 'scratch-guest', token, cols: 80, rows: 24 })
  }
  await sleep(1200)
  check('per-user limit closes the oldest session', exits.length >= 1, `exits=${exits.length} oldestKilled=${exits.some((entry) => entry.terminalId === limitIds[0])}`)
  for (const terminalId of limitIds) socket4.emit('terminal:close', { terminalId })
  socket4.disconnect()

  const passed = results.filter((entry) => entry.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exit(passed === results.length ? 0 : 1)
}

main().catch((error) => {
  console.error('harness error', error)
  process.exit(1)
})
