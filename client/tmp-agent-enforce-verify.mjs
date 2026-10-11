import crypto from 'node:crypto'
import fs from 'node:fs'
import { io } from 'socket.io-client'

const URL = 'http://localhost:4000'
const results = []
function check(name, ok, detail = '') {
  results.push(ok)
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
  const signature = crypto.createHmac('sha256', readSecret()).update(body).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
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

function emitAck(socket, event, payload, ms = 10000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    socket.emit(event, payload, (response) => {
      clearTimeout(timer)
      resolve(response)
    })
  })
}

async function main() {
  const socket = await connect()
  const token = mintToken(`enforce-${crypto.randomUUID()}`)

  const attach = await emitAck(socket, 'agent:attach', { token })
  check('non-admin can attach to the agent channel', attach?.ok === true, JSON.stringify(attach))

  const reactRun = await emitAck(socket, 'agent:run', {
    token,
    projectId: 'scratch-guest',
    task: 'build a react app',
    framework: 'react',
  })
  check('non-admin non-vanilla stack rejected 403', reactRun?.ok === false && reactRun?.status === 403 && reactRun?.code === 'FORBIDDEN', JSON.stringify(reactRun))

  const vanillaRun = await emitAck(socket, 'agent:run', {
    token,
    projectId: 'scratch-guest',
    task: 'build a landing page',
    framework: 'html',
  })
  check('non-admin vanilla stack passes the stack gate', vanillaRun?.ok === false && vanillaRun?.code === 'NO_KEYS' && vanillaRun?.status !== 403, JSON.stringify(vanillaRun))

  socket.disconnect()

  const passed = results.filter(Boolean).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exit(passed === results.length ? 0 : 1)
}

main().catch((error) => {
  console.error('harness error', error)
  process.exit(1)
})
