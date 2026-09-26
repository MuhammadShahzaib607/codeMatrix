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

const LLM_TIMEOUT_MS = 120000 // Groq is fast; 2 min per call is already generous
const MAX_TOOL_RESULT_CHARS = 12000 // what the model gets back per tool
const MAX_READ_CHARS = 30000 // read_file content cap
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

async function callGroq(apiKey, messages) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  try {
    const response = await fetch(`${env.groqBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: env.groqModel,
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

/**
 * Runs one task to completion.
 *
 * @param {object}   options
 * @param {string}   options.projectId workspace to operate on
 * @param {string}   options.task       natural-language task from the user
 * @param {string}   options.framework  framework id from the selector
 * @param {string}   options.apiKey     DECRYPTED Groq key (memory only)
 * @param {function} options.emit       (event) => void — streams agent:action
 * @returns {Promise<{ message: string, toolCalls: number, durationMs: number, limitReached?: boolean }>}
 *   Resolves with the final summary; rejects on fatal errors (bad key, network),
 *   after already emitting an 'error' action so the UI can show it too.
 */
export async function runAgent({ projectId, task, framework, apiKey, emit = () => {} }) {
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

  event('thinking', 'Starting the agent…', { status: 'thinking' })
  const treeContext = await buildTreeContext(projectId)

  const messages = [
    { role: 'system', content: buildSystemPrompt(framework, treeContext) },
    { role: 'user', content: task },
  ]

  for (;;) {
    let response
    try {
      response = await callGroq(apiKey, messages)
    } catch (error) {
      event('error', error.message, { status: 'done' })
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
      })
      return { message: finalText, toolCalls, durationMs: Date.now() - startedAt }
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
        })
        return {
          message: limitMessage,
          toolCalls,
          durationMs: Date.now() - startedAt,
          limitReached: true,
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
