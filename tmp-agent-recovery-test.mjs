// TEMPORARY verification for the reliability fixes.
//
// Drives the REAL runAgent against a scripted stand-in for Groq (no MongoDB,
// no socket) and asserts:
//   A. a dedicated AI naming call produces a kebab-case name, and the framework
//      fallback is used when it fails — never words from the prompt;
//   B. repeated 400 "Failed to parse tool call arguments as JSON" errors do NOT
//      abort the task: two same-model retries at lower temperature, then a model
//      switch, all announced in the feed, and the task finishes;
//   C. the model's PLAN is captured, append_to_file writes part 2 of a file, and
//      a premature "done" is rejected until every planned file exists on disk;
//   D. a short 429 retry-after is waited out with a live countdown and the same
//      request is retried automatically.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 4977
const BASE = `http://127.0.0.1:${PORT}`

process.env.GROQ_BASE_URL = BASE

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) passed += 1
  else failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const PLAN = ['index.html', 'about.html', 'contact.html', 'style.css', 'script.js']
const INDEX_PART1 =
  '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Home</title>\n'
const INDEX_PART2 =
  '<link rel="stylesheet" href="style.css">\n</head>\n<body>\n<a href="about.html">About</a>\n<a href="contact.html">Contact</a>\n<script src="script.js"></script>\n</body>\n</html>\n'
const STYLE = 'body { font-family: system-ui; }\n'
const SCRIPT = "console.log('ok')\n"
const ABOUT = '<!doctype html><title>About</title><a href="index.html">Home</a>\n'
const CONTACT = '<!doctype html><title>Contact</title><a href="index.html">Home</a>\n'

const create = (file, content) => ({ name: 'create_file', args: { path: file, content } })
const append = (file, content) => ({ name: 'append_to_file', args: { path: file, content } })

const SCRIPT_STEPS = [
  { content: `PLAN: ${PLAN.join(', ')}`, tool: create('index.html', INDEX_PART1) },
  { tool: append('index.html', INDEX_PART2) },
  { tool: create('style.css', STYLE) },
  { tool: create('script.js', SCRIPT) },
  { content: 'Done — created the site.' },
  { tool: create('about.html', ABOUT) },
  { tool: create('contact.html', CONTACT) },
  { content: 'All done — the three-page site is complete.' },
]

const mockState = {
  mode: 'recovery',
  parseBudget: 3,
  rateBudget: 2,
  parseForever: false,
  singleModel: false,
  chatCalls: 0,
  modelCalls: 0,
  lastMessages: [],
  models: [],
}

function toolCallMessage(step, id) {
  const message = { role: 'assistant', content: step.content ?? null }
  if (step.tool) {
    message.tool_calls = [
      {
        id,
        type: 'function',
        function: { name: step.tool.name, arguments: JSON.stringify(step.tool.args) },
      },
    ]
  }
  return message
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, BASE)
  if (req.method === 'GET' && url.pathname.endsWith('/models')) {
    mockState.modelCalls += 1
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        object: 'list',
        data: (mockState.singleModel
          ? ['llama-3.1-8b-instant']
          : ['llama-3.1-8b-instant', 'openai/gpt-oss-120b']
        ).map((id) => ({ id, object: 'model', owned_by: 'groq' })),
      }),
    )
    return
  }
  if (req.method !== 'POST' || !url.pathname.endsWith('/chat/completions')) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'not found' } }))
    return
  }

  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    mockState.chatCalls += 1
    let parsed = {}
    try {
      parsed = JSON.parse(body)
    } catch {}

    const send = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(payload))
    }

    if (!Array.isArray(parsed.tools)) {
      send(200, {
        id: 'naming',
        model: parsed.model,
        choices: [{ message: { role: 'assistant', content: 'three-page-static-website' } }],
      })
      return
    }

    const messages = parsed.messages ?? []
    mockState.lastMessages = messages
    mockState.models.push(parsed.model)

    if (mockState.parseForever) {
      send(400, {
        error: {
          message: 'Failed to parse tool call arguments as JSON',
          code: 'tool_use_failed',
          failed_generation: '{"path":"index.html","content":"<!doctype html>...',
        },
      })
      return
    }

    if (mockState.mode === 'ratelimit' && mockState.rateBudget > 0) {
      mockState.rateBudget -= 1
      res.writeHead(429, { 'Content-Type': 'application/json', 'retry-after': '1' })
      res.end(JSON.stringify({ error: { message: 'Rate limit reached. Please try again in 1s.' } }))
      return
    }

    if (mockState.mode === 'recovery' && mockState.parseBudget > 0) {
      mockState.parseBudget -= 1
      send(400, {
        error: {
          message: 'Failed to parse tool call arguments as JSON',
          code: 'tool_use_failed',
          failed_generation: '{"path":"index.html","content":"<!doctype html>...',
        },
      })
      return
    }

    const assistantCount = messages.filter((message) => message?.role === 'assistant').length
    const step = SCRIPT_STEPS[assistantCount] ?? { content: 'All done.' }
    const message = toolCallMessage(step, `call_${assistantCount + 1}`)
    send(200, {
      id: `chatcmpl-${mockState.chatCalls}`,
      model: parsed.model,
      choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
    })
  })
})

