import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(here, '..', 'server')

const JSON_ARGS =
  '{"path": "css/theme.css", "old_string": "--color-primary: #4361ee;", "new_string": "--color-primary: #e94560;"}'
const JSON_ARGS_STALE = '{"path": "css/theme.css", "old_str": "--color-primary: #4361ee;", "new_str": "--color-primary: #e94560;"}'

const scenarios = {
  A_name_field_carried_the_arguments_then_the_real_name: [
    { index: 0, function: { name: JSON_ARGS, arguments: '' } },
    { index: 0, function: { name: 'edit_file', arguments: JSON_ARGS_STALE } },
  ],
  B_reported_shape_name_json_plus_edit_file: [
    { index: 0, id: 'call_f', type: 'function', function: { name: `${JSON_ARGS}edit_file`, arguments: JSON_ARGS_STALE } },
  ],
  C_id_only_on_the_first_chunk: [
    { index: 0, id: 'call_d', type: 'function', function: { name: 'edit_file', arguments: '' } },
    { index: 0, function: { arguments: JSON_ARGS } },
  ],
  D_name_arrives_after_the_arguments_without_id: [
    { index: 0, function: { name: '', arguments: '{"path": "css/theme.css", ' } },
    { index: 0, function: { arguments: '"old_string": "a", "new_string": "b"}' } },
    { index: 0, id: 'call_9', function: { name: 'edit_file' } },
  ],
  E_tool_name_stuck_on_the_end_of_the_arguments: [
    { index: 0, id: 'call_g', type: 'function', function: { name: '', arguments: `${JSON_ARGS}edit_file` } },
    { index: 0, id: 'call_g', function: { name: 'edit_file' } },
  ],
}

const builds = [
  {
    label: 'BEFORE-legacy (commit 24b8b62: name += name, index-keyed)',
    module: path.join(serverRoot, 'src/services/providerClientLegacy.mjs'),
    style: 'legacy',
  },
  {
    label: 'BEFORE-HEAD (commit 9c89bf9: the build that produced the report)',
    module: path.join(serverRoot, 'src/services/providerClientHead.mjs'),
    style: 'head',
  },
  {
    label: 'AFTER (current worktree)',
    module: path.join(serverRoot, 'src/services/providerClient.js'),
    style: 'current',
  },
]

let currentScenario = null

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(404).end()
    return
  }
  let raw = ''
  for await (const chunk of req) raw += chunk
  const frames = []
  for (const delta of scenarios[currentScenario]) {
    frames.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [delta] } }] })}\n\n`)
  }
  frames.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`)
  frames.push('data: [DONE]\n\n')
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  res.end(frames.join(''))
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
process.env.MISTRAL_BASE_URL = `http://127.0.0.1:${port}/v1`

const tools = [{ type: 'function', function: { name: 'edit_file', parameters: { type: 'object', properties: {} } } }]
const KNOWN = ['create_file', 'append_to_file', 'edit_file', 'scaffold_site', 'scaffold_app', 'read_file', 'list_directory', 'delete_file', 'run_command']

const headService = await import(pathToFileURL(path.join(serverRoot, 'src/services/agentServiceHead.mjs')).href)
const currentService = await import(pathToFileURL(path.join(serverRoot, 'src/services/agentService.js')).href)

function legacyDispatch(call) {
  const name = String(call.function?.name ?? call.name ?? 'unknown').trim() || 'unknown'
  let args = {}
  let parseError = null
  try {
    args = JSON.parse(call.function?.arguments ?? '{}')
  } catch (error) {
    parseError = error.message
  }
  const keys = Object.keys(args)
  if (!KNOWN.includes(name)) {
    return `Error: unknown tool "${name}".${parseError ? ` (args not parseable: ${parseError})` : ''}`
  }
  return `dispatch ${name} keys=[${keys.join(', ')}]${parseError ? ` PARSE-FAIL: ${parseError}` : ''}`
}

function headDispatch(call) {
  const name = String(call.function?.name ?? call.name ?? 'unknown').trim() || 'unknown'
  const { args } = headService.parseAndNormalizeToolArguments(name, call.function?.arguments)
  const keys = Object.keys(args)
  if (!KNOWN.includes(name)) {
    const received = keys.length > 0 ? ` (it received: ${keys.join(', ')})` : ''
    return `Error: unknown tool "${name}"${received}. Use one of: create_file, append_to_file, edit_file, ...`
  }
  return `dispatch ${name} keys=[${keys.join(', ')}]`
}

function currentDispatch(call) {
  const rawName = String(call.function?.name ?? call.name ?? 'unknown').trim() || 'unknown'
  const resolved = currentService.resolveToolCallName(rawName, call.function?.arguments)
  const name = resolved.name || 'unknown'
  const { args } = currentService.parseAndNormalizeToolArguments(name, resolved.arguments)
  const keys = Object.keys(args)
  if (!KNOWN.includes(name)) {
    const received = keys.length > 0 ? ` (it received: ${keys.join(', ')})` : ''
    return `Error: unknown tool "${name}"${received}. Use one of: create_file, append_to_file, edit_file, ...`
  }
  return `dispatch ${name} keys=[${keys.join(', ')}]`
}

console.log('=== STREAMING ASSEMBLY + DISPATCH: three builds, five chunk shapes (real providerChatStream) ===\n')

for (const build of builds) {
  const mod = await import(pathToFileURL(build.module).href)
  console.log(`--- ${build.label}`)
  for (const scenario of Object.keys(scenarios)) {
    currentScenario = scenario
    const response = await mod.providerChatStream({
      providerId: 'mistral',
      apiKey: 'test-key',
      model: 'mistral-large-latest',
      messages: [{ role: 'user', content: 'hi' }],
      tools,
      onDelta: () => {},
    })
    const calls = response?.choices?.[0]?.message?.tool_calls ?? []
    console.log(`  [${scenario}] ${calls.length} assembled call(s)`)
    calls.forEach((call, index) => {
      const name = call.function.name
      const args = call.function.arguments
      console.log(`    call[${index}] name=${JSON.stringify(name)}${/[{}]/.test(name) ? '   <== TOOL NAME CONTAINS THE JSON ARGUMENTS' : ''}`)
      console.log(`    call[${index}] args=${JSON.stringify(args).slice(0, 120)}${/[a-z_]$/.test(args) && !args.endsWith('}') ? '   <== TOOL NAME STUCK ONTO THE ARGUMENTS' : ''}`)
      const dispatch = build.style === 'legacy' ? legacyDispatch(call) : build.style === 'head' ? headDispatch(call) : currentDispatch(call)
      console.log(`    -> ${dispatch}`)
    })
    if (calls.length === 0) console.log('    (nothing assembled)')
  }
  console.log('')
}

server.close()
