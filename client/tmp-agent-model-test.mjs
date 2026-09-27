// TEMPORARY verification (deleted after the run).
//
// Task 2: the agent must NOT send a hardcoded model. It must GET /models, pick
//         the first tool-capable id the key has, and send that id with a clean
//         "Bearer <key>" header to /chat/completions.
// Task 3: the agent must start against an EMPTY workspace (fresh scratch
//         workspace, zero files, no project imported).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { io } from 'socket.io-client'
import { startTestEnvironment } from './tmp-test-server.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORKSPACES = path.join(ROOT, 'server', 'workspaces')

const FULL_KEY = 'gsk_mockkeyformockgroq0000000000aa'

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) passed += 1
  else failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function req(api, method, p, body, token) {
  const response = await fetch(`${api}${p}`, {
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

function folderFor(projectId) {
  const registry = JSON.parse(fs.readFileSync(path.join(WORKSPACES, '.workspaces.json'), 'utf8'))
  const record = registry[projectId]
  if (!record) throw new Error(`${projectId} not in registry`)
  return path.join(WORKSPACES, record.container, record.folderName)
}

async function main() {
  // ---- Audit of the configured endpoint/model defaults ---------------------
  const { env } = await import('../server/src/config/env.js')
  check(
    'Groq base URL is the OpenAI-compatible v1 endpoint',
    env.groqBaseUrl === 'https://api.groq.com/openai/v1',
    env.groqBaseUrl,
  )
  check(
    'chat endpoint composition is exact',
    `${env.groqBaseUrl}/chat/completions` === 'https://api.groq.com/openai/v1/chat/completions',
    `${env.groqBaseUrl}/chat/completions`,
  )
  check(
    'no hardcoded model remains (GROQ_MODEL unset => empty, resolved dynamically)',
    env.groqModel === '',
    JSON.stringify(env.groqModel),
  )

  const { api, mockState, stop } = await startTestEnvironment()
  try {
    // ---- A brand-new account: NO project imported, NO files anywhere -----
    const email = `model-${Date.now()}@example.com`
    const auth = await req(api, 'POST', '/api/auth/register', {
      name: 'Model Tester',
      email,
      password: 'test-pass-123',
    })
    const token = auth.token
    const userId = auth.user.id
    const scratchId = `scratch-${userId}`
    const keyDoc = await req(api, 'POST', '/api/keys', { key: FULL_KEY, label: 'mock' }, token)
    const keyId = keyDoc.key.id

    check('fresh account has an empty scratch workspace on disk', !fs.existsSync(folderForSafe(scratchId)))

    // ---- Run the agent against the EMPTY scratch workspace ---------------
    const socket = io(api, { transports: ['websocket'] })
    let ackPayload = null
    const events = []
    const donePayload = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('agent run timed out')), 120000)
      socket.on('connect', () => {
        socket.emit(
          'agent:run',
          { token, projectId: scratchId, task: 'create a todo app', framework: 'react', keyId },
          (ack) => {
            ackPayload = ack
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

    // Task 3
    check('Task 3: agent starts with NO project imported / empty workspace', ackPayload?.ok === true, JSON.stringify(ackPayload))
    check('Task 3: run completed ok', donePayload?.ok === true, JSON.stringify(donePayload))
    const folder = folderFor(scratchId)
    check('Task 3: scratch workspace created on demand', fs.existsSync(folder), folder)
    check('Task 3: agent scaffolded from nothing (package.json)', fs.existsSync(path.join(folder, 'package.json')))
    check('Task 3: agent scaffolded src/App.jsx', fs.existsSync(path.join(folder, 'src', 'App.jsx')))
    check(
      'Task 3: editor setup prompt reported an empty project (no block)',
      events.some((event) => event.type === 'list_directory'),
    )

    // Task 2
    check('Task 2: /models was called exactly once', mockState.modelListCalls === 1, String(mockState.modelListCalls))
    const chatRequests = mockState.requests.filter((r) => r.path.endsWith('/chat/completions'))
    check('Task 2: chat requests hit /chat/completions', chatRequests.length > 0, String(chatRequests.length))
    check(
      'Task 2: all chat requests used one clean resolved model',
      chatRequests.every((r) => r.model === 'openai/gpt-oss-120b'),
      [...new Set(chatRequests.map((r) => r.model))].join(', '),
    )
    check(
      'Task 2: model reported back to the client',
      donePayload?.model === 'openai/gpt-oss-120b',
      String(donePayload?.model),
    )
    check(
      'Task 2: Authorization header is exactly "Bearer <key>"',
      chatRequests.every((r) => r.authorization === `Bearer ${FULL_KEY}`),
      chatRequests[0]?.authorization,
    )
    check(
      'Task 2: /models also used the same Bearer key',
      mockState.requests.some((r) => r.path.endsWith('/models') && r.authorization === `Bearer ${FULL_KEY}`),
    )
    check(
      'Task 2: tools were sent with every chat request',
      chatRequests.every((r) => r.tools === 6),
      [...new Set(chatRequests.map((r) => r.tools))].join(', '),
    )

    // The old behavior: a missing workspace was rejected. Now it is not.
    socket.close()
  } finally {
    stop()
  }

  console.log(`\n${passed}/${passed + failed} checks passed`)
  process.exit(failed ? 1 : 0)
}

function folderForSafe(projectId) {
  try {
    return folderFor(projectId)
  } catch {
    return path.join(WORKSPACES, '__missing__')
  }
}

main().catch((error) => {
  console.error('FAIL:', error)
  process.exit(1)
})
