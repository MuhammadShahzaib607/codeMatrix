import fs from 'node:fs/promises'
import path from 'node:path'
import { getWorkspacePath } from '../../utils/workspaceManager.js'
import { loadKitClasses } from '../../templates/vanilla-kit/index.js'

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
const UNSTYLED_CLASS_TOLERANCE = 0
const UNSTYLED_ID_TOLERANCE = 0
const JS_HOOK_CLASS = /^js-[\w-]+$/
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

function normalizeNavHref(pageFile, href) {
  const value = String(href ?? '').trim()
  if (!value) return ''
  const hashIndex = value.indexOf('#')
  const fragment = hashIndex === -1 ? '' : value.slice(hashIndex)
  let target = hashIndex === -1 ? value : value.slice(0, hashIndex)
  target = target.replace(/^\/+/, '').replace(/^\.\//, '').trim()
  if (!target) {
    // A bare "#section" is a link inside the CURRENT page. Section ids are
    // reused across pages, so it is compared page-independently: this keeps a
    // legitimate "#services" on the about page from reading as a difference.
    return fragment || ''
  }
  if (REMOTE.test(target) || IGNORED_SCHEMES.test(value)) return ''
  target = target.replace(/^\.\//, '')
  return `${target}${fragment}`
}

function navItemsOf(html) {
  const navMatch = /<nav\b[\s\S]*?<\/nav>/i.exec(String(html ?? ''))
  if (!navMatch) return { found: false, items: [] }
  const block = navMatch[0]
  const items = []
  const pattern = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi
  let match = pattern.exec(block)
  while (match) {
    const href = String(match[1] ?? match[2] ?? match[3] ?? '').trim()
    const label = String(match[4] ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    if (href) items.push({ href, label, markup: match[0] })
    match = pattern.exec(block)
  }
  return { found: true, block, items }
}

function navHrefValue(attrs) {
  const match = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(String(attrs ?? ''))
  return String(match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim()
}

function footerLinksOf(html) {
  const footerMatch = /<footer\b[\s\S]*?<\/footer>/i.exec(String(html ?? ''))
  if (!footerMatch) return { found: false, links: [], headings: [] }
  const block = footerMatch[0]
  const links = []
  const pattern = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi
  let match = pattern.exec(block)
  while (match) {
    const href = String(match[1] ?? match[2] ?? match[3] ?? '').trim()
    if (href) links.push(href)
    match = pattern.exec(block)
  }
  const headings = []
  for (const heading of block.matchAll(/<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/gi)) {
    const text = String(heading[1]).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    if (text) headings.push(text)
  }
  return { found: true, block, links, headings }
}

function pageStylesheetName(pageFile, stylesheet) {
  const base = path.posix.basename(String(pageFile ?? ''))
  const name = base.replace(/\.[^.]+$/, '')
  const dir = path.posix.dirname(String(stylesheet ?? ''))
  return dir && dir !== '.' ? `${dir}/${name}.css` : `${name}.css`
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
  const navData = new Map()
  const footerData = new Map()
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
    navInconsistent: [],
    navUnreachable: [],
    footerInconsistent: [],
    missingPageCss: [],
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
    navData.set(file, navItemsOf(html))
    footerData.set(file, footerLinksOf(html))

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
    // A project may link a SHARED stylesheet plus one page stylesheet per page
    // (css/base.css + css/<page>.css), so "the same set on every page" is no
    // longer the rule: what must be on EVERY page is the intersection — the
    // shared stylesheet(s). A page missing one of those is the real bug.
    const sheetEntries = htmlFiles
      .map((file) => ({ file, sheets: [...(stylesheetTargets.get(file) ?? [])] }))
      .filter((entry) => entry.sheets.length > 0)
    if (sheetEntries.length >= 2) {
      const shared = sheetEntries
        .slice(1)
        .reduce(
          (acc, entry) => acc.filter((sheet) => entry.sheets.includes(sheet)),
          sheetEntries[0].sheets.slice(),
        )
      for (const entry of sheetEntries) {
        const missing = shared.filter((sheet) => !entry.sheets.includes(sheet))
        if (missing.length === 0) continue
        problems.push(
          `"${entry.file}" does not link the shared stylesheet(s) ${missing.join(', ')} that the other pages link (${sheetEntries[0].file} links ${sheetEntries[0].sheets.join(', ')}) — every page must link the same shared stylesheet with the same relative path.`,
        )
        details.inconsistent = details.inconsistent ?? []
        details.inconsistent.push({ file: entry.file, reference: sheetEntries[0].file, label: 'stylesheet' })
        problemFiles.add(entry.file)
      }
    }

    const scriptEntries = htmlFiles
      .map((file) => ({ file, key: [...(scriptTargets.get(file) ?? [])].sort().join('|') }))
      .filter((entry) => entry.key)
    if (scriptEntries.length >= 2) {
      const reference = scriptEntries[0]
      for (const entry of scriptEntries.slice(1)) {
        if (entry.key !== reference.key) {
          problems.push(
            `"${entry.file}" links different script files than "${reference.file}" (${entry.key} vs ${reference.key}) — every page must link the same shared script with the same relative path.`,
          )
          details.inconsistent = details.inconsistent ?? []
          details.inconsistent.push({ file: entry.file, reference: reference.file, label: 'script' })
          problemFiles.add(entry.file)
        }
      }
    }
  }

  const navFiles = htmlFiles.filter((file) => {
    const nav = navData.get(file)
    return nav?.found && nav.items.length > 0
  })
  if (navFiles.length >= 2) {
    const referenceFile =
      navFiles.find((file) => /(^|\/)index\.html?$/i.test(file)) ?? navFiles[0]
    const signatureOf = (file) =>
      new Set(
        navData
          .get(file)
          .items.map((item) => normalizeNavHref(file, item.href))
          .filter(Boolean),
      )
    const reference = signatureOf(referenceFile)
    for (const file of navFiles) {
      if (file === referenceFile) continue
      const current = signatureOf(file)
      const missing = [...reference].filter((href) => !current.has(href))
      const extra = [...current].filter((href) => !reference.has(href))
      if (missing.length === 0 && extra.length === 0) continue
      problems.push(
        `The header nav of "${file}" does not match "${referenceFile}":${
          missing.length > 0 ? ` missing link(s) ${missing.join(', ')}` : ''
        }${extra.length > 0 ? ` extra link(s) ${extra.join(', ')}` : ''}. Copy the header/nav markup from "${referenceFile}" so EVERY page lists the same links.`,
      )
      details.navInconsistent.push({ file, reference: referenceFile, missing, extra })
      problemFiles.add(file)
    }

    const unreachable = []
    for (const file of htmlFiles) {
      const nav = navData.get(file)
      if (!nav?.found || nav.items.length === 0) continue
      const targets = new Set(
        nav.items
          .map((item) => normalizeNavHref(file, item.href).split('#')[0])
          .filter(Boolean),
      )
      const missing = htmlFiles.filter((other) => other !== file && !targets.has(other))
      if (missing.length > 0) unreachable.push({ file, missing })
    }
    if (unreachable.length > 0) {
      details.navUnreachable = unreachable
      for (const entry of unreachable) problemFiles.add(entry.file)
      problems.push(
        `${unreachable.length} page(s) cannot reach every other page from their nav: ${unreachable
          .slice(0, 6)
          .map((entry) => `"${entry.file}" is missing ${entry.missing.join(', ')}`)
          .join('; ')}. Add the missing links to the nav of the page(s) listed (use edit_file).`,
      )
    }
  }

  const footerFiles = htmlFiles.filter((file) => footerData.get(file)?.found)
  if (footerFiles.length >= 2) {
    const referenceFile =
      footerFiles.find((file) => /(^|\/)index\.html?$/i.test(file)) ?? footerFiles[0]
    const referenceFooter = footerData.get(referenceFile)
    const referenceLinks = new Set(
      referenceFooter.links.map((href) => normalizeNavHref(referenceFile, href)).filter(Boolean),
    )
    for (const file of footerFiles) {
      if (file === referenceFile) continue
      const footer = footerData.get(file)
      const links = new Set(footer.links.map((href) => normalizeNavHref(file, href)).filter(Boolean))
      const missing = [...referenceLinks].filter((href) => !links.has(href))
      const headingsDiffer =
        referenceFooter.headings.length > 0 &&
        footer.headings.length > 0 &&
        footer.headings.join('|') !== referenceFooter.headings.join('|')
      if (missing.length === 0 && !headingsDiffer) continue
      problems.push(
        `The footer of "${file}" differs from "${referenceFile}":${
          missing.length > 0 ? ` missing link(s) ${missing.join(', ')}` : ''
        }${headingsDiffer ? ` different column headings (${footer.headings.join(', ')} vs ${referenceFooter.headings.join(', ')})` : ''}. Reuse the SAME footer markup on every page (brand blurb, quick links, contact, social icons, copyright bar).`,
      )
      details.footerInconsistent.push({ file, reference: referenceFile, missing })
      problemFiles.add(file)
    }
  }

  // Per-page stylesheet convention (css/base.css + one css/<page>.css per page).
  // Projects that still use a single shared stylesheet are left alone.
  const baseSheet = cssAll.find((file) => /(^|\/)base\.css$/i.test(file))
  if (baseSheet && htmlFiles.length > 0) {
    const pageSheets = new Map()
    for (const file of htmlFiles) pageSheets.set(file, pageStylesheetName(file, baseSheet))
    const usesPageSheets = htmlFiles.some((file) =>
      (stylesheetTargets.get(file) ?? new Set()).has(pageSheets.get(file)),
    )
    for (const file of htmlFiles) {
      const sheets = stylesheetTargets.get(file) ?? new Set()
      if (!sheets.has(baseSheet)) {
        problems.push(
          `"${file}" does not link the shared "${baseSheet}" that the other pages link. Every page must link the same shared stylesheet with the same relative path.`,
        )
        details.missingPageCss.push({ file, missing: baseSheet })
        problemFiles.add(file)
        continue
      }
      if (!usesPageSheets) continue
      const ownSheet = pageSheets.get(file)
      if (!cssAll.includes(ownSheet)) {
        problems.push(
          `"${ownSheet}" is missing: every page needs its own page stylesheet (${ownSheet} for ${file}) with only the rules of that page's sections.`,
        )
        details.missingPageCss.push({ file, missing: ownSheet })
        problemFiles.add(file)
        continue
      }
      if (!sheets.has(ownSheet)) {
        problems.push(
          `"${file}" does not link its own page stylesheet "${ownSheet}" (link base.css first, then ${ownSheet}).`,
        )
        details.missingPageCss.push({ file, missing: ownSheet })
        problemFiles.add(file)
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
    const kitClasses = await loadKitClasses()
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
        if (cssClasses.has(name)) continue
        if (allowClasses.has(name) || RUNTIME_CLASS_ALLOWLIST.has(name)) continue
        if (kitClasses.has(name) || JS_HOOK_CLASS.test(name)) continue
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
    for (const name of js.selectors) {
      if (unionClasses.has(name) || kitClasses.has(name) || JS_HOOK_CLASS.test(name)) continue
      missingSelectors.push(`.${name}`)
    }
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
    'Every page lives at the project root and links the SAME shared stylesheet(s) and the same script as the other pages, with a RELATIVE path (never a leading "/"); a css/base.css project also gives every page its own css/<page>.css. Give every class the HTML uses a CSS rule.',
  ].join('\n')
}

export function formatAutofixReport(result) {
  if (!result || !Array.isArray(result.fixes) || result.fixes.length === 0) return ''
  const lines = result.fixes
    .slice(0, 8)
    .map((fix) =>
      fix.kind === 'nav'
        ? `${fix.file}: added the missing nav link to "${fix.to}"`
        : `${fix.file}: "${fix.from}" -> "${fix.to}"`,
    )
  return ['The server auto-fixed these (no need to redo them, and do not undo them):', ...lines].join('\n')
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

function indentationOf(text, index) {
  const start = text.lastIndexOf('\n', Math.max(0, index - 1)) + 1
  const match = /^[ \t]*/.exec(text.slice(start, index))
  return match ? match[0] : ''
}

function insertNavLink(html, { label, href, active = false }) {
  const navMatch = /<nav\b[\s\S]*?<\/nav>/i.exec(html)
  if (!navMatch) return null
  const anchors = [
    ...navMatch[0].matchAll(/<a\b[^>]*href\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>[\s\S]*?<\/a>/gi),
  ]
  if (anchors.length === 0) return null

  const template = anchors[anchors.length - 1]
  const opening = /^<a\b([^>]*)>/i.exec(template[0])
  let attrs = opening ? opening[1] : ''
  attrs = attrs.replace(/\s*href\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '')
  attrs = attrs.replace(/\s*aria-current\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '')
  const classMatch = /\s*class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs)
  const classValue = classMatch ? String(classMatch[1] ?? classMatch[2] ?? classMatch[3] ?? '') : ''
  if (classMatch) attrs = attrs.replace(classMatch[0], '')
  const tokens = classValue
    .split(/\s+/)
    .filter((token) => token && !/^(active|is-active|current)$/i.test(token))
  if (active) tokens.push('active')
  const classAttr = tokens.length > 0 ? ` class="${tokens.join(' ')}"` : ''
  const ariaAttr = active ? ' aria-current="page"' : ''
  const markup = `<a${attrs.replace(/\s+/g, ' ').replace(/\s+$/, '')}${classAttr}${ariaAttr} href="${href}">${label}</a>`

  const templateStart = navMatch.index + template.index
  const insertAt = templateStart + template[0].length
  const indent = indentationOf(html, templateStart)
  const next = `${html.slice(0, insertAt)}\n${indent}${markup}${html.slice(insertAt)}`
  return next === html ? null : { next, markup }
}

export async function autofixConnections({
  projectId = null,
  root = null,
  files = null,
  navLinks = false,
} = {}) {
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

  // Trivially fixable case: a nav link that SOME page has and another page is
  // missing. The server inserts a copy of the page's own last nav item with the
  // right href + label, so every page ends up listing the same links without
  // spending a model round on it. A page whose whole nav is absent, and a page
  // no nav links to at all, are left for the model to fix.
  if (navLinks && htmlFiles.length > 1) {
    const contents = new Map()
    for (const file of htmlFiles) {
      try {
        contents.set(file, await fs.readFile(path.join(workspaceRoot, file), 'utf8'))
      } catch {}
    }

    const union = new Map()
    for (const file of htmlFiles) {
      const html = contents.get(file)
      if (html == null) continue
      for (const item of navItemsOf(html).items) {
        const target = normalizeNavHref(file, item.href).split('#')[0]
        if (!target || !allSet.has(target)) continue
        if (!union.has(target)) union.set(target, item.label || path.posix.basename(target))
      }
    }

    for (const file of htmlFiles) {
      let html = contents.get(file)
      if (html == null) continue
      const nav = navItemsOf(html)
      if (!nav.found || nav.items.length === 0) continue
      const present = new Set(
        nav.items.map((item) => normalizeNavHref(file, item.href).split('#')[0]).filter(Boolean),
      )
      let touched = false
      for (const [target, label] of union) {
        if (present.has(target)) continue
        const result = insertNavLink(html, {
          label,
          href: relativeRef(file, target),
          active: target === file,
        })
        if (!result) continue
        html = result.next
        present.add(target)
        touched = true
        fixes.push({ file, kind: 'nav', attr: 'href', from: '(missing)', to: target })
      }
      if (!touched) continue
      try {
        await fs.writeFile(path.join(workspaceRoot, file), html, 'utf8')
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
  navItemsOf,
  footerLinksOf,
  normalizeNavHref,
  insertNavLink,
  pageStylesheetName,
  UNSTYLED_CLASS_TOLERANCE,
  RUNTIME_CLASS_ALLOWLIST,
}
