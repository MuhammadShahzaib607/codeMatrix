import fs from 'node:fs/promises'
import path from 'node:path'
import { getWorkspacePath } from '../utils/workspaceManager.js'

/**
 * AGENT.md — the project's own work log.
 *
 * A normal file in the project root (so the Explorer lists it and the user can
 * open, edit or delete it), appended to after EVERY completed agent run —
 * success, partial or error — so the history of what the agent did is never
 * lost. It is NOT a page and NOT an asset: it is never linked from a page,
 * never added to the nav, and never scaffolded, because only .html files are
 * treated as pages.
 *
 * `readAgentMemory` is what the agent's context uses — and only when the user
 * enables "Give the agent project history (AGENT.md)" in Settings > General.
 * The file is written either way.
 */

export const AGENT_MEMORY_FILENAME = 'AGENT.md'

// The context budget for the injected history. Newest entries win; older ones
// are dropped first (and the file itself is compacted when it grows past
// COMPACT_AT_CHARS, keeping it small enough to stay a useful, readable log).
export const MAX_MEMORY_CONTEXT_CHARS = 6000
export const COMPACT_AT_CHARS = 60000
export const COMPACT_KEEP_CHARS = 30000

const PREAMBLE = `# Project history — written by the CodeMatrix agent

This file is the project's own work log. After every agent run it gets one
short entry: what was asked, what changed, the key decisions, and anything the
next run should know. You can edit or delete it freely — the agent appends to
whatever it finds here.
`

function memoryPath(projectId) {
  return path.join(getWorkspacePath(projectId), AGENT_MEMORY_FILENAME)
}