async function main() {
  await new Promise((resolve) => server.listen(PORT, resolve))

  const { runAgent, suggestProjectName, isToolCallParseError, resolveModelPlan } = await import(
    './server/src/services/agentService.js'
  )
  const { chooseScratchProjectName } = await import(
    './server/src/services/scratchProjectService.js'
  )
  const { ensureScratchWorkspace, getWorkspacePath, deleteWorkspaceFolder, readFileFromWorkspace } =
    await import('./server/src/utils/workspaceManager.js')
  const { hasResumableSession } = await import('./server/src/services/agentSessionService.js')

  // ---- A. naming ---------------------------------------------------------
  const aiName = await suggestProjectName({
    apiKeys: [{ plain: 'gsk_test', label: 'test', id: 'k1' }],
    task: 'ek website banao jisme teen page hon',
  })
  check('A: AI naming call returns a kebab-case slug', aiName === 'three-page-static-website', String(aiName))
  check(
    'A: framework fallback name is safe (no prompt words)',
    chooseScratchProjectName({ modelSuggestedName: null, framework: 'html' }) === 'html-project',
  )
  check(
    'A: model suggestion wins over the fallback',
    chooseScratchProjectName({ modelSuggestedName: 'portfolio-site', framework: 'html' }) ===
      'portfolio-site',
  )
  check(
    'A: parse-error detector recognises the Groq 400 shape',
    isToolCallParseError({
      status: 400,
      message: 'Failed to parse tool call arguments as JSON',
      code: 'tool_use_failed',
    }),
  )

  // ---- A2. model preference order ----------------------------------------
  const autoModels = await resolveModelPlan([{ plain: 'gsk_test', label: 'test', id: 'k1' }])
  check(
    'A2: Auto puts llama-3.1-8b-instant first',
    autoModels[0] === 'llama-3.1-8b-instant',
    autoModels.join(', '),
  )
  const pinned = await resolveModelPlan([{ plain: 'gsk_test', label: 'test', id: 'k1' }], {
    preferredModel: 'openai/gpt-oss-120b',
  })
  check('A2: an explicit model choice is honoured first', pinned[0] === 'openai/gpt-oss-120b', pinned.join(', '))

  // ---- B/C. parse recovery, plan, append, verify -------------------------
  mockState.mode = 'recovery'
  mockState.parseBudget = 3
  mockState.models = []
  const projectId = 'scratch-recoverytest'
  ensureScratchWorkspace(projectId)
  const events = []
  const result = await runAgent({
    projectId,
    task:
      'Ek modern responsive 3-page static site banao (Home, About, Contact) navbar footer hero cards testimonial FAQ accordion aur contact form ke saath',
    framework: 'html',
    apiKeys: [{ plain: 'gsk_test', label: 'test', id: 'k1' }],
    emit: (event) => events.push(event),
  })

  const malformed = events.filter(
    (event) => event.type === 'note' && /malformed/i.test(event.description),
  )
  check('B: the malformed tool call is retried, not fatal', malformed.length === 2, String(malformed.length))
  const switched = events.find(
    (event) => event.type === 'fallback' && /switching to openai\/gpt-oss-120b/.test(event.description),
  )
  check('B: after retries it switches to the next model', Boolean(switched), switched?.description)
  check('B: the run completes instead of aborting', result.toolCalls > 0 && !result.limitReached)

  const planEvent = events.find((event) => event.type === 'plan')
  check('C: the PLAN line is captured and shown', Boolean(planEvent) && /Planned 5/.test(planEvent.description), planEvent?.description)
  const appendEvent = events.find(
    (event) => event.type === 'append_to_file' && /part 2/.test(event.description),
  )
  check('C: append_to_file streams as "Writing index.html (part 2)"', Boolean(appendEvent), appendEvent?.description)
  const pushedBack = events.find(
    (event) => event.type === 'note' && /still missing/.test(event.description),
  )
  check('C: a premature "done" is rejected while files are missing', Boolean(pushedBack), pushedBack?.description)

  const wsPath = getWorkspacePath(projectId)
  const allExist = PLAN.every((file) => fs.existsSync(path.join(wsPath, file)))
  check('C: every planned file exists on disk', allExist, PLAN.filter((f) => !fs.existsSync(path.join(wsPath, f))).join(', '))
  const indexContent = readFileFromWorkspace(projectId, 'index.html')
  check('C: append_to_file wrote part 2 onto part 1', indexContent === INDEX_PART1 + INDEX_PART2)

  check(
    'B: the first agent request actually used llama-3.1-8b-instant',
    mockState.models[0] === 'llama-3.1-8b-instant',
    String(mockState.models[0]),
  )

  // ---- D. rate-limit wait ------------------------------------------------
  mockState.mode = 'ratelimit'
  mockState.rateBudget = 2
  const rlProject = 'scratch-ratelimittest'
  ensureScratchWorkspace(rlProject)
  const rlEvents = []
  await runAgent({
    projectId: rlProject,
    task: 'Add a README.md',
    framework: 'html',
    apiKeys: [{ plain: 'gsk_test', label: 'test', id: 'k1' }],
    emit: (event) => rlEvents.push(event),
  })
  const waiting = rlEvents.find(
    (event) => event.type === 'note' && /Waiting \d+s for rate limit to reset/.test(event.description),
  )
  check('D: a <=60s rate limit shows a live countdown and is waited out', Boolean(waiting), waiting?.description)
  const recovered = rlEvents.find(
    (event) => event.type === 'fallback' && /Recovered after the wait/.test(event.description),
  )
  check('D: the same request is retried automatically after the wait', Boolean(recovered))

  // ---- E. resume support -------------------------------------------------
  const resumeProject = 'scratch-resumetest'
  ensureScratchWorkspace(resumeProject)
  mockState.parseForever = true
  mockState.singleModel = true
  let aborted = false
  try {
    await runAgent({
      projectId: resumeProject,
      task: 'Build a three page site',
      framework: 'html',
      apiKeys: [{ plain: 'gsk_test', label: 'test', id: 'k1' }],
      emit: () => {},
    })
  } catch {
    aborted = true
  }
  check('E: a run that cannot recover ends in an error (does not hang)', aborted)
  check('E: the session is saved for resume', hasResumableSession(resumeProject))

  mockState.parseForever = false
  mockState.singleModel = false
  mockState.parseBudget = 0
  const resumeEvents = []
  const resumeResult = await runAgent({
    projectId: resumeProject,
    task: 'continue',
    framework: 'html',
    apiKeys: [{ plain: 'gsk_test', label: 'test', id: 'k1' }],
    resume: true,
    emit: (event) => resumeEvents.push(event),
  })
  check('E: resume streams a resume note', resumeEvents.some((event) => event.type === 'resume'))
  check('E: resumed run completes', Boolean(resumeResult.message) && !resumeResult.limitReached)
  const sawContinueNote = mockState.lastMessages.some(
    (message) => message.role === 'user' && /Continue the previous task/.test(message.content ?? ''),
  )
  check('E: the saved history plus the continue note is sent to the model', sawContinueNote)

  await deleteWorkspaceFolder(projectId)
  await deleteWorkspaceFolder(rlProject)
  await deleteWorkspaceFolder(resumeProject)

  console.log(`\n${passed}/${passed + failed} checks passed`)
  server.close()
  process.exit(failed ? 1 : 0)
}

main().catch((error) => {
  console.error('FAIL:', error)
  server.close()
  process.exit(1)
})
