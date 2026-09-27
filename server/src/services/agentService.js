import crypto from 'node:crypto'
import { env } from '../config/env.js'
import { runWorkspaceCommand } from '../utils/terminalManager.js'
import {
  deleteFromWorkspace,
  existsInWorkspace,
  getWorkspaceTree,
  listDirectoryInWorkspace,
  readFileFromWorkspace,
  writeFileToWorkspace,
} from '../utils/workspaceManager.js'
import { buildSystemPrompt } from './agentFrameworks.js'

// ---------------------------------------------------------------------------
// The AI CODING AGENT.
//
// One loop against Groq's OpenAI-compatible chat-completions endpoint with
// tool/function calling: ask -> tool calls -> execute them for REAL on the
// workspace (files + shell) -> feed the results back -> ask again … until the
// model answers with plain text (the final summary), or the MAX_TOOL_CALLS cap
// is hit. Every step is streamed to the UI through emit() as an 'agent:action'
// event, so the panel shows a live Claude-Code-style feed instead of one final
// answer.
//
// There is NO built-in Groq key: `apiKey` is decrypted by apiKeyService just
// for this run and dropped when it ends.
// ---------------------------------------------------------------------------

/** Hard cap on tool executions per run (runaway-loop protection). */
export const MAX_TOOL_CALLS = 25

// ---------------------------------------------------------------------------
// Model selection — DYNAMIC, never hardcoded
// ---------------------------------------------------------------------------
//
// Groq retires models over time. `llama-3.3-70b-versatile` — the old default
// here — was announced for retirement in 2026 and now answers 404
// "model does not exist" on keys that no longer serve it (that was the
// root cause of the agent's 404). Hardcoding ANY id is therefore a time bomb.
//
// So, at the start of every run, the agent asks Groq which models THIS user's
// key can actually use (GET /models) and picks the first id from the
// tool-capable allowlist below. The allowlist mirrors Groq's "Tool Use"
// support table (verified against console.groq.com/docs/tool-use).
const TOOL_CAPABLE_MODELS = [
  // Current, recommended (best agentic/tool behaviour first).
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
  'minimaxai/minimax-m2.7',
  // Still tool-capable, but being retired — kept so keys that still serve
  // them keep working rather than erroring.
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'openai/gpt-oss-safeguard-20b',
  // Older ids, for keys that still have access.
  'moonshotai/kimi-k2-instruct-0905',
  'qwen/qwen3-32b',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'meta-llama/llama-4-scout-17b-16e-instruct',
]

/** Allowlist with an optional GROQ_MODEL override moved to the front. */
function preferredModelOrder() {
  const preferred = String(env.groqModel ?? '').trim()
  if (!preferred) return TOOL_CAPABLE_MODELS
  return [preferred, ...TOOL_CAPABLE_MODELS.filter((id) => id !== preferred)]
}

