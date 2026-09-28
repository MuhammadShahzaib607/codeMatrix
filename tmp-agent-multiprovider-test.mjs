import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 4983
const BASE = `http://127.0.0.1:${PORT}`

process.env.GROQ_BASE_URL = BASE
process.env.MISTRAL_BASE_URL = BASE

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) passed += 1
  else failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const PLAN = ['index.html', 'about.html', 'contact.html', 'style.css', 'script.js']
const bigLines = (n) =>
  Array.from({ length: n }, (_, i) => `<div class="card" data-i="${i}">hero ${i}</div>`).join('\n')
const INDEX_PART1 = `<!doctype html>\n<html><head><title>Home</title>\n${bigLines(120)}\n`
const INDEX_PART2 = '<link rel="stylesheet" href="style.css">\n</head><body><script src="script.js"></script></body></html>\n'

const create = (file, content) => ({ name: 'create_file', args: { path: file, content } })
const append = (file, content) => ({ name: 'append_to_file', args: { path: file, content } })

const STEPS = [
  {
    content: `PLAN: project_name=three-page-static-website\nFILES: ${PLAN.join(', ')}`,
    tool: create('index.html', INDEX_PART1),
  },
  { tool: append('index.html', INDEX_PART2) },
  { tool: create('style.css', 'body { font-family: system-ui; }\n') },
  { tool: create('script.js', "console.log('ok')\n") },
  { tool: create('about.html', '<!doctype html><title>About</title>\n') },
  { tool: create('contact.html', '<!doctype html><title>Contact</title>\n') },
  { content: 'All done.' },
]

const mockState = {
  requests: [],
  models: [],
  failMistral: false,
  usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
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
  const send = (status, payload, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
    res.end(JSON.stringify(payload))
  }
  if (req.method === 'GET' && url.pathname.endsWith('/models')) {
    const auth = String(req.headers.authorization ?? '')
    const ids = /msk_/.test(auth)
      ? ['mistral-large-latest', 'mistral-embed', 'mistral-ocr-latest', 'pixtral-12b-2409']
      : ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b']
    send(200, { object: 'list', data: ids.map((id) => ({ id, object: 'model' })) })
    return
  }
  if (req.method !== 'POST' || !url.pathname.endsWith('/chat/completions')) {
    send(404, { error: { message: 'not found' } })
    return
  }
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    let parsed = {}
    try {
      parsed = JSON.parse(body)
    } catch {}
    const auth = String(req.headers.authorization ?? '')
    const isMistral = /msk_/.test(auth)
    mockState.requests.push({ provider: isMistral ? 'mistral' : 'groq', model: parsed.model, auth, messages: parsed.messages ?? [] })
    mockState.models.push(parsed.model)

    if (isMistral && mockState.failMistral) {
      send(
        429,
        { error: { message: 'Rate limit exceeded' } },
        { 'Retry-After': '0', 'x-ratelimit-limit-tokens': '500000', 'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '3s' },
      )
      return
    }

    const assistantCount = (parsed.messages ?? []).filter((m) => m?.role === 'assistant').length
    const step = STEPS[assistantCount] ?? { content: 'All done.' }
    const message = toolCallMessage(step, `call_${assistantCount + 1}`)
    send(200, {
      id: 'chatcmpl-test',
      model: parsed.model,
      choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
      usage: mockState.usage,
    })
  })
})

