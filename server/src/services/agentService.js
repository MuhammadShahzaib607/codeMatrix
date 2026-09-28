import crypto from 'node:crypto'
import path from 'node:path'
import { runWorkspaceCommand } from '../utils/terminalManager.js'
import {
  appendFileToWorkspace,
  deleteFromWorkspace,
  existsInWorkspace,
  getWorkspacePath,
  getWorkspaceTree,
  listDirectoryInWorkspace,
  readFileFromWorkspace,
  writeFileToWorkspace,
} from '../utils/workspaceManager.js'
import { buildSystemPrompt } from './agentFrameworks.js'
import { clearAgentSession, getAgentSession, saveAgentSession } from './agentSessionService.js'
import {
  clearTaskTotals,
  getKeyHealth,
  getTaskTotals,
  getUsageSummary,
  markKeyActive,
  markKeyCooling,
  markKeyInvalid,
  recordObservedHeaders,
  recordUsageEvent,
  remainingPerMinute,
} from './usageService.js'
import {
  DEFAULT_PROVIDER_ORDER,
  isAllowedModel,
  modelCapability,
  modelLimits,
  providerLabel,
} from '../config/providers.js'
import { estimateTokens, planRequest } from './tokenBudgetService.js'
import {
  isToolCallParseError,
  listProviderModels,
  normalizeMessagesForProvider,
  providerChat,
} from './providerClient.js'

export const MAX_TOOL_CALLS = 60

const DESIRED_MAX_COMPLETION = 2500
const MIN_COMPLETION = 800
const KEEP_RECENT_MESSAGES = 8
const KEEP_FULL_TURNS = 4
const OLD_TOOL_RESULT_MAX = 300
const MAX_READ_CHARS = 8000
const MAX_LIST_CHARS = 2500
const MAX_TOOL_RESULT_CHARS = 4000
const MAX_PARSE_RETRIES = 2
const MAX_WAIT_MS = 60000
const MAX_TOTAL_WAIT_MS = 180000
const COOLING_DEFAULT_MS = 60000
const TRANSIENT_COOLING_MS = 5000

const TOOL_CALL_CORRECTION_NOTE =
  'Invalid tool-call JSON. Write the file in smaller parts: create_file for part 1, append_to_file for the rest, under ~120 lines each, and escape quotes/newlines.'

const CONTINUE_TASK_NOTE =
  'Continue the previous task. First call list_directory, then create the remaining files from the plan.'

const PLAN_NAME_PATTERN = /project[_\s-]*name\s*[:=]\s*([a-z0-9][a-z0-9-]*)/i
const FILES_LINE_PATTERN = /(?:^|\n)\s*(?:files|plan)\s*[:=]\s*([^\n]+)/i

