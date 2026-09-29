import http from 'node:http'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(here, '..', 'server')

const JSON_ARGS =
  '{"path": "css/theme.css", "old_string": "--color-primary: #4361ee;\\n --color-primary-hover: #3a57d4;", "new_string": "--color-primary: #e94560;\\n --color-primary-hover: #ff6b81;"}'
const JSON_ARGS_B = '{"path": "css/theme.css", "old_str": "--color-primary: #4361ee;", "new_str": "--color-primary: #e94560;"}'

const scenarios = {
  'S1 name-after-args (id only on the name chunk)': [
    { index: 0, function: { name: '', arguments: '{"path": "css/theme.css", ' } },
    { index: 0, function: { arguments: '"old_string": "a", "new_string": "b"}' } },
    { index: 0, id: 'call_9', function: { name: 'edit_file' } },
  ],
  'S2 trailing name field after arguments': [
    { index: 0, id: 'call_1', type: 'function', function: { name: 'edit_file', arguments: '' } },
    { index: 0, function: { arguments: JSON_ARGS } },
    { index: 0, function: { arguments: '', name: 'edit_file' } },
  ],
  'S3 two whole calls back to back (both index 0)': [
    { index: 0, id: 'call_a', type: 'function', function: { name: 'edit_file', arguments: JSON_ARGS } },
    { index: 0, id: 'call_b', type: 'function', function: { name: 'edit_file', arguments: JSON_ARGS_B } },
  ],
  'S4 arguments text delivered inside function.name, then the real name': [
    { index: 0, function: { name: JSON_ARGS, arguments: '' } },
    { index: 0, function: { name: 'edit_file', arguments: JSON_ARGS_B } },
  ],
  'S5 arguments string with the tool name stuck on the end': [
    { index: 0, id: 'call_c', type: 'function', function: { name: 'edit_file', arguments: JSON_ARGS + 'edit_file' } },
  ],
  'S6 id only on the first chunk (name and args split across keys)': [
    { index: 0, id: 'call_d', type: 'function', function: { name: 'edit_file', arguments: '' } },
    { index: 0, function: { arguments: JSON_ARGS } },
  ],
  'S7 repeated index 0, second call carries no name': [
    { index: 0, id: 'call_e', type: 'function', function: { name: 'edit_file', arguments: JSON_ARGS } },
    { index: 0, id: 'call_e', function: { arguments: JSON_ARGS_B } },
  ],
  'S8 reported bug shape: name field = JSON arguments + edit_file': [
    {
      index: 0,
      id: 'call_f',
      type: 'function',
      function: { name: `${JSON_ARGS}edit_file`, arguments: JSON_ARGS_B },
    },
  ],
  'S9 trailing tool name stuck on the end of the arguments': [
    {
      index: 0,
      id: 'call_g',
      type: 'function',
      function: { name: '', arguments: `${JSON_ARGS}edit_file` },
    },
    { index: 0, id: 'call_g', function: { name: 'edit_file' } },
  ],
  'S10 oldStr/newStr alias keys': [
    {
      index: 0,
      id: 'call_h',
      type: 'function',
      function: {
        name: 'edit_file',
        arguments: '{"file_path": "css/theme.css", "oldStr": "--color-primary: #4361ee;", "newStr": "--color-primary: #e94560;"}',
      },
    },
  ],
}

const scenarioOrder = Object.keys(scenarios)
let current = 0

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(404).end()
    return
  }
  let raw = ''
  for await (const chunk of req) raw += chunk
  const payload = JSON.parse(raw || '{}')
  const steps = scenarios[scenarioOrder[current]]
  const frames = []
  for (const delta of steps) {
    frames.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [delta] } }] })}\n\n`)
  }
  frames.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`)
  frames.push(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`)
  frames.push('data: [DONE]\n\n')
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  res.end(frames.join(''))
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
process.env.MISTRAL_BASE_URL = `http://127.0.0.1:${port}/v1`

const { providerChatStream, normalizeMessagesForProvider } = await import(
  pathToFileURLLike(path.join(serverRoot, 'src/services/providerClient.js'))
)

function pathToFileURLLike(p) {
  return 'file:///' + p.replace(/\\/g, '/')
}

const tools = [
  {
    type: 'function',
    function: { name: 'edit_file', description: 'edit', parameters: { type: 'object', properties: {} } },
  },
]

console.log('=== STREAMING TOOL-CALL ASSEMBLY (real providerChatStream, mock Mistral chunking) ===\n')

const results = []
for (const name of scenarioOrder) {
  current = scenarioOrder.indexOf(name)
  const response = await providerChatStream({
    providerId: 'mistral',
    apiKey: 'test-key',
    model: 'mistral-large-latest',
    messages: [{ role: 'user', content: 'hi' }],
    tools,
    onDelta: () => {},
  })
  const calls = response?.choices?.[0]?.message?.tool_calls ?? []
  results.push({ scenario: name, calls: calls.map((call) => ({ id: call.id, name: call.function.name, arguments: call.function.arguments })) })
  console.log(`--- ${name}`)
  calls.forEach((call, index) => {
    const leaked = call.function.name !== String(call.function.name).trim() || /[{}]/.test(call.function.name)
    console.log(
      `    call[${index}] name=${JSON.stringify(call.function.name)}${leaked ? '   <== LEAKED NAME' : ''}`,
    )
    console.log(`    call[${index}] args=${JSON.stringify(call.function.arguments).slice(0, 160)}`)
  })
  if (calls.length === 0) console.log('    (no tool calls assembled)')
  console.log('')
}

console.log('=== SIMULATED agentService DISPATCH (name + keys the tool would see) ===\n')
const { parseAndNormalizeToolArguments, PATH_ARG_ALIASES } = await import(
  pathToFileURLLike(path.join(serverRoot, 'src/services/agentService.js'))
)
const KNOWN = ['create_file', 'append_to_file', 'edit_file', 'scaffold_site', 'scaffold_app', 'read_file', 'list_directory', 'delete_file', 'run_command']
for (const entry of results) {
  entry.calls.forEach((call, index) => {
    const rawName = String(call.name ?? call.function?.name ?? '')
    const name = rawName.trim() || 'unknown'
    const parsed = parseAndNormalizeToolArguments(name, call.arguments)
    const known = KNOWN.includes(name)
    console.log(`${entry.scenario} -> call[${index}] dispatchName=${JSON.stringify(name)} known=${known} keys=[${Object.keys(parsed.args).join(', ')}]`)
  })
}

server.close()
