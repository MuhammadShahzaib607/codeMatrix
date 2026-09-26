// TEMPORARY test double (deleted after verification): a scripted stand-in for
// Groq's OpenAI-compatible chat-completions endpoint. It replies with ONE tool
// call per round (list -> create -> edit -> delete -> run -> read), then a
// final natural-language summary — so the REAL agent loop, REAL workspace
// actions and REAL streaming can be verified deterministically offline.
import http from 'node:http'

const PORT = 4999

const PACKAGE_JSON = JSON.stringify(
  {
    name: 'agent-todo',
    private: true,
    version: '0.1.0',
    type: 'module',
    scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
    dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
    devDependencies: { '@vitejs/plugin-react': '^4.3.1', vite: '^5.4.8' },
  },
  null,
  2,
)

const APP_V1 = `import { useState } from 'react'

export default function App() {
  const [items, setItems] = useState([])
  return <h1>Todo</h1>
}
`

const APP_V2 = `import { useState } from 'react'

export default function App() {
  const [items, setItems] = useState([])
  const [text, setText] = useState('')

  function addItem() {
    if (!text.trim()) return
    setItems((current) => [...current, text.trim()])
    setText('')
  }

  return (
    <main>
      <h1>Todos</h1>
      <input value={text} onChange={(e) => setText(e.target.value)} />
      <button onClick={addItem}>Add</button>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </main>
  )
}
`

const STEPS = [
  { tool: 'list_directory', args: { path: '.' } },
  { tool: 'create_file', args: { path: 'package.json', content: PACKAGE_JSON } },
  { tool: 'create_file', args: { path: 'src/main.jsx', content: "import App from './App.jsx'\n\ncreateRoot(document.getElementById('root')).render(<App />)\n" } },
  { tool: 'create_file', args: { path: 'src/App.jsx', content: APP_V1 } },
  { tool: 'create_file', args: { path: 'index.html', content: '<!doctype html>\n<html><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>\n' } },
  { tool: 'edit_file', args: { path: 'src/App.jsx', content: APP_V2 } },
  { tool: 'create_file', args: { path: 'tmp-agent.txt', content: 'scratch file\\n' } },
  { tool: 'delete_file', args: { path: 'tmp-agent.txt' } },
  { tool: 'run_command', args: { command: 'echo agent-shell-works && node --version' } },
  { tool: 'read_file', args: { path: 'src/App.jsx' } },
]

const FINAL_MESSAGE =
  'Done — I scaffolded the React todo app in the workspace: package.json, index.html, src/main.jsx and src/App.jsx (then upgraded App.jsx with the add-todo flow), removed a scratch file and verified the shell with a real command. Run npm install && npm run dev to try it.'

let requestCount = 0

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
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
    let messages = []
    try {
      messages = JSON.parse(body)?.messages ?? []
    } catch {}

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

    console.log(`[mock-groq] #${requestCount} -> ${step ? step.tool : 'final message'} (${toolResults} tool results so far)`)

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        id: `chatcmpl-mock-${requestCount}`,
        object: 'chat.completion',
        model: 'llama-3.3-70b-versatile',
        choices: [{ index: 0, message, finish_reason: step ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }),
    )
  })
})

server.listen(PORT, () => {
  console.log(`[mock-groq] listening on http://localhost:${PORT}`)
})
