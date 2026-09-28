import crypto from 'node:crypto'
import fs from 'node:fs'
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
import { buildSystemPrompt, isVanillaFramework, resolveTier } from '../agent/prompts/index.js'
import { findRuleBlock } from './strictRules.js'
import { formatGateReport, vanillaGate } from '../agent/quality/vanillaGate.js'
import { formatQuickCheck, quickCheck } from '../agent/quality/quickCheck.js'
import {
  autofixConnections,
  connectionCheck,
  detectRepairIntent,
  formatAutofixReport,
  formatConnectionReport,
} from '../agent/quality/connectionCheck.js'
import { GATE_MAX_REPAIR_ROUNDS } from '../agent/quality/thresholds.js'
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
  providerChatStream,
} from './providerClient.js'

export const MAX_TOOL_CALLS = 60
// A vanilla site is 4-6 files. Anything above this is a loop, and every extra
// turn resends the whole conversation — the tool cap is also a token cap.
export const VANILLA_MAX_TOOL_CALLS = 25
// One file must never be grown through dozens of append calls: that is the
// "part 1..31" loop that burned the user's budget and stalled the run.
export const MAX_APPENDS_PER_FILE = 6
// Repair rounds for the cheap automatic check (no model tokens on the happy path).
export const MAX_QUICK_CHECK_ROUNDS = 2
// Repair rounds for the html<->css<->js connection check (links, class coverage).
export const MAX_CONNECTION_ROUNDS = 2
// Soft per-task token budget. At 70% the agent is told to wrap up, at 100% the
// run stops cleanly with a summary instead of silently burning another 300K.
export const TASK_TOKEN_BUDGET = 150000
export const TASK_WRAP_UP_RATIO = 0.7

const MAX_GATE_ROUNDS = GATE_MAX_REPAIR_ROUNDS
// A file is "already written" (and therefore never re-creatable) once this many
// lines exist on disk from THIS run.
const CREATE_OVERWRITE_MIN_LINES = 6
// Guards that catch a stuck loop: N consecutive writes to one file, or N write
// calls that never produced a new file.
const STUCK_SAME_PATH_STREAK = 5
const STUCK_WRITE_CALLS = 12
const BUDGET_WAIT_STEP_MS = 20000
const DESIRED_MAX_COMPLETION = 2500
const MIN_COMPLETION = 800
const KEEP_RECENT_MESSAGES = 8
const KEEP_FULL_TURNS = 4
const MIN_HTML_LINES = 10
const MAX_AUTO_CONTINUES = 5
const MAX_SUMMARY_CONTINUES = 2
const MAX_EMPTY_RETRIES = 2
const DEBUG_AGENT = process.env.DEBUG_AGENT === '1'
const CODE_COMPLETION_MODEL = /codestral/i
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
  'Invalid tool-call JSON. Send the file again as ONE create_file call with the complete file (or one complete block of at least 80 lines if the file is very large), and escape quotes and newlines properly.'

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

function extractJsonObject(text) {
  const source = String(text ?? '')
  const start = source.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  return null
}

function normalizePlanFiles(value) {
  const files = []
  for (const entry of Array.isArray(value) ? value : []) {
    const candidate = typeof entry === 'string' ? entry : entry?.path
    const filePath = String(candidate ?? '')
      .replace(/\\/g, '/')
      .replace(/^\.?\//, '')
      .trim()
    if (!filePath || files.some((file) => file.path === filePath)) continue
    files.push({
      path: filePath,
      purpose: typeof entry === 'object' && entry ? String(entry.purpose ?? '') : '',
    })
  }
  return files
}

export function parsePlanJson(text) {
  const raw = String(text ?? '')
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  for (const source of [fenced?.[1], raw]) {
    if (!source || !source.includes('{')) continue
    const json = extractJsonObject(source)
    if (!json) continue
    let parsed = null
    try {
      parsed = JSON.parse(json)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    const files = normalizePlanFiles(parsed.files)
    const projectName = slugifyProjectName(parsed.project_name ?? parsed.projectName)
    if (files.length === 0 && !projectName) continue
    return {
      projectName: projectName ?? null,
      brand: parsed.brand && typeof parsed.brand === 'object' ? parsed.brand : null,
      nav: (Array.isArray(parsed.nav) ? parsed.nav : []).map((entry) => ({
        label: String((typeof entry === 'string' ? entry : entry?.label) ?? '').trim(),
        href: String((typeof entry === 'object' && entry ? entry.href : '') ?? '').trim(),
      })),
      files,
      pages: (Array.isArray(parsed.pages) ? parsed.pages : [])
        .map((entry) => ({
          file: String((typeof entry === 'string' ? entry : entry?.file) ?? '')
            .replace(/\\/g, '/')
            .replace(/^\.?\//, '')
            .trim(),
          sections: (Array.isArray(entry?.sections) ? entry.sections : [])
            .map((section) => String(section ?? '').trim())
            .filter(Boolean),
        }))
        .filter((page) => page.file),
      requirements: (Array.isArray(parsed.requirements) ? parsed.requirements : [])
        .map((item) => String(item ?? '').trim())
        .filter(Boolean),
    }
  }
  return null
}

function planSpecText(doc) {
  if (!doc) return ''
  const parts = [`project ${doc.projectName ?? 'unnamed'}`]
  if (doc.brand?.name) {
    parts.push(`brand ${doc.brand.name}${doc.brand.industry ? ` (${doc.brand.industry})` : ''}`)
  }
  if (doc.nav.length > 0) parts.push(`nav ${doc.nav.map((item) => `${item.label}->${item.href}`).join(' | ')}`)
  if (doc.files.length > 0) parts.push(`files ${doc.files.map((file) => file.path).join(', ')}`)
  if (doc.pages.length > 0) {
    parts.push(`pages ${doc.pages.map((page) => `${page.file}[${page.sections.join(', ')}]`).join(' | ')}`)
  }
  if (doc.requirements.length > 0) parts.push(`requirements ${doc.requirements.join(' | ')}`)
  return `SPEC: ${parts.join('; ')}`
}

function appendGuidance(messages, text) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'tool') {
      message.content = `${message.content ?? ''}\n\n${text}`
      return true
    }
    if (message?.role === 'assistant') break
  }
  messages.push({ role: 'user', content: text })
  return false
}