/** The model ids this key can use, straight from Groq's live /models list. */
export async function listAvailableModels(apiKey) {
  const key = String(apiKey ?? '').trim()
  if (!key) throw new Error('No Groq API key is available for this run.')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(`${env.groqBaseUrl}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: controller.signal,
    })

    if (!response.ok) {
      let detail = ''
      try {
        detail = (await response.json())?.error?.message ?? ''
      } catch {}
      if (response.status === 401 || response.status === 403) {
        throw new Error('Groq rejected the saved API key (401). Update it in Settings → AI.')
      }
      throw new Error(
        `Could not list the Groq models available to this key (${response.status})${detail ? `: ${detail}` : '.'}`,
      )
    }

    const body = await response.json()
    return (Array.isArray(body?.data) ? body.data : [])
      .map((model) => String(model?.id ?? '').trim())
      .filter(Boolean)
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      throw new Error('Groq did not answer the model-list request within 20 seconds.')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The model this run will use: the first tool-capable id the key actually has.
 * Throws a clear, actionable error when the key has none.
 */
export async function resolveGroqModel(apiKey) {
  const available = new Set(await listAvailableModels(apiKey))
  const match = preferredModelOrder().find((id) => available.has(id))
  if (match) return match

  const sample = [...available].slice(0, 8).join(', ')
  throw new Error(
    'None of the Groq models available to this key support the tools the agent needs. ' +
      `Available: ${sample || '(none)'}. Update or replace the key in Settings → AI.`,
  )
}

/**
 * The MODEL FALLBACK PLAN: every allowlisted tool-capable id that at least ONE
 * of the user's saved keys can use, in preferred order. The agent walks this
 * list when a model is rate-limited: it retries the SAME model with the next
 * saved key, and only advances to the next model once every key has been tried.
 *
 * A key that cannot answer GET /models (bad/rotated) does not abort the plan —
 * the remaining keys are still consulted. Only when NO key can list models does
 * this throw, with that key's error.
 */
export async function resolveModelPlan(apiKeys) {
  const union = new Set()
  let firstError = null
  let anyListed = false

  for (const key of apiKeys) {
    try {
      const available = await listAvailableModels(key.plain)
      anyListed = true
      for (const id of available) union.add(id)
    } catch (error) {
      if (!firstError) firstError = error
    }
  }

  if (!anyListed) throw firstError ?? new Error('No Groq API key is available for this run.')

  const models = preferredModelOrder().filter((id) => union.has(id))
  if (models.length === 0) {
    const sample = [...union].slice(0, 8).join(', ')
    throw new Error(
      'None of the Groq models available to the saved keys support the tools the agent needs. ' +
        `Available: ${sample || '(none)'}. Update or replace a key in Settings → AI.`,
    )
  }
  return models
}

// ---------------------------------------------------------------------------
// Project naming — "Scratch" → a real project name derived from the task.
// ---------------------------------------------------------------------------

// Filler words that describe the ACT, not the project, so they are dropped
// before the name is built ("create a todo app" -> "todo-app").
const PROJECT_NAME_STOPWORDS = new Set([
  'create', 'build', 'make', 'add', 'write', 'generate', 'implement', 'develop',
  'a', 'an', 'the', 'for', 'with', 'using', 'use', 'to', 'of', 'and', 'or', 'in',
  'on', 'my', 'me', 'please', 'new', 'simple', 'basic',
])

/**
 * A short, filesystem-safe project name inferred from the user's task. This is
 * the deterministic fallback (no extra model call) used when a task starts in
 * the anonymous scratch workspace: "Create a todo app with localStorage" ->
 * "todo-app". Empty/meaningless tasks become "my-project".
 */
export function deriveProjectName(task) {
  const words = String(task ?? '')
    .toLowerCase()
    .replace(/[`'"]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((word) => !PROJECT_NAME_STOPWORDS.has(word))

  const picked = words.slice(0, 2)
  const name = picked
    .join('-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/[.\s]+$/, '')

  return name || 'my-project'
}

const LLM_TIMEOUT_MS = 120000 // Groq is fast; 2 min per call is already generous
const MAX_TOOL_RESULT_CHARS = 8000 // what the model gets back per tool
const MAX_READ_CHARS = 24000 // read_file content cap

// ---------------------------------------------------------------------------
// Token-lean history trimming
// ---------------------------------------------------------------------------
//
// The agent loop appends EVERY assistant tool-call message and EVERY tool result
// to `messages`, then resends the whole array on each turn. Left alone, a single
// read_file/create_file round can push tens of thousands of characters into the
// prompt, and each subsequent turn pays for all of them again — which is how a
// simple task races toward the rate limit.
//
// `trimMessages` keeps the most recent turns FULLY intact (the model needs them)
// and slims everything older: large tool results are replaced with a one-line
// placeholder, and create_file/edit_file file bodies inside older tool-call
// arguments are dropped (only the path survives). Nothing is mutated on the
// canonical history — this only affects what is SENT this turn.
const KEEP_RECENT_MESSAGES = 8
const OLD_TOOL_RESULT_MAX = 400

function slimToolCallArguments(rawArguments) {
  const raw = typeof rawArguments === 'string' ? rawArguments : ''
  if (raw.length <= 200) return rawArguments
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return '{}'
  }
  const slim = {}
  if (parsed.path) slim.path = parsed.path
  if (parsed.command) slim.command = String(parsed.command).slice(0, 200)
  if (parsed.timeout_ms) slim.timeout_ms = parsed.timeout_ms
  return JSON.stringify(slim)
}

function trimMessages(messages) {
  const cutoff = messages.length - KEEP_RECENT_MESSAGES
  if (cutoff <= 2) return messages // only the system+user preamble is old

  return messages.map((message, index) => {
    if (index >= cutoff) return message

    if (
      message.role === 'tool' &&
      typeof message.content === 'string' &&
      message.content.length > OLD_TOOL_RESULT_MAX
    ) {
      return {
        ...message,
        content: `[Older tool result omitted to save tokens (${message.content.length} chars). Re-run the tool if you need it again.]`,
      }
    }

    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      return {
        ...message,
        tool_calls: message.tool_calls.map((call) => ({
          ...call,
          function: call.function
            ? { ...call.function, arguments: slimToolCallArguments(call.function.arguments) }
            : call.function,
        })),
      }
    }

    return message
  })
}
const MAX_TREE_LINES = 400
const MAX_TREE_DEPTH = 4