export function slugifyProjectName(value) {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[`'"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  if (!slug || slug.length < 2) return null
  return slug
}

export function extractProjectName(text) {
  const match = String(text ?? '').match(PLAN_NAME_PATTERN)
  return match ? slugifyProjectName(match[1]) : null
}

export function extractPlanFiles(text) {
  const match = String(text ?? '').match(FILES_LINE_PATTERN)
  if (!match) return []
  const files = []
  for (const raw of match[1].split(/[,;|]/)) {
    let candidate = String(raw ?? '').trim()
    if (!candidate) continue
    candidate = candidate.replace(/^\s*[-•*\d.)]+\s*/, '').replace(/[`*"']/g, '').trim()
    candidate = candidate.split(/\s+/)[0]
    candidate = candidate.replace(/^\.?\//, '').replace(/[.,;:]+$/, '').replace(/\\/g, '/')
    if (!candidate || !/[a-z0-9]/i.test(candidate)) continue
    if (!/\.[a-z0-9]+$/i.test(candidate) && !candidate.includes('/')) continue
    if (!files.includes(candidate)) files.push(candidate)
  }
  return files
}

export function extractPlan(text) {
  const projectName = extractProjectName(text)
  let files = extractPlanFiles(text)
  if (files.length === 0) {
    const line = String(text ?? '').match(/PLAN\s*[:=]\s*([^\n]+)/i)
    if (line) {
      files = extractPlanFiles(`FILES: ${line[1]}`)
    }
  }
  return { projectName, files }
}

export function stripProjectNameLine(text) {
  return String(text ?? '')
    .replace(/^\s*project[_\s-]*name\s*[:=][^\n]*\n?/i, '')
    .trim()
}

export function deriveProjectName(task) {
  const words = String(task ?? '')
    .toLowerCase()
    .replace(/[`'"]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  const picked = words.slice(0, 2).join('-')
  return slugifyProjectName(picked) || 'my-project'
}

const OPENAI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Create or overwrite a file. Parent folders are created.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path' },
          content: { type: 'string', description: 'File content' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'append_to_file',
      description: 'Append content to the end of a file (creates it if missing).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path' },
          content: { type: 'string', description: 'Content to append' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Overwrite an existing file. Fails when it does not exist.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path' },
          content: { type: 'string', description: 'New full content' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file before editing it.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List a folder ("." for the root).',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file or folder.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command in the project and wait for it.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          timeout_ms: { type: 'number' },
        },
        required: ['command'],
      },
    },
  },
]

const TOOL_LABELS = {
  create_file: 'create_file',
  append_to_file: 'append_to_file',
  edit_file: 'edit_file',
  read_file: 'read_file',
  list_directory: 'list_directory',
  delete_file: 'delete_file',
  run_command: 'run_command',
}

const WRITE_TOOLS = new Set(['create_file', 'append_to_file', 'edit_file'])

function truncate(text, limit) {
  const value = String(text ?? '')
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n[… ${value.length - limit} more characters truncated …]`
}

function countLines(text) {
  const value = String(text ?? '')
  if (!value) return 0
  return value.split('\n').length
}

function describeAction(name, args, context = {}) {
  switch (name) {
    case 'create_file':
      return `Create ${args.path ?? 'file'}`
    case 'append_to_file': {
      const part = context.appendPart
      return `Writing ${args.path ?? 'file'}${part ? ` (part ${part})` : ''}`
    }
    case 'edit_file':
      return `Edit ${args.path ?? 'file'}`
    case 'read_file':
      return `Read ${args.path ?? 'file'}`
    case 'list_directory':
      return `List ${args.path && args.path !== '.' ? args.path : 'project root'}`
    case 'delete_file':
      return `Delete ${args.path ?? 'item'}`
    case 'run_command':
      return `Run: ${truncate(args.command ?? '', 160)}`
    default:
      return `Call ${name}`
  }
}

function normalizeToolArgs(projectId, name, args) {
  if (name === 'run_command' || !args || typeof args.path !== 'string') return args
  const raw = args.path.replace(/\\/g, '/').replace(/^(\/|\.\/)+/, '')
  if (!raw) return args
  let rootName = ''
  try {
    rootName = path.basename(getWorkspacePath(projectId))
  } catch {
    return args
  }
  if (!rootName) return args
  const segments = raw.split('/').filter(Boolean)
  if (segments[0].toLowerCase() !== rootName.toLowerCase()) return args
  try {
    if (existsInWorkspace(projectId, segments[0])) return args
  } catch {
    return args
  }
  if (segments.length > 1) return { ...args, path: segments.slice(1).join('/') }
  if (name === 'list_directory') return { ...args, path: '' }
  return args
}

async function executeTool(name, rawArgs, projectId) {
  const args = normalizeToolArgs(projectId, name, rawArgs)
  switch (name) {
    case 'create_file':
    case 'edit_file': {
      const filePath = String(args.path ?? '').trim()
      const content = typeof args.content === 'string' ? args.content : String(args.content ?? '')
      if (!filePath) return { text: 'Error: a "path" is required.' }
      if (name === 'edit_file' && !existsInWorkspace(projectId, filePath)) {
        return { text: `Error: "${filePath}" does not exist (use create_file).` }
      }
      const saved = writeFileToWorkspace(projectId, filePath, content)
      const verb = name === 'create_file' ? 'Created' : 'Updated'
      return {
        text: `${verb} ${saved}`,
        modelText: `ok, ${countLines(content)} lines`,
        lines: countLines(content),
      }
    }
    case 'append_to_file': {
      const filePath = String(args.path ?? '').trim()
      const content = typeof args.content === 'string' ? args.content : String(args.content ?? '')
      if (!filePath) return { text: 'Error: a "path" is required.' }
      const saved = appendFileToWorkspace(projectId, filePath, content)
      return {
        text: `Appended to ${saved}`,
        modelText: `ok, ${countLines(content)} lines`,
        lines: countLines(content),
      }
    }
    case 'read_file': {
      const filePath = String(args.path ?? '').trim()
      if (!filePath) return { text: 'Error: a "path" is required.' }
      const content = readFileFromWorkspace(projectId, filePath)
      return { text: truncate(content, MAX_READ_CHARS) }
    }
    case 'list_directory': {
      const rawPath = String(args.path ?? '.').trim()
      const relative = rawPath === '.' || rawPath === './' ? '' : rawPath
      const entries = await listDirectoryInWorkspace(projectId, relative)
      if (entries.length === 0) return { text: '(empty folder)' }
      const text = entries
        .map((entry) => (entry.type === 'folder' ? `${entry.name}/` : entry.name))
        .join('\n')
      return { text: truncate(text, MAX_LIST_CHARS) }
    }
    case 'delete_file': {
      const filePath = String(args.path ?? '').trim()
      if (!filePath) return { text: 'Error: a "path" is required.' }
      const deleted = await deleteFromWorkspace(projectId, filePath)
      return { text: `Deleted ${deleted}` }
    }
    case 'run_command': {
      const command = String(args.command ?? '').trim()
      if (!command) return { text: 'Error: a "command" is required.' }
      const outcome = await runWorkspaceCommand(projectId, command, { timeoutMs: args.timeout_ms })
      const header = outcome.timedOut
        ? `TIMED OUT. Partial output:`
        : `Exit code: ${outcome.exitCode ?? 0}`
      const text = `${header}\n${outcome.output}`
      return {
        text: truncate(text, MAX_TOOL_RESULT_CHARS),
        details: {
          command,
          output: outcome.output,
          exitCode: outcome.exitCode,
          timedOut: outcome.timedOut,
          durationMs: outcome.durationMs,
          shell: outcome.shell,
        },
      }
    }
    default:
      return { text: `Error: unknown tool "${name}".` }
  }
}

const COLLAPSE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache', '.turbo', 'coverage',
])

const MAX_TREE_LINES = 200
const MAX_TREE_DEPTH = 3

async function buildTreeContext(projectId) {
  let tree
  try {
    tree = await getWorkspaceTree(projectId)
  } catch (error) {
    return `(structure unavailable: ${error.message})`
  }
  const lines = []
  let truncated = false
  function walk(node, depth) {
    if (lines.length >= MAX_TREE_LINES) {
      truncated = true
      return
    }
    if (depth > 0) {
      const indent = '  '.repeat(depth - 1)
      lines.push(`${indent}${node.name}${node.type === 'folder' ? '/' : ''}`)
    }
    if (node.type !== 'folder') return
    if (depth > 0 && COLLAPSE_DIRS.has(node.name)) {
      lines[lines.length - 1] += ' [collapsed]'
      return
    }
    if (depth >= MAX_TREE_DEPTH) return
    for (const child of node.children ?? []) walk(child, depth + 1)
  }
  walk(tree, 0)
  if (truncated) lines.push('[… truncated …]')
  return lines.length ? lines.join('\n') : '(empty project)'
}

function stubWriteArguments(call, lines) {
  let parsed = {}
  try {
    parsed = JSON.parse(call?.function?.arguments ?? '{}')
  } catch {
    parsed = {}
  }
  const stub = {}
  if (parsed.path) stub.path = parsed.path
  stub.content = `[written: ${lines} lines]`
  if (call?.function) call.function.arguments = JSON.stringify(stub)
}

function condenseHistory(messages, keepRecent) {
  let cutoff = Math.max(2, messages.length - keepRecent)
  while (cutoff > 2 && messages[cutoff]?.role === 'tool') cutoff -= 1
  if (cutoff <= 2) return messages

  const droppedToolIds = new Set()
  const result = []
  messages.forEach((message, index) => {
    if (index >= cutoff) {
      result.push(message)
      return
    }
    if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length) {
      const labels = message.tool_calls.map((call) => {
        const name = call?.function?.name ?? 'tool'
        let filePath = ''
        try {
          filePath = JSON.parse(call?.function?.arguments ?? '{}')?.path ?? ''
        } catch {}
        if (call?.id) droppedToolIds.add(call.id)
        return filePath ? `${name} ${filePath}` : name
      })
      result.push({ role: 'assistant', content: `[did: ${labels.join(', ')}]` })
      return
    }
    if (message.role === 'tool') {
      if (droppedToolIds.has(message.tool_call_id)) return
      return
    }
    if (message.role === 'assistant') {
      result.push({ role: 'assistant', content: truncate(message.content ?? '', OLD_TOOL_RESULT_MAX) })
      return
    }
    result.push(message)
  })
  return result
}

