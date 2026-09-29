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
import { buildProjectSnapshot } from '../agent/prompts/projectSnapshot.js'
import { AGENT_MEMORY_FILENAME, readAgentMemory } from './agentMemory.js'
import { queueAgentFsChange } from './agentFsNotifier.js'
import { findRuleBlock } from './strictRules.js'
import { buildScaffoldAppPlan, buildScaffoldPlan, sectionCatalog } from '../templates/vanilla-kit/index.js'
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
import { formatVisualReport, visualSanityCheck } from '../agent/quality/visualSanity.js'
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
  PREFERRED_AGENT_MODEL,
  isAllowedModel,
  isCodeOnlyModel,
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
  splitJsonPayload,
  trimTrailingNameLeak,
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
// Soft PER-TASK token budget, measured rather than guessed. A complete one-page
// vanilla landing page (plan + scaffold_site + one full-page write + the quality
// gate) costs ~44K cumulative tokens in a real runAgent run (4 requests; 38K
// prompt / 5.8K completion). The budget is 4x that so a 3-5 page site fits with
// room for a repair round, and it is a limit for the WHOLE task: an internal
// auto-continue only tops it up by a bounded fraction, it can never reset it.
export const MEASURED_LANDING_PAGE_TOKENS = 44000
export const TASK_TOKEN_BUDGET = MEASURED_LANDING_PAGE_TOKENS * 4
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
// A continuation tops the task budget up by this fraction, capped at
// MAX_BUDGET_MULTIPLIER x the base — enough to finish real work, never enough
// to hide a runaway loop.
const AUTO_CONTINUE_BUDGET_BONUS = 0.34
const MAX_BUDGET_MULTIPLIER = 2.5
// How many times the SAME failing check may be auto-continued before the run
// stops honestly instead of burning the budget on a loop that changes nothing.
const MAX_STALLED_CONTINUES = 1
// A stuck loop stops after this many detections — cumulative, never reset by an
// auto-continue, so a model that keeps rewriting one page cannot burn the whole
// task budget before the run stops honestly.
const MAX_STUCK_WARNINGS = 3
const MAX_SUMMARY_CONTINUES = 2
const MAX_EMPTY_RETRIES = 2
const DEBUG_AGENT = process.env.DEBUG_AGENT === '1'
const CODE_COMPLETION_MODEL = /codestral/i
const CODE_ONLY_PENALTY = 60
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

const TOOL_ARG_SPECS = {
  create_file: {
    keys: 'path, content',
    example: '{"path":"index.html","content":"<!DOCTYPE html>…"}',
  },
  append_to_file: {
    keys: 'path, content',
    example: '{"path":"css/base.css","content":".card { border-radius: 8px; }"}',
  },
  edit_file: {
    keys: 'path, old_string, new_string (or path, content for a whole-file rewrite)',
    example:
      '{"path":"css/theme.css","old_string":"--color-primary: #4361ee;","new_string":"--color-primary: #e94560;"}',
  },
  scaffold_site: {
    keys: 'brand, pages',
    example: '{"brand":"Acme","pages":[{"file":"index.html","sections":["hero","services"]}]}',
  },
  scaffold_app: {
    keys: 'title, brand, palette',
    example: '{"title":"Tip Calculator","brand":"Acme","palette":"indigo-modern"}',
  },
  read_file: { keys: 'path', example: '{"path":"index.html"}' },
  list_directory: { keys: 'path', example: '{"path":"."}' },
  delete_file: { keys: 'path', example: '{"path":"old.html"}' },
  run_command: { keys: 'command', example: '{"command":"npm run build"}' },
}

function toolArgSpec(toolName) {
  const spec = TOOL_ARG_SPECS[toolName]
  if (spec) {
    return `${toolName} takes exactly these keys: ${spec.keys}. Example: ${toolName} ${spec.example}`
  }
  return (
    `Valid tools: ${Object.keys(TOOL_LABELS).join(', ')}. The write tools take these exact keys — ` +
    `create_file: path, content. append_to_file: path, content. edit_file: path, old_string, new_string (or path, content). ` +
    `Example: edit_file ${TOOL_ARG_SPECS.edit_file.example}`
  )
}

function toolFailureNotes(toolName, failureText) {
  const spec = toolArgSpec(toolName)
  const last = failureText ? ` Last error: ${failureText}` : ''
  return {
    nonStream: `Your last two tool calls failed, so this turn is being re-requested WITHOUT streaming. ${spec}${last} Send ONE complete tool call with balanced JSON and nothing else.`,
    corrective: `Your tool calls are still failing. ${spec}${last} Send ONE complete tool call with balanced JSON now — no other call in the same reply.`,
    escalate: `Your tool calls keep failing, so this turn uses a different model. ${spec}${last} Send ONE simple, complete tool call and nothing else.`,
    final: `STOP. Do not send another failing tool call. ${spec}${last} If you cannot produce a valid call, reply with plain text explaining exactly what you need instead of calling a tool.`,
  }
}

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

export function normalizePlanType(value) {
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!text) return null
  if (/\b(app|tool|utility|widget|game|calculator|converter|todo)\b/.test(text)) return 'app'
  if (/\b(site|website|webpage|landing|blog|marketing|portfolio|brochure|content)\b/.test(text)) return 'site'
  return null
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
      type: normalizePlanType(parsed.type ?? parsed.project_type ?? parsed.kind),
      direction: String(parsed.direction ?? '').trim().slice(0, 240) || null,
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
  if (doc.type) parts.push(`type ${doc.type}`)
  if (doc.direction) parts.push(`direction ${doc.direction}`)
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

