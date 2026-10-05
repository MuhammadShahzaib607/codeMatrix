import fs from 'node:fs/promises'
import path from 'node:path'
import { getWorkspacePath } from '../../utils/workspaceManager.js'
import { SLOT_PATTERN } from '../../templates/vanilla-kit/index.js'

// ---------------------------------------------------------------------------
// The CHEAP verification pass.
//
// This runs on the happy path for free (no model tokens): after every .html
// file the agent writes, and once more when it says it is finished. It is a
// deliberately small, regex-only subset of the vanilla quality gate:
//
//   * a written file is never suspiciously tiny (a 3-line index.html means a
//     chunk was lost, which is exactly how a build silently ends up broken),
//   * every .html file actually ends with </html>,
//   * every local href/src resolves to a file that exists,
//   * no href="#" / empty href and no remote <img>
//
// A problem is handed back to the model as ONE short message inside the last
// tool result. The full gate (cheerio) still runs when the run finishes.
// ---------------------------------------------------------------------------

const MIN_FILE_LINES = 10
const MAX_REPORTED_PROBLEMS = 6
const IGNORED_SCHEMES = /^(mailto:|tel:|sms:|data:|javascript:|blob:)/i
const LOCAL_ASSET = /\.[a-z0-9]+$/i
const REFERENCE_PATTERN = /<(link|script|img|a|source|iframe)\b([^>]*)>/gi
const ATTRIBUTE_PATTERN = /\b(href|src)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i

function cleanRelative(value) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^\.\//, '')
    .trim()
}

function posixJoin(fromFile, reference) {
  const dir = path.posix.dirname(String(fromFile ?? '').replace(/\\/g, '/'))
  const joined = posixNormalize(path.posix.join(dir === '.' ? '' : dir, reference))
  return joined
}

function posixNormalize(value) {
  const segments = []
  for (const segment of String(value ?? '').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) return null
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments.join('/')
}

function countLines(content) {
  const value = String(content ?? '')
  if (!value) return 0
  return value.split('\n').length
}

function attributeOf(tagAttributes) {
  const match = ATTRIBUTE_PATTERN.exec(String(tagAttributes ?? ''))
  if (!match) return ''
  return (match[3] ?? match[4] ?? match[5] ?? '').trim()
}

function references(html) {
  const found = []
  REFERENCE_PATTERN.lastIndex = 0
  let match = REFERENCE_PATTERN.exec(html)
  while (match) {
    const tag = String(match[1] ?? '').toLowerCase()
    const value = attributeOf(match[2])
    if (value) found.push({ tag, value })
    match = REFERENCE_PATTERN.exec(html)
  }
  return found
}

/**
 * Checks the planned files (or just `files`, or every file the agent wrote)
 * inside a workspace. `root` overrides the workspace path, which is how the
 * suite tests it against a plain folder.
 *
 * Returns { ok, problems: string[], checked: string[] }.
 */