function cleanLine(value, max = 400) {
  return String(value ?? '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function cleanPath(value) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim()
}

/**
 * Splits the file into the preamble plus one block per entry, so old entries can
 * be dropped oldest-first without cutting an entry in half.
 */
function splitEntries(text) {
  const source = String(text ?? '')
  const marker = /\n## /
  const firstIndex = source.search(marker)
  if (firstIndex === -1) return { preamble: source.trimEnd(), entries: [] }
  return {
    preamble: source.slice(0, firstIndex).trimEnd(),
    entries: source
      .slice(firstIndex)
      .split(/\n(?=## )/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  }
}

/**
 * The history as the agent should see it, capped by `maxChars` with the OLDEST
 * entries trimmed first. Returns null when there is nothing to send.
 */
export async function readAgentMemory(projectId, { maxChars = MAX_MEMORY_CONTEXT_CHARS } = {}) {
  if (!projectId) return null
  let raw = null
  try {
    raw = await fs.readFile(memoryPath(projectId), 'utf8')
  } catch {
    return null
  }
  if (!raw || !raw.trim()) return null

  const { preamble, entries } = splitEntries(raw)
  if (entries.length === 0) return raw.trim()

  const kept = []
  let used = preamble.length
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (kept.length > 0 && used + entry.length > maxChars) break
    kept.unshift(entry)
    used += entry.length
  }
  const trimmed = kept.length < entries.length
  const text = [preamble, kept.join('\n\n'), trimmed ? '_Older entries trimmed from this view._' : '']
    .filter(Boolean)
    .join('\n\n')
  return text.trim()
}

function formatChangeList(changes) {
  const added = []
  const edited = []
  const deleted = []
  const folders = []
  for (const change of Array.isArray(changes) ? changes : []) {
    const file = cleanPath(change?.path)
    if (!file) continue
    if (file === AGENT_MEMORY_FILENAME) continue
    const type = String(change?.type ?? '')
    if (type === 'add') added.push(file)
    else if (type === 'addDir') folders.push(file)
    else if (type === 'unlink' || type === 'unlinkDir') deleted.push(file)
    else edited.push(file)
  }
  const list = (items) => (items.length === 0 ? 'none' : items.slice(0, 24).join(', '))
  return { added, edited, deleted, folders, list }
}

export function formatAgentMemoryEntry({
  at = new Date(),
  task = '',
  changes = [],
  framework = null,
  palette = null,
  status = 'completed',
  note = '',
} = {}) {
  const date = at instanceof Date && !Number.isNaN(at.getTime()) ? at : new Date()
  const pad = (value) => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const { added, edited, deleted, folders, list } = formatChangeList(changes)
  const lines = [
    `## ${stamp} — ${cleanLine(task, 160) || 'untitled task'}`,
    `- Requested: ${cleanLine(task, 300) || '(no task text recorded)'}`,
    `- Added: ${list(added)}`,
    `- Edited: ${list(edited)}`,
    `- Deleted: ${list(deleted)}`,
  ]
  if (folders.length > 0) lines.push(`- Folders created: ${list(folders)}`)
  const decisions = []
  if (framework) decisions.push(`stack ${cleanLine(framework, 40)}`)
  if (palette) decisions.push(`palette ${cleanLine(palette, 40)}`)
  if (decisions.length > 0) lines.push(`- Key decisions: ${decisions.join(', ')}`)
  lines.push(`- Status: ${cleanLine(status, 120)}`)
  if (note) lines.push(`- Note for the next run: ${cleanLine(note, 400)}`)
  return `${lines.join('\n')}\n`
}

/**
 * The one place that turns a finished run into a log entry, so the socket and
 * any test build exactly the same thing. `outcome` is
 * { ok: true, result } | { ok: false, error }.
 */
export function buildRunMemoryEntry({
  at = new Date(),
  task = '',
  changes = [],
  framework = null,
  outcome = null,
} = {}) {
  const ok = outcome?.ok === true
  const message = String(outcome?.result?.message ?? '')
  const paletteMatch = /palette\s+([a-z0-9-]+)/i.exec(message)
  return {
    at,
    task,
    changes,
    framework: framework ?? null,
    palette: paletteMatch ? paletteMatch[1] : null,
    status: ok
      ? outcome?.result?.gatePassed === false
        ? 'completed with quality-gate warnings'
        : 'completed'
      : `error — ${String(outcome?.error?.message ?? '').slice(0, 120)}`,
    note: ok
      ? message.split('\n')[0].slice(0, 300)
      : `Run failed: ${String(outcome?.error?.message ?? 'unknown error').slice(0, 300)}. ` +
        'Check the files listed above before continuing.',
  }
}

async function compactIfHuge(absolute, text) {
  if (text.length <= COMPACT_AT_CHARS) return text
  const { preamble, entries } = splitEntries(text)
  const kept = []
  let used = preamble.length
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    used += entry.length
    kept.unshift(entry)
    if (used > COMPACT_KEEP_CHARS) break
  }
  const compacted = `${[preamble, kept.join('\n\n')].filter(Boolean).join('\n\n')}\n`
  try {
    await fs.writeFile(absolute, compacted, 'utf8')
  } catch {
    return text
  }
  return compacted
}

/**
 * Appends one entry. Creates the file (with its preamble) on the first run.
 * Returns { path, chars } or null when the workspace cannot be resolved — a
 * logging failure must never break the run that just finished.
 */
export async function appendAgentMemoryEntry(projectId, entry) {
  if (!projectId) return null
  let absolute
  try {
    absolute = memoryPath(projectId)
  } catch {
    return null
  }

  let existing = ''
  try {
    existing = await fs.readFile(absolute, 'utf8')
  } catch {
    existing = ''
  }

  const base = existing.trim() ? existing.trimEnd() : PREAMBLE.trimEnd()
  const text = `${base}\n\n${formatAgentMemoryEntry(entry)}`
  const compacted = await compactIfHuge(absolute, text)
  try {
    await fs.writeFile(absolute, compacted, 'utf8')
  } catch (error) {
    console.warn(`[agent] could not write ${AGENT_MEMORY_FILENAME}: ${error?.message ?? error}`)
    return null
  }
  return { path: AGENT_MEMORY_FILENAME, chars: compacted.length }
}

export const __testables = { splitEntries, formatChangeList, memoryPath, PREAMBLE }