function replaceTaskWithSpec(messages, spec) {
  const index = messages.findIndex((message) => message.role === 'user')
  if (index >= 0) messages[index] = { role: 'user', content: spec }
}

export async function listAvailableModels(providerId, apiKey, onResponse = null) {
  return listProviderModels({ providerId, apiKey, onResponse })
}

function capabilityScore(providerId, model) {
  const id = String(model).toLowerCase()
  let score = modelCapability(id)
  const providerIndex = DEFAULT_PROVIDER_ORDER.indexOf(providerId)
  score += (DEFAULT_PROVIDER_ORDER.length - providerIndex) * 2
  return score
}

export async function resolveModelPlan(keys, { userId = null, requestedProvider = null, requestedModel = null } = {}) {
  const candidates = []
  const seen = new Set()
  let firstError = null
  let anyListed = false

  for (const key of keys) {
    const providerId = key.provider || 'groq'
    try {
      const available = new Set(await listProviderModels({ providerId, apiKey: key.plain }))
      anyListed = true
      for (const model of available) {
        if (!isAllowedModel(providerId, model)) continue
        const identity = `${providerId}:${model}:${key.id ?? key.plain}`
        if (seen.has(identity)) continue
        seen.add(identity)
        candidates.push({
          providerId,
          model,
          key,
          limits: modelLimits(providerId, model),
        })
      }
    } catch (error) {
      if (!firstError) firstError = error
    }
  }

  if (!anyListed) throw firstError ?? new Error('No API key is available for this run.')

  if (candidates.length === 0) {
    throw new Error(
      'None of the saved keys serve an allowlisted coding model. Add a Groq or Mistral key in Settings -> AI.',
    )
  }

  const requested = String(requestedModel ?? '').trim()
  if (requested) {
    const pinned = candidates.find(
      (candidate) =>
        candidate.model === requested &&
        (!requestedProvider || candidate.providerId === requestedProvider),
    )
    if (pinned) {
      return [pinned, ...candidates.filter((candidate) => candidate !== pinned)]
    }
  }

  return candidates
}