function plannedSectionsFor(planDoc, file) {
  const target = String(file ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .toLowerCase()
  const sections = []
  for (const page of Array.isArray(planDoc?.pages) ? planDoc.pages : []) {
    const pageFile = String(typeof page === 'string' ? page : page?.file ?? '')
      .replace(/\\/g, '/')
      .replace(/^\.?\//, '')
      .toLowerCase()
    if (pageFile !== target) continue
    for (const section of Array.isArray(page?.sections) ? page.sections : []) {
      const name = String(section ?? '').trim()
      if (name && !sections.includes(name)) sections.push(name)
    }
  }
  return sections
}

async function plannedFileIssues(projectId, plannedPaths, planDoc = null) {
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
    // "The file exists" is NOT "the page is finished". A scaffolded page whose
    // SLOT markers were never replaced, or whose plan-declared sections were
    // never written, is still incomplete work and must keep the run going.
    const leftoverSlots = (content.match(/<!--\s*SLOT:/g) || []).length
    if (leftoverSlots > 0) {
      issues.push({ path: file, kind: 'slots', count: leftoverSlots, lines })
    }
    // ONE issue per file, listing every missing section. Reporting one issue per
    // section made the progress text read "23 file(s) still incomplete" on a
    // 5-page plan, which is both wrong and useless to the model.
    const missingSections = plannedSectionsFor(planDoc, file).filter(
      (section) => !new RegExp(`id\\s*=\\s*["']${section}["']`, 'i').test(content),
    )
    if (missingSections.length > 0) {
      issues.push({ path: file, kind: 'missingSections', sections: missingSections })
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
      case 'slots':
        return `${issue.path} still has ${issue.count} empty scaffold slot(s) that were never replaced with real content`
      case 'missingSections':
        return `${issue.path} is missing ${issue.sections.length} planned section(s): ${issue.sections
          .map((section) => `<section id="${section}">`)
          .join(', ')}`
      case 'noClosingHtml':
        return `${issue.path} does not end with </html>`
      default:
        return `${issue.path} has a problem`
    }
  })
}

async function missingPlannedFiles(projectId, plannedPaths, planDoc = null) {
  const issues = await plannedFileIssues(projectId, plannedPaths, planDoc)
  return [...new Set(issues.map((issue) => issue.path))]
}

async function nextPlannedPath(projectId, plannedPaths, exclude = null, planDoc = null) {
  const issues = await plannedFileIssues(projectId, plannedPaths, planDoc)
  const remaining = issues.filter((issue) => issue.path !== exclude)
  return remaining.length > 0
    ? `finish ${formatIssues(remaining).join('; ')}`
    : 'stop with your short summary.'
}

