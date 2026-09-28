import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'strict-rules-'))
process.env.WORKSPACES_ROOT = tempRoot

const {
  sanitizeStrictRules,
  buildStrictRulesBlock,
  strictRuleFlags,
  findRuleBlock,
  MAX_STRICT_RULES,
  MAX_STRICT_RULE_LENGTH,
} = await import('./src/services/strictRules.js')
const { runAgent } = await import('./src/services/agentService.js')

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) passed += 1
  else failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const NO_OVERWRITE =
  'Never overwrite or delete existing files unless I explicitly ask. Modify existing files with small edits only.'
const NO_RENAME = 'Do not rename or move files/folders unless I ask.'

const cleaned = sanitizeStrictRules([
  { id: 'a', text: `  ${NO_OVERWRITE}  ` },
  { id: 'b', text: `${NO_OVERWRITE.toUpperCase()}` },
  { id: 'c', text: `${NO_RENAME}` },
  { id: 'd', text: `bad${String.fromCharCode(9)}rule${String.fromCharCode(13)}with control chars` },
  { id: 'e', text: 'x'.repeat(900) },
  'plain string entry',
  { id: 'f', text: '   ' },
])
check('1: duplicates are rejected case-insensitively', cleaned.filter((rule) => rule.text.toLowerCase() === NO_OVERWRITE.toLowerCase()).length === 1)
check('2: control characters are stripped and text trimmed', cleaned.some((rule) => rule.text === 'bad rule with control chars'), cleaned.map((rule) => rule.text).join(' | ').slice(0, 200))
check('3: over-long rules are clamped to 300 characters', cleaned.every((rule) => rule.text.length <= MAX_STRICT_RULE_LENGTH))
check('4: plain string entries are accepted, blanks dropped', cleaned.some((rule) => rule.text === 'plain string entry') && !cleaned.some((rule) => rule.text === ''))

const many = sanitizeStrictRules(Array.from({ length: 40 }, (_, index) => ({ id: `r${index}`, text: `rule number ${index}` })))
check('5: rule count is capped at 20', many.length === MAX_STRICT_RULES, String(many.length))

check('6: empty rule list produces no prompt block', buildStrictRulesBlock([]) === '')
const block = buildStrictRulesBlock([{ text: NO_OVERWRITE }, { text: NO_RENAME }])
check('7: block carries the required header', block.startsWith('USER STRICT RULES (follow always;'))
check('8: block numbers every rule', block.includes(`1. ${NO_OVERWRITE}`) && block.includes(`2. ${NO_RENAME}`))

const rules = sanitizeStrictRules([{ text: NO_OVERWRITE }, { text: NO_RENAME }])
const flags = strictRuleFlags(rules)
check('9: the preset enables both enforcement flags', flags.blockOverwrite === true && flags.blockRenameMove === true)
check('10: the matching rule text is reported for the feed row', flags.overwriteRule === NO_OVERWRITE && flags.renameRule === NO_RENAME)

const exists = (target) => target === 'index.html'
const blockExisting = findRuleBlock({ name: 'create_file', args: { path: 'index.html' }, rules, fileExists: exists })
const blockMissing = findRuleBlock({ name: 'create_file', args: { path: 'new.html' }, rules, fileExists: exists })
const blockDelete = findRuleBlock({ name: 'delete_file', args: { path: 'index.html' }, rules, fileExists: exists })
const blockRm = findRuleBlock({ name: 'run_command', args: { command: 'rm -rf dist' }, rules })
const blockMv = findRuleBlock({ name: 'run_command', args: { command: 'mv a.html b.html' }, rules })
const blockGitMv = findRuleBlock({ name: 'run_command', args: { command: 'git mv a.html b.html' }, rules })
const okBuild = findRuleBlock({ name: 'run_command', args: { command: 'npm run build' }, rules })
const okEdit = findRuleBlock({ name: 'edit_file', args: { path: 'index.html' }, rules, fileExists: exists })
const okAppend = findRuleBlock({ name: 'append_to_file', args: { path: 'index.html' }, rules, fileExists: exists })
const noRules = findRuleBlock({ name: 'create_file', args: { path: 'index.html' }, rules: [], fileExists: exists })

check('11: create_file on an existing file is blocked with edit_file guidance', blockExisting !== null && blockExisting.message.includes('edit_file') && blockExisting.message.includes('index.html'))
check('12: create_file on a new file is allowed', blockMissing === null)
check('13: delete_file is blocked', blockDelete !== null && blockDelete.message.includes('not allowed'))
check('14: shell deletes are blocked', blockRm !== null && blockRm.message.includes('deletes files'))
check('15: mv and git mv are blocked by the rename rule', blockMv !== null && blockGitMv !== null)
check('16: harmless commands are allowed', okBuild === null)
check('17: edit_file and append_to_file stay allowed', okEdit === null && okAppend === null)
check('18: without rules nothing is blocked', noRules === null)