const OPENAI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_file',
      description:
        'Create a new file (or overwrite it if it exists) at a path relative to the project root. Parent folders are created automatically.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path, e.g. src/App.jsx' },
          content: { type: 'string', description: 'Full file content' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Overwrite an EXISTING file with new full content. Use for edits/updates after read_file. Fails if the file does not exist.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path of the existing file' },
          content: { type: 'string', description: 'The complete new content of the file' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: "Read a file's current content before deciding how to edit it.",
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path of the file to read' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description:
        'List the files and folders at a path (pass "." for the project root) to explore the project structure.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative folder path, "." for the root' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file OR a folder (folders are removed recursively).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to delete' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Run a shell command in the project workspace (npm install, npx create-vite…, npm run build, git status, …) and wait for it to finish. Returns its output and exit code. Installs/builds may take minutes; long-running servers are NOT allowed.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute' },
          timeout_ms: {
            type: 'number',
            description:
              'Optional timeout in ms (default 180000, max 300000). Raise it for slow installs.',
          },
        },
        required: ['command'],
      },
    },
  },
]

const TOOL_LABELS = {
  create_file: 'create_file',
  edit_file: 'edit_file',
  read_file: 'read_file',
  list_directory: 'list_directory',
  delete_file: 'delete_file',
  run_command: 'run_command',
}