async function buildProgressHint(projectId, plannedPaths, justWritten, planDoc = null) {
  if (!Array.isArray(plannedPaths) || plannedPaths.length === 0) return ''
  const issues = await plannedFileIssues(projectId, plannedPaths, planDoc)
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
      description:
        'Change an EXISTING file. PREFERRED: pass old_string (an exact snippet that occurs once, e.g. a <!-- SLOT:hero --> marker) plus new_string — only that snippet is replaced and the rest of the file is kept byte for byte, so the header, footer and every other section survive. ALTERNATIVE: pass content to overwrite the WHOLE file, which is only allowed for a complete page.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path' },
          old_string: {
            type: 'string',
            description: 'Exact snippet to replace, e.g. "<!-- SLOT:hero -->". Must occur exactly once in the file.',
          },
          new_string: { type: 'string', description: 'The replacement for old_string' },
          content: {
            type: 'string',
            description: 'Whole new file content (only for a complete page; prefer old_string/new_string)',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scaffold_site',
      description:
        'Create the professional starter-kit shell for a vanilla site in ONE call (no CSS writing needed): copies css/base.css and js/main.js, writes css/theme.css for the chosen palette and one full HTML page per entry with an identical header, nav and footer. Each requested section becomes a <!-- SLOT:name --> marker you later replace with real copy.',
      parameters: {
        type: 'object',
        properties: {
          brand: { type: 'string', description: 'Brand name' },
          tagline: { type: 'string', description: 'One short line about the business' },
          palette: {
            type: 'string',
            description:
              'Theme preset id: indigo-modern | emerald-fresh | sunset-warm | midnight-dark | rose-elegant | slate-corporate | gallery-ivory | playful-pop | clinic-calm',
          },
          pages: {
            type: 'array',
            description: 'One entry per page, in nav order',
            items: {
              type: 'object',
              properties: {
                file: { type: 'string', description: 'Relative page path, e.g. index.html' },
                title: { type: 'string', description: 'Unique <title>' },
                nav_label: { type: 'string', description: 'Text shown in the nav' },
                sections: {
                  type: 'array',
                  description: `kit section names, in order. Available: ${sectionCatalog()}`,
                  items: { type: 'string' },
                },
              },
              required: ['file', 'sections'],
            },
          },
        },
        required: ['brand', 'pages'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scaffold_app',
      description:
        'Create the shell for a single-purpose UTILITY APP (calculator, todo list, timer, quiz, converter, small game) in ONE call: writes the palette tokens, a compact app stylesheet and the js/app.js helpers, plus an index.html with an app bar, one <main> and a single <!-- SLOT:app --> marker. It deliberately writes NO navbar, NO hero, NO footer, NO pricing/FAQ/ testimonials — an app is not a marketing site. Never use it for a marketing/content site; use scaffold_site for those.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'App title, shown in the app bar and in <title>' },
          brand: { type: 'string', description: 'Optional short brand name for the app bar badge' },
          description: { type: 'string', description: 'One short line about what the app does (meta description)' },
          palette: {
            type: 'string',
            description:
              'Theme preset id: indigo-modern | emerald-fresh | sunset-warm | midnight-dark | rose-elegant | slate-corporate | gallery-ivory | playful-pop | clinic-calm',
          },
        },
        required: ['title'],
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
  scaffold_site: 'scaffold_site',
  scaffold_app: 'scaffold_app',
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

// A starter-kit page is recognisable by its <header class="site-header">. Every
// such page owes exactly one header, one footer and one <h1>, and must end with
// </html>. Written as a checklist so a partial rewrite can never pass again.
const SITE_PAGE_MARKER = /class\s*=\s*["'][^"']*\bsite-header\b/i

export function documentIntegrityIssues(text) {
  const problems = []
  const count = (pattern) => (String(text ?? '').match(pattern) || []).length
  const headers = count(/<header\b/gi)
  const footers = count(/<footer\b/gi)
  const h1s = count(/<h1\b/gi)
  if (headers !== 1) problems.push(`${headers} <header> (a page has exactly one)`)
  if (footers !== 1) problems.push(`${footers} <footer> (a page has exactly one)`)
  if (h1s !== 1) problems.push(`${h1s} <h1> (a page has exactly one)`)
  if (!/<\/html>\s*$/i.test(String(text ?? '').trimEnd())) problems.push('no closing </html>')
  if (problems.length === 0) return ''
  return `the document is incomplete — it has ${problems.join(', ')}`
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
    return `Error: "${filePath}" must start with <!DOCTYPE html>. Write the FULL page in THIS call, or change ONE snippet of the existing file with old_string/new_string.`
  }
  // This is the check that was missing. A whole-file rewrite that starts with
  // <!DOCTYPE html> and has 10+ lines used to be accepted even when it was only
  // the page's navbar — the page on disk then lost its footer and every section.
  if (SITE_PAGE_MARKER.test(text)) {
    const integrity = documentIntegrityIssues(text)
    if (integrity) {
      return `Error: "${filePath}" was NOT written, because ${integrity}. A page keeps exactly one <header> at the top, EVERY planned section inside <main>, and exactly one <footer> at the bottom. Fill the page one section at a time with edit_file { path, old_string: "<!-- SLOT:hero -->", new_string: "<section …>…</section>" }, or resend content for the COMPLETE page.`
    }
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
      if (args.old_string) {
        return phase === 'running' ? `Filling ${filePath}…` : `Filled ${filePath} · ${lines} lines`
      }
      return phase === 'running' ? `Editing ${filePath}…` : `Edited ${filePath} · ${lines} lines`
    case 'scaffold_site':
      return phase === 'running'
        ? `Scaffolding ${Array.isArray(args.pages) ? args.pages.length : 0} page(s) from the starter kit…`
        : `Scaffolded ${Array.isArray(args.pages) ? args.pages.length : 0} page(s) — ${lines} lines`
    case 'scaffold_app':
      return phase === 'running'
        ? `Scaffolding the ${args.title ? `${truncate(args.title, 40)} ` : ''}app shell…`
        : `Scaffolded the app shell — ${lines} lines`
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
    case 'scaffold_site':
      return reason ? `Failed to scaffold the site — ${reason}` : 'Failed to scaffold the site'
    case 'scaffold_app':
      return reason ? `Failed to scaffold the app — ${reason}` : 'Failed to scaffold the app'
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

export const PATH_ARG_ALIASES = [
  'path',
  'file_path',
  'filepath',
  'filePath',
  'filename',
  'file_name',
  'fileName',
  'name',
  'file',
  'target',
  'target_path',
  'pathname',
]

export const CONTENT_ARG_ALIASES = [
  'content',
  'contents',
  'text',
  'code',
  'body',
  'file_content',
  'fileContent',
  'source',
  'data',
]

export const COMMAND_ARG_ALIASES = ['command', 'cmd', 'shell_command', 'shellCommand']

export const OLD_STRING_ARG_ALIASES = [
  'old_string',
  'oldString',
  'oldStr',
  'old_str',
  'oldContent',
  'find',
  'search',
]
export const NEW_STRING_ARG_ALIASES = [
  'new_string',
  'newString',
  'newStr',
  'new_str',
  'newContent',
  'replace',
  'replacement',
]

function pickArgumentAlias(args, aliases) {
  for (const alias of aliases) {
    const value = args?.[alias]
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim() === '') continue
    return { key: alias, value }
  }
  return null
}

function balanceJsonFragment(text) {
  let inString = false
  let escaped = false
  const stack = []
  for (const character of text) {
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{' || character === '[') stack.push(character)
    else if (character === '}' || character === ']') stack.pop()
  }
  let repaired = text
  if (inString) repaired += '"'
  repaired = repaired.replace(/,\s*$/, '')
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    repaired += stack[index] === '{' ? '}' : ']'
  }
  return repaired
}

function extractJsonFragment(text) {
  const start = String(text ?? '').indexOf('{')
  if (start === -1) return null
  const source = String(text).slice(start)
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = 0; index < source.length; index += 1) {
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
      if (depth === 0) return source.slice(0, index + 1)
    }
  }
  return balanceJsonFragment(source)
}

function parseJsonLenient(raw) {
  if (raw && typeof raw === 'object') return { value: raw, error: null }
  const text = String(raw ?? '').trim()
  if (!text) return { value: {}, error: 'the arguments were empty' }
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object') return { value: parsed, error: null }
    return { value: {}, error: 'the arguments were not a JSON object' }
  } catch (firstError) {
    const fragment = extractJsonFragment(text)
    if (fragment) {
      try {
        const parsed = JSON.parse(fragment)
        if (parsed && typeof parsed === 'object') return { value: parsed, error: null }
      } catch {}
    }
    return { value: {}, error: firstError.message }
  }
}

function isKnownToolName(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TOOL_LABELS, value)
}

export function resolveToolCallName(rawName, rawArguments) {
  let name = String(rawName ?? '').trim()
  let argsText =
    typeof rawArguments === 'string'
      ? rawArguments
      : rawArguments == null
        ? ''
        : JSON.stringify(rawArguments)
  if (!isKnownToolName(name)) {
    const split = splitJsonPayload(name)
    let rest = name
    let embedded = ''
    if (split) {
      embedded = split.json
      rest = `${split.before} ${split.after}`
    }
    const tokens = rest.match(/[A-Za-z_][A-Za-z0-9_-]{0,63}/g) ?? []
    const recovered = [...tokens].reverse().find((token) => isKnownToolName(token))
    if (recovered) {
      name = recovered
      if (!argsText && embedded) argsText = embedded
    } else {
      name = rest.trim()
      if (!argsText) argsText = embedded
    }
  }
  if (argsText) {
    const trimmed = trimTrailingNameLeak(argsText)
    if (trimmed.arguments !== argsText) argsText = trimmed.arguments
  }
  return { name, arguments: argsText }
}