async function main() {
  await new Promise((resolve) => server.listen(PORT, resolve))

  const { runAgent } = await import('./server/src/services/agentService.js')
  const { ensureScratchWorkspace, deleteWorkspaceFolder, getWorkspacePath } = await import(
    './server/src/utils/workspaceManager.js'
  )
  const { normalizeMessagesForProvider } = await import('./server/src/services/providerClient.js')
  const { recordUsageEvent, getUsageSummary, recordObservedHeaders, getTaskTotals } = await import(
    './server/src/services/usageService.js'
  )
  const { isAllowedModel, PROVIDERS, DEFAULT_PROVIDER_ORDER } = await import('./server/src/config/providers.js')

  // ---- 1. provider list + allowlist ------------------------------------
  check(
    '1: only groq and mistral providers exist',
    DEFAULT_PROVIDER_ORDER.join(',') === 'mistral,groq' && Object.keys(PROVIDERS).join(',') === 'groq,mistral',
    DEFAULT_PROVIDER_ORDER.join(','),
  )
  check('1: mistral model choices are the expected three', PROVIDERS.mistral.toolCapableModels.join(',') === 'mistral-large-latest,mistral-small-latest,codestral-latest')
  check('1: excluded models are not allowed', !isAllowedModel('mistral', 'mistral-embed') && !isAllowedModel('mistral', 'mistral-ocr-latest') && !isAllowedModel('mistral', 'pixtral-12b-2409'))
  check('1: tool-capable mistral models are allowed', isAllowedModel('mistral', 'mistral-large-latest') && isAllowedModel('mistral', 'codestral-latest'))
  check('1: cerebras/gemini are gone', !('cerebras' in PROVIDERS) && !('gemini' in PROVIDERS))

  // ---- 2. normalizeMessagesForProvider --------------------------------
  const raw = [
    { role: 'system', content: 'S1' },
    { role: 'assistant', content: 'hi' },
    { role: 'user', content: 'task' },
    { role: 'system', content: 'S2' },
    { role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'create_file', arguments: { path: 'a.js', content: 'x' } } }] },
    { role: 'tool', tool_call_id: 'call_1', content: 'ok' },
    { role: 'user', content: 'corrective note' },
    { role: 'assistant', content: 'done' },
  ]
  const out = normalizeMessagesForProvider(raw, 'mistral')
  check('2: exactly one system message, first', out.filter((m) => m.role === 'system').length === 1 && out[0].role === 'system')
  check('2: system parts are merged', out[0].content.includes('S1') && out[0].content.includes('S2'))
  const toolIdx = out.findIndex((m) => m.role === 'tool')
  check('2: no user message directly after tool messages', out[toolIdx + 1]?.role !== 'user', out[toolIdx + 1]?.role)
  check('2: corrective note folded into the tool result', /corrective note/.test(String(out[toolIdx].content)))
  check('2: history never ends with an assistant message', out[out.length - 1].role !== 'assistant', out[out.length - 1].role)
  const call = out.find((m) => Array.isArray(m.tool_calls))?.tool_calls?.[0]
  check('2: mistral tool_call id is 9 alphanumeric chars', /^[a-zA-Z0-9]{9}$/.test(call.id), call.id)
  const toolMsg = out.find((m) => m.role === 'tool')
  check('2: tool message id matches the remapped tool_call id', toolMsg.tool_call_id === call.id, `${toolMsg.tool_call_id} vs ${call.id}`)
  check('2: arguments are a JSON string', typeof call.function.arguments === 'string')

  const orphan = normalizeMessagesForProvider(
    [
      { role: 'system', content: 's' },
      { role: 'assistant', tool_calls: [{ id: 'call_x', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_unknown', content: 'orphan' },
      { role: 'user', content: 'go on' },
    ],
    'groq',
  )
  check('2: orphan tool messages dropped', !orphan.some((m) => m.content === 'orphan'))
  check('2: missing tool result filled in', orphan.some((m) => m.role === 'tool' && m.tool_call_id === 'call_x'))

  // ---- 3. usage ledger math -------------------------------------------
  recordUsageEvent({ keyId: 'k1', provider: 'mistral', model: 'mistral-large-latest', usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } })
  recordUsageEvent({ keyId: 'k1', provider: 'mistral', model: 'mistral-large-latest', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
  const summary = getUsageSummary({ keyId: 'k1', provider: 'mistral', model: 'mistral-large-latest' })
  check('3: tokensLastMinute sums the ledger', summary.tokensLastMinute === 165, String(summary.tokensLastMinute))
  check('3: requestsLastMinute counts events', summary.requestsLastMinute === 2, String(summary.requestsLastMinute))
  check('3: tokensThisMonth sums events', summary.tokensThisMonth === 165, String(summary.tokensThisMonth))
  check('3: mistral limits use the documented defaults', summary.limits.tpm === 500000 && summary.limits.monthlyTokens === 1000000000)
  check('3: local counting is flagged', summary.countedLocally === true)

  recordObservedHeaders({
    keyId: 'k2',
    provider: 'groq',
    model: 'llama-3.1-8b-instant',
    headers: new Headers({
      'x-ratelimit-limit-tokens': '6000',
      'x-ratelimit-remaining-tokens': '1000',
      'x-ratelimit-reset-tokens': '30s',
    }),
  })
  const observed = getUsageSummary({ keyId: 'k2', provider: 'groq', model: 'llama-3.1-8b-instant' })
  check('3: observed limits override defaults', observed.limits.tpm === 6000, String(observed.limits.tpm))
  check('3: provider remaining is kept separate from the ledger', observed.providerReported.remainingTokens === 1000 && observed.tokensThisMonth === 0)
  check('3: observed limits clear the local-counting flag', observed.countedLocally === false)

  // ---- 4. groq-only run completes -------------------------------------
  mockState.requests = []
  mockState.models = []
  mockState.failMistral = false
  const projectA = 'scratch-groqonly'
  ensureScratchWorkspace(projectA)
  const eventsA = []
  let usageA = null
  const resultA = await runAgent({
    projectId: projectA,
    task: 'Build a 3-page static site',
    framework: 'html',
    apiKeys: [{ id: 'g1', label: 'groq', provider: 'groq', plain: 'gsk_test' }],
    emit: (event) => eventsA.push(event),
    emitUsage: (payload) => {
      usageA = payload
    },
    taskId: 'task-groq',
  })
  const wsA = getWorkspacePath(projectA)
  check('4: groq-only run completes', Boolean(resultA.message) && !resultA.limitReached, resultA.message)
  check('4: every file was created', PLAN.every((file) => fs.existsSync(path.join(wsA, file))))
  check('4: only groq models were requested', mockState.requests.every((r) => r.provider === 'groq'))
  check('4: usage:update carried a summary + task totals', Boolean(usageA?.summary) && usageA.task?.totalTokens > 0, JSON.stringify({ used: usageA?.summary?.tokensLastMinute, task: usageA?.task?.totalTokens }))
  check('4: tool-call ids on groq are untouched (call_N)', mockState.requests.every((r) => r.messages.filter((m) => m.role === 'assistant' && m.tool_calls).every((m) => /^call_\d+$/.test(m.tool_calls[0].id))))

  // ---- 5. mistral first, 429 -> groq fallback -------------------------
  mockState.requests = []
  mockState.models = []
  mockState.failMistral = true
  const projectB = 'scratch-fallback'
  ensureScratchWorkspace(projectB)
  const eventsB = []
  const resultB = await runAgent({
    projectId: projectB,
    task: 'Build a 3-page static site',
    framework: 'html',
    apiKeys: [
      { id: 'm1', label: 'mistral', provider: 'mistral', plain: 'msk_test' },
      { id: 'g2', label: 'groq', provider: 'groq', plain: 'gsk_test' },
    ],
    providerPreference: 'mistral',
    emit: (event) => eventsB.push(event),
    taskId: 'task-fallback',
  })
  const fallbackNote = eventsB.find((event) => event.type === 'fallback')
  check('5: Mistral is tried first', mockState.requests[0]?.provider === 'mistral', mockState.requests[0]?.provider)
  check('5: a fallback note names the limit and the switch', /Mistral per-minute limit reached, switching to Groq \(/.test(fallbackNote?.description ?? ''), fallbackNote?.description)
  check('5: the fallback event reports the new provider/model', fallbackNote?.details?.provider === 'groq' && Boolean(fallbackNote?.details?.model), JSON.stringify(fallbackNote?.details))
  check('5: the run continues on groq after the 429', resultB.provider === 'groq' && Boolean(resultB.message), `${resultB.provider} / ${resultB.message}`)

  // ---- 6. replay of groq-style ids to mistral gets remapped -----------
  mockState.requests = []
  mockState.models = []
  mockState.failMistral = false
  const projectC = 'scratch-mistral'
  ensureScratchWorkspace(projectC)
  const resultC = await runAgent({
    projectId: projectC,
    task: 'Build a 3-page static site',
    framework: 'html',
    apiKeys: [{ id: 'm2', label: 'mistral', provider: 'mistral', plain: 'msk_test' }],
    providerPreference: 'mistral',
    emit: () => {},
    taskId: 'task-mistral',
  })
  check('6: mistral run completes', Boolean(resultC.message), resultC.message)
  const mistralRequests = mockState.requests.filter((r) => r.provider === 'mistral')
  const ids = []
  for (const request of mistralRequests) {
    for (const message of request.messages) {
      if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
        for (const call of message.tool_calls) ids.push(call.id)
      }
      if (message.role === 'tool') ids.push(message.tool_call_id)
    }
  }
  check('6: every mistral tool_call id is 9 alphanumeric chars', ids.length > 0 && ids.every((id) => /^[a-zA-Z0-9]{9}$/.test(id)), ids.slice(0, 6).join(','))
  const firstTool = mistralRequests.at(-1)?.messages
  check(
    '6: every assistant tool_call has a matching tool result (no user between)',
    (() => {
      let pending = null
      for (const message of firstTool ?? []) {
        if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length) {
          pending = message.tool_calls[0].id
          continue
        }
        if (message.role === 'tool' && message.tool_call_id === pending) pending = null
        else if (message.role === 'user' && pending) return false
      }
      return true
    })(),
  )
  check('6: task totals kept increasing', (getTaskTotals('task-mistral')?.totalTokens ?? 0) > 0, JSON.stringify(getTaskTotals('task-mistral')))

  await deleteWorkspaceFolder(projectA)
  await deleteWorkspaceFolder(projectB)
  await deleteWorkspaceFolder(projectC)

  console.log(`\n${passed}/${passed + failed} checks passed`)
  server.close()
  process.exit(failed ? 1 : 0)
}

main().catch((error) => {
  console.error('FAIL:', error)
  server.close()
  process.exit(1)
})