async function plannedFileIssues(projectId, plannedPaths) {
  if (!Array.isArray(plannedPaths) || plannedPaths.length === 0) return []
  const issues = []
  for (const file of plannedPaths) {
    const content = await readWorkspaceFileSafe(projectId, file)
    if (content === null) {
      issues.push({ path: file, kind: 'missing' })
      continue
    }
    const lines = countLines(content)
    if (!content.trim()) {
      issues.push({ path: file, kind: 'empty' })
      continue
    }
    if (looksLikePlaceholder(content)) {
      issues.push({ path: file, kind: 'placeholder', lines })
      continue
    }
    if (!/\.html?$/i.test(file)) continue
    if (lines < MIN_HTML_LINES) {
      issues.push({ path: file, kind: 'tooSmall', lines })
      continue
    }
    const head = content.replace(/^\uFEFF/, '').trimStart()
    if (!/^<!doctype\s+html/i.test(head)) {
      issues.push({ path: file, kind: 'noDoctype', lines })
      continue
    }
    if (!/<\/html>\s*$/i.test(content.trimEnd())) {
      issues.push({ path: file, kind: 'noClosingHtml', lines })
    }
  }
  return issues
}

function formatIssues(issues) {
  return (issues ?? []).map((issue) => {
    switch (issue.kind) {
      case 'missing':
        return `${issue.path} was not written`
      case 'empty':
        return `${issue.path} is empty`
      case 'placeholder':
        return `${issue.path} contains placeholder text instead of real content`
      case 'tooSmall':
        return `${issue.path} is only ${issue.lines} line(s) and looks incomplete`
      case 'noDoctype':
        return `${issue.path} does not start with <!DOCTYPE html>`
      case 'noClosingHtml':
        return `${issue.path} does not end with </html>`
      default:
        return `${issue.path} has a problem`
    }
  })
}

async function missingPlannedFiles(projectId, plannedPaths) {
  const issues = await plannedFileIssues(projectId, plannedPaths)
  return issues.map((issue) => issue.path)
}

async function nextPlannedPath(projectId, plannedPaths, exclude = null) {
  const issues = await plannedFileIssues(projectId, plannedPaths)
  const remaining = issues.filter((issue) => issue.path !== exclude)
  return remaining.length > 0
    ? `finish ${formatIssues(remaining).join('; ')}`
    : 'stop with your short summary.'
}

async function buildProgressHint(projectId, plannedPaths, justWritten) {
  if (!Array.isArray(plannedPaths) || plannedPaths.length === 0) return ''
  const issues = await plannedFileIssues(projectId, plannedPaths)
  const remaining = issues.map((issue) => issue.path)
  const done = plannedPaths.filter((file) => !remaining.includes(file))
  const next = remaining.find((file) => file !== justWritten) ?? remaining[0] ?? null
  return `Progress ${done.length} of ${plannedPaths.length} planned files. Remaining: ${
    remaining.length > 0 ? remaining.join(', ') : 'none'
  }. Next: ${next ?? 'finish with your short summary'}`
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

const PLACEHOLDER_PATTERNS = [
  /^\s*\[(?:written|omitted|truncated|redacted|placeholder|content)/i,
  /^\s*\[written:.*lines?\]\s*$/i,
  /^\s*(?:\.\.\.|\u2026)\s*$/,
  /^\s*(?:TODO|FIXME)\s*:?\s*content\b/i,
  /^\s*<content omitted>\s*$/i,
]

function looksLikePlaceholder(content) {
  const trimmed = String(content ?? '').trim()
  if (!trimmed) return true
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed))
}

function looksComplete(filePath, text) {
  const lines = countLines(text)
  if (lines < 10 || looksLikePlaceholder(text)) return false
  if (/\.html?$/i.test(String(filePath ?? ''))) {
    const head = text.replace(/^\uFEFF/, '').trimStart()
    return /^<!doctype\s+html/i.test(head) && /<\/html>\s*$/i.test(text.trimEnd())
  }
  return true
}

function validateWriteContent(name, filePath, content) {
  const text = typeof content === 'string' ? content : String(content ?? '')
  const lines = countLines(text)
  const isHtml = /\.html?$/i.test(String(filePath ?? ''))

  if (!text.trim()) {
    return `Error: the "content" for "${filePath}" was empty. Write the FULL file content in THIS call.`
  }
  if (looksLikePlaceholder(text)) {
    return `Error: the "content" for "${filePath}" looks like a placeholder ("${truncate(
      text.trim(),
      40,
    )}"), not file content. Write the FULL file content in THIS call.`
  }
  if (name === 'append_to_file') return null
  if (!isHtml) return null

  if (lines < MIN_HTML_LINES) {
    return `Error: "${filePath}" was only ${lines} line(s) and an HTML page must be complete. Write the FULL page in THIS call: <!DOCTYPE html>, <head>, the shared <header>/<nav>, <main>, the shared <footer> and the closing </html>.`
  }
  const head = text.replace(/^\uFEFF/, '').trimStart()
  if (!/^<!doctype\s+html/i.test(head)) {
    return `Error: "${filePath}" must start with <!DOCTYPE html>. Write the FULL page in THIS call.`
  }
  return null
}

function workspaceStateText(writtenThisRun) {
  if (!writtenThisRun || writtenThisRun.size === 0) return ''
  const files = [...writtenThisRun.entries()].map(([file, info]) => `${file} (${info.lines} lines)`)
  return `Files already written in this run: ${files.join(', ')}.`
}