function truncate(text, limit) {
  const value = String(text ?? '')
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n[… ${value.length - limit} more characters truncated …]`
}

/** Human line for the action feed, e.g. "Create src/App.jsx", "Run: npm install". */
function describeAction(name, args) {
  switch (name) {
    case 'create_file':
      return `Create ${args.path ?? 'file'}`
    case 'edit_file':
      return `Edit ${args.path ?? 'file'}`
    case 'read_file':
      return `Read ${args.path ?? 'file'}`
    case 'list_directory':
      return `List ${(args.path && args.path !== '.' ? args.path : 'project root')}`
    case 'delete_file':
      return `Delete ${args.path ?? 'item'}`
    case 'run_command':
      return `Run: ${truncate(args.command ?? '', 160)}`
    default:
      return `Call ${name}`
  }
}

// ---------------------------------------------------------------------------
// The six REAL tools
// ---------------------------------------------------------------------------

async function executeTool(name, args, projectId) {
  switch (name) {
    case 'create_file':
    case 'edit_file': {
      const path = String(args.path ?? '').trim()
      const content = typeof args.content === 'string' ? args.content : String(args.content ?? '')
      if (!path) return { text: 'Error: a "path" is required.' }
      if (name === 'edit_file' && !existsInWorkspace(projectId, path)) {
        return {
          text: `Error: "${path}" does not exist — use create_file to create it (or read_file first).`,
        }
      }
      const saved = writeFileToWorkspace(projectId, path, content)
      const verb = name === 'create_file' ? 'Created' : 'Updated'
      return { text: `${verb} ${saved} (${Buffer.byteLength(content, 'utf8')} bytes).` }
    }

    case 'read_file': {
      const path = String(args.path ?? '').trim()
      if (!path) return { text: 'Error: a "path" is required.' }
      const content = readFileFromWorkspace(projectId, path)
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
      return { text }
    }

    case 'delete_file': {
      const path = String(args.path ?? '').trim()
      if (!path) return { text: 'Error: a "path" is required.' }
      const deleted = await deleteFromWorkspace(projectId, path)
      return { text: `Deleted ${deleted}.` }
    }

    case 'run_command': {
      const command = String(args.command ?? '').trim()
      if (!command) return { text: 'Error: a "command" is required.' }
      const outcome = await runWorkspaceCommand(projectId, command, {
        timeoutMs: args.timeout_ms,
      })
      const header = outcome.timedOut
        ? `TIMED OUT after ${Math.round((Number(args.timeout_ms) || 180000) / 1000)}s (command killed). Partial output:`
        : `Exit code: ${outcome.exitCode ?? 0} (took ${(outcome.durationMs / 1000).toFixed(1)}s)`
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

// ---------------------------------------------------------------------------
// Project-structure context for the system prompt
// ---------------------------------------------------------------------------

const COLLAPSE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.cache',
  '.turbo',
  'coverage',
])

async function buildTreeContext(projectId) {
  let tree
  try {
    tree = await getWorkspaceTree(projectId)
  } catch (error) {
    return `(project structure unavailable: ${error.message})`
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
      const isFolder = node.type === 'folder'
      lines.push(`${indent}${node.name}${isFolder ? '/' : ''}`)
    }
    if (node.type !== 'folder') return
    if (depth > 0 && COLLAPSE_DIRS.has(node.name)) {
      lines[lines.length - 1] += '  [collapsed — do not explore]'
      return
    }
    if (depth >= MAX_TREE_DEPTH) {
      if (depth > 0 && lines.length > 0) lines[lines.length - 1] += '  [deeper…]'
      return
    }
    for (const child of node.children ?? []) walk(child, depth + 1)
  }

  walk(tree, 0)
  if (truncated) lines.push('[… structure truncated …]')
  return lines.length ? lines.join('\n') : '(empty project — no files yet)'
}

// ---------------------------------------------------------------------------
// Groq call
// ---------------------------------------------------------------------------

/**
 * Milliseconds to wait before retrying after a 429, or null when Groq did not
 * tell us. Understands both `Retry-After` (seconds or an HTTP date) and the
 * "Please try again in 15.79s" / "...in 1m30s" phrasing inside the error text.
 */
function parseRetryAfterMs(response, detail) {
  const unitsToMs = { ms: 1, s: 1000, m: 60000, h: 3600000 }
  const fromText = (text) => {
    const match = /try again in\s*([\d.]+)\s*(ms|s|m|h)?/i.exec(String(text ?? ''))
    if (!match) return null
    const value = Number(match[1])
    if (!Number.isFinite(value)) return null
    return Math.round(value * (unitsToMs[(match[2] ?? 's').toLowerCase()] ?? 1000))
  }

  try {
    const header = response?.headers?.get?.('retry-after')
    if (header) {
      const seconds = Number(header)
      if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000))
      const date = Date.parse(header)
      if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
    }
  } catch {}

  return fromText(detail)
}

async function callGroq(apiKey, messages, model) {
  // Defensive trimming: a key or model string that picked up whitespace from
  // an .env file or a copy/paste would otherwise become a 401/404 at Groq.
  const key = String(apiKey ?? '').trim()
  const modelId = String(model ?? '').trim()
  if (!modelId) throw new Error('No Groq model was resolved for this run.')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  try {
    const response = await fetch(`${env.groqBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages,
        tools: OPENAI_TOOLS,
        tool_choice: 'auto',
        temperature: 0.2,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      let detail = ''
      try {
        const body = await response.json()
        detail = body?.error?.message ?? ''
      } catch {}
      let message = `Groq API error (${response.status})${detail ? `: ${detail}` : ''}`
      if (response.status === 401 || response.status === 403) {
        message = 'Groq rejected the saved API key (401). Update it in Settings → AI.'
      } else if (response.status === 429) {
        message = `Groq rate limit reached (429)${detail ? `: ${detail}` : '. Wait a moment and retry.'}`
      } else if (response.status >= 500) {
        message = 'Groq is unavailable right now (server error). Try again shortly.'
      }
      const error = new Error(message)
      error.status = response.status
      // How long Groq says to wait, when it says so — from the standard
      // `Retry-After` header or the "Please try again in 15.79s" text Groq puts
      // in the 429 body. The fallback chain uses this to decide whether letting
      // the clock run a few seconds is worth it before giving up.
      error.retryAfterMs = parseRetryAfterMs(response, detail)
      throw error
    }

    return await response.json()
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      throw new Error('Groq did not answer within 120 seconds. Try again.')
    }
    if (error.status) throw error
    throw new Error(`Could not reach the Groq API: ${error.message}`)
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

/** Maximum wait the agent will sit through before giving up on rate limits. */
const MAX_FALLBACK_WAIT_MS = 15000

const RATE_LIMIT_FINAL_MESSAGE =
  'All available API keys/models are currently rate-limited. Please wait a moment and try again, or add another API key in Settings.'

