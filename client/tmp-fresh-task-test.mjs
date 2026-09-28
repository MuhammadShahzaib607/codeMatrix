// TEMPORARY test (deleted after verification): the fresh-agent-task flow.
//
// Issue #1 — a brand-new task must NOT write into a generic "Scratch" folder:
//   * POST /api/workspace/scratch { task } creates the workspace DIRECTLY under
//     its final name (task-derived slug) — no Scratch container ever exists;
//   * a model that names its own folder (PROJECT_NAME line, then writes under
//     that name) is caught by the self-nesting guard, so files land at the root;
//   * a model that NEVER names the project (tool_calls with null content on the
//     first message — the case that used to defer the rename until after every
//     write) still works, because the folder was already named;
//   * an anonymous Scratch reused for a task is renamed with a true top-level
//     folder rename (fs.rename): contents survive, no copy is left behind.
//
// Issue #2 — the generated index.html's <link> / <script> references resolve
// through the live-preview server once the files are siblings in the real root.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { io } from 'socket.io-client'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const WORKSPACES = path.resolve(ROOT, 'server/workspaces')
const API = 'http://localhost:4400'
const GROQ_PORT = 5499

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) passed += 1
  else failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

function registry() {
  return JSON.parse(fs.readFileSync(path.join(WORKSPACES, '.workspaces.json'), 'utf8'))
}

function folderFor(projectId) {
  const record = registry()[projectId]
  if (!record) throw new Error(`${projectId} is not in the registry`)
  return { record, folder: path.join(WORKSPACES, record.container, record.folderName) }
}

function listTop(container) {
  const dir = path.join(WORKSPACES, container)
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []
}

function shallow(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []
}

