import fs from 'node:fs/promises'
import path from 'node:path'
import { getWorkspacePath } from '../../utils/workspaceManager.js'

const IGNORED_SCHEMES = /^(mailto:|tel:|sms:|data:|javascript:|blob:)/i
const REMOTE = /^(https?:|\/\/)/i
const LOCAL_EXT = /\.[a-z0-9]+$/i
const CSS_EXT = /\.css$/i
const JS_EXT = /\.js$/i
const HTML_EXT = /\.html?$/i
const TAG_PATTERN = /<(link|script|img|a|source|iframe|video|audio)\b([^>]*)>/gi
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache', '.turbo', 'coverage',
  '.freebuff', '.agents', 'vendor',
])
const MAX_WALK_FILES = 600
const MAX_HTML_FILES = 48
const UNSTYLED_CLASS_TOLERANCE = 2
const UNSTYLED_ID_TOLERANCE = 1
// Selectors are compared against the UNION of every page's classes/ids, so a
// selector that is only used on one page is still satisfied by that page. A
// selector that exists on no page at all is therefore always a real bug, and
// there is no reason to tolerate one.
const SELECTOR_TOLERANCE = 0
const CSS_MIN_LINES = 20
const PLACEHOLDER_CSS = /\blorem ipsum\b|\bplaceholder content\b|\bcontent omitted\b/i

const RUNTIME_CLASS_ALLOWLIST = new Set([
  'active', 'open', 'show', 'hide', 'hidden', 'visible', 'in-view', 'reveal', 'scrolled',
  'sticky', 'loaded', 'ready', 'error', 'invalid', 'valid', 'success', 'disabled',
  'selected', 'current', 'expanded', 'collapsed', 'dark', 'light', 'no-js', 'js',
  'is-open', 'is-active', 'is-visible', 'is-hidden', 'theme-dark', 'theme-light',
])

const RUNTIME_ID_ALLOWLIST = new Set(['year', 'main', 'content', 'top'])
const STRUCTURAL_TAG = /<(section|main|header|footer|nav|aside|form|article|figure)\b[^>]*\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/gi

function cleanPath(value) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^\.\//, '')
    .trim()
}