export function parseAndNormalizeToolArguments(name, rawArguments) {
  const { value, error } = parseJsonLenient(rawArguments)
  const args = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}
  if (name !== 'run_command') {
    const pathHit = pickArgumentAlias(args, PATH_ARG_ALIASES)
    if (pathHit && typeof args.path !== 'string') {
      args.path = String(pathHit.value)
      if (pathHit.key !== 'path') delete args[pathHit.key]
    }
    const contentHit = pickArgumentAlias(args, CONTENT_ARG_ALIASES)
    if (contentHit && typeof args.content !== 'string') {
      args.content = typeof contentHit.value === 'string' ? contentHit.value : JSON.stringify(contentHit.value)
      if (contentHit.key !== 'content') delete args[contentHit.key]
    }
    // Surgical-edit aliases. Kept separate from CONTENT_ARG_ALIASES on purpose:
    // "new_string" is NOT the whole file, and mapping it onto `content` would
    // overwrite a page with one section (which is exactly what broke pages).
    const oldHit = pickArgumentAlias(args, OLD_STRING_ARG_ALIASES)
    if (oldHit && typeof args.old_string !== 'string') {
      args.old_string = String(oldHit.value)
    }
    for (const alias of OLD_STRING_ARG_ALIASES) {
      if (alias !== 'old_string') delete args[alias]
    }
    const newHit = pickArgumentAlias(args, NEW_STRING_ARG_ALIASES)
    if (newHit && typeof args.new_string !== 'string') {
      args.new_string = typeof newHit.value === 'string' ? newHit.value : JSON.stringify(newHit.value)
    }
    for (const alias of NEW_STRING_ARG_ALIASES) {
      if (alias !== 'new_string') delete args[alias]
    }
  } else {
    const commandHit = pickArgumentAlias(args, COMMAND_ARG_ALIASES)
    if (commandHit && typeof args.command !== 'string') args.command = String(commandHit.value)
  }
  return { args, error }
}

function requiredPathMessage(name, args) {
  const keys = Object.keys(args ?? {})
  const received = keys.length > 0 ? keys.join(', ') : '(none)'
  const examples = {
    create_file: '{"path":"index.html","content":"<!DOCTYPE html>…"}',
    append_to_file: '{"path":"css/base.css","content":"…the next block of rules…"}',
    edit_file: '{"path":"index.html","old_string":"<!-- SLOT:hero -->","new_string":"<section class=\"hero\" id=\"hero\">…</section>"}',
    read_file: '{"path":"index.html"}',
    delete_file: '{"path":"old.html"}',
  }
  const example = examples[name] ?? '{"path":"index.html"}'
  const needsContent = WRITE_TOOLS.has(name) && name !== 'edit_file'
  const contentNote = name === 'edit_file' ? ', and either old_string + new_string or content' : needsContent ? ', content' : ''
  return (
    `Error: ${name} needs a "path" — a workspace-relative file path such as "index.html" or "css/base.css". ` +
    `It received these keys: ${received}. Required keys: path${contentNote}. ` +
    `Accepted aliases: ${PATH_ARG_ALIASES.join(', ')}. ` +
    `Send it again like this: ${name} ${example}`
  )
}

function editPayloadMessage(args) {
  const keys = Object.keys(args ?? {})
  const received = keys.length > 0 ? keys.join(', ') : '(none)'
  return (
    `Error: edit_file needs either old_string + new_string (an exact snippet that occurs once in the file) or content (a complete file). ` +
    `It received these keys: ${received}. ` +
    `Valid keys: path, old_string, new_string, content. ` +
    `Accepted aliases: path, file_path, filepath, old_string, old_str, oldStr, new_string, new_str, newStr. ` +
    `Send it again like this: edit_file ${TOOL_ARG_SPECS.edit_file.example}`
  )
}

function unknownToolMessage(name, receivedKeys = []) {
  const known = Object.keys(TOOL_LABELS).join(', ')
  const received = receivedKeys.length > 0 ? ` (it received: ${receivedKeys.join(', ')})` : ''
  return `Error: unknown tool "${name}"${received}. Use one of: ${known}.`
}

function debugToolCall(name, filePath, content, outcome) {
  if (!DEBUG_AGENT) return
  const head = String(content ?? '').slice(0, 40).replace(/\s+/g, ' ')
  console.log(
    `[agent] ${name} ${filePath} contentLen=${String(content ?? '').length} outcome=${outcome} head=${JSON.stringify(head)}`,
  )
}