/**
 * Runs one task to completion.
 *
 * @param {object}   options
 * @param {string}   options.projectId workspace to operate on
 * @param {string}   options.task       natural-language task from the user
 * @param {string}   options.framework  framework id from the selector
 * @param {string[]} options.apiKeys    DECRYPTED Groq keys, preference order
 * @param {string}   options.apiKey     single-key shorthand (kept for callers/tests)
 * @param {function} options.emit       (event) => void — streams agent:action
 * @returns {Promise<{ message: string, toolCalls: number, durationMs: number, limitReached?: boolean }>}
 *   Resolves with the final summary; rejects on fatal errors (bad key, network),
 *   after already emitting an 'error' action so the UI can show it too.
 */
export async function runAgent({ projectId, task, framework, apiKey, apiKeys, emit = () => {} }) {
  const startedAt = Date.now()
  let toolCalls = 0

  const event = (type, description, details = {}) => {
    // Re-using an actionId in details makes two events describe ONE logical
    // action ("running" -> "done"), so the feed can upsert instead of duplicating.
    const { actionId, ...rest } = details
    emit({
      type,
      description,
      details: rest,
      actionId: actionId ?? crypto.randomUUID(),
      at: Date.now(),
    })
  }

  // The user's saved keys, in preference order. A single-key caller (or an
  // older test harness) falls back to the `apiKey` shorthand.
  const keys = (Array.isArray(apiKeys) ? apiKeys : [])
    .map((key) => ({ id: key?.id ?? null, label: key?.label ?? '', plain: String(key?.plain ?? '') }))
    .filter((key) => key.plain)
  if (keys.length === 0 && apiKey) keys.push({ id: null, label: '', plain: String(apiKey) })

  if (keys.length === 0) {
    const error = new Error('No Groq API key is available for this run.')
    event('error', error.message, { status: 'done' })
    throw error
  }

  const keyLabel = (key) => key.label || `key ${keys.indexOf(key) + 1}`

  // Resolve the fallback plan FIRST: the union of tool-capable models any saved
  // key can use, in preferred order. A key with no usable model fails with a
  // clear message instead of a 404 halfway through the loop.
  let models
  try {
    models = await resolveModelPlan(keys)
  } catch (error) {
    event('error', error.message, { status: 'done' })
    throw error
  }

  let activeKey = keys[0]
  let model = models[0]

  /**
   * One chat completion with TRANSPARENT key/model fallback.
   *
   * Order: the currently-active combination first, then every other model ×
   * saved-key pair. A 429 moves to the next key on the SAME model before a new
   * model is tried; a 404 (model not served by that key) skips just that pair;
   * a 401/403 skips that key. Every switch is announced in the live feed AND
   * carries the new model id so the panel header tracks the real combination.
   * When every pair is rate-limited, a short (<15s) Groq-suggested wait is
   * honoured once before the run fails with the final rate-limit message.
   */
  async function requestCompletion(messagesForRequest) {
    const combos = []
    for (const candidateModel of models) {
      for (const candidateKey of keys) combos.push({ key: candidateKey, model: candidateModel })
    }
    // Bring the active combination to the front without duplicating others.
    const ordered = [
      { key: activeKey, model },
      ...combos.filter((combo) => combo.key !== activeKey || combo.model !== model),
    ]

    const failures = []

    for (let index = 0; index < ordered.length; index += 1) {
      const combo = ordered[index]
      try {
        const response = await callGroq(combo.key.plain, messagesForRequest, combo.model)
        if (combo.key !== activeKey || combo.model !== model) {
          activeKey = combo.key
          model = combo.model
          event(
            'fallback',
            `Recovered — now using ${combo.model} with ${keyLabel(combo.key)}.`,
            { status: 'done', model: combo.model, tool: 'fallback' },
          )
        }
        return response
      } catch (error) {
        const retryable =
          error.status === 429 ||
          error.status === 404 ||
          error.status === 401 ||
          error.status === 403
        if (!retryable) throw error

        failures.push({ combo, error })

        const next = ordered[index + 1]
        if (next && error.status === 429) {
          const sameModel = next.model === combo.model
          const description = sameModel
            ? `Rate limit hit on ${combo.model} with ${keyLabel(combo.key)} — switching to ${keyLabel(next.key)}…`
            : `Rate limited on ${combo.model} across saved keys — switching to ${next.model}…`
          event('fallback', description, {
            status: 'done',
            model: next.model,
            tool: 'fallback',
          })
        } else if (next && error.status === 404) {
          event(
            'fallback',
            `${combo.model} is not available on ${keyLabel(combo.key)} — trying ${next.model}…`,
            { status: 'done', model: next.model, tool: 'fallback' },
          )
        } else if (next && (error.status === 401 || error.status === 403)) {
          event(
            'fallback',
            `${keyLabel(combo.key)} was rejected — trying ${keyLabel(next.key)}…`,
            { status: 'done', model: next.model, tool: 'fallback' },
          )
        }
      }
    }

    // Every combination failed. If Groq told us a SHORT wait would clear it,
    // honour that once (rather than failing instantly) — but only when there is
    // genuinely nothing else to try.
    const waits = failures
      .map(({ error }) => error.retryAfterMs)
      .filter((value) => Number.isFinite(value) && value > 0)
    const shortWait = waits.length ? Math.min(...waits) : null

    if (shortWait !== null && shortWait <= MAX_FALLBACK_WAIT_MS) {
      event(
        'thinking',
        `All keys/models are rate-limited — waiting ${Math.ceil(shortWait / 1000)}s before one retry…`,
        { status: 'thinking', model },
      )
      await new Promise((resolve) => setTimeout(resolve, shortWait))
      try {
        const response = await callGroq(activeKey.plain, messagesForRequest, model)
        event('fallback', `Recovered after the wait — continuing on ${model}.`, {
          status: 'done',
          model,
          tool: 'fallback',
        })
        return response
      } catch (error) {
        failures.push({ combo: { key: activeKey, model }, error })
      }
    }

    const error = new Error(RATE_LIMIT_FINAL_MESSAGE)
    error.status = 429
    error.code = 'RATE_LIMITED'
    throw error
  }

  event('thinking', 'Starting the agent…', {
    status: 'thinking',
    model,
    keyLabel: keyLabel(activeKey),
    keys: keys.length,
  })
  const treeContext = await buildTreeContext(projectId)

  const messages = [
    { role: 'system', content: buildSystemPrompt(framework, treeContext) },
    { role: 'user', content: task },
  ]

  for (;;) {
    let response
    try {
      // Send a TRIMMED view of the history: recent turns stay complete, older
      // tool results and file bodies are slimmed so the prompt stays lean.
      response = await requestCompletion(trimMessages(messages))
    } catch (error) {
      event('error', error.message, { status: 'done', model })
      throw error
    }

    const message = response?.choices?.[0]?.message
    if (!message) {
      const error = new Error('Groq returned an empty response. Try again.')
      event('error', error.message, { status: 'done' })
      throw error
    }
    messages.push(message)

    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
    if (calls.length === 0) {
      const finalText = String(message.content ?? '').trim() || 'Task complete.'
      event('complete', finalText, {
        status: 'done',
        durationMs: Date.now() - startedAt,
        toolCalls,
        model,
      })
      return { message: finalText, toolCalls, durationMs: Date.now() - startedAt, model }
    }

    event('thinking', 'Working on it…', { status: 'thinking' })

    for (const call of calls) {
      if (toolCalls >= MAX_TOOL_CALLS) {
        const limitMessage = `Stopped after ${MAX_TOOL_CALLS} tool calls — the per-run limit. The files created so far are on disk; review the work or run the task again to continue.`
        event('complete', limitMessage, {
          status: 'done',
          limitReached: true,
          toolCalls,
          durationMs: Date.now() - startedAt,
          model,
        })
        return {
          message: limitMessage,
          toolCalls,
          durationMs: Date.now() - startedAt,
          limitReached: true,
          model,
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

      const actionId = crypto.randomUUID()
      const description = describeAction(name, args)
      // (a) announce the action BEFORE it runs, so the feed streams live
      event(TOOL_LABELS[name] ?? 'thinking', description, {
        tool: name,
        args: { path: args.path, command: args.command },
        status: 'running',
        actionId,
      })

      // (b) execute for REAL on the workspace (files / shell)
      let outcome
      try {
        outcome = await executeTool(name, args, projectId)
      } catch (error) {
        outcome = { text: `Error: ${error.message}` }
      }

      // (c) report the result under the SAME actionId (updates the feed row,
      //     e.g. "Running npm install" -> its captured output + exit code)
      event(TOOL_LABELS[name] ?? 'thinking', description, {
        tool: name,
        args: { path: args.path, command: args.command },
        status: 'done',
        actionId,
        result: truncate(outcome.text, 4000),
        ...(outcome.details ?? {}),
      })

      messages.push({
        role: 'tool',
        tool_call_id: call.id ?? call.function?.name ?? `call_${toolCalls}`,
        content: truncate(outcome.text, MAX_TOOL_RESULT_CHARS),
      })
    }
  }
}