export async function quickCheck({
  projectId = null,
  root = null,
  plan = null,
  files = null,
  written = null,
  checkReferences = true,
} = {}) {
  const problems = []
  let workspaceRoot = root
  if (!workspaceRoot) {
    try {
      workspaceRoot = getWorkspacePath(projectId)
    } catch (error) {
      return { ok: false, problems: [`The workspace folder could not be resolved: ${error.message}`], checked: [] }
    }
  }

  const planned = []
  const addPlanned = (candidate) => {
    const filePath = cleanRelative(typeof candidate === 'string' ? candidate : candidate?.path)
    if (filePath && !planned.includes(filePath)) planned.push(filePath)
  }
  if (Array.isArray(written) && written.length > 0) for (const file of written) addPlanned(file)
  else if (Array.isArray(files) && files.length > 0) for (const file of files) addPlanned(file)
  else for (const file of plan?.files ?? []) addPlanned(file)

  // The plan's own page list is what decides which sections a page owes. A
  // scaffolded page that still does not carry its declared sections is an
  // incomplete build, not a style warning — the loop must keep going.
  const declaredSections = new Map()
  for (const page of Array.isArray(plan?.pages) ? plan.pages : []) {
    const filePath = cleanRelative(typeof page === 'string' ? page : page?.file)
    if (!filePath) continue
    const sections = (Array.isArray(page?.sections) ? page.sections : [])
      .map((section) => String(section ?? '').trim())
      .filter(Boolean)
    if (sections.length > 0) declaredSections.set(filePath, sections)
  }

  const cache = new Map()
  const read = async (relativePath) => {
    const clean = cleanRelative(relativePath)
    if (!clean) return null
    if (cache.has(clean)) return cache.get(clean)
    let content = null
    try {
      content = await fs.readFile(path.join(workspaceRoot, clean), 'utf8')
    } catch {
      content = null
    }
    cache.set(clean, content)
    return content
  }

  // A utility app (css/app.css, no css/base.css) is a single screen and must
  // NOT be told to add a marketing footer; the prompt forbids one. Requiring a
  // footer here is exactly what pushed apps into adding one.
  const appProject =
    (await read('css/app.css')) !== null && (await read('css/base.css')) === null

  const checked = []
  for (const file of planned) {
    const content = await read(file)
    if (content === null) {
      problems.push(`"${file}" was not written, or it is empty.`)
      continue
    }
    checked.push(file)

    if (countLines(content) < MIN_FILE_LINES) {
      problems.push(
        `"${file}" is only ${countLines(content)} line(s) — the file is incomplete. Write the whole file again (one create_file per file).`,
      )
      continue
    }

    if (!/\.html?$/i.test(file)) continue
    if (!/<\/html>\s*$/i.test(content.trimEnd())) {
      problems.push(`"${file}" does not end with </html>, so its tail is missing or a chunk overwrote it.`)
    }

    const leftoverSlots = [...content.matchAll(new RegExp(SLOT_PATTERN.source, 'g'))].map((match) => match[1])
    if (leftoverSlots.length > 0) {
      problems.push(
        `"${file}" still has ${leftoverSlots.length} empty scaffold slot(s): ${leftoverSlots
          .map((name) => `<!-- SLOT:${name} -->`)
          .join(', ')}. Replace every slot with the real section markup and business-specific copy now.`,
      )
    }

    if (/\bhref\s*=\s*(""|'')/i.test(content) || /\bhref\s*=\s*"#"/i.test(content)) {
      problems.push(`"${file}" contains a dead link (href="#") — point it at a real file or section id.`)
    }

    // A page is structurally incomplete without these, and reporting it as a
    // success is exactly how a near-empty page shipped. Catch it here, cheaply.
    if (!/<header\b/i.test(content)) {
      problems.push(`"${file}" has no <header> — a page is incomplete without its site header.`)
    }
    if (!appProject && !/<footer\b/i.test(content)) {
      problems.push(`"${file}" has no <footer> landmark — the page is incomplete without its footer.`)
    }
    const h1Count = (content.match(/<h1\b/gi) || []).length
    if (h1Count !== 1) {
      problems.push(`"${file}" must contain exactly one <h1> (found ${h1Count}).`)
    }
    for (const section of declaredSections.get(file) ?? []) {
      const idPattern = new RegExp(`id\\s*=\\s*["']${section}["']`, 'i')
      if (!idPattern.test(content)) {
        problems.push(
          `"${file}" is missing the planned <section id="${section}"> — write that section with real copy now, it is part of the page the plan promised.`,
        )
      }
    }

    if (!checkReferences) continue
    const fileExists = async (candidate) => (await read(candidate)) !== null
    for (const reference of references(content)) {
      const value = reference.value
      if (!value || IGNORED_SCHEMES.test(value)) continue
      const isRemote = /^(https?:)?\/\//i.test(value)
      if (isRemote) {
        if (reference.tag === 'img' || reference.tag === 'source' || reference.tag === 'iframe') {
          problems.push(`"${file}" loads a remote ${reference.tag} (${value}) — use inline SVG, CSS shapes or a gradient instead.`)
        }
        continue
      }
      if (value.startsWith('#') || value === '') continue
      if (/^(https?:)/i.test(value)) continue
      if (value.startsWith('/') && !value.startsWith('//')) {
        problems.push(
          `"${file}" uses the root-absolute path "${value}" — the preview serves this project under /preview/<projectId>/, so it is fetched from the server root and 404s. Use a relative path with no leading "/" (for example "${value.replace(/^\/+/, '')}").`,
        )
        continue
      }
      if (!LOCAL_ASSET.test(value.split('#')[0].split('?')[0])) continue
      const target = posixJoin(file, value.split('#')[0].split('?')[0])
      if (!target || !(await fileExists(target))) {
        problems.push(`"${file}" links to "${value}", which does not exist in the project.`)
      }
    }

  }

  return {
    ok: problems.length === 0,
    problems: problems.slice(0, MAX_REPORTED_PROBLEMS * 2),
    checked,
  }
}

/** One short instruction message for the model, appended to a tool result. */
export function formatQuickCheck(result) {
  if (!result || result.ok) return ''
  const lines = result.problems.map((problem, index) => `${index + 1}. ${problem}`)
  return [
    'AUTOMATIC CHECK FAILED — fix exactly these, then continue:',
    ...lines.slice(0, MAX_REPORTED_PROBLEMS),
    'Do not rewrite files that passed. Write each remaining file completely in one create_file call.',
  ].join('\n')
}

export const __testables = { MIN_FILE_LINES, references, posixJoin, attributeOf }