function candidateIdentity(candidate) {
  return `${candidate.providerId}:${candidate.model}:${candidate.key?.id ?? candidate.key?.label ?? 'org'}`
}

function budgetKeyFor(candidate) {
  return {
    keyId: candidate.key?.id ?? null,
    orgKey: candidate.key?.id ?? candidate.key?.label ?? 'org',
    providerId: candidate.providerId,
    provider: candidate.providerId,
    model: candidate.model,
  }
}

function preferredRank(candidate, preference) {
  if (preference !== 'mistral' && preference !== 'groq') return 0
  return candidate.providerId === preference ? 0 : 1
}

function pickAutoCandidate(candidates, estimatedInput, cooling, preference) {
  const now = Date.now()
  const healthy = candidates.filter(
    (candidate) =>
      (cooling?.get(candidateIdentity(candidate)) ?? 0) <= now &&
      getKeyHealth(candidate.key?.id).status !== 'invalid',
  )
  const pool = healthy.length > 0 ? healthy : candidates
  const viable = pool.filter(
    (candidate) => remainingPerMinute(budgetKeyFor(candidate)) >= estimatedInput + MIN_COMPLETION,
  )
  const usable = viable.length > 0 ? viable : pool
  const sorted = [...usable].sort((a, b) => {
    const prefDiff = preferredRank(a, preference) - preferredRank(b, preference)
    if (prefDiff !== 0) return prefDiff
    const budgetDiff = remainingPerMinute(budgetKeyFor(b)) - remainingPerMinute(budgetKeyFor(a))
    if (budgetDiff !== 0) return budgetDiff
    return capabilityScore(b.providerId, b.model) - capabilityScore(a.providerId, a.model)
  })
  return sorted[0] ?? candidates[0]
}

