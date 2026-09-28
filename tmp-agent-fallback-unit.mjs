import { deriveProjectName, runAgent } from './server/src/services/agentService.js'
import { getKeyHealth } from './server/src/services/usageService.js'

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) passed += 1
  else failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const MODELS = ['llama-3.1-8b-instant']
const FINAL_ASSISTANT = { role: 'assistant', content: 'Task complete.' }

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

function stub({ chat }) {
  let chatCalls = 0
  global.fetch = async (url) => {
    if (String(url).endsWith('/models')) {
      return jsonResponse({ object: 'list', data: MODELS.map((id) => ({ id })) })
    }
    chatCalls += 1
    return chat(chatCalls)
  }
  return () => chatCalls
}

async function run(apiKeys) {
  const events = []
  let result = null
  let error = null
  try {
    result = await runAgent({
      projectId: 'unit-test-workspace',
      task: 'do a thing',
      framework: 'html',
      apiKeys,
      emit: (event) => events.push(event),
    })
  } catch (caught) {
    error = caught
  }
  return { result, error, events }
}

async function main() {
  check('derive: returns a slug', deriveProjectName('Create a todo app with localStorage') === 'create-a')
  check('derive: empty -> fallback', deriveProjectName('   ') === 'my-project')

  // A) every candidate 429s with a SHORT retry-after -> waits for the reset,
  //    then automatically resumes the same task. Succeed on the 5th call,
  //    i.e. after both keys were cooled once.
  stub({
    chat: (n) => {
      if (n >= 5) return jsonResponse({ choices: [{ message: { ...FINAL_ASSISTANT } }], usage: { total_tokens: 10 } })
      return jsonResponse(
        { error: { message: 'Rate limit reached. Please try again in 0.2s.' } },
        { status: 429, headers: { 'Retry-After': '0.2' } },
      )
    },
  })
  const startedAt = Date.now()
  const all429 = await run([
    { id: 'a', label: 'one', plain: 'gsk_unitkeyone000000000000000001' },
    { id: 'b', label: 'two', plain: 'gsk_unitkeytwo000000000000000002' },
  ])
  check('A: run recovers after waiting for the reset', all429.error === null, all429.error?.message)
  check('A: returns the model answer', /Task complete/.test(all429.result?.message ?? ''), all429.result?.message)
  check('A: a wait/countdown note streamed', all429.events.some((event) => /Waiting for reset:|cooling down/.test(event.description)), all429.events.map((e) => e.description).join(' | ').slice(0, 200))
  check('A: it actually waited', Date.now() - startedAt >= 200)

  // B) a transient 5xx is retried once (same candidate) before giving up.
  let calls = 0
  stub({
    chat: () => {
      calls += 1
      if (calls === 1) return jsonResponse({ error: { message: 'upstream' } }, { status: 503 })
      return jsonResponse({ choices: [{ message: { ...FINAL_ASSISTANT } }], usage: { total_tokens: 10 } })
    },
  })
  const transient = await run([{ id: 'c', label: 'one', plain: 'gsk_unitkeyone000000000000000001' }])
  check('B: transient error is retried and succeeds', transient.error === null && /Task complete/.test(transient.result?.message ?? ''))
  check('B: a retry note streamed', transient.events.some((event) => /retrying once/.test(event.description)))
  check('B: only one transient retry was needed', calls === 2, String(calls))

  // C) a 401 marks the key invalid and the run switches to the next key.
  let authCalls = 0
  stub({
    chat: () => {
      authCalls += 1
      if (authCalls === 1) return jsonResponse({ error: { message: 'invalid api key' } }, { status: 401 })
      return jsonResponse({ choices: [{ message: { ...FINAL_ASSISTANT } }], usage: { total_tokens: 10 } })
    },
  })
  const invalid = await run([
    { id: 'bad', label: 'bad', plain: 'gsk_badkey0000000000000000000000001' },
    { id: 'good', label: 'good', plain: 'gsk_goodkey0000000000000000000000002' },
  ])
  check('C: run continues on the next key after a 401', invalid.error === null && /Task complete/.test(invalid.result?.message ?? ''))
  check('C: the rejected key is marked invalid', getKeyHealth('bad').status === 'invalid', getKeyHealth('bad').status)
  check('C: a switch note streamed', invalid.events.some((event) => /rejected its key/.test(event.description)))

  console.log(`\n${passed}/${passed + failed} checks passed`)
  process.exit(failed ? 1 : 0)
}

main().catch((error) => {
  console.error('FAIL:', error)
  process.exit(1)
})