function missingParentFolders(projectId, filePath) {
  const segments = String(filePath ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
  const missing = []
  for (let index = 1; index < segments.length; index += 1) {
    const prefix = segments.slice(0, index).join('/')
    try {
      if (!existsInWorkspace(projectId, prefix)) missing.push(prefix)
    } catch {
      return []
    }
  }
  return missing
}

async function executeTool(name, rawArgs, projectId) {
  const args = normalizeToolArgs(projectId, name, rawArgs)
  switch (name) {
    case 'create_file':
    case 'edit_file': {
      const filePath = String(args.path ?? '').trim()
      const content = typeof args.content === 'string' ? args.content : String(args.content ?? '')
      if (!filePath) return { text: requiredPathMessage(name, args), rejected: true }
      if (name === 'edit_file' && !existsInWorkspace(projectId, filePath)) {
        return { text: `Error: "${filePath}" does not exist (use create_file).` }
      }

      // ---- SURGICAL EDIT (the safe way to fill a scaffold slot) -------------
      // Replaces ONE exact occurrence and keeps the rest of the file byte for
      // byte, so filling a <!-- SLOT:x --> marker CANNOT drop the header, the
      // footer or the sections written before it. Before this existed the only
      // way to fill a slot was to resend the whole page, and a truncated resend
      // is what shipped "a navbar with nothing below it".
      const oldString = typeof args.old_string === 'string' ? args.old_string : ''
      if (name === 'edit_file' && oldString) {
        const existing = await readWorkspaceFileSafe(projectId, filePath)
        if (existing === null) {
          return { text: `Error: "${filePath}" does not exist (use create_file).`, rejected: true }
        }
        const newString = typeof args.new_string === 'string' ? args.new_string : String(args.new_string ?? '')
        if (!newString.trim()) {
          return {
            text: `Error: edit_file needs a non-empty "new_string" — the real markup that replaces "${truncate(oldString, 60)}".`,
            rejected: true,
          }
        }
        const candidates = [oldString]
        if (existing.includes('\r\n') && oldString.includes('\n')) {
          candidates.push(oldString.replace(/\n/g, '\r\n'))
        }
        if (oldString.trim() !== oldString) candidates.push(oldString.trim())
        let needle = null
        for (const candidate of candidates) {
          if (candidate && existing.split(candidate).length - 1 === 1) {
            needle = candidate
            break
          }
        }
        if (!needle) {
          const occurrences = existing.split(oldString).length - 1
          const slots = [...existing.matchAll(/<!--\s*SLOT:([a-z0-9-]+)\s*-->/g)].map(
            (match) => `<!-- SLOT:${match[1]} -->`,
          )
          if (occurrences > 1) {
            return {
              text: `Error: old_string appears ${occurrences} times in "${filePath}", so the edit would be ambiguous. Include a few surrounding characters so it occurs exactly once.${slots.length > 0 ? ` Empty slots still in the file: ${slots.join(', ')}.` : ''}`,
              rejected: true,
            }
          }
          return {
            text: `Error: old_string was not found in "${filePath}", so nothing was changed.${slots.length > 0 ? ` Replace one of these markers instead: ${slots.join(', ')}.` : ' Read the file with read_file and copy the exact snippet.'}`,
            rejected: true,
          }
        }
        const next = existing.replace(needle, newString)
        if (/\.html?$/i.test(filePath) && SITE_PAGE_MARKER.test(next)) {
          const integrity = documentIntegrityIssues(next)
          if (integrity) {
            return {
              text: `Error: that edit would leave "${filePath}" incomplete (${integrity}), so it was rejected. Replace one <!-- SLOT:name --> marker per call and never delete the header or the footer.`,
              rejected: true,
            }
          }
        }
        const existedBefore = existsInWorkspace(projectId, filePath)
        let saved
        try {
          saved = writeFileToWorkspace(projectId, filePath, next)
        } catch (error) {
          debugToolCall(name, filePath, next, 'error')
          return { text: toolErrorMessage(name, args, error) }
        }
        debugToolCall(name, saved, next, 'edited')
        const slotsLeft = [...next.matchAll(/<!--\s*SLOT:([a-z0-9-]+)\s*-->/g)].map((match) => match[1])
        return {
          text: `Updated ${saved}.${slotsLeft.length > 0 ? ` Empty slots left in this file: ${slotsLeft.join(', ')}.` : ' No empty slots left in this file.'}`,
          modelText: `ok, ${countLines(next)} lines${slotsLeft.length > 0 ? `, ${slotsLeft.length} slot(s) left` : ', no slots left'}`,
          lines: countLines(next),
          fsChanges: [{ path: saved, type: existedBefore ? 'change' : 'add' }],
        }
      }
      if (name === 'edit_file' && !oldString && !content.trim()) {
        return { text: editPayloadMessage(args), rejected: true }
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
      const existedBefore = existsInWorkspace(projectId, filePath)
      const newFolders = existedBefore ? [] : missingParentFolders(projectId, filePath)
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
        fsChanges: [
          ...newFolders.map((folder) => ({ path: folder, type: 'addDir' })),
          { path: saved, type: existedBefore ? 'change' : 'add' },
        ],
      }
    }
    case 'append_to_file': {
      const filePath = String(args.path ?? '').trim()
      const content = typeof args.content === 'string' ? args.content : String(args.content ?? '')
      if (!filePath) return { text: requiredPathMessage(name, args), rejected: true }
      const invalid = validateWriteContent(name, filePath, content)
      if (invalid) {
        debugToolCall(name, filePath, content, 'rejected')
        return { text: invalid, rejected: true }
      }
      const appendedToExisting = existsInWorkspace(projectId, filePath)
      const appendedFolders = appendedToExisting ? [] : missingParentFolders(projectId, filePath)
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
        fsChanges: [
          ...appendedFolders.map((folder) => ({ path: folder, type: 'addDir' })),
          { path: saved, type: appendedToExisting ? 'change' : 'add' },
        ],
      }
    }
    case 'scaffold_site': {
      let plan
      try {
        plan = await buildScaffoldPlan(args)
      } catch (error) {
        return { text: `Error: could not read the starter kit: ${error.message}`, rejected: true }
      }
      if (plan.files.length === 0) {
        return {
          text: `Error: scaffold_site needs at least one page. It received pages=${JSON.stringify(
            Array.isArray(args.pages) ? args.pages.length : args.pages ?? null,
          )}. Example: scaffold_site {"brand":"Acme","palette":"indigo-modern","pages":[{"file":"index.html","title":"Acme — home","nav_label":"Home","sections":["hero","services"]}]}`,
          rejected: true,
        }
      }
      const created = []
      const skipped = []
      const folders = new Set()
      let totalLines = 0
      for (const file of plan.files) {
        const existing = existsInWorkspace(projectId, file.path)
          ? await readWorkspaceFileSafe(projectId, file.path)
          : null
        if (existing !== null && existing.trim()) {
          skipped.push(file.path)
          continue
        }
        try {
          writeFileToWorkspace(projectId, file.path, file.content)
        } catch (error) {
          return { text: `Error: could not write ${file.path}: ${error.message}`, rejected: true }
        }
        const segments = file.path.split('/')
        for (let index = 1; index < segments.length; index += 1) {
          folders.add(segments.slice(0, index).join('/'))
        }
        created.push({ path: file.path, lines: countLines(file.content) })
        totalLines += countLines(file.content)
      }
      const slotSummary = plan.pages
        .map((page) => `${page.file}[${page.sections.join(', ')}]`)
        .join('; ')
      const themeNote = `palette ${plan.theme.id} (${plan.theme.headingFont} + ${plan.theme.bodyFont})`
      const parts = [
        `Scaffolded ${created.length} file(s) with ${themeNote}${skipped.length > 0 ? ` (left ${skipped.length} existing file(s) untouched: ${skipped.join(', ')})` : ''}.`,
        created.length > 0 ? `Created: ${created.map((file) => file.path).join(', ')}.` : '',
        slotSummary ? `Content slots to fill next: ${slotSummary}.` : '',
        'Replace each <!-- SLOT:name --> marker with the real section markup using ONLY the kit classes, one edit_file per page.',
      ].filter(Boolean)
      return {
        text: parts.join(' '),
        modelText: parts.join(' '),
        lines: totalLines,
        written: created,
        fsChanges: [
          ...[...folders].map((folder) => ({ path: folder, type: 'addDir' })),
          ...created.map((file) => ({ path: file.path, type: 'add' })),
        ],
      }
    }
    case 'scaffold_app': {
      let plan
      try {
        plan = await buildScaffoldAppPlan(args)
      } catch (error) {
        return { text: `Error: could not read the app kit: ${error.message}`, rejected: true }
      }
      const created = []
      const skipped = []
      const folders = new Set()
      let totalLines = 0
      for (const file of plan.files) {
        const existing = existsInWorkspace(projectId, file.path)
          ? await readWorkspaceFileSafe(projectId, file.path)
          : null
        if (existing !== null && existing.trim()) {
          skipped.push(file.path)
          continue
        }
        try {
          writeFileToWorkspace(projectId, file.path, file.content)
        } catch (error) {
          return { text: `Error: could not write ${file.path}: ${error.message}`, rejected: true }
        }
        const segments = file.path.split('/')
        for (let index = 1; index < segments.length; index += 1) {
          folders.add(segments.slice(0, index).join('/'))
        }
        created.push({ path: file.path, lines: countLines(file.content) })
        totalLines += countLines(file.content)
      }
      const themeNote = `palette ${plan.theme.id} (${plan.theme.headingFont} + ${plan.theme.bodyFont})`
      const parts = [
        `Scaffolded the app shell: ${created.map((file) => file.path).join(', ')} — ${themeNote}${skipped.length > 0 ? ` (left ${skipped.length} existing file(s) untouched: ${skipped.join(', ')})` : ''}.`,
        'This is a UTILITY APP, not a marketing site: do NOT add a navbar, hero, footer, pricing or FAQ section.',
        'Next: replace <!-- SLOT:app --> in index.html with the real app UI using the classes in css/app.css (panel, app-grid, toolbar, btn, field, label, input, list, list__item, chip, readout, notice, icon-btn, app-head) and append your app logic to the END of js/app.js inside CMApp.ready(function () { ... }). The app bar already holds the page <h1> — do not add another one.',
      ]
      return {
        text: parts.join(' '),
        modelText: parts.join(' '),
        lines: totalLines,
        written: created,
        fsChanges: [
          ...[...folders].map((folder) => ({ path: folder, type: 'addDir' })),
          ...created.map((file) => ({ path: file.path, type: 'add' })),
        ],
      }
    }
    case 'read_file': {
      const filePath = String(args.path ?? '').trim()
      if (!filePath) return { text: requiredPathMessage(name, args), rejected: true }
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
      if (!filePath) return { text: requiredPathMessage(name, args), rejected: true }
      const deleted = await deleteFromWorkspace(projectId, filePath)
      return { text: `Deleted ${deleted}`, fsChanges: [{ path: deleted, type: 'unlink' }] }
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
      return {
        text: unknownToolMessage(name, rawArgs && typeof rawArgs === 'object' ? Object.keys(rawArgs) : []),
        rejected: true,
      }
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
  const preferredStrong = requestedModel ? null : PREFERRED_AGENT_MODEL[preference]
  const autoScore = (candidate) => {
    let score = capabilityScore(candidate.providerId, candidate.model)
    if (requestedModel && candidate.model === requestedModel) score += 1000
    if (preferredStrong && candidate.model === preferredStrong) score += 120
    if (!requestedModel && CODE_COMPLETION_MODEL.test(candidate.model)) score -= CODE_ONLY_PENALTY
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
  const preferredStrong = requestedModel ? null : PREFERRED_AGENT_MODEL[base.providerId]
  const vanillaScore = (candidate) =>
    capabilityScore(candidate.providerId, candidate.model) -
    (isCodeOnlyModel(candidate.model) ? CODE_ONLY_PENALTY : 0) +
    (preferredStrong && candidate.model === preferredStrong ? 120 : 0)
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
  projectHistory = false,
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

  // Follow-up runs used to see the file tree only, so the model invented a new
  // header/footer instead of reusing the existing one. On a non-empty workspace
  // we now read the project ONCE on the server (no model tokens) and inject a
  // compact snapshot: file list, per-page title + linked css/js, the exact
  // header/nav and footer markup of the main page, the nav/footer link lists,
  // the :root tokens and the shared class names.
  let projectSnapshotText = null
  try {
    const snapshot = await buildProjectSnapshot({ projectId, framework })
    projectSnapshotText = snapshot?.text ?? null
  } catch (error) {
    console.warn(`[agent] project snapshot failed: ${error?.message ?? error}`)
    projectSnapshotText = null
  }

  let projectMemoryText = null
  if (projectHistory) {
    try {
      projectMemoryText = await readAgentMemory(projectId)
    } catch (error) {
      console.warn(`[agent] ${AGENT_MEMORY_FILENAME} read failed: ${error?.message ?? error}`)
      projectMemoryText = null
    }
  }

  const repairIntent = !resume && vanillaMode && detectRepairIntent(task)
  let repairClean = false
  let repairInfo = null
  if (repairIntent) {
    try {
      const autofix = await autofixConnections({ projectId, navLinks: vanillaMode })
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
          type: null,
          direction: null,
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
      projectSnapshot: projectSnapshotText,
      projectMemory: projectMemoryText,
      updateWorkflow: Boolean(projectSnapshotText),
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
        const allowStream = !forceNonStreamOnce
        forceNonStreamOnce = false
        const response = await sendCompletion(wireMessages, maxCompletionTokens, temperature, { allowStream })
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
  let consecutiveFailures = 0
  let failureEscalation = 0
  let forceNonStreamOnce = false
  let lastFailureText = ''
  let lastFailureTool = ''
  // A repair round that produces the SAME failure list and changes nothing on
  // disk is not progress; continuing it only burns budget.
  let lastCheckSignature = null
  let stalledContinues = 0

  const wrapUpHint = async (usedTokens) => {
    const remaining = await missingPlannedFiles(projectId, plan, planDoc)
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
    if (consecutiveFailures >= 2) return false
    autoContinues += 1
    toolCallCap += toolCallCapBase
    // A continuation extends the task's token budget by a BOUNDED increment,
    // never by a whole fresh budget: the budget is per task, so it can no
    // longer be silently reset (5x150K) by internal continuations.
    effectiveBudget = Math.min(
      TASK_TOKEN_BUDGET * MAX_BUDGET_MULTIPLIER,
      effectiveBudget + TASK_TOKEN_BUDGET * AUTO_CONTINUE_BUDGET_BONUS,
    )
    wrapUpNotified = false
    writeStreak = 0
    writesWithoutNewFile = 0
    parseRetries = 0
    note(`Continuing automatically (${autoContinues} of ${MAX_AUTO_CONTINUES}) — ${reason}.`)
    return true
  }

  const blockFinishing = (label, failures, code) => {
    const list = (Array.isArray(failures) ? failures : []).filter(Boolean)
    const message = `Stopped: ${label}. ${list.length} problem(s) are still unresolved after every repair round: ${list
      .slice(0, 4)
      .join(' ')}`
    event_('error', message, {
      status: 'done',
      model,
      provider: active.providerId,
      tool: 'gate',
      failures: list.slice(0, 12),
    })
    persistSession(code)
    throw new Error(message)
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
      const issuesNow = await plannedFileIssues(projectId, plan, planDoc)
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
              type: jsonPlan.type,
              direction: jsonPlan.direction,
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
        const planType = jsonPlan?.type ?? null
        event_(
          'plan',
          `${planType ? `TYPE: ${planType} — ` : ''}Planned ${plan.length} file(s): ${plan.join(', ')}`,
          {
            status: 'done',
            model,
            provider: active.providerId,
            tool: 'plan',
            projectName: parsed.projectName ?? null,
            projectType: planType,
            direction: jsonPlan?.direction ?? null,
          },
        )
      }
    }

    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
    if (calls.length === 0) {
      const issues = await plannedFileIssues(projectId, plan, planDoc)
      const missing = issues.map((issue) => issue.path)
      if (issues.length > 0 && planReminders < 3 && toolCalls < toolCallCap) {
        planReminders += 1
        messages.push(message)
        appendGuidance(
          messages,
          `These planned files are not complete yet: ${formatIssues(issues).join(
            '; ',
          )}. Finish each one now: fill the remaining <!-- SLOT:name --> markers with edit_file { path, old_string: "<!-- SLOT:hero -->", new_string: "<section …>…</section>" } — several in ONE reply — and create a page with create_file only when it does not exist yet.`,
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
        const signature = quick.problems.join(' | ')
        if (signature === lastCheckSignature) stalledContinues += 1
        else {
          lastCheckSignature = signature
          stalledContinues = 0
        }
        if (
          stalledContinues < MAX_STALLED_CONTINUES &&
          tryAutoContinue('the automatic content check still found problems')
        ) {
          quickCheckRounds = 0
          appendGuidance(messages, formatQuickCheck(quick))
          continue
        }
        // A page that still fails the automatic content check must NEVER be
        // reported as a success. Stop honestly (an error the client turns into
        // Continue) instead of shipping a near-empty page.
        blockFinishing(
          'the automatic content check still fails',
          quick.problems,
          'content_incomplete',
        )
      }

      if (vanillaMode) {
        try {
          const autofix = await autofixConnections({ projectId, navLinks: vanillaMode })
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
          blockFinishing('the link/style connection check still fails', connection.problems, 'connection_failed')
        }

        let visual = null
        try {
          visual = await visualSanityCheck({ projectId, files: plan.length > 0 ? plan : null })
        } catch (error) {
          visual = { skipped: true, reason: error.message }
        }
        if (visual && visual.skipped) {
          note(`Visual check skipped: ${visual.reason}.`)
        } else if (visual && !visual.ok) {
          if (connectionRounds < MAX_CONNECTION_ROUNDS && toolCalls < toolCallCap) {
            connectionRounds += 1
            event_('gate', `Visual check found ${visual.problems.length} problem(s) — repair round ${connectionRounds} of ${MAX_CONNECTION_ROUNDS}.`, {
              status: 'done',
              tool: 'gate',
              passed: false,
              round: connectionRounds,
              failures: visual.problems.slice(0, 12),
            })
            appendGuidance(messages, formatVisualReport(visual))
            note(`Repairing the rendering problems — round ${connectionRounds} of ${MAX_CONNECTION_ROUNDS}…`)
            continue
          }
          if (tryAutoContinue('the site still does not render like a styled site')) {
            connectionRounds = 0
            appendGuidance(messages, formatVisualReport(visual))
            continue
          }
          blockFinishing('the visual check still fails', visual.problems, 'visual_failed')
        } else if (visual) {
          event_('gate', `Visual check passed in headless Chrome — ${visual.checked.length} page(s) render a styled, modern layout.`, {
            status: 'done',
            tool: 'gate',
            passed: true,
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
          // The gate failing after every repair round means the page is still
          // under-sized or unfinished. Never report that as a successful run.
          blockFinishing('the quality gate still fails', gate.failures, 'gate_failed')
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
    let batchCalls = 0
    let batchFailures = 0
    for (const call of calls) {
      if (toolCalls >= toolCallCap) {
        const issuesAtCap = await plannedFileIssues(projectId, plan, planDoc)
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

      const rawName = String(call.function?.name ?? call.name ?? 'unknown').trim() || 'unknown'
      const resolved = resolveToolCallName(rawName, call.function?.arguments)
      const name = resolved.name || 'unknown'
      const parsed = parseAndNormalizeToolArguments(name, resolved.arguments)
      let args = normalizeToolArgs(projectId, name, parsed.args)

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
            `Error: "${filePath}" has already been appended to ${used} times in this run — the per-file limit, and the file is long enough. Stop writing it and ${await nextPlannedPath(projectId, plan, filePath, planDoc)}`
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
      batchCalls += 1
      if (failed) {
        batchFailures += 1
        lastFailureText = String(outcome.text ?? '').slice(0, 240)
        lastFailureTool = name
      }

      // The Explorer must follow the agent in real time, so every successful
      // file operation pushes a direct change event to the project's room —
      // chokidar is a second, slower safety net for terminal/external changes.
      if (!failed && Array.isArray(outcome.fsChanges) && outcome.fsChanges.length > 0) {
        for (const change of outcome.fsChanges) queueAgentFsChange(projectId, change)
      }
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

      const batchWrites = Array.isArray(outcome.written) && outcome.written.length > 0 ? outcome.written : null
      const writeSucceeded = (WRITE_TOOLS.has(name) || Boolean(batchWrites)) && !failed
      let modelResult = outcome.modelText ?? truncate(outcome.text ?? '', MAX_TOOL_RESULT_CHARS)

      if (writeSucceeded) {
        let isNewFile = !alreadyWritten
        if (batchWrites) {
          isNewFile = false
          for (const item of batchWrites) {
            const previous = writtenThisRun.get(item.path)
            if (!previous) isNewFile = true
            writtenThisRun.set(item.path, {
              lines: item.lines,
              calls: (previous?.calls ?? 0) + 1,
            })
          }
        } else {
          const totalLines =
            name === 'create_file'
              ? (outcome.lines ?? 0)
              : (alreadyWritten?.lines ?? 0) + (outcome.lines ?? 0)
          writtenThisRun.set(filePath, {
            lines: totalLines,
            calls: (alreadyWritten?.calls ?? 0) + 1,
          })
        }

        const progress = await buildProgressHint(projectId, plan, filePath, planDoc)
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
        if (vanillaMode && (batchWrites || /\.(html?|css|js)$/i.test(filePath))) {
          try {
            const autofix = await autofixConnections({ projectId, navLinks: vanillaMode })
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
        const remaining = await missingPlannedFiles(projectId, plan, planDoc)
        const stuck =
          remaining.length > 0 &&
          (writeStreak >= STUCK_SAME_PATH_STREAK || writesWithoutNewFile >= STUCK_WRITE_CALLS)
        if (stuck) {
          const issueText = formatIssues(await plannedFileIssues(projectId, plan, planDoc)).join('; ')
          stuckWarnings += 1
          if (stuckWarnings >= MAX_STUCK_WARNINGS) {
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
          writeStreak = 0
          writesWithoutNewFile = 0
          modelResult = `${modelResult}\n\nStop rewriting ${filePath} the same way. Finish only this remaining work: ${issueText}. Fill each empty <!-- SLOT:name --> marker with edit_file { path, old_string, new_string } in one reply, then summarise and stop.`
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

    if (batchCalls > 0 && batchFailures === batchCalls) {
      consecutiveFailures += 1
    } else if (batchCalls > 0) {
      consecutiveFailures = 0
      failureEscalation = 0
      lastFailureTool = ''
      lastFailureText = ''
    }

    if (consecutiveFailures >= 2) {
      const guidance = toolFailureNotes(lastFailureTool, lastFailureText)
      if (failureEscalation === 0) {
        failureEscalation = 1
        forceNonStreamOnce = true
        appendGuidance(messages, guidance.nonStream)
        note('Two tool calls in a row failed — retrying this turn without streaming…')
        continue
      }
      if (failureEscalation === 1) {
        failureEscalation = 2
        forceNonStreamOnce = true
        appendGuidance(messages, guidance.corrective)
        note('Still failing — sending the exact argument names for that tool and retrying…')
        continue
      }
      if (failureEscalation === 2) {
        failureEscalation = 3
        const previous = active
        if (advanceCandidate()) {
          event_('fallback', `Tool calls kept failing on ${previous.model} — switching to ${active.model}.`, {
            status: 'done',
            model,
            provider: active.providerId,
            tool: 'fallback',
          })
          appendGuidance(messages, guidance.escalate)
          continue
        }
      }
      if (failureEscalation === 3) {
        failureEscalation = 4
        const previous = active
        if (advanceCandidate()) {
          event_('fallback', `Tool calls kept failing on ${previous.model} — switching to ${active.model}.`, {
            status: 'done',
            model,
            provider: active.providerId,
            tool: 'fallback',
          })
          appendGuidance(messages, guidance.escalate)
          continue
        }
        appendGuidance(messages, guidance.final)
        note('One corrective message before giving up…')
        continue
      }
      const failureError = new Error(
        `Stopped: the agent's tool calls failed ${consecutiveFailures} turns in a row${
          writtenThisRun.size > 0
            ? ` (${writtenThisRun.size} file(s) were written earlier in this run)`
            : ' and no files were written'
        } after every automatic recovery attempt (non-streaming retry, corrective message, model fallback) was exhausted. Last error: ${lastFailureText || 'unknown'}`,
      )
      event_('error', failureError.message, { status: 'done', model, toolFailures: consecutiveFailures })
      persistSession('tool_failure')
      throw failureError
    }
  }
}

export { isToolCallParseError }
