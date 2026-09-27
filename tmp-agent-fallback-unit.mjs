// TEMPORARY unit test (deleted after verification). Runs the REAL agent loop
// in-process with a stubbed global.fetch so the two rate-limit terminal branches
// can be exercised deterministically without a socket or database:
//   A) every model/key 429s with a LONG Retry-After  -> final user-facing error
//   B) every combo 429s with a SHORT Retry-After     -> wait once, then succeed
import { deriveProjectName, runAgent } from './server/src/services/agentService.js'

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) passed += 1
  else failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const MODELS = ['openai/gpt-oss-120b', 'llama-3.1-8b-instant']
const FINAL = 'All available API keys/models are currently rate-limited. Please wait a moment and try again, or add another API key in Settings.'
const FINAL_ASSISTANT = { role: 'assistant', content: 'Task complete from a single unanswered request.' }

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

async function scenario({ retryAfter, succeedOnChatCall }) {
  const events = []
  let chatCalls = 0
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/models')) {
      return jsonResponse({ object: 'list', data: MODELS.map((id) => ({ id })) })
    }
    chatCalls += 1
    if (succeedOnChatCall && chatCalls >= succeedOnChatCall) {
      return jsonResponse({
        choices: [{ message: { ...FINAL_ASSISTANT } }],
      })
    }
    return jsonResponse(
      { error: { message: `Rate limit reached. Please try again in ${retryAfter}s.` } },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    )
  }

  const startedAt = Date.now()
  let result = null
  let error = null
  try {
    result = await runAgent({
      projectId: 'unit-test-workspace',
      task: 'do a thing',
      framework: 'html',
      apiKeys: [
        { id: 'a', label: 'one', plain: 'gsk_unitkeyone000000000000000001' },
        { id: 'b', label: 'two', plain: 'gsk_unitkeytwo000000000000000002' },
      ],
      emit: (event) => events.push(event),
    })
  } catch (caught) {
    error = caught
  }
  return { result, error, events, elapsedMs: Date.now() - startedAt, chatCalls }
}

async function main() {
  // ---- deriveProjectName -------------------------------------------------
  check('derive: todo app', deriveProjectName('Create a todo app with localStorage') === 'todo-app', deriveProjectName('Create a todo app with localStorage'))
  check('derive: landing page', deriveProjectName('Build a landing page with a contact form') === 'landing-page', deriveProjectName('Build a landing page with a contact form'))
  check('derive: empty -> fallback', deriveProjectName('   ') === 'my-project', deriveProjectName('   '))

  // ---- A) long Retry-After -> final error --------------------------------
  const long = await scenario({ retryAfter: 40 })
  check('A: run rejects with the final rate-limit message', long.error?.message === FINAL, long.error?.message)
  check('A: error code is RATE_LIMITED', long.error?.code === 'RATE_LIMITED', String(long.error?.code))
  check('A: an error action was emitted', long.events.some((event) => event.type === 'error'))
  check(
    'A: fallback notes streamed (key + model switches)',
    long.events.filter((event) => event.type === 'fallback').length >= 3,
    String(long.events.filter((event) => event.type === 'fallback').length),
  )
  check('A: did NOT wait on a long retry-after', long.elapsedMs < 5000, `${long.elapsedMs}ms`)

  // ---- B) short Retry-After -> wait once, then succeed -------------------
  const short = await scenario({ retryAfter: 0.3, succeedOnChatCall: 5 })
  check('B: run recovers after the short wait', short.error === null, short.error?.message)
  check('B: returns the model answer', /Task complete/.test(short.result?.message ?? ''), short.result?.message)
  check('B: it did wait ~0.3s', short.elapsedMs >= 250, `${short.elapsedMs}ms`)
  check('B: a "Recovered after the wait" note streamed', short.events.some((event) => /Recovered after the wait/.test(event.description)), '')
  check('B: model reported in the result', Boolean(short.result?.model), String(short.result?.model))

  console.log(`\n${passed}/${passed + failed} checks passed`)
  process.exit(failed ? 1 : 0)
}

main().catch((error) => {
  console.error('FAIL:', error)
  process.exit(1)
})