export async function runAgent({
  projectId,
  task,
  framework,
  apiKey,
  apiKeys,
  emit = () => {},
  emitUsage = () => {},
  onProjectName = null,
  userId = null,
  requestedModel = null,
  requestedProvider = null,
  providerPreference = null,
  taskId = null,
  resume = false,
}) {
  const startedAt = Date.now()
  let toolCalls = 0
  let planReminders = 0
  let parseRetries = 0

  const event = (type, description, details = {}) => {
    const { actionId, ...rest } = details
    emit({
      type,
      description,
      details: rest,
      actionId: actionId ?? crypto.randomUUID(),
      at: Date.now(),
    })
  }

  const keys = (Array.isArray(apiKeys) ? apiKeys : [])
    .map((key) => ({
      id: key?.id ?? null,
      label: key?.label ?? '',
      provider: key?.provider ?? 'groq',
      plain: String(key?.plain ?? ''),
    }))
    .filter((key) => key.plain)
  if (keys.length === 0 && apiKey) {
    keys.push({ id: null, label: '', provider: requestedProvider ?? 'groq', plain: String(apiKey) })
  }

  if (keys.length === 0) {
    const error = new Error('No API key is available for this run.')
    event('error', error.message, { status: 'done' })
    throw error
  }

  let candidates
  try {
    candidates = await resolveModelPlan(keys, { userId, requestedProvider, requestedModel })
  } catch (error) {
    event('error', error.message, { status: 'done' })
    throw error
  }

  const event_ = event
  const keyLabelOf = (key) => key.label || `${key.provider ?? 'key'} key`
  const cooling = new Map()
  if (taskId) clearTaskTotals(taskId)

  const coolCandidate = (candidate, ms) => {
    cooling.set(candidateIdentity(candidate), Date.now() + Math.max(0, ms))
  }
  const pruneCooling = () => {
    const now = Date.now()
    for (const [identity, until] of cooling) if (until <= now) cooling.delete(identity)
  }
  const isCooling = (candidate) =>
    (cooling.get(candidateIdentity(candidate)) ?? 0) > Date.now() ||
    getKeyHealth(candidate.key?.id).status === 'invalid'

  const treeContext = await buildTreeContext(projectId)
  const systemPrompt = buildSystemPrompt(framework, treeContext)
  const systemMessage = { role: 'system', content: systemPrompt }

  const session = resume ? getAgentSession(projectId) : null
  let plan = Array.isArray(session?.plan) ? session.plan.slice() : []
  let condensedSpec = session?.condensedSpec ?? null

  const messages = []
  if (resume && Array.isArray(session?.messages) && session.messages.length > 0) {
    const saved = session.messages.filter((message) => message?.role !== 'system')
    let start = 0
    while (start < saved.length && saved[start]?.role === 'tool') start += 1
    messages.push(systemMessage)
    for (const message of saved.slice(start)) messages.push({ ...message })
    messages.push({ role: 'user', content: CONTINUE_TASK_NOTE })
    event_('resume', 'Resuming the previous task…', { status: 'done', model: candidates[0].model, tool: 'resume' })
  } else {
    messages.push(systemMessage)
    messages.push({ role: 'user', content: task })
  }

  const estimateInput = () => estimateTokens(condenseHistory(messages, KEEP_RECENT_MESSAGES), OPENAI_TOOLS)

  let active = pickAutoCandidate(candidates, estimateInput(), cooling, providerPreference)
  let model = active.model

  function moveTo(candidate) {
    if (!candidate || candidate === active) return false
    active = candidate
    model = candidate.model
    return true
  }

  function orderedCandidates() {
    const current = active
    const sameProvider = candidates.filter(
      (candidate) => candidate !== current && candidate.providerId === current.providerId,
    )
    const others = candidates.filter(
      (candidate) => candidate !== current && candidate.providerId !== current.providerId,
    )
    return [
      current,
      ...sameProvider.filter((candidate) => !isCooling(candidate)),
      ...others.filter((candidate) => !isCooling(candidate)),
    ]
  }

  function advanceCandidate() {
    pruneCooling()
    const ordered = orderedCandidates()
    for (let index = 1; index < ordered.length; index += 1) {
      const candidate = ordered[index]
      if (!isCooling(candidate)) return moveTo(candidate)
    }
    return false
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  const note = (description, actionId = null, extra = {}) =>
    event_('note', description, {
      status: 'done',
      model,
      provider: active.providerId,
      tool: 'note',
      actionId,
      ...extra,
    })

  async function countdownWait(totalMs, actionId = null, extra = {}) {
    const id = actionId ?? crypto.randomUUID()
    let remaining = Math.max(0, Math.round(totalMs))
    while (remaining > 0) {
      note(`Waiting for reset: ${Math.ceil(remaining / 1000)}s`, id, {
        waitingMs: remaining,
        ...extra,
      })
      const step = Math.min(1000, remaining)
      await sleep(step)
      remaining -= step
    }
    if (totalMs > 0) note(`Waiting for reset: 0s`, id, { waitingMs: 0, ...extra })
  }

  async function sendCompletion(wireMessages, maxCompletionTokens, temperature) {
    const usedProvider = active.providerId
    const usedModel = active.model
    const keyId = active.key.id ?? null
    const response = await providerChat({
      providerId: usedProvider,
      apiKey: active.key.plain,
      model: usedModel,
      messages: normalizeMessagesForProvider(wireMessages, usedProvider),
      tools: OPENAI_TOOLS,
      temperature,
      maxCompletionTokens,
      onResponse: keyId
        ? (res) => {
            try {
              recordObservedHeaders({
                keyId,
                provider: usedProvider,
                model: usedModel,
                headers: res.headers,
              })
            } catch {}
          }
        : null,
    })
    if (keyId) {
      const summary = recordUsageEvent({
        ownerId: userId,
        keyId,
        provider: usedProvider,
        model: usedModel,
        taskId,
        usage: response?.usage ?? null,
      })
      markKeyActive(keyId)
      emitUsage({
        keyId,
        provider: usedProvider,
        model: usedModel,
        summary: summary ?? getUsageSummary({ keyId, provider: usedProvider, model: usedModel }),
        task: getTaskTotals(taskId),
        at: Date.now(),
      })
    }
    return response
  }

  async function requestOnce(temperature, { shrinkLevel = 0 } = {}) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const keep = Math.max(2, KEEP_RECENT_MESSAGES - shrinkLevel * 2)
      const wireMessages = condenseHistory(messages, keep)
      const estimatedInput = estimateTokens(wireMessages, OPENAI_TOOLS)
      const decision = planRequest({
        key: budgetKeyFor(active),
        limits: active.limits,
        estimatedInput,
        desiredMax: DESIRED_MAX_COMPLETION,
      })

      if (!decision.ok) {
        if (decision.shrinkHistory && shrinkLevel < 2) {
          shrinkLevel += 1
          continue
        }
        const error = new Error(
          `${providerLabel(active.providerId)} has no per-minute token budget left for the next request.`,
        )
        error.budget = true
        error.waitMs = decision.waitMs ?? MAX_WAIT_MS
        throw error
      }

      const maxCompletionTokens = Math.max(MIN_COMPLETION, decision.maxCompletionTokens)

      try {
        const response = await sendCompletion(wireMessages, maxCompletionTokens, temperature)
        return { response, maxCompletionTokens, estimatedInput }
      } catch (error) {
        if (error.status === 413) {
          if (shrinkLevel < 2) {
            shrinkLevel += 1
            note('Request too large (413) — trimming history and retrying…')
            continue
          }
          error.tooLarge = true
        }
        throw error
      }
    }
    const error = new Error('Could not fit the request within the provider token budget.')
    error.budget = true
    error.waitMs = MAX_WAIT_MS
    throw error
  }

  async function waitForCoolingPool() {
    const deadline = Date.now() + MAX_TOTAL_WAIT_MS
    for (;;) {
      pruneCooling()
      const pending = candidates
        .map((candidate) => cooling.get(candidateIdentity(candidate)) ?? 0)
        .filter((until) => until > Date.now())
      if (pending.length === 0) return
      const earliest = Math.min(...pending)
      const waitMs = Math.max(0, earliest - Date.now())
      if (waitMs <= 0) continue
      const waited = Math.min(waitMs, MAX_WAIT_MS)
      note(
        `All candidates are cooling down — waiting for the earliest reset…`,
        null,
        { waitingMs: waited },
      )
      await countdownWait(waited)
      if (Date.now() > deadline) {
        const error = new Error(
          'All saved keys are cooling down. Try again shortly or add another API key in Settings.',
        )
        error.status = 429
        error.code = 'RATE_LIMITED'
        throw error
      }
    }
  }

  const switchNote = (previous, reason, extra = {}) =>
    event_('fallback', `${reason}, switching to ${providerLabel(active.providerId)} (${active.model})`, {
      status: 'done',
      model,
      provider: active.providerId,
      tool: 'fallback',
      switchTo: active.providerId,
      from: previous.providerId,
      ...extra,
    })

  async function requestCompletion(temperature) {
    let lastError = null
    let transientRetried = false
    const maxSteps = candidates.length * 3 + 4

    for (let step = 0; step < maxSteps; step += 1) {
      const previous = active
      const previousLabel = providerLabel(previous.providerId)
      try {
        return await requestOnce(temperature)
      } catch (error) {
        lastError = error
        if (isToolCallParseError(error)) throw error

        if (error.budget) {
          const next = advanceCandidate()
          if (next) {
            switchNote(previous, `${previousLabel} per-minute budget used up`)
            continue
          }
          await waitForCoolingPool()
          continue
        }

        if (error.status === 429) {
          const waitMs =
            Number.isFinite(error.retryAfterMs) && error.retryAfterMs > 0
              ? error.retryAfterMs
              : COOLING_DEFAULT_MS
          coolCandidate(previous, waitMs)
          if (previous.key.id) {
            markKeyCooling(previous.key.id, waitMs, `${previousLabel} rate limit reached.`)
          }
          const next = advanceCandidate()
          if (next) {
            switchNote(previous, `${previousLabel} per-minute limit reached`)
            continue
          }
          await waitForCoolingPool()
          continue
        }

        if (error.status === 401 || error.status === 403) {
          if (previous.key.id) markKeyInvalid(previous.key.id, error.message)
          coolCandidate(previous, MAX_TOTAL_WAIT_MS)
          const next = advanceCandidate()
          if (next) {
            switchNote(previous, `${previousLabel} rejected its key`)
            continue
          }
          await waitForCoolingPool()
          continue
        }

        if (error.status === 422) {
          coolCandidate(previous, COOLING_DEFAULT_MS)
          const next = advanceCandidate()
          if (next) {
            switchNote(previous, `${previousLabel} rejected ${previous.model} as invalid (422)`)
            continue
          }
          throw error
        }

        if (error.status === 413 || error.status === 404 || error.tooLarge) {
          const next = advanceCandidate()
          if (next) {
            switchNote(previous, `The request did not fit on ${previous.model}`)
            continue
          }
          throw error
        }

        if (error.status >= 500 || error.code === 'TIMEOUT' || error.code === 'NETWORK') {
          if (!transientRetried) {
            transientRetried = true
            note(`${previousLabel} had a transient error — retrying once…`, null, { retrying: true })
            continue
          }
          coolCandidate(previous, TRANSIENT_COOLING_MS)
          const next = advanceCandidate()
          if (next) {
            switchNote(previous, `${previousLabel} is unavailable`)
            continue
          }
          throw error
        }

        throw error
      }
    }

    throw lastError ?? new Error('Could not complete the request.')
  }

  event_('thinking', 'Starting the agent…', {
    status: 'thinking',
    model,
    provider: active.providerId,
    keyLabel: keyLabelOf(active.key),
  })

  const persistSession = (reason) => {
    try {
      saveAgentSession(projectId, {
        messages,
        plan,
        framework,
        model,
        provider: active.providerId,
        condensedSpec,
        reason,
      })
    } catch (error) {
      console.warn(`[agent] could not save session: ${error?.message ?? error}`)
    }
  }

  const appendPartCounts = new Map()

  for (;;) {
    const temperature = parseRetries === 0 ? 0.2 : Math.max(0, 0.2 - parseRetries * 0.1)
    let response
    try {
      ;({ response } = await requestCompletion(temperature))
    } catch (error) {
      if (isToolCallParseError(error)) {
        if (parseRetries < MAX_PARSE_RETRIES) {
          parseRetries += 1
          note('Tool call was malformed, retrying with smaller chunks…')
          messages.push({ role: 'system', content: TOOL_CALL_CORRECTION_NOTE })
          continue
        }
        const next = advanceCandidate()
        if (next) {
          parseRetries = 0
          event_('fallback', `Repeated malformed tool calls — switching to ${model}.`, {
            status: 'done',
            model,
            provider: active.providerId,
            tool: 'fallback',
          })
          messages.push({ role: 'user', content: TOOL_CALL_CORRECTION_NOTE })
          continue
        }
      }
      event_('error', error.message, { status: 'done', model })
      persistSession(error.code ?? 'error')
      throw error
    }

    parseRetries = 0

    const message = response?.choices?.[0]?.message
    if (!message) {
      const error = new Error('The provider returned an empty response. Try again.')
      event_('error', error.message, { status: 'done' })
      persistSession('empty_response')
      throw error
    }

    if (plan.length === 0 && message.content) {
      const parsed = extractPlan(message.content)
      if (parsed.files.length > 0 || parsed.projectName) {
        plan = parsed.files
        const firstUser = messages.find((entry) => entry.role === 'user')
        const summaryText = stripProjectNameLine(String(message.content ?? ''))
        condensedSpec = truncate(
          `SPEC (project ${parsed.projectName ?? 'unnamed'}): ${summaryText}`,
          1200,
        )
        if (firstUser) replaceTaskWithSpec(messages, condensedSpec)
        if (parsed.projectName && typeof onProjectName === 'function') {
          try {
            await onProjectName(parsed.projectName)
          } catch (error) {
            console.warn(`[agent] project naming failed: ${error?.message ?? error}`)
          }
        }
        persistSession('plan')
        event_('plan', `Planned ${plan.length} file(s): ${plan.join(', ')}`, {
          status: 'done',
          model,
          provider: active.providerId,
          tool: 'plan',
          projectName: parsed.projectName ?? null,
        })
      }
    }

    messages.push(message)

    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
    if (calls.length === 0) {
      const missing = plan.filter((file) => {
        try {
          return !existsInWorkspace(projectId, file)
        } catch {
          return false
        }
      })
      if (missing.length > 0 && planReminders < 3 && toolCalls < MAX_TOOL_CALLS) {
        planReminders += 1
        messages.push({
          role: 'user',
          content: `These planned files are still missing: ${missing.join(', ')}. Continue and create them.`,
        })
        note(`Verifying the plan — ${missing.length} file(s) still missing…`)
        continue
      }
      const finalText = stripProjectNameLine(String(message.content ?? '').trim()) || 'Task complete.'
      event_('complete', finalText, {
        status: 'done',
        durationMs: Date.now() - startedAt,
        toolCalls,
        model,
        provider: active.providerId,
        plannedFiles: plan.length,
        missingFiles: missing.length,
      })
      clearAgentSession(projectId)
      return {
        message: finalText,
        toolCalls,
        durationMs: Date.now() - startedAt,
        model,
        provider: active.providerId,
        suggestedName: extractProjectName(message.content) ?? null,
      }
    }

    event_('thinking', 'Working on it…', { status: 'thinking', provider: active.providerId })

    for (const call of calls) {
      if (toolCalls >= MAX_TOOL_CALLS) {
        const limitMessage = `Stopped after ${MAX_TOOL_CALLS} tool calls — the per-run limit. Use Continue to finish.`
        event_('complete', limitMessage, {
          status: 'done',
          limitReached: true,
          toolCalls,
          durationMs: Date.now() - startedAt,
          model,
          provider: active.providerId,
        })
        persistSession('limit')
        return {
          message: limitMessage,
          toolCalls,
          durationMs: Date.now() - startedAt,
          limitReached: true,
          model,
          provider: active.providerId,
        }
      }
      toolCalls += 1

      const name = call.function?.name ?? call.name ?? 'unknown'
      let args = {}
      try {
        args = JSON.parse(call.function?.arguments ?? '{}')
      } catch {
        args = {}
      }
      args = normalizeToolArgs(projectId, name, args)

      const actionId = crypto.randomUUID()
      let appendPart
      if (name === 'append_to_file') {
        appendPart = (appendPartCounts.get(args.path) ?? 1) + 1
        appendPartCounts.set(args.path, appendPart)
      }
      const description = describeAction(name, args, { appendPart })
      event_(TOOL_LABELS[name] ?? 'thinking', description, {
        tool: name,
        args: { path: args.path, command: args.command },
        status: 'running',
        actionId,
      })

      let outcome
      try {
        outcome = await executeTool(name, args, projectId)
      } catch (error) {
        outcome = { text: `Error: ${error.message}` }
      }

      event_(TOOL_LABELS[name] ?? 'thinking', description, {
        tool: name,
        args: { path: args.path, command: args.command },
        status: 'done',
        actionId,
        result: truncate(outcome.text, 2000),
        ...(outcome.details ?? {}),
      })

      const modelResult =
        outcome.modelText ?? truncate(outcome.text ?? '', MAX_TOOL_RESULT_CHARS)
      messages.push({
        role: 'tool',
        tool_call_id: call.id ?? call.function?.name ?? `call_${toolCalls}`,
        content: modelResult,
      })

      if (WRITE_TOOLS.has(name) && !String(outcome.text ?? '').startsWith('Error')) {
        stubWriteArguments(call, outcome.lines ?? 0)
      }
    }
  }
}

export { isToolCallParseError }