async function readWorkspaceFileSafe(projectId, relativePath) {
  const clean = String(relativePath ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/?\.?\//, '')
    .trim()
  if (!clean || clean.split('/').includes('..')) return null
  try {
    return await fs.promises.readFile(path.join(getWorkspacePath(projectId), clean), 'utf8')
  } catch {
    return null
  }
}

// One compact line per tool call, in the OpenCode/Freebuff style: the running
// and the done text describe the SAME action, and the client collapses both
// into one row, so "Writing index.html…" simply becomes "Wrote index.html".
function describeAction(name, args, { phase = 'running', lines = 0 } = {}) {
  const filePath = args.path ?? 'file'
  switch (name) {
    case 'create_file':
      return phase === 'running' ? `Writing ${filePath}…` : `Wrote ${filePath} · ${lines} lines`
    case 'append_to_file':
      return phase === 'running' ? `Extending ${filePath}…` : `Extended ${filePath} · +${lines} lines`
    case 'edit_file':
      return phase === 'running' ? `Editing ${filePath}…` : `Edited ${filePath} · ${lines} lines`
    case 'read_file':
      return `Read ${filePath}`
    case 'list_directory':
      return `Listed ${args.path && args.path !== '.' ? args.path : 'project root'}`
    case 'delete_file':
      return `Deleted ${args.path ?? 'item'}`
    case 'run_command':
      return phase === 'running'
        ? `Running: ${truncate(args.command ?? '', 120)}…`
        : `Ran: ${truncate(args.command ?? '', 120)}`
    default:
      return `Call ${name}`
  }
}

function describeFailure(name, args, outcome = null) {
  const filePath = args.path ?? 'file'
  const raw = String(outcome?.text ?? '')
  const reason = raw.startsWith('Error:')
    ? raw.replace(/^Error:\s*/, '').split('\n')[0].slice(0, 160)
    : ''
  switch (name) {
    case 'create_file':
      return reason ? `Failed to write ${filePath} — ${reason}` : `Failed to write ${filePath}`
    case 'append_to_file':
      return reason ? `Failed to extend ${filePath} — ${reason}` : `Failed to extend ${filePath}`
    case 'edit_file':
      return reason ? `Failed to edit ${filePath} — ${reason}` : `Failed to edit ${filePath}`
    default:
      return reason ? `Failed: ${name} — ${reason}` : `Failed: ${name}`
  }
}

const ERROR_HINTS = {
  EPERM:
    'The path is locked by another program on Windows (open terminal, editor or antivirus). Retry, close what holds it, or write to a different path.',
  EBUSY: 'The path is busy right now. Retry in a moment, or write to a different path.',
  EACCES: 'The path is not writable. Check the folder permissions or pick another path.',
  ENOSPC: 'The disk is full — free some space and retry.',
  ENOENT:
    'The target folder no longer exists. Call list_directory to see the current structure and use the path it shows.',
  EISDIR: 'That path is a folder, not a file. Use a file path inside it.',
  ENOTDIR:
    'Part of the path is a file, not a folder. Call list_directory and correct the path.',
  NOT_A_FILE: 'That path is a folder. Use a file path inside it.',
  NOT_A_FOLDER: 'That path is a file. Use the parent folder instead.',
  ALREADY_EXISTS: 'An item with that name already exists — pick a different name or edit the existing one.',
  INVALID_PATH: 'The path is outside the workspace or malformed — use a relative path inside the project.',
  FILE_MISSING:
    'The file does not exist. Call list_directory to confirm the path, then create it with create_file.',
  WORKSPACE_MISSING:
    'The workspace folder is gone (it may have been cleared on restart). Re-import the project, then retry.',
}

function toolErrorMessage(name, args, error) {
  const code = error?.code ? String(error.code) : null
  const reason = error?.message ?? String(error)
  const hint = code ? ERROR_HINTS[code] : null
  const target = args?.path ? `"${args.path}"` : args?.command ? `command "${truncate(args.command, 80)}"` : 'the target'
  const verb =
    name === 'create_file'
      ? 'create'
      : name === 'append_to_file'
        ? 'extend'
        : name === 'edit_file'
          ? 'edit'
          : name === 'delete_file'
            ? 'delete'
            : name
  return `Error: could not ${verb} ${target}${code ? ` (${code})` : ''}: ${reason}${hint ? ` ${hint}` : ''}`
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

function debugToolCall(name, filePath, content, outcome) {
  if (!DEBUG_AGENT) return
  const head = String(content ?? '').slice(0, 40).replace(/\s+/g, ' ')
  console.log(
    `[agent] ${name} ${filePath} contentLen=${String(content ?? '').length} outcome=${outcome} head=${JSON.stringify(head)}`,
  )
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
      if (name === 'create_file' && existsInWorkspace(projectId, filePath)) {
        const existing = await readWorkspaceFileSafe(projectId, filePath)
        if (existing !== null && looksComplete(filePath, existing)) {
          return {
            text: `Error: "${filePath}" already exists (${countLines(existing)} lines) and is complete, so create_file would throw that file away. Use edit_file to replace it, append_to_file to extend it, or pick a new file name.`,
            rejected: true,
          }
        }
      }
      const invalid = validateWriteContent(name, filePath, content)
      if (invalid) {
        debugToolCall(name, filePath, content, 'rejected')
        return { text: invalid, rejected: true }
      }
      let saved
      try {
        saved = writeFileToWorkspace(projectId, filePath, content)
      } catch (error) {
        debugToolCall(name, filePath, content, 'error')
        return { text: toolErrorMessage(name, args, error) }
      }
      debugToolCall(name, saved, content, 'written')
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
      const invalid = validateWriteContent(name, filePath, content)
      if (invalid) {
        debugToolCall(name, filePath, content, 'rejected')
        return { text: invalid, rejected: true }
      }
      let saved
      try {
        saved = appendFileToWorkspace(projectId, filePath, content)
      } catch (error) {
        debugToolCall(name, filePath, content, 'error')
        return { text: toolErrorMessage(name, args, error) }
      }
      debugToolCall(name, saved, content, 'appended')
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

function condenseHistory(messages, keepRecent, workspaceSummary = '') {
  let cutoff = Math.max(2, messages.length - keepRecent)
  while (cutoff > 2 && messages[cutoff]?.role === 'tool') cutoff -= 1
  if (cutoff <= 2) return messages

  const droppedToolIds = new Set()
  const result = []
  messages.forEach((message, index) => {
    if (index >= cutoff) return
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
    if (message.role === 'tool') return
    if (message.role === 'assistant') {
      result.push({ role: 'assistant', content: truncate(message.content ?? '', OLD_TOOL_RESULT_MAX) })
      return
    }
    result.push(message)
  })
  if (workspaceSummary) result.push({ role: 'user', content: workspaceSummary })
  for (const message of messages.slice(cutoff)) result.push(message)
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

function pickAutoCandidate(candidates, estimatedInput, cooling, preference, requestedModel = null) {
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
  const autoScore = (candidate) => {
    let score = capabilityScore(candidate.providerId, candidate.model)
    if (requestedModel && candidate.model === requestedModel) score += 1000
    if (!requestedModel && CODE_COMPLETION_MODEL.test(candidate.model)) score -= 25
    return score
  }
  const sorted = [...usable].sort((a, b) => {
    const prefDiff = preferredRank(a, preference) - preferredRank(b, preference)
    if (prefDiff !== 0) return prefDiff
    const budgetDiff = remainingPerMinute(budgetKeyFor(b)) - remainingPerMinute(budgetKeyFor(a))
    if (budgetDiff !== 0) return budgetDiff
    return autoScore(b) - autoScore(a)
  })
  return sorted[0] ?? candidates[0]
}

function pickCandidateForMode(
  candidates,
  { task = '', estimatedInput = 0, cooling = null, preference = null, vanilla = false, requestedModel = null } = {},
) {
  const estimate =
    estimatedInput > 0
      ? estimatedInput
      : estimateTokens([{ role: 'user', content: String(task ?? '') }], OPENAI_TOOLS)
  const base = pickAutoCandidate(candidates, estimate, cooling, preference, requestedModel)
  if (!base || !vanilla || String(requestedModel ?? '').trim()) return base
  const healthy = candidates.filter(
    (candidate) =>
      candidate.providerId === base.providerId &&
      (cooling?.get(candidateIdentity(candidate)) ?? 0) <= Date.now() &&
      getKeyHealth(candidate.key?.id).status !== 'invalid',
  )
  const pool = healthy.length > 0 ? healthy : [base]
  const vanillaScore = (candidate) =>
    capabilityScore(candidate.providerId, candidate.model) -
    (CODE_COMPLETION_MODEL.test(candidate.model) ? 25 : 0)
  const strongest = [...pool].sort((a, b) => vanillaScore(b) - vanillaScore(a))[0]
  return strongest ?? base
}

export async function runAgent({
  projectId,
  task,
  framework,
  apiKey,
  apiKeys,
  emit = () => {},
  emitUsage = () => {},
  emitDelta = () => {},
  onProjectName = null,
  userId = null,
  requestedModel = null,
  requestedProvider = null,
  providerPreference = null,
  taskId = null,
  resume = false,
  shouldStop = null,
  runStartedAt = null,
  strictRules = [],
}) {
  const startedAt = Number.isFinite(runStartedAt) ? runStartedAt : Date.now()
  let toolCalls = 0
  let planReminders = 0
  let parseRetries = 0
  let quickCheckRounds = 0
  let connectionRounds = 0
  let wrapUpNotified = false
  let autoContinues = 0
  let summaryContinues = 0
  let emptyRetries = 0
  let effectiveBudget = TASK_TOKEN_BUDGET

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

  const session = resume ? getAgentSession(projectId) : null
  let plan = Array.isArray(session?.plan) ? session.plan.slice() : []
  let planDoc = session?.planDoc ?? null
  let condensedSpec = session?.condensedSpec ?? null
  let gateRounds = 0
  let gateFailure = null

  const treeContext = await buildTreeContext(projectId)
  const vanillaMode = isVanillaFramework(framework)

  const repairIntent = !resume && vanillaMode && detectRepairIntent(task)
  let repairClean = false
  let repairInfo = null
  if (repairIntent) {
    try {
      const autofix = await autofixConnections({ projectId })
      if (autofix.fixes.length > 0) {
        event_('gate', `Auto-fixed ${autofix.fixes.length} broken asset link(s) on the server.`, {
          status: 'done',
          tool: 'gate',
          passed: true,
          autofixed: autofix.fixes.length,
        })
      }
      const connection = await connectionCheck({ projectId })
      if (connection.checked.length > 0) {
        if (connection.ok) repairClean = true
        else repairInfo = connection
      }
    } catch (error) {
      console.warn(`[agent] repair precheck failed: ${error?.message ?? error}`)
      repairInfo = null
    }
  }
  const repairActive = Boolean(repairClean || repairInfo)
  if (repairInfo && !repairInfo.ok) {
    const problemFiles = (repairInfo.details?.problemFiles ?? []).filter(Boolean)
    if (problemFiles.length > 0) {
      plan = problemFiles
      planDoc = {
        projectName: null,
        brand: null,
        nav: [],
        files: problemFiles.map((file) => ({ path: file, purpose: 'connection repair' })),
        pages: [],
        requirements: [],
      }
    }
    task =
      'REPAIR ONLY — the links and styles in this project are broken. The server found exactly these problems; fix ONLY these, do not regenerate the whole site:\n' +
      repairInfo.problems.map((problem, index) => `${index + 1}. ${problem}`).join('\n')
  }

  const tierCandidate = pickCandidateForMode(candidates, {
    task,
    cooling,
    preference: providerPreference,
    vanilla: vanillaMode,
    requestedModel,
  })
  const systemMessage = {
    role: 'system',
    content: buildSystemPrompt({
      framework,
      tier: resolveTier(tierCandidate.limits, { vanilla: vanillaMode }),
      now: new Date(),
      projectStructure: treeContext,
      strictRules,
    }),
  }

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

  let active = pickCandidateForMode(candidates, {
    task,
    estimatedInput: estimateInput(),
    cooling,
    preference: providerPreference,
    vanilla: vanillaMode,
    requestedModel,
  })
  let model = active.model

  if (repairClean) {
    const message = 'Everything is connected — every page loads the shared stylesheet and script and a style rule exists for each class, so nothing needed fixing.'
    event_('complete', message, {
      status: 'done',
      durationMs: Date.now() - startedAt,
      toolCalls,
      model,
      provider: active.providerId,
      gatePassed: false,
      gateSkipped: true,
      repaired: true,
    })
    clearAgentSession(projectId)
    return {
      message,
      toolCalls,
      durationMs: Date.now() - startedAt,
      model,
      provider: active.providerId,
      gatePassed: false,
      gateSkipped: true,
      repaired: true,
    }
  }

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

  if (resume && vanillaMode && !repairIntent) {
    try {
      const connection = await connectionCheck({ projectId })
      if (!connection.ok && connection.checked.length > 0) {
        appendGuidance(messages, formatConnectionReport(connection))
        note(`Continue: ${connection.problems.length} link/style problem(s) to repair first.`)
      }
    } catch {}
  }

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

  // Anything that is NOT a real provider verdict may be retried without
  // streaming. A rate limit, an invalid key, a too-large body or a malformed
  // tool call must travel up untouched so the existing fallback/retry logic
  // still sees it.
  function canRetryWithoutStreaming(error) {
    if (!error) return false
    if (error.budget || error.tooLarge || isToolCallParseError(error)) return false
    if ([401, 403, 413, 422, 429].includes(error.status)) return false
    return true
  }

  let streamedAny = false

  async function sendCompletion(wireMessages, maxCompletionTokens, temperature, { allowStream = true } = {}) {
    const usedProvider = active.providerId
    const usedModel = active.model
    const keyId = active.key.id ?? null
    const request = {
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
    }

    let response = null
    if (allowStream) {
      try {
        response = await providerChatStream({
          ...request,
          onDelta: (delta) => {
            if (!delta?.text) return
            streamedAny = true
            emitDelta({ text: delta.text })
          },
        })
      } catch (error) {
        if (!canRetryWithoutStreaming(error)) throw error
        note('The provider stopped streaming — retrying this turn without streaming…')
        if (streamedAny) {
          // Drop the half-streamed text before the non-streamed answer arrives.
          emitDelta({ text: '', reset: true })
          streamedAny = false
        }
      }
    }
    if (!response) response = await providerChat(request)
    streamedAny = false

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
      const wireMessages = condenseHistory(messages, keep, workspaceStateText(writtenThisRun))
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

  let budgetWaitedMs = 0
  async function waitForBudgetWindow() {
    pruneCooling()
    const pending = candidates
      .map((candidate) => cooling.get(candidateIdentity(candidate)) ?? 0)
      .filter((until) => until > Date.now())
    const waitMs =
      pending.length > 0
        ? Math.min(...pending.map((until) => Math.max(0, until - Date.now())))
        : BUDGET_WAIT_STEP_MS
    if (budgetWaitedMs + waitMs > MAX_TOTAL_WAIT_MS) return false
    note('The per-minute token budget is spent — waiting for it to refill…', null, { waitingMs: waitMs })
    await countdownWait(waitMs)
    budgetWaitedMs += waitMs
    return true
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
          coolCandidate(previous, BUDGET_WAIT_STEP_MS)
          const next = advanceCandidate()
          if (next) {
            switchNote(previous, `${previousLabel} per-minute budget used up`)
            continue
          }
          if (await waitForBudgetWindow()) continue
          throw error
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
        planDoc,
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

  const toolCallCapBase = vanillaMode ? VANILLA_MAX_TOOL_CALLS : MAX_TOOL_CALLS
  let toolCallCap = toolCallCapBase

  // ---- per-run guard state -------------------------------------------------
  // writtenThisRun: path -> { lines, calls } for every file THIS run wrote.
  // appendCallsByPath: path -> append_to_file calls already spent on it.
  // writeStreak / writesWithoutNewFile: how a stuck loop is spotted.
  const writtenThisRun = new Map()
  const appendCallsByPath = new Map()
  let writeStreakPath = null
  let writeStreak = 0
  let writesWithoutNewFile = 0
  let stuckWarnings = 0

  const wrapUpHint = async (usedTokens) => {
    const remaining = await missingPlannedFiles(projectId, plan)
    return [
      `TOKEN BUDGET: this task has used about ${Math.round(usedTokens / 1000)}K of its ~${Math.round(effectiveBudget / 1000)}K budget.`,
      remaining.length > 0
        ? `Wrap up now: finish only the remaining planned files (${remaining.join(', ')}) — one create_file call each — then stop and summarise.`
        : 'Wrap up now: stop writing files and finish with your short summary.',
    ].join(' ')
  }

  const stopRequested = () => typeof shouldStop === 'function' && Boolean(shouldStop())

  const finishStopped = () => {
    const stopMessage = 'Stopped by the user.'
    event_('complete', stopMessage, {
      status: 'done',
      stopped: true,
      durationMs: Date.now() - startedAt,
      toolCalls,
      model,
      provider: active.providerId,
    })
    persistSession('stopped')
    return {
      message: stopMessage,
      stopped: true,
      toolCalls,
      durationMs: Date.now() - startedAt,
      model,
      provider: active.providerId,
    }
  }

  const tryAutoContinue = (reason) => {
    if (autoContinues >= MAX_AUTO_CONTINUES) return false
    autoContinues += 1
    toolCallCap += toolCallCapBase
    effectiveBudget += TASK_TOKEN_BUDGET
    wrapUpNotified = false
    stuckWarnings = 0
    writeStreak = 0
    writesWithoutNewFile = 0
    parseRetries = 0
    note(`Continuing automatically (${autoContinues} of ${MAX_AUTO_CONTINUES}) — ${reason}.`)
    return true
  }

  for (;;) {
    if (stopRequested()) return finishStopped()
    const baseTemperature = vanillaMode ? 0.3 : 0.2
    const temperature =
      parseRetries === 0 ? baseTemperature : Math.max(0, baseTemperature - parseRetries * 0.1)
    let response
    try {
      ;({ response } = await requestCompletion(temperature))
    } catch (error) {
      if (isToolCallParseError(error)) {
        if (parseRetries < MAX_PARSE_RETRIES) {
          parseRetries += 1
          note('Tool call was malformed, retrying with smaller chunks…')
          appendGuidance(messages, TOOL_CALL_CORRECTION_NOTE)
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
          appendGuidance(messages, TOOL_CALL_CORRECTION_NOTE)
          continue
        }
      }
      event_('error', error.message, { status: 'done', model })
      persistSession(error.code ?? 'error')
      throw error
    }

    parseRetries = 0

    // ---- soft token budget -------------------------------------------------
    // A normal 3-page vanilla site costs well under 150K tokens. Hitting 70%
    // tells the model to wrap up, hitting 100% ends the run cleanly with a
    // summary instead of silently burning another 300K like the old loop did.
    const usedTokens = taskId ? (getTaskTotals(taskId)?.totalTokens ?? 0) : 0
    if (usedTokens >= effectiveBudget) {
      const issuesNow = await plannedFileIssues(projectId, plan)
      if (
        issuesNow.length > 0 &&
        tryAutoContinue('the token budget was spent before the files were finished')
      ) {
        appendGuidance(
          messages,
          `TOKEN BUDGET reached, but work remains: ${formatIssues(issuesNow).join(
            '; ',
          )}. Continue now — one create_file per file — then stop with your short summary.`,
        )
        continue
      }
      const stopMessage =
        `Stopped: this task reached its ~${Math.round(effectiveBudget / 1000)}K token budget. ` +
        (issuesNow.length > 0
          ? `Still incomplete: ${formatIssues(issuesNow).join('; ')}. Use Continue to finish them.`
          : 'Every planned file was written.')
      event_('complete', stopMessage, {
        status: 'done',
        durationMs: Date.now() - startedAt,
        toolCalls,
        model,
        provider: active.providerId,
        budgetReached: true,
        plannedFiles: plan.length,
        missingFiles: issuesNow.map((issue) => issue.path),
      })
      persistSession('budget')
      return {
        message: stopMessage,
        toolCalls,
        durationMs: Date.now() - startedAt,
        limitReached: true,
        budgetReached: true,
        model,
        provider: active.providerId,
      }
    }
    if (!wrapUpNotified && usedTokens >= effectiveBudget * TASK_WRAP_UP_RATIO) {
      wrapUpNotified = true
      appendGuidance(messages, await wrapUpHint(usedTokens))
      note(
        `Token budget at ${Math.round((usedTokens / effectiveBudget) * 100)}% — telling the agent to wrap up…`,
      )
    }

    const message = response?.choices?.[0]?.message
    if (!message) {
      if (emptyRetries < MAX_EMPTY_RETRIES && autoContinues < MAX_AUTO_CONTINUES) {
        emptyRetries += 1
        autoContinues += 1
        note('The provider returned an empty response — retrying automatically…')
        appendGuidance(messages, 'Your previous reply was empty. Continue the task now.')
        continue
      }
      const error = new Error('The provider returned an empty response. Try again.')
      event_('error', error.message, { status: 'done' })
      persistSession('empty_response')
      throw error
    }
    emptyRetries = 0

    if (plan.length === 0 && !planDoc && message.content) {
      const jsonPlan = parsePlanJson(message.content)
      const parsed = jsonPlan ?? extractPlan(message.content)
      if (jsonPlan || parsed.files.length > 0 || parsed.projectName) {
        plan = jsonPlan ? jsonPlan.files.map((file) => file.path) : parsed.files
        planDoc = jsonPlan
          ? {
              projectName: jsonPlan.projectName,
              brand: jsonPlan.brand,
              nav: jsonPlan.nav,
              files: jsonPlan.files,
              pages: jsonPlan.pages,
              requirements: jsonPlan.requirements,
            }
          : {
              projectName: parsed.projectName ?? null,
              brand: null,
              nav: [],
              files: plan.map((file) => ({ path: file, purpose: '' })),
              pages: [],
              requirements: [],
            }
        const firstUser = messages.find((entry) => entry.role === 'user')
        condensedSpec = truncate(planSpecText(planDoc), 1200)
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

    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
    if (calls.length === 0) {
      const issues = await plannedFileIssues(projectId, plan)
      const missing = issues.map((issue) => issue.path)
      if (issues.length > 0 && planReminders < 3 && toolCalls < toolCallCap) {
        planReminders += 1
        messages.push(message)
        appendGuidance(
          messages,
          `These planned files are not complete yet: ${formatIssues(issues).join(
            '; ',
          )}. Write each one completely in a single create_file call.`,
        )
        note(`Verifying the plan — ${issues.length} file(s) still incomplete…`)
        continue
      }
      // Cheap, token-free verification FIRST: a lost chunk, a page that does
      // not end with </html>, a tiny file or a broken local link is a real
      // failure and travels back as ONE short message inside the last tool
      // result. It costs no model tokens on the happy path.
      let quick
      try {
        quick = await quickCheck({ projectId, plan: planDoc, files: plan })
      } catch (error) {
        quick = { ok: false, problems: [`The automatic check could not run: ${error.message}`] }
      }
      if (!quick.ok && quickCheckRounds < MAX_QUICK_CHECK_ROUNDS && toolCalls < toolCallCap) {
        quickCheckRounds += 1
        event_(
          'gate',
          `Automatic check found ${quick.problems.length} problem(s) — repair round ${quickCheckRounds} of ${MAX_QUICK_CHECK_ROUNDS}.`,
          {
            status: 'done',
            tool: 'gate',
            passed: false,
            round: quickCheckRounds,
            failures: quick.problems.slice(0, 12),
          },
        )
        appendGuidance(messages, formatQuickCheck(quick))
        note(`Fixing the automatic check failures — round ${quickCheckRounds}…`)
        continue
      }
      if (!quick.ok) {
        if (tryAutoContinue('the automatic content check still found problems')) {
          quickCheckRounds = 0
          appendGuidance(messages, formatQuickCheck(quick))
          continue
        }
        gateFailure = { failures: quick.problems, checks: [] }
        event_('gate', `Automatic check still failing (${quick.problems.length} problem(s)).`, {
          status: 'done',
          tool: 'gate',
          passed: false,
          failures: quick.problems.slice(0, 12),
        })
      }

      if (vanillaMode) {
        try {
          const autofix = await autofixConnections({ projectId })
          if (autofix.fixes.length > 0) {
            event_('gate', `Auto-fixed ${autofix.fixes.length} broken asset link(s) on the server.`, {
              status: 'done',
              tool: 'gate',
              passed: true,
              autofixed: autofix.fixes.length,
            })
          }
        } catch {}

        let connection = null
        try {
          connection = await connectionCheck({ projectId, files: plan.length > 0 ? plan : null })
        } catch (error) {
          connection = {
            ok: false,
            problems: [`The link/style check could not run: ${error.message}`],
            checked: [],
            details: {},
          }
        }
        if (connection && !connection.ok && connection.checked.length > 0) {
          if (connectionRounds < MAX_CONNECTION_ROUNDS && toolCalls < toolCallCap) {
            connectionRounds += 1
            event_(
              'gate',
              `Link/style check found ${connection.problems.length} problem(s) — repair round ${connectionRounds} of ${MAX_CONNECTION_ROUNDS}.`,
              {
                status: 'done',
                tool: 'gate',
                passed: false,
                round: connectionRounds,
                failures: connection.problems.slice(0, 12),
              },
            )
            appendGuidance(messages, formatConnectionReport(connection))
            note(`Repairing the link/style problems — round ${connectionRounds} of ${MAX_CONNECTION_ROUNDS}…`)
            continue
          }
          if (tryAutoContinue('the link/style check still found problems')) {
            connectionRounds = 0
            appendGuidance(messages, formatConnectionReport(connection))
            continue
          }
          gateFailure = gateFailure ?? { failures: connection.problems, checks: [] }
          event_('gate', `Link/style check still failing (${connection.problems.length} problem(s)).`, {
            status: 'done',
            tool: 'gate',
            passed: false,
            failures: connection.problems.slice(0, 12),
          })
        }
      }

      if (vanillaMode && quick.ok && !repairActive) {
        let gate = null
        try {
          gate = await vanillaGate({ projectId, plan: planDoc, now: new Date() })
        } catch (error) {
          gate = { ok: false, failures: [`The quality gate could not run: ${error.message}`], checks: [] }
        }
        if (gate.ok) {
          event_('gate', `Quality gate passed — ${gate.checks.length} check group(s) verified.`, {
            status: 'done',
            tool: 'gate',
            passed: true,
            checks: gate.checks.length,
          })
        } else if (gateRounds < MAX_GATE_ROUNDS && toolCalls < toolCallCap) {
          gateRounds += 1
          event_(
            'gate',
            `Quality gate found ${gate.failures.length} problem(s) — repair round ${gateRounds} of ${MAX_GATE_ROUNDS}.`,
            {
              status: 'done',
              tool: 'gate',
              passed: false,
              round: gateRounds,
              failures: gate.failures.slice(0, 12),
              checks: gate.checks.length,
            },
          )
          appendGuidance(messages, formatGateReport(gate, { maxRounds: MAX_GATE_ROUNDS }))
          note(`Repair round ${gateRounds} of ${MAX_GATE_ROUNDS} — fixing the gate failures…`)
          continue
        } else {
          if (tryAutoContinue('the quality gate still found problems')) {
            gateRounds = 0
            appendGuidance(messages, formatGateReport(gate, { maxRounds: MAX_GATE_ROUNDS }))
            continue
          }
          gateFailure = gate
          event_(
            'gate',
            `Quality gate still failing (${gate.failures.length} problem(s)) after ${gateRounds} repair round(s).`,
            {
              status: 'done',
              tool: 'gate',
              passed: false,
              failures: gate.failures.slice(0, 12),
              checks: gate.checks.length,
            },
          )
        }
      }

      const finishReason = response?.choices?.[0]?.finish_reason
      if (finishReason === 'length' && summaryContinues < MAX_SUMMARY_CONTINUES) {
        summaryContinues += 1
        messages.push({ role: 'assistant', content: String(message.content ?? '') })
        appendGuidance(
          messages,
          'Your last reply was cut off by the token limit. Finish your short summary now — at most two sentences — then stop.',
        )
        note('The final summary was cut off — asking the model to finish it…')
        continue
      }

      messages.push(message)
      const finalText = stripProjectNameLine(String(message.content ?? '').trim()) || 'Task complete.'
      const honestText = gateFailure
        ? `${finalText}\n\nStill failing the quality gate:\n${gateFailure.failures
            .map((failure, index) => `${index + 1}. ${failure}`)
            .join('\n')}`
        : finalText
      const totals = taskId ? getTaskTotals(taskId) : null
      const summaryTotals = { requests: totals?.requests ?? 0, totalTokens: totals?.totalTokens ?? 0 }
      event_('complete', honestText, {
        status: 'done',
        durationMs: Date.now() - startedAt,
        toolCalls,
        model,
        provider: active.providerId,
        plannedFiles: plan.length,
        missingFiles: missing.length,
        gatePassed: gateFailure ? false : vanillaMode && !repairActive,
        gateSkipped: repairActive || undefined,
        gateFailures: gateFailure?.failures ?? [],
        ...summaryTotals,
      })
      clearAgentSession(projectId)
      return {
        message: honestText,
        toolCalls,
        durationMs: Date.now() - startedAt,
        model,
        provider: active.providerId,
        suggestedName: extractProjectName(message.content) ?? planDoc?.projectName ?? null,
        gatePassed: gateFailure ? false : vanillaMode && !repairActive,
        gateSkipped: repairActive || undefined,
        ...summaryTotals,
      }
    }

    messages.push(message)

    event_('thinking', 'Working on it…', { status: 'thinking', provider: active.providerId })

    let capReached = false
    for (const call of calls) {
      if (toolCalls >= toolCallCap) {
        const issuesAtCap = await plannedFileIssues(projectId, plan)
        if (
          issuesAtCap.length > 0 &&
          tryAutoContinue(`reached the per-run tool-call limit (${toolCallCap})`)
        ) {
          appendGuidance(
            messages,
            `Tool-call limit reached, but work remains: ${formatIssues(issuesAtCap).join(
              '; ',
            )}. Continue and finish them — one create_file per file — then stop with your short summary.`,
          )
          capReached = true
          break
        }
        const limitMessage = `Stopped after ${toolCalls} tool calls — the per-run limit for this stack. Use Continue to finish the remaining files.`
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
      const filePath = String(args.path ?? '')
      const alreadyWritten = filePath ? writtenThisRun.get(filePath) : null
      let rejection = ''
      const ruleBlock = findRuleBlock({
        name,
        args,
        rules: strictRules,
        fileExists: (target) => existsInWorkspace(projectId, target),
      })
      if (ruleBlock) rejection = ruleBlock.message

      // Cap the appends per file. Growing one stylesheet through 31 tiny
      // append calls is exactly the loop that burned ~510K tokens on a 3-page
      // site, and the file was still broken afterwards.
      if (name === 'append_to_file') {
        const used = appendCallsByPath.get(filePath) ?? 0
        if (used >= MAX_APPENDS_PER_FILE) {
          rejection =
            `Error: "${filePath}" has already been appended to ${used} times in this run — the per-file limit, and the file is long enough. Stop writing it and ${await nextPlannedPath(projectId, plan, filePath)}`
        } else {
          appendCallsByPath.set(filePath, used + 1)
        }
      }

      // create_file OVERWRITES. Refusing to re-create a file this run already
      // wrote is what stops a repaired page from ending up as just its tail.
      if (
        !rejection &&
        name === 'create_file' &&
        (alreadyWritten?.lines ?? 0) >= CREATE_OVERWRITE_MIN_LINES
      ) {
        rejection = `Error: "${filePath}" was already written in this run (${alreadyWritten.lines} lines) and create_file would OVERWRITE it. Use append_to_file to extend it, or edit_file to replace it deliberately.`
      }

      if (!ruleBlock) {
        event_(TOOL_LABELS[name] ?? 'thinking', describeAction(name, args, { phase: 'running' }), {
          tool: name,
          args: { path: args.path, command: args.command },
          status: 'running',
          actionId,
        })
      }

      let outcome
      if (rejection) {
        outcome = { text: rejection }
      } else {
        try {
          outcome = await executeTool(name, args, projectId)
        } catch (error) {
          outcome = { text: toolErrorMessage(name, args, error) }
        }
      }

      const failed = String(outcome.text ?? '').startsWith('Error')
      if (ruleBlock) {
        event_('rule_blocked', `Blocked by your rule: ${truncate(ruleBlock.rule, 80)}`, {
          tool: name,
          args: { path: args.path, command: args.command },
          status: 'done',
          actionId,
          result: truncate(outcome.text, 2000),
          rule: ruleBlock.rule,
        })
      } else {
        event_(
          TOOL_LABELS[name] ?? 'thinking',
          failed
            ? describeFailure(name, args, outcome)
            : describeAction(name, args, { phase: 'done', lines: outcome.lines ?? 0 }),
          {
            tool: name,
            args: { path: args.path, command: args.command },
            status: failed ? 'error' : 'done',
            actionId,
            result: truncate(outcome.text, 2000),
            ...(outcome.details ?? {}),
          },
        )
      }

      const writeSucceeded = WRITE_TOOLS.has(name) && !failed
      let modelResult = outcome.modelText ?? truncate(outcome.text ?? '', MAX_TOOL_RESULT_CHARS)

      if (writeSucceeded) {
        const isNewFile = !alreadyWritten
        const totalLines =
          name === 'create_file'
            ? (outcome.lines ?? 0)
            : (alreadyWritten?.lines ?? 0) + (outcome.lines ?? 0)
        writtenThisRun.set(filePath, {
          lines: totalLines,
          calls: (alreadyWritten?.calls ?? 0) + 1,
        })

        const progress = await buildProgressHint(projectId, plan, filePath)
        if (progress) modelResult = `${modelResult}\n${progress}`

        // Every page is checked immediately: it must end with </html>, must not
        // be a 3-line fragment, and must not contain a dead link. Only the
        // file's own integrity is checked here (its siblings may not exist
        // yet), which is what keeps it free of false alarms.
        if (/\.html?$/i.test(filePath)) {
          try {
            const quick = await quickCheck({ projectId, files: [filePath], checkReferences: false })
            const text = formatQuickCheck(quick)
            if (text) modelResult = `${modelResult}\n\n${text}`
          } catch {}
        }

        // The connection check runs after EVERY html/css/js write too: a
        // root-absolute asset path and an unbalanced stylesheet are found the
        // moment they are written, not three pages later.
        if (vanillaMode && /\.(html?|css|js)$/i.test(filePath)) {
          try {
            const autofix = await autofixConnections({ projectId })
            const fixText = formatAutofixReport(autofix)
            if (fixText) modelResult = `${modelResult}\n\n${fixText}`
            if (autofix.fixes.length > 0) {
              event_('gate', `Auto-fixed ${autofix.fixes.length} broken asset link(s).`, {
                status: 'done',
                tool: 'gate',
                passed: true,
                autofixed: autofix.fixes.length,
              })
            }
            const connection = await connectionCheck({ projectId, checkExistence: false })
            const connectionText = formatConnectionReport(connection)
            if (connectionText) modelResult = `${modelResult}\n\n${connectionText}`
          } catch {}
        }

        // ---- stuck-loop detection ------------------------------------------
        writeStreak = writeStreakPath === filePath ? writeStreak + 1 : 1
        writeStreakPath = filePath
        writesWithoutNewFile = isNewFile ? 0 : writesWithoutNewFile + 1
        const remaining = await missingPlannedFiles(projectId, plan)
        const stuck =
          remaining.length > 0 &&
          (writeStreak >= STUCK_SAME_PATH_STREAK || writesWithoutNewFile >= STUCK_WRITE_CALLS)
        if (stuck) {
          const issueText = formatIssues(await plannedFileIssues(projectId, plan)).join('; ')
          if (stuckWarnings >= 2 && !tryAutoContinue(`the agent kept repeating "${filePath}"`)) {
            const stopMessage = `Stopped: the agent kept repeating "${filePath}" without finishing. Still incomplete: ${issueText}. Use Continue to finish them.`
            event_('complete', stopMessage, {
              status: 'done',
              limitReached: true,
              stuck: true,
              toolCalls,
              durationMs: Date.now() - startedAt,
              model,
              provider: active.providerId,
            })
            persistSession('stuck')
            return {
              message: stopMessage,
              toolCalls,
              durationMs: Date.now() - startedAt,
              limitReached: true,
              model,
              provider: active.providerId,
            }
          }
          stuckWarnings += 1
          writeStreak = 0
          writesWithoutNewFile = 0
          modelResult = `${modelResult}\n\nStop writing ${filePath}. Finish only these incomplete files: ${issueText}. One create_file call each, then summarise and stop.`
          note(`Stuck loop detected on ${filePath} — telling the agent to move on…`)
        }
      }

      messages.push({
        role: 'tool',
        tool_call_id: call.id ?? call.function?.name ?? `call_${toolCalls}`,
        content: modelResult,
      })
    }
    if (capReached) continue
  }
}

export { isToolCallParseError }
