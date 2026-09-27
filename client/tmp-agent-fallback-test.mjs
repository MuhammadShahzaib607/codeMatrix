// TEMPORARY integration test (deleted after verification). Drives the FULL agent
// loop over Socket.IO against the live test server + the rate-limiting mock Groq
// and verifies:
//   1. a 429 mid-task transparently falls back key-by-key, then model-by-model,
//      and the task STILL COMPLETES (no user intervention)
//   2. live feed carries 'fallback' notes and the final model indicator updates
//   3. the empty scratch workspace is RENAMED to a task-derived project name
//      ("todo-app"), gets a MongoDB Project record, and emits a 'project' event
//   4. older tool results / tool-call file bodies are trimmed from later prompts
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { io } from 'socket.io-client'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORKSPACES = path.join(ROOT, 'server', 'workspaces')
const SERVER_PORT = 4102
const GROQ_PORT = 4966
const API = `http://localhost:${SERVER_PORT}`

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

function registryRecord(projectId) {
  const registry = JSON.parse(fs.readFileSync(path.join(WORKSPACES, '.workspaces.json'), 'utf8'))
  return registry[projectId] ?? null
}

async function main() {
  process.env.MOCK_GROQ_PORT = String(GROQ_PORT)
  const mock = await import(pathToFileURL(path.join(ROOT, 'tmp-mock-groq-fallback.mjs')).href)

  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(SERVER_PORT),
      GROQ_BASE_URL: `http://localhost:${GROQ_PORT}`,
      CLIENT_ORIGIN: 'http://localhost:5173',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs = []
  let exitCode = null
  child.stdout.on('data', (chunk) => logs.push(String(chunk)))
  child.stderr.on('data', (chunk) => logs.push(String(chunk)))
  child.on('exit', (code) => {
    exitCode = code
  })

  async function stop() {
    try {
      child.kill('SIGKILL')
    } catch {}
    try {
      mock.mockServer.close()
    } catch {}
  }

  try {
    // Wait for the server.
    const deadline = Date.now() + 30000
    for (;;) {
      if (exitCode !== null) throw new Error(`server exited early (${exitCode}):\n${logs.join('')}`)
      if (Date.now() > deadline) throw new Error(`server did not start:\n${logs.join('')}`)
      try {
        const response = await fetch(`${API}/api/health`)
        if (response.ok) break
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250))
    }

    // Account + TWO saved keys (primary first, secondary second).
    const suffix = Date.now()
    const auth = await req('POST', '/api/auth/register', {
      name: 'Fallback Tester',
      email: `fallback-${suffix}@example.com`,
      password: 'test-pass-123',
    })
    const token = auth.token
    const userId = auth.user.id
    const scratchId = `scratch-${userId}`

    const primary = await req('POST', '/api/keys', { key: mock.PRIMARY_KEY, label: 'primary' }, token)
    const secondary = await req('POST', '/api/keys', { key: mock.SECONDARY_KEY, label: 'secondary' }, token)
    check('two keys saved', Boolean(primary.key.id && secondary.key.id))
    check('scratch workspace absent before the run', !registryRecord(scratchId))

    // Run the agent against the EMPTY scratch workspace, selecting the
    // rate-limited primary key first.
    const socket = io(API, { transports: ['websocket'] })
    const events = []
    let ack = null
    const done = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('agent run timed out')), 120000)
      socket.on('connect', () => {
        socket.emit(
          'agent:run',
          {
            token,
            projectId: scratchId,
            task: 'Create a todo app with localStorage',
            framework: 'html',
            keyId: primary.key.id,
          },
          (payload) => {
            ack = payload
            if (!payload?.ok) {
              clearTimeout(timer)
              reject(new Error(`ack failed: ${payload?.message}`))
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

    // ---- 1) task completed despite the 429s -------------------------------
    check('agent ack ok', ack?.ok === true, JSON.stringify(ack))
    check('task completed despite rate limits', done?.ok === true, JSON.stringify(done))
    check('final summary returned', /built the todo app/.test(done?.message ?? ''), (done?.message ?? '').slice(0, 90))

    // ---- 2) fallback activity + model indicator ---------------------------
    const fallbacks = events.filter((event) => event.type === 'fallback')
    check('fallback notes streamed to the feed', fallbacks.length >= 1, String(fallbacks.length))
    check(
      'first note switches key on the same model',
      /Rate limit hit on openai\/gpt-oss-120b with primary — switching to secondary/.test(
        fallbacks[0]?.description ?? '',
      ),
      fallbacks.map((event) => event.description).join(' | '),
    )
    check(
      'a note switches to the fallback MODEL',
      fallbacks.some((event) => /switching to llama-3\.1-8b-instant/.test(event.description)),
      fallbacks.map((event) => event.description).join(' | '),
    )
    check('model indicator ends on the working model', done?.model === 'llama-3.1-8b-instant', String(done?.model))
    check(
      'fallback events carry the model id for the header',
      fallbacks.every((event) => Boolean(event.details?.model)),
      '',
    )

    // ---- 3) scratch -> named project --------------------------------------
    const projectEvent = events.find((event) => event.type === 'project')
    check('project rename event streamed', projectEvent?.details?.name === 'todo-app', JSON.stringify(projectEvent?.details))
    const record = registryRecord(scratchId)
    check('registry folder renamed to todo-app', record?.folderName === 'todo-app', JSON.stringify(record))
    const folder = record ? path.join(WORKSPACES, record.container, record.folderName) : null
    check('renamed folder exists on disk', Boolean(folder && fs.existsSync(folder)), String(folder))
    check('old "Scratch" folder is gone', Boolean(folder && !fs.existsSync(path.join(path.dirname(folder), 'Scratch'))))
    check('task files landed in the renamed folder', Boolean(folder && fs.existsSync(path.join(folder, 'app.js'))), String(folder))
    const projects = await req('GET', '/api/projects', null, token)
    const projectRecord = (projects.projects ?? []).find((project) => project.id === scratchId)
    check('Project record created with the derived name', projectRecord?.name === 'todo-app', JSON.stringify(projectRecord))
    check('Project record carries the disk folder name', projectRecord?.diskFolderName === 'todo-app', String(projectRecord?.diskFolderName))

    // ---- 4) token trimming of older turns ---------------------------------
    const chatRequests = mock.mockState.requests.filter((request) => request.messages?.length)
    check('chat completions were recorded', chatRequests.length > 0, String(chatRequests.length))
    check(
      'older large read_file result was trimmed in later prompts',
      chatRequests.some((request) =>
        request.messages.some(
          (message) => message.role === 'tool' && String(message.content).startsWith('[Older tool result omitted'),
        ),
      ),
    )
    check(
      'big.js content was sent in FULL while recent',
      chatRequests.some((request) =>
        request.messages.some((message) =>
          (message.tool_calls ?? []).some((call) => String(call.function?.arguments ?? '').includes('const row')),
        ),
      ),
    )
    const lastRequest = chatRequests[chatRequests.length - 1]
    check(
      'older create_file body was slimmed to just the path',
      lastRequest.messages.some((message) =>
        (message.tool_calls ?? []).some((call) => call.function?.arguments === '{"path":"big.js"}'),
      ),
      'no slimmed big.js tool_call in the last request',
    )
    check(
      'every prompt stayed under a lean tool-call argument budget',
      lastRequest.messages.every((message) =>
        (message.tool_calls ?? []).every((call) => String(call.function?.arguments ?? '').length < 1200),
      ),
    )

    // ---- rate-limit accounting on the mock -------------------------------
    check('both keys were consulted for /models', mock.mockState.modelListCalls === 2, String(mock.mockState.modelListCalls))
    check('mock issued 429s for the primary key', mock.mockState.rateLimited >= 3, String(mock.mockState.rateLimited))

    socket.close()
  } finally {
    await stop()
  }

  console.log(`\n${passed}/${passed + failed} checks passed`)
  process.exit(failed ? 1 : 0)
}

main().catch(async (error) => {
  console.error('FAIL:', error)
  process.exit(1)
})