/** Runs one agent task over the socket, returning every streamed event. */
function runAgent({ token, projectId, task, keyId, framework = 'html' }) {
  const socket = io(API, { transports: ['websocket'] })
  const events = []
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error(`agent run timed out for "${task}"`))
    }, 90000)
    socket.on('connect', () => {
      socket.emit(
        'agent:run',
        { token, projectId, task, framework, keyId },
        (ack) => {
          if (!ack?.ok) {
            clearTimeout(timer)
            socket.close()
            reject(new Error(`ack failed: ${ack?.message}`))
          }
        },
      )
    })
    socket.on('agent:action', (event) => events.push(event))
    socket.on('agent:usage', (record) => events.push({ type: '__usage', record }))
    socket.on('agent:done', (payload) => {
      clearTimeout(timer)
      socket.close()
      resolve({ events, payload })
    })
    socket.on('connect_error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

async function main() {
  // ---- servers -----------------------------------------------------------
  process.env.MOCK_GROQ_PORT = String(GROQ_PORT)
  const mock = await import(`../tmp-mock-groq-nested.mjs`)

  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(ROOT, 'server'),
    env: {
      ...process.env,
      PORT: '4400',
      GROQ_BASE_URL: `http://localhost:${GROQ_PORT}`,
      CLIENT_ORIGIN: 'http://localhost:5173',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let serverLog = ''
  let serverExit = null
  server.stdout.on('data', (chunk) => {
    serverLog += String(chunk)
  })
  server.stderr.on('data', (chunk) => {
    serverLog += String(chunk)
  })
  server.on('exit', (code) => {
    serverExit = code
  })

  const stop = () => {
    try {
      server.kill('SIGKILL')
    } catch {}
    try {
      mock.mockServer.close()
    } catch {}
  }

  try {
    const deadline = Date.now() + 30000
    for (;;) {
      if (serverExit !== null) throw new Error(`server exited (${serverExit}):\n${serverLog}`)
      if (Date.now() > deadline) throw new Error(`server did not start:\n${serverLog}`)
      try {
        const response = await fetch(`${API}/api/health`)
        if (response.ok) break
      } catch {}
      await sleep(250)
    }

    // ---- account + key ---------------------------------------------------
    const email = `fresh-${Date.now()}@example.com`
    const auth = await req('POST', '/api/auth/register', {
      name: 'Fresh Task',
      email,
      password: 'test-pass-123',
    })
    const token = auth.token
    const ownerId = auth.user.id
    const keyDoc = await req(
      'POST',
      '/api/keys',
      { key: 'gsk_mockkeyformockgroq0000000000bb', label: 'mock' },
      token,
    )
    const keyId = keyDoc.key.id
    const ownerContainer = `u-${String(ownerId).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24)}`

    // =========================================================================
    // SCENARIO A — model NAMES its project and writes files under that name
    // =========================================================================
    const taskA = 'create a todo app with localStorage'
    const openA = await req('POST', '/api/workspace/scratch', { task: taskA }, token)
    check('A: workspace is created with the task-derived name (no Scratch)', openA.name === 'todo-app', `name=${openA.name}`)
    check('A: a task-named workspace reports isScratch:false', openA.isScratch === false, String(openA.isScratch))
    check(
      'A: no generic Scratch folder exists for this user',
      !listTop(ownerContainer).some((entry) => /^scratch/i.test(entry)),
      listTop(ownerContainer).join(', '),
    )
    const beforeA = folderFor(openA.projectId)
    check('A: folder on disk is already "todo-app"', path.basename(beforeA.folder) === 'todo-app', beforeA.folder)

    const runA = await runAgent({ token, projectId: openA.projectId, task: taskA, keyId })
    check('A: agent finished ok', runA.payload?.ok === true, JSON.stringify(runA.payload?.message ?? '').slice(0, 90))

    const afterA = folderFor(openA.projectId)
    check('A: model suggestion renamed the folder to "task-tracker"', path.basename(afterA.folder) === 'task-tracker', afterA.folder)
    check('A: the rename was a RENAME, not a copy (old folder is gone)', !fs.existsSync(beforeA.folder), beforeA.folder)
    check(
      'A: files sit at the project root (flat — no nested task-tracker/)',
      JSON.stringify(shallow(afterA.folder)) === JSON.stringify(['index.html', 'script.js', 'style.css']),
      shallow(afterA.folder).join(', '),
    )
    check('A: no nested self-named folder anywhere', !fs.existsSync(path.join(afterA.folder, 'task-tracker')), 'task-tracker/task-tracker')
    check('A: no Scratch folder left in the container', !listTop(ownerContainer).some((e) => /^scratch/i.test(e)), listTop(ownerContainer).join(', '))

    const actionsA = runA.events.filter((event) => event.type !== '__usage')
    const projectEvent = actionsA.find((event) => event.type === 'project')
    const firstWriteIndex = actionsA.findIndex((event) => event.type === 'create_file')
    check('A: a project-naming event was streamed', Boolean(projectEvent), projectEvent?.description ?? '(none)')
    check(
      'A: the rename happened BEFORE the first file was written',
      Boolean(projectEvent) && actionsA.indexOf(projectEvent) < firstWriteIndex,
      `project@${actionsA.indexOf(projectEvent)} create@${firstWriteIndex}`,
    )
    const createdPaths = actionsA
      .filter((event) => event.type === 'create_file' && event.details?.status === 'done')
      .map((event) => event.details?.args?.path)
    check(
      'A: every streamed create path is root-relative (no project-name prefix)',
      createdPaths.length === 3 && createdPaths.every((p) => !/^(task-tracker|todo-app)\//.test(p)),
      createdPaths.join(', '),
    )

    // live rate-limit usage streaming (drives the AI panel's progress bar)
    const usageEvents = runA.events.filter((event) => event.type === '__usage' && event.record?.keyId === keyId)
    check('A: agent:usage snapshots streamed during the run', usageEvents.length >= 1, `${usageEvents.length} events`)
    const remainings = usageEvents.map((event) => event.record.remainingRequests)
    check(
      'A: usage numbers change as the task consumes requests',
      remainings.length >= 2 && remainings[remainings.length - 1] < remainings[0],
      remainings.join(' -> '),
    )

    // ---- issue #2: preview file linking ----------------------------------
    const previewBase = `${API}/preview/${openA.projectId}`
    const indexRes = await fetch(`${previewBase}/index.html?token=${encodeURIComponent(token)}`)
    const indexHtml = await indexRes.text()
    check('A: preview serves index.html (200, text/html)', indexRes.status === 200 && /text\/html/.test(indexRes.headers.get('content-type') ?? ''), `${indexRes.status}`)
    check('A: index.html really links style.css + script.js', /href="style\.css"/.test(indexHtml) && /src="script\.js"/.test(indexHtml))

    // A browser resolves those relative references WITHOUT the ?token=
    // query, so the preview must fall back to the path-scoped cookie it sets
    // on the document response.
    const setCookie = indexRes.headers.get('set-cookie') ?? ''
    check('A: preview sets a path-scoped cookie for relative assets', /cm_preview_/.test(setCookie) && /Path=\/preview\//.test(setCookie), setCookie.split(';')[0])
    const noAuth = await fetch(`${previewBase}/style.css`)
    check('A: a bare asset request (no token, no cookie) is refused', noAuth.status === 401, String(noAuth.status))
    const withCookie = await fetch(`${previewBase}/style.css`, {
      headers: { Cookie: setCookie.split(';')[0] },
    })
    check(
      'A: the cookie alone authenticates relative <link>/<script> requests',
      withCookie.status === 200 && /text\/css/.test(withCookie.headers.get('content-type') ?? ''),
      `${withCookie.status} ${withCookie.headers.get('content-type')}`,
    )

    const refs = [...indexHtml.matchAll(/(?:href|src)="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((ref) => !/^(https?:|\/|data:|#)/.test(ref))
    check('A: relative references found in the page', refs.includes('style.css') && refs.includes('script.js'), refs.join(', '))
    let allResolved = true
    const details = []
    for (const ref of refs) {
      const response = await fetch(`${previewBase}/${ref}?token=${encodeURIComponent(token)}`)
      const ok = response.status === 200
      allResolved = allResolved && ok
      details.push(`${ref}:${response.status}/${(response.headers.get('content-type') ?? '').split(';')[0]}`)
      if (ok && ref.endsWith('style.css')) {
        const body = await response.text()
        const onDisk = fs.readFileSync(path.join(afterA.folder, ref), 'utf8')
        if (body !== onDisk) allResolved = false
      }
    }
    check('A: every linked asset resolves in the live preview', allResolved, details.join(' '))

    const treeA = await req('GET', `/api/workspace/${openA.projectId}/tree`, null, token)
    const rootChildren = (treeA.tree?.children ?? []).map((node) => node.name).sort()
    check(
      'A: API tree is flat under the project root',
      JSON.stringify(rootChildren) === JSON.stringify(['index.html', 'script.js', 'style.css']),
      rootChildren.join(', '),
    )

    // =========================================================================
    // SCENARIO B — the model NEVER names the project (first message = tool_calls)
    // =========================================================================
    const taskB = 'make a silent notes app'
    const openB = await req('POST', '/api/workspace/scratch', { task: taskB }, token)
    check('B: workspace born as "silent-notes" (never Scratch)', openB.name === 'silent-notes', openB.name)
    const folderB = folderFor(openB.projectId).folder
    check('B: folder on disk is "silent-notes" before the run', path.basename(folderB) === 'silent-notes', folderB)

    const runB = await runAgent({ token, projectId: openB.projectId, task: taskB, keyId })
    check('B: agent finished ok', runB.payload?.ok === true, String(runB.payload?.message ?? '').slice(0, 90))
    check(
      'B: files landed at the root despite the model writing "silent-notes/..."',
      JSON.stringify(shallow(folderB)) === JSON.stringify(['index.html', 'script.js', 'style.css']),
      shallow(folderB).join(', '),
    )
    check('B: no nested silent-notes folder', !fs.existsSync(path.join(folderB, 'silent-notes')))
    check(
      'B: the workspace was never named Scratch at any point',
      path.basename(folderB) === 'silent-notes' && openB.name === 'silent-notes',
      openB.name,
    )

    // =========================================================================
    // SCENARIO C — an ANONYMOUS Scratch is reused for a task (rename must be a
    // true folder rename that keeps existing contents)
    // =========================================================================
    const openC = await req('POST', '/api/workspace/scratch', {}, token)
    check('C: plain open still returns an anonymous Scratch', openC.name === 'Scratch' && openC.isScratch === true, `${openC.name}/${openC.isScratch}`)
    const scratchFolder = folderFor(openC.projectId).folder
    check('C: Scratch folder exists on disk', path.basename(scratchFolder) === 'Scratch', scratchFolder)
    await req(
      'PUT',
      `/api/workspace/${openC.projectId}/file`,
      { path: 'keep-me.txt', content: 'pre-existing content\n' },
      token,
    )

    const taskC = 'add a readme file please'
    const runC = await runAgent({ token, projectId: openC.projectId, task: taskC, keyId })
    check('C: agent finished ok', runC.payload?.ok === true, String(runC.payload?.message ?? '').slice(0, 90))

    const afterC = folderFor(openC.projectId)
    check('C: pre-run adoption renamed Scratch -> readme-file', path.basename(afterC.folder) === 'readme-file', afterC.folder)
    check('C: the old Scratch folder is gone (rename, not copy)', !fs.existsSync(scratchFolder), scratchFolder)
    check('C: pre-existing file survived the rename', fs.readFileSync(path.join(afterC.folder, 'keep-me.txt'), 'utf8') === 'pre-existing content\n')
    check('C: new README.md sits beside it', fs.existsSync(path.join(afterC.folder, 'README.md')))
    const projectC = runC.events.find((event) => event.type === 'project')
    const firstWriteC = runC.events.findIndex((event) => event.type === 'create_file')
    check('C: naming event streamed before the first write', Boolean(projectC) && runC.events.indexOf(projectC) < firstWriteC, `project@${runC.events.indexOf(projectC)} create@${firstWriteC}`)

    console.log(`\n${passed}/${passed + failed} checks passed`)
    process.exitCode = failed ? 1 : 0
  } catch (error) {
    console.error('FAIL:', error.message)
    process.exitCode = 1
  } finally {
    stop()
  }
}

await main()