function posixJoin(fromFile, reference) {
  const dir = path.posix.dirname(String(fromFile ?? '').replace(/\\/g, '/'))
  const joined = path.posix.join(dir === '.' ? '' : dir, String(reference ?? ''))
  const normalized = path.posix.normalize(joined)
  if (!normalized || normalized === '.' || normalized.startsWith('..')) return null
  return normalized.replace(/^\.\//, '')
}

function relativeRef(fromFile, target) {
  const dir = path.posix.dirname(String(fromFile ?? '').replace(/\\/g, '/'))
  const relative = path.posix.relative(dir === '.' ? '' : dir, target)
  return relative || target
}

function splitSuffix(value) {
  const match = /^([^?#]*)([?#].*)?$/.exec(String(value ?? ''))
  return { bare: (match?.[1] ?? '').trim(), suffix: match?.[2] ?? '' }
}

function lineOf(text, index) {
  let line = 1
  const limit = Math.min(index, text.length)
  for (let cursor = 0; cursor < limit; cursor += 1) if (text.charCodeAt(cursor) === 10) line += 1
  return line
}

function attributeValue(attrs, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const match = pattern.exec(String(attrs ?? ''))
  if (!match) return ''
  return String(match[1] ?? match[2] ?? match[3] ?? '').trim()
}

function htmlReferences(html) {
  const refs = []
  TAG_PATTERN.lastIndex = 0
  let match = TAG_PATTERN.exec(html)
  while (match) {
    const tag = String(match[1] ?? '').toLowerCase()
    const attrs = match[2] ?? ''
    const line = lineOf(html, match.index)
    if (tag === 'link') {
      const rel = attributeValue(attrs, 'rel').toLowerCase()
      if (/(^|\s)stylesheet(\s|$)/.test(rel)) {
        const value = attributeValue(attrs, 'href')
        if (value) refs.push({ tag, attr: 'href', value, line, stylesheet: true })
      }
    } else if (tag === 'a') {
      const value = attributeValue(attrs, 'href')
      if (value) refs.push({ tag, attr: 'href', value, line, stylesheet: false })
    } else {
      const value = attributeValue(attrs, 'src')
      if (value) refs.push({ tag, attr: 'src', value, line, stylesheet: false })
    }
    match = TAG_PATTERN.exec(html)
  }
  return refs
}

async function walkFiles(root, relative = '', out = []) {
  if (out.length >= MAX_WALK_FILES) return out
  let entries
  try {
    entries = await fs.readdir(path.join(root, relative || '.'), { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (out.length >= MAX_WALK_FILES) break
    const name = String(entry.name ?? '')
    if (!name) continue
    const next = relative ? `${relative}/${name}` : name
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue
      await walkFiles(root, next, out)
    } else {
      out.push(next)
    }
  }
  return out
}

function jsReferences(jsText) {
  const selectors = new Set()
  const mutations = new Set()
  const ids = new Set()
  for (const match of jsText.matchAll(/(?:querySelector|querySelectorAll|closest|matches)\(\s*['"]\.([A-Za-z_][\w-]*)/g)) selectors.add(match[1])
  for (const match of jsText.matchAll(/(?:querySelector|querySelectorAll|closest|matches)\(\s*['"]#([A-Za-z_][\w-]*)/g)) ids.add(match[1])
  for (const match of jsText.matchAll(/getElementsByClassName\(\s*['"]([^'"]+)['"]/g)) {
    for (const name of match[1].split(/\s+/)) if (name) selectors.add(name)
  }
  for (const match of jsText.matchAll(/getElementById\(\s*['"]([^'"]+)['"]/g)) ids.add(match[1])
  for (const match of jsText.matchAll(/classList\.(?:add|remove|toggle|contains)\(\s*['"]([^'"]+)['"]/g)) {
    for (const name of match[1].split(/\s+/)) if (name) mutations.add(name)
  }
  for (const match of jsText.matchAll(/\bclassName\s*=\s*['"]([^'"]+)['"]/g)) {
    for (const name of match[1].split(/\s+/)) if (name) mutations.add(name)
  }
  return { selectors, mutations, ids }
}

function htmlClassesOf(html) {
  const classes = new Set()
  for (const match of html.matchAll(/class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const value = String(match[1] ?? match[2] ?? match[3] ?? '')
    for (const name of value.split(/\s+/)) if (name) classes.add(name)
  }
  return classes
}

function htmlIdsOf(html) {
  const ids = new Set()
  for (const match of html.matchAll(/\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const value = String(match[1] ?? match[2] ?? match[3] ?? '').trim()
    if (value) ids.add(value)
  }
  return ids
}

function cssBracesBalanced(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const open = (stripped.match(/\{/g) ?? []).length
  const close = (stripped.match(/\}/g) ?? []).length
  return { ok: open === close, open, close }
}

export async function connectionCheck({
  projectId = null,
  root = null,
  files = null,
  checkExistence = true,
  checkCoverage = true,
} = {}) {
  const problems = []
  let workspaceRoot = root
  if (!workspaceRoot) {
    try {
      workspaceRoot = getWorkspacePath(projectId)
    } catch (error) {
      return { ok: false, problems: [`The workspace folder could not be resolved: ${error.message}`], checked: [], details: {} }
    }
  }

  const all = await walkFiles(workspaceRoot)
  const allSet = new Set(all)
  const cssAll = all.filter((file) => CSS_EXT.test(file))
  const jsAll = all.filter((file) => JS_EXT.test(file))

  let requested = null
  if (Array.isArray(files) && files.length > 0) requested = files.map(cleanPath).filter(Boolean)
  let htmlFiles = requested ? requested.filter((file) => HTML_EXT.test(file)) : all.filter((file) => HTML_EXT.test(file))
  htmlFiles = [...new Set(htmlFiles)].slice(0, MAX_HTML_FILES)

  const cache = new Map()
  const read = async (relativePath) => {
    const clean = cleanPath(relativePath)
    if (!clean || clean.split('/').includes('..')) return null
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

  const checked = []
  const problemFiles = new Set()
  const stylesheetTargets = new Map()
  const scriptTargets = new Map()
  const details = {
    htmlFiles,
    cssFiles: cssAll,
    jsFiles: jsAll,
    rootAbsolute: [],
    missingFiles: [],
    missingClasses: [],
    missingIds: [],
    missingSelectors: [],
    unbalancedCss: [],
    undefinedVars: [],
  }

  for (const file of htmlFiles) {
    const html = await read(file)
    if (html === null) continue
    checked.push(file)

    const sheets = new Set()
    const scripts = new Set()
    let declaredSheet = false
    for (const ref of htmlReferences(html)) {
      const value = ref.value
      if (!value || IGNORED_SCHEMES.test(value) || REMOTE.test(value) || value.startsWith('#')) continue
      if (ref.stylesheet) declaredSheet = true
      const { bare } = splitSuffix(value)
      if (!bare) continue

      if (bare.startsWith('/')) {
        const suggestion = bare.replace(/^\/+/, '')
        problems.push(
          `"${file}" line ${ref.line} uses the root-absolute path "${value}". The live preview serves this project under /preview/<projectId>/, so a path starting with "/" is requested from the server root and 404s (that is why the styles never load). Use the relative path "${suggestion}" instead — never a leading slash.`,
        )
        details.rootAbsolute.push({ file, value, line: ref.line })
        problemFiles.add(file)
        continue
      }

      if (bare.startsWith('..')) {
        problems.push(`"${file}" line ${ref.line}: "${value}" points outside the project.`)
        problemFiles.add(file)
        continue
      }

      if (!LOCAL_EXT.test(bare)) continue

      const target = posixJoin(file, bare)
      if (!target) {
        problems.push(`"${file}" line ${ref.line}: "${value}" points outside the project.`)
        problemFiles.add(file)
        continue
      }

      if (checkExistence && !allSet.has(target)) {
        problems.push(
          `"${file}" line ${ref.line} links to "${value}", which does not exist in the project (resolved to "${target}").`,
        )
        details.missingFiles.push({ file, value, target, line: ref.line })
        problemFiles.add(file)
        continue
      }

      if (ref.stylesheet && CSS_EXT.test(target)) sheets.add(target)
      if (ref.tag === 'script' && JS_EXT.test(target)) scripts.add(target)
    }
    stylesheetTargets.set(file, sheets)
    scriptTargets.set(file, scripts)

    // Only complain about a MISSING stylesheet link. A page that links one but
    // with a path that could not be resolved already got its own, precise
    // message above (root-absolute / missing file), and telling the model to
    // "add a <link>" there would contradict it.
    if (cssAll.length > 0 && sheets.size === 0 && !declaredSheet) {
      problems.push(
        `"${file}" does not link any stylesheet, but this project has CSS files (${cssAll.slice(0, 3).join(', ')}). Add <link rel="stylesheet" href="..."> in <head>.`,
      )
      problemFiles.add(file)
    }
    if (jsAll.length > 0 && scripts.size === 0) {
      problems.push(
        `"${file}" does not load any script, but this project has JS files (${jsAll.slice(0, 3).join(', ')}). Add <script src="..."></script> before </body>.`,
      )
      problemFiles.add(file)
    }
  }

  if (htmlFiles.length > 1) {
    const pairs = [
      ['stylesheet', stylesheetTargets],
      ['script', scriptTargets],
    ]
    for (const [label, map] of pairs) {
      const entries = htmlFiles
        .map((file) => ({ file, key: [...(map.get(file) ?? [])].sort().join('|') }))
        .filter((entry) => entry.key)
      if (entries.length < 2) continue
      const reference = entries[0]
      for (const entry of entries.slice(1)) {
        if (entry.key !== reference.key) {
          problems.push(
            `"${entry.file}" links different ${label} files than "${reference.file}" (${entry.key} vs ${reference.key}) — every page must link the same shared ${label} with the same relative path.`,
          )
          details.inconsistent = details.inconsistent ?? []
          details.inconsistent.push({ file: entry.file, reference: reference.file, label })
          problemFiles.add(entry.file)
        }
      }
    }
  }

  for (const file of cssAll) {
    const content = await read(file)
    if (content === null) continue
    const balance = cssBracesBalanced(content)
    if (!balance.ok) {
      problems.push(`"${file}" has unbalanced braces (${balance.open} "{" vs ${balance.close} "}"), so part of the stylesheet is invalid and is dropped by the browser.`)
      details.unbalancedCss.push(file)
      problemFiles.add(file)
    }
    if (PLACEHOLDER_CSS.test(content)) {
      problems.push(`"${file}" contains placeholder text — replace it with real CSS rules.`)
      problemFiles.add(file)
    }
    const cssLines = content.trim() ? content.trim().split('\n').length : 0
    if (htmlFiles.length > 0 && cssLines < CSS_MIN_LINES) {
      problems.push(`"${file}" is only ${cssLines} line(s) — the stylesheet looks incomplete.`)
      problemFiles.add(file)
    }
  }

  if (cssAll.length > 0) {
    const cssText = (await Promise.all(cssAll.map(read))).filter((text) => text !== null).join('\n')
    const stripped = cssText.replace(/\/\*[\s\S]*?\*\//g, '')
    const defined = new Set()
    for (const match of stripped.matchAll(/--([A-Za-z_][\w-]*)\s*:/g)) defined.add(match[1])
    const used = new Set()
    for (const match of stripped.matchAll(/var\(\s*--([A-Za-z_][\w-]*)/g)) used.add(match[1])
    const undefinedVars = [...used].filter((name) => !defined.has(name))
    if (undefinedVars.length > 0) {
      details.undefinedVars = undefinedVars
      for (const file of cssAll) problemFiles.add(file)
      const list = undefinedVars.slice(0, 12).join(', ')
      problems.push(
        `${cssAll.join(', ')} uses ${undefinedVars.length} custom propert${
          undefinedVars.length === 1 ? 'y' : 'ies'
        } (${list}${undefinedVars.length > 12 ? ', …' : ''}) that ${undefinedVars.length === 1 ? 'is' : 'are'} never defined. Without a :root block every var() is invalid at computed-value time, so the browser drops each declaration and the page still renders unstyled even though the stylesheet loaded. Define every token in a :root block and reference it with var().`,
      )
    }
  }

  if (checkCoverage && cssAll.length > 0 && htmlFiles.length > 0) {
    const linked = new Set()
    for (const set of stylesheetTargets.values()) for (const target of set) linked.add(target)
    const linkedExisting = [...linked].filter((target) => allSet.has(target))
    const cssFiles = linkedExisting.length > 0 ? linkedExisting : cssAll
    const cssText = (await Promise.all(cssFiles.map(read))).filter((text) => text !== null).join('\n')
    const jsText = (await Promise.all(jsAll.map(read))).filter((text) => text !== null).join('\n')

    const cssClasses = new Set()
    for (const match of cssText.matchAll(/\.([A-Za-z_][\w-]*)/g)) cssClasses.add(match[1])
    const cssIds = new Set()
    for (const match of cssText.matchAll(/#([A-Za-z_][\w-]*)/g)) cssIds.add(match[1])

    const js = jsReferences(jsText)
    // Only classes the SCRIPT MUTATES at runtime (classList/className) are exempt
    // from needing a CSS rule. A class the script merely QUERIES (.navbar) is a
    // real styling target and must still be styled.
    const allowClasses = new Set(js.mutations)
    const allowIds = new Set(js.ids)

    const htmlClasses = new Map()
    const htmlIds = new Set()
    const associationIds = new Set()
    for (const file of htmlFiles) {
      const html = await read(file)
      if (html === null) continue
      htmlClasses.set(file, htmlClassesOf(html))
      for (const id of htmlIdsOf(html)) htmlIds.add(id)
      for (const match of html.matchAll(STRUCTURAL_TAG)) {
        const value = String(match[2] ?? match[3] ?? '').trim()
        if (value) associationIds.add(value)
      }
      for (const match of html.matchAll(/(?:for|aria-controls|aria-labelledby|aria-describedby|aria-owns|headers)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
        const value = String(match[1] ?? match[2] ?? '')
        for (const name of value.split(/\s+/)) if (name) associationIds.add(name)
      }
      for (const match of html.matchAll(/href\s*=\s*["']#([^"']+)["']/gi)) associationIds.add(match[1])
    }
    const unionClasses = new Set()
    for (const set of htmlClasses.values()) for (const name of set) unionClasses.add(name)

    const missingClasses = new Set()
    for (const set of htmlClasses.values()) {
      for (const name of set) {
        if (cssClasses.has(name) || allowClasses.has(name) || RUNTIME_CLASS_ALLOWLIST.has(name)) continue
        missingClasses.add(name)
      }
    }
    if (missingClasses.size > UNSTYLED_CLASS_TOLERANCE) {
      const list = [...missingClasses]
      details.missingClasses = list
      for (const file of cssFiles) problemFiles.add(file)
      problems.push(
        `${cssFiles.join(', ')} do not style ${list.length} class(es) used in the HTML: ${list.slice(0, 14).join(', ')}${list.length > 14 ? ', …' : ''}. Add a rule for every class the HTML uses — including the contact form fields, labels, textarea, submit button, info cards and map block.`,
      )
    }

    const missingIds = [...htmlIds].filter(
      (id) =>
        !cssIds.has(id) &&
        !allowIds.has(id) &&
        !associationIds.has(id) &&
        !RUNTIME_ID_ALLOWLIST.has(id),
    )
    if (missingIds.length > UNSTYLED_ID_TOLERANCE) {
      details.missingIds = missingIds
      for (const file of cssFiles) problemFiles.add(file)
      problems.push(
        `${cssFiles.join(', ')} do not style ${missingIds.length} id(s) used in the HTML: ${missingIds.slice(0, 12).join(', ')}${missingIds.length > 12 ? ', …' : ''}.`,
      )
    }

    const missingSelectors = []
    for (const name of js.selectors) if (!unionClasses.has(name)) missingSelectors.push(`.${name}`)
    for (const id of js.ids) if (!htmlIds.has(id)) missingSelectors.push(`#${id}`)
    if (missingSelectors.length > SELECTOR_TOLERANCE) {
      details.missingSelectors = missingSelectors
      for (const file of jsAll) problemFiles.add(file)
      problems.push(
        `The scripts select elements that do not exist in the HTML: ${missingSelectors.slice(0, 8).join(', ')}. Add the matching markup or fix the selector.`,
      )
    }
  }

  details.problemFiles = [...problemFiles]
  return { ok: problems.length === 0, problems, checked, details }
}

export function formatConnectionReport(result, { max = 6 } = {}) {
  if (!result || result.ok) return ''
  const problems = Array.isArray(result.problems) ? result.problems : []
  if (problems.length === 0) return ''
  const lines = problems.map((problem, index) => `${index + 1}. ${problem}`)
  return [
    'LINK/STYLE CHECK FAILED — fix exactly these, then continue:',
    ...lines.slice(0, max),
    'Every page lives at the project root and links the shared css/style.css and js/main.js with a RELATIVE path (never a leading "/"). Give every class the HTML uses a CSS rule.',
  ].join('\n')
}

export function formatAutofixReport(result) {
  if (!result || !Array.isArray(result.fixes) || result.fixes.length === 0) return ''
  const lines = result.fixes.slice(0, 6).map((fix) => `${fix.file}: "${fix.from}" -> "${fix.to}"`)
  return ['The server auto-fixed broken asset path(s) (no need to redo these):', ...lines].join('\n')
}

function basenameMatches(all, bare) {
  const base = path.posix.basename(bare)
  const ext = path.posix.extname(base).toLowerCase()
  if (!ext) return []
  return all.filter((file) => file.toLowerCase().endsWith(ext) && path.posix.basename(file) === base)
}

function replaceAttribute(text, attr, current, next) {
  const escaped = String(current).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(\\b${attr}\\s*=\\s*)(?:"${escaped}"|'${escaped}'|${escaped})`, 'g')
  return text.replace(pattern, (_match, prefix) => `${prefix}"${next}"`)
}

export async function autofixConnections({ projectId = null, root = null, files = null } = {}) {
  const fixes = []
  const changed = []
  let workspaceRoot = root
  if (!workspaceRoot) {
    try {
      workspaceRoot = getWorkspacePath(projectId)
    } catch {
      return { fixes, changed }
    }
  }

  const all = await walkFiles(workspaceRoot)
  const allSet = new Set(all)
  let htmlFiles
  if (Array.isArray(files) && files.length > 0) htmlFiles = files.map(cleanPath).filter((file) => HTML_EXT.test(file))
  else htmlFiles = all.filter((file) => HTML_EXT.test(file))
  htmlFiles = [...new Set(htmlFiles)].slice(0, MAX_HTML_FILES)

  for (const file of htmlFiles) {
    const absolute = path.join(workspaceRoot, file)
    let content
    try {
      content = await fs.readFile(absolute, 'utf8')
    } catch {
      continue
    }
    let updated = content
    const handled = new Set()

    for (const ref of htmlReferences(content)) {
      const value = ref.value
      if (!value || IGNORED_SCHEMES.test(value) || REMOTE.test(value) || value.startsWith('#')) continue
      const { bare, suffix } = splitSuffix(value)
      if (!bare) continue
      const key = `${ref.attr}|${value}`
      if (handled.has(key)) continue

      let target = null
      if (bare.startsWith('/')) {
        const candidate = bare.replace(/^\/+/, '')
        if (candidate && allSet.has(candidate)) target = candidate
      } else if (!bare.startsWith('..')) {
        const resolved = posixJoin(file, bare)
        if (!resolved || !allSet.has(resolved)) {
          const matches = basenameMatches(all, bare)
          if (matches.length === 1 && matches[0] !== resolved) target = matches[0]
        }
      }
      if (!target || !allSet.has(target)) continue

      const nextRef = relativeRef(file, target) + suffix
      if (nextRef === value) continue
      const replaced = replaceAttribute(updated, ref.attr, value, nextRef)
      if (replaced === updated) continue
      updated = replaced
      handled.add(key)
      fixes.push({ file, attr: ref.attr, from: value, to: nextRef })
    }

    if (updated !== content) {
      try {
        await fs.writeFile(absolute, updated, 'utf8')
        changed.push(file)
      } catch {}
    }
  }

  return { fixes, changed }
}

const REPAIR_PATTERNS = [
  /\bfix\b[^.\n]{0,30}\b(links?|styling|styles?|css|stylesheet)\b/i,
  /\b(links?|styling|styles?|css|stylesheet)\b[^.\n]{0,30}\b(not|isn'?t|aren'?t|missing|broken|failed|failing|wrong|unstyled)\b/i,
  /\b(unstyled|broken links?|no styles?|styles? (are )?(not|broken|missing))\b/i,
  /\brepair\b[^.\n]{0,30}\b(links?|styles?|css|styling)\b/i,
]

export function detectRepairIntent(task) {
  const text = String(task ?? '').trim()
  if (!text) return false
  return REPAIR_PATTERNS.some((pattern) => pattern.test(text))
}

export const __testables = {
  htmlReferences,
  jsReferences,
  posixJoin,
  relativeRef,
  splitSuffix,
  htmlClassesOf,
  htmlIdsOf,
  cssBracesBalanced,
  replaceAttribute,
  UNSTYLED_CLASS_TOLERANCE,
  RUNTIME_CLASS_ALLOWLIST,
}