const workspaceId = 'scratch-strict-1'
const workspaceManager = await import('./src/utils/workspaceManager.js')
const register = workspaceManager.registerWorkspaceFolder(workspaceId, {
  ownerId: 'strictuser',
  folderName: 'strict-project',
})
const root = path.join(tempRoot, register.container, register.folderName)
const INDEX = `<!doctype html>
<html>
  <head><title>Keep me</title></head>
  <body>
    <h1>Original</h1>
    <p>Original content line 1</p>
    <p>Original content line 2</p>
    <p>Original content line 3</p>
  </body>
</html>
`
await fsp.mkdir(root, { recursive: true })
await fsp.writeFile(path.join(root, 'index.html'), INDEX)
await fsp.writeFile(path.join(root, 'junk.txt'), 'scratch\n')

function jsonResponse(body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function sseResponse(message) {
  const frames = []
  if (message.content) frames.push({ choices: [{ delta: { content: message.content } }] })
  for (const call of message.tool_calls ?? []) {
    frames.push({
      choices: [
        { delta: { tool_calls: [{ index: 0, id: call.id, type: call.type, function: call.function }] } },
      ],
    })
  }
  frames.push({
    choices: [{ delta: {}, finish_reason: message.tool_calls?.length ? 'tool_calls' : 'stop' }],
    usage: { total_tokens: 10 },
  })
  return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}`).join('\n\n') + '\n\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'x-ratelimit-limit-tokens': '200000',
      'x-ratelimit-remaining-tokens': '195000',
    },
  })
}

const requests = []
const scripted = [
  { name: 'create_file', args: { path: 'index.html', content: INDEX.replace('Original', 'Overwritten') } },
  { name: 'delete_file', args: { path: 'junk.txt' } },
  { name: 'run_command', args: { command: 'rm junk.txt' } },
  { name: 'run_command', args: { command: 'mv index.html home.html' } },
]

global.fetch = async (url, options) => {
  const target = String(url)
  if (target.endsWith('/models')) {
    return jsonResponse({ object: 'list', data: [{ id: 'llama-3.3-70b-versatile' }] })
  }
  let parsed = {}
  try {
    parsed = JSON.parse(options?.body ?? '{}')
  } catch {}
  requests.push(parsed)
  const callNumber = requests.length
  let message
  if (callNumber <= scripted.length) {
    const step = scripted[callNumber - 1]
    message = {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: `call_${callNumber}`,
          type: 'function',
          function: { name: step.name, arguments: JSON.stringify(step.args) },
        },
      ],
    }
  } else {
    message = { role: 'assistant', content: 'Done — tried the four blocked actions.' }
  }
  return sseResponse(message)
}

const events = []
const run = await runAgent({
  projectId: workspaceId,
  task: 'try the blocked actions',
  framework: null,
  apiKeys: [{ id: 'k1', label: 'mock', provider: 'groq', plain: 'gsk_mockstrictkey000000000000000001' }],
  emit: (event) => events.push(event),
  userId: 'strictuser',
  strictRules: rules,
})

const blockedRows = events.filter((event) => event.type === 'rule_blocked')
check('19: four blocked actions each produced a dim rule_blocked feed row', blockedRows.length === 4, `${blockedRows.length}`)
check('20: feed rows read "Blocked by your rule:"', blockedRows.every((event) => event.description.startsWith('Blocked by your rule:')), blockedRows.map((event) => event.description).join(' | '))
check('21: the feed rows carry the full blocking message', blockedRows.every((event) => String(event.details?.result ?? '').includes('BLOCKED by your strict rule')))

const indexAfter = await fsp.readFile(path.join(root, 'index.html'), 'utf8')
const junkExists = fs.existsSync(path.join(root, 'junk.txt'))
const renamedAway = fs.existsSync(path.join(root, 'home.html'))
check('22: the existing file was NOT overwritten', indexAfter === INDEX)
check('23: neither delete nor rm removed the file', junkExists)
check('24: the mv never happened', !renamedAway)

const toolMessages = requests.flatMap((parsed) => (parsed.messages ?? []).filter((message) => message.role === 'tool'))
check('25: every blocked tool result tells the model it was blocked by a rule', toolMessages.length >= 4 && toolMessages.every((message) => String(message.content).includes('BLOCKED by your strict rule')), `${toolMessages.length} tool messages`)
check('26: the run still completed normally', typeof run?.message === 'string' && run.toolCalls === 4, `toolCalls=${run.toolCalls}`)

const system = requests[0]?.messages?.find((message) => message.role === 'system')
check('27: the system prompt carries the rules block', String(system?.content ?? '').includes('USER STRICT RULES') && String(system?.content ?? '').includes('Never overwrite or delete existing files'))

const createEvents = events.filter((event) => event.type === 'create_file')
check('28: the blocked create emitted no misleading "Writing …" row', createEvents.length === 0, `${createEvents.length}`)

console.log(`\n${passed}/${passed + failed} checks passed`)
await fsp.rm(tempRoot, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
