// TEMPORARY test double (deleted after verification). A scripted stand-in for
// Groq that lets us verify:
//   1. the key + model fallback chain on 429s (Retry-After handling included)
//   2. token-usage trimming of older tool results / tool-call arguments
//   3. no hardcoded model — GET /models is called and a tool-capable id is used
//
// Rate-limit behaviour:
//   PRIMARY key   -> always 429 on BOTH models
//   SECONDARY key -> 429 on openai/gpt-oss-120b, works on llama-3.1-8b-instant
// So the chain must be: gpt-oss-120b/primary -> gpt-oss-120b/secondary ->
// llama-3.1-8b-instant/primary -> llama-3.1-8b-instant/secondary (success).
import http from 'node:http'

const PORT = Number(process.env.MOCK_GROQ_PORT || 4966)

export const PRIMARY_KEY = 'gsk_primarymockkey0000000000000000aa'
export const SECONDARY_KEY = 'gsk_secondarymockkey000000000000bb'

export const AVAILABLE_MODELS = ['openai/gpt-oss-120b', 'llama-3.1-8b-instant']

export const mockState = {
  requests: [],
  modelListCalls: 0,
  chatCalls: 0,
  rateLimited: 0,
}

const BIG_JS = `// big generated module\n${'const row = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";\n'.repeat(150)}export default row\n`

const STEPS = [
  { tool: 'list_directory', args: { path: '.' } },
  { tool: 'create_file', args: { path: 'index.html', content: '<!doctype html>\n<html><body><div id="root"></div></body></html>\n' } },
  { tool: 'create_file', args: { path: 'style.css', content: 'body { margin: 0; font-family: sans-serif; }\n' } },
  { tool: 'create_file', args: { path: 'big.js', content: BIG_JS } },
  { tool: 'read_file', args: { path: 'big.js' } },
  { tool: 'create_file', args: { path: 'app.js', content: "const todos = []\nexport default todos\n" } },
  { tool: 'edit_file', args: { path: 'app.js', content: "const todos = []\nfunction add(text) { todos.push(text) }\nexport { add }\nexport default todos\n" } },
  { tool: 'run_command', args: { command: 'echo fallback-shell-ok' } },
  { tool: 'create_file', args: { path: 'README.md', content: '# todo\n' } },
  { tool: 'edit_file', args: { path: 'README.md', content: '# Todo app\n\nBuilt by the agent.\n' } },
  { tool: 'list_directory', args: {} },
]

const FINAL_MESSAGE =
  'Done — I built the todo app in the workspace (index.html, style.css, app.js, big.js), read the large module back and verified the shell still runs. No hardcoded model was used.'

function rateLimited(res) {
  mockState.rateLimited += 1
  res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '15.79' })
  res.end(
    JSON.stringify({
      error: {
        message:
          'Rate limit reached for openai/gpt-oss-120b in organization org_x on requests per day. Please try again in 15.79s.',
        type: 'rate_limit_exceeded',
      },
    }),
  )
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const auth = req.headers.authorization ?? ''

  if (req.method === 'GET' && url.pathname.endsWith('/models')) {
    mockState.modelListCalls += 1
    mockState.requests.push({ method: 'GET', path: url.pathname, authorization: auth })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({ object: 'list', data: AVAILABLE_MODELS.map((id) => ({ id, object: 'model' })) }),
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

    const usingPrimary = auth.includes(PRIMARY_KEY)
    const usingSecondary = auth.includes(SECONDARY_KEY)
    const model = parsed?.model ?? null

    // The scripted rate-limit matrix.
    if (usingPrimary || (usingSecondary && model === 'openai/gpt-oss-120b')) {
      rateLimited(res)
      return
    }

    mockState.requests.push({
      method: 'POST',
      path: url.pathname,
      authorization: auth,
      model,
      messages: Array.isArray(parsed?.messages) ? parsed.messages : [],
    })

    if (!usingSecondary) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'unknown key' } }))
      return
    }

    const messages = parsed?.messages ?? []
    const toolResults = messages.filter((message) => message.role === 'tool').length
    const step = STEPS[toolResults]

    const message = step
      ? {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: `call_${toolResults + 1}`,
              type: 'function',
              function: { name: step.tool, arguments: JSON.stringify(step.args) },
            },
          ],
        }
      : { role: 'assistant', content: FINAL_MESSAGE }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        id: `chatcmpl-mock-${mockState.chatCalls}`,
        object: 'chat.completion',
        model: model ?? 'mock-model',
        choices: [{ index: 0, message, finish_reason: step ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }),
    )
  })
})

server.listen(PORT, () => {
  console.log(`[mock-groq-fallback] listening on http://localhost:${PORT}`)
})

export { server as mockServer }
