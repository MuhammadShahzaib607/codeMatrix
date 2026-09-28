// TEMPORARY test double (deleted after verification): a scripted stand-in for
// Groq that behaves like a REAL model does when asked for a new project — it
// names its project folder and writes files UNDER that name. That is exactly
// what used to scatter a fresh agent task across a nested copy of itself.
//
// The scenario is picked from the USER TASK text, so one mock can serve several
// runs against one server:
//
//   "…todo app with localStorage"  -> the model SPEAKS FIRST with a
//       PROJECT_NAME line (a different name than the task slug!) and then
//       writes its files under that name ("task-tracker/index.html").
//   "…silent notes app"            -> the model NEVER names the project: its
//       first message is tool_calls with null content (the very common case
//       that used to defer the rename until AFTER every write), and it writes
//       its files under the task-derived slug ("silent-notes/index.html").
//   "…readme…"                     -> plain, flat writes (control scenario).
//
// Every response carries Groq's rate-limit headers so the agent's live
// 'agent:usage' stream can be asserted too.
import http from 'node:http'

const PORT = Number(process.env.MOCK_GROQ_PORT || 5499)

export const AVAILABLE_MODELS = ['llama-3.1-8b-instant', 'openai/gpt-oss-120b']

export const mockState = { requests: [], chatCalls: 0 }

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Todo</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <h1>Todos</h1>
    <ul id="list"></ul>
    <script src="script.js"></script>
  </body>
</html>
`

const STYLE_CSS = `body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; }
h1 { color: #a78bfa; }`

const SCRIPT_JS = `const KEY = 'todos';
const todos = JSON.parse(localStorage.getItem(KEY) || '[]');
const list = document.getElementById('list');
for (const todo of todos) {
  const item = document.createElement('li');
  item.textContent = todo;
  list.appendChild(item);
}
window.saveTodo = (text) => {
  todos.push(text);
  localStorage.setItem(KEY, JSON.stringify(todos));
};
`

const README = `# Notes\n\nA tiny notes app.\n`

const create = (file, content) => ({ tool: 'create_file', args: { path: file, content } })

function stepsFor(task) {
  const text = String(task ?? '').toLowerCase()
  if (text.includes('todo app with localstorage')) {
    return {
      // The model names a project DIFFERENT from the task slug and files it
      // under its own name — the double bug (nested folder) in one go.
      firstMessage: 'PROJECT_NAME: task-tracker\n\nScaffolding the todo app now.',
      writes: [
        create('task-tracker/index.html', INDEX_HTML),
        create('task-tracker/style.css', STYLE_CSS),
        create('task-tracker/script.js', SCRIPT_JS),
      ],
      final: 'Done — created the todo app with localStorage persistence (index.html, style.css, script.js).',
    }
  }
  if (text.includes('silent notes app')) {
    return {
      firstMessage: null, // tool_calls with NO content: no PROJECT_NAME line at all
      writes: [
        create('silent-notes/index.html', INDEX_HTML),
        create('silent-notes/style.css', STYLE_CSS),
        create('silent-notes/script.js', SCRIPT_JS),
      ],
      final: 'Done — built the notes app (index.html, style.css, script.js).',
    }
  }
  return {
    firstMessage: null,
    writes: [create('README.md', README)],
    final: 'Done — added a README.md to the project.',
  }
}

let requestCount = 0

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)

  if (req.method === 'GET' && url.pathname.endsWith('/models')) {
    mockState.requests.push({ method: 'GET', path: url.pathname })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        object: 'list',
        data: AVAILABLE_MODELS.map((id) => ({ id, object: 'model', owned_by: 'groq' })),
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
    requestCount += 1
    mockState.chatCalls += 1
    let parsed = {}
    try {
      parsed = JSON.parse(body)
    } catch {}

    const messages = parsed?.messages ?? []
    const task = messages.find((message) => message.role === 'user')?.content ?? ''
    const scenario = stepsFor(task)
    const toolResults = messages.filter((message) => message.role === 'tool').length
    const isFirstCall = toolResults === 0

    let message
    if (isFirstCall && scenario.firstMessage) {
      message = {
        role: 'assistant',
        content: scenario.firstMessage,
        tool_calls: [
          {
            id: `call_1`,
            type: 'function',
            function: {
              name: scenario.writes[0].tool,
              arguments: JSON.stringify(scenario.writes[0].args),
            },
          },
        ],
      }
    } else {
      // `toolResults` is exactly how many of the scenario's writes have already
      // been executed (write #0 travelled with the PROJECT_NAME line on the
      // first call, and is counted in toolResults once it comes back).
      const target = scenario.writes[toolResults]
      if (target) {
        message = {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: `call_${toolResults + 1}`,
              type: 'function',
              function: { name: target.tool, arguments: JSON.stringify(target.args) },
            },
          ],
        }
      } else {
        message = { role: 'assistant', content: scenario.final }
      }
    }

    console.log(
      `[mock-groq] #${requestCount} model=${parsed?.model} -> ${
        message.tool_calls ? message.tool_calls[0].function.name : 'final message'
      } (${toolResults} tool results so far)`,
    )

    res.writeHead(200, {
      'Content-Type': 'application/json',
      // Groq's rate-limit headers: a SMALL daily budget that visibly depletes
      // over one run, so the client's live usage bar has real numbers to draw.
      'x-ratelimit-limit-requests': '40',
      'x-ratelimit-remaining-requests': String(Math.max(0, 40 - mockState.chatCalls * 5)),
      'x-ratelimit-limit-tokens': '30000',
      'x-ratelimit-remaining-tokens': String(Math.max(0, 30000 - mockState.chatCalls * 500)),
      'x-ratelimit-reset-requests': '24h',
      'x-ratelimit-reset-tokens': '1m',
    })
    res.end(
      JSON.stringify({
        id: `chatcmpl-mock-${requestCount}`,
        object: 'chat.completion',
        model: parsed?.model ?? 'mock-model',
        choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }),
    )
  })
})

server.listen(PORT, () => {
  console.log(`[mock-groq-nested] listening on http://localhost:${PORT}`)
})

export { server as mockServer }
