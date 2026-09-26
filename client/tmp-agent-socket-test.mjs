// TEMPORARY test (deleted after verification): drives the FULL agent loop over
// Socket.IO against the live test server + scripted mock Groq — real tool
// executions on a real workspace, live agent:action streaming, final agent:done.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { io } from 'socket.io-client'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const API = process.env.TEST_API ?? 'http://localhost:4100'
const WORKSPACES = path.resolve(__dirname, '../server/workspaces')

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) passed += 1
  else failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function req(method, p, body, token) {
  const response = await fetch(`${API}${p}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`${method} ${p} -> ${response.status} ${JSON.stringify(data)}`)
  return data
}

function workspaceFolder(projectId) {
  const registry = JSON.parse(fs.readFileSync(path.join(WORKSPACES, '.workspaces.json'), 'utf8'))
  const record = registry[projectId]
  if (!record) throw new Error('project not in registry')
  return path.join(WORKSPACES, record.container, record.folderName)
}

async function main() {
  // 1. Account + project + one saved key
  const email = `agent-${Date.now()}@example.com`
  const auth = await req('POST', '/api/auth/register', {
    name: 'Agent Tester',
    email,
    password: 'test-pass-123',
  })
  const token = auth.token
  const projectId = crypto.randomUUID()
  await req(
    'POST',
    `/api/workspace/${projectId}/import`,
    { name: 'agent-e2e', files: [{ relativePath: 'README.md', content: '# agent test' }] },
    token,
  )
  const keyDoc = await req('POST', '/api/keys', { key: 'gsk_mockkeyformockgroq0000000000aa', label: 'mock' }, token)
  const keyId = keyDoc.key.id
  const folder = workspaceFolder(projectId)
  check('workspace ready on disk', fs.existsSync(path.join(folder, 'README.md')), folder)

  // 2. Connect + run the agent
  const socket = io(API, { transports: ['websocket'] })
  const events = []
  const donePayload = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('agent run timed out after 120s')), 120000)
    socket.on('connect', () => {
      socket.emit(
        'agent:run',
        { token, projectId, task: 'create a todo app', framework: 'react', keyId },
        (ack) => {
          if (!ack?.ok) {
            clearTimeout(timer)
            reject(new Error(`ack failed: ${ack?.message}`))
          }
        },
      )
    })
    socket.on('agent:action', (event) => events.push(event))
    socket.on('agent:done', (payload) => {
      clearTimeout(timer)
      resolve(payload)
    })
    socket.on('connect_error', (error) => reject(error))
  })

  // 3. Streaming assertions
  check('agent:done ok', donePayload?.ok === true, JSON.stringify(donePayload))
  check('final summary received', /scaffolded the React todo app/.test(donePayload?.message ?? ''), (donePayload?.message ?? '').slice(0, 80))

  const types = events.map((event) => event.type)
  check('thinking events streamed', types.includes('thinking'))
  for (const tool of ['list_directory', 'create_file', 'edit_file', 'delete_file', 'run_command', 'read_file']) {
    check(`streamed action for ${tool}`, types.includes(tool), `${types.filter((t) => t === tool).length} events`)
  }
  check('every event has actionId + description', events.every((event) => event.actionId && event.description))
  check('a complete event was streamed', types.includes('complete'))

  // running -> done pairing for one actionId
  const createEvents = events.filter((event) => event.type === 'create_file')
  const firstId = createEvents[0]?.actionId
  const paired = createEvents.filter((event) => event.actionId === firstId)
  check(
    'running/done pair shares one actionId',
    paired.length === 2 && paired[0].details?.status === 'running' && paired[1].details?.status === 'done',
    paired.map((event) => event.details?.status).join(' -> '),
  )

  // run_command result carries the captured output
  const runDone = events.find((event) => event.type === 'run_command' && event.details?.status === 'done')
  check(
    'run_command output captured (real shell)',
    /agent-shell-works/.test(runDone?.details?.output ?? '') && runDone?.details?.exitCode === 0,
    `exit ${runDone?.details?.exitCode}, shell ${runDone?.details?.shell}`,
  )

  // 4. Real filesystem effects
  check('package.json created on disk', fs.existsSync(path.join(folder, 'package.json')))
  check('src/App.jsx created on disk', fs.existsSync(path.join(folder, 'src', 'App.jsx')))
  const appContent = fs.readFileSync(path.join(folder, 'src', 'App.jsx'), 'utf8')
  check('edit_file applied (addItem present)', /addItem/.test(appContent))
  check('delete_file removed tmp-agent.txt', !fs.existsSync(path.join(folder, 'tmp-agent.txt')))
  check('read back did not corrupt App.jsx', /export default function App/.test(appContent))

  // 5. Rejected paths
  const badAck = await new Promise((resolve) => {
    socket.emit('agent:run', { token, projectId: 'not-a-project', task: 'x' }, resolve)
  })
  check('missing workspace rejected at ack', badAck?.ok === false, badAck?.message)
  const noKeyAck = await new Promise((resolve) => {
    socket.emit('agent:run', { token: 'garbage-token', projectId, task: 'x' }, resolve)
  })
  check('bad token rejected at ack', noKeyAck?.ok === false, noKeyAck?.message)

  socket.close()
  console.log(`\n${passed}/${passed + failed} checks passed`)
  process.exit(failed ? 1 : 0)
}

main().catch((error) => {
  console.error('FAIL:', error)
  process.exit(1)
})
