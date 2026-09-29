import fs from 'node:fs/promises'
import path from 'node:path'
import { getWorkspacePath } from '../../utils/workspaceManager.js'

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache', '.turbo',
  'coverage', '.freebuff', '.agents', 'vendor',
])

const HTML_EXT = /\.html?$/i
const CSS_EXT = /\.css$/i
const JS_EXT = /\.js$/i

const MAX_WALK_FILES = 400
const MAX_TREE_LINES = 90
const MAX_PAGES = 24
const MAX_CLASSES = 70
const MAX_TOKENS_CHARS = 11000
const MAX_BLOCK_CHARS = 3200

const MAIN_PAGE_CANDIDATES = ['index.html', 'home.html', 'index.htm']

function cleanPath(value) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^\.\//, '')
    .trim()
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

function treeLines(files) {
  const lines = []
  for (const file of files.slice(0, MAX_TREE_LINES)) lines.push(file)
  if (files.length > MAX_TREE_LINES) lines.push(`[… ${files.length - MAX_TREE_LINES} more files …]`)
  return lines
}

function blockOf(html, tag) {
  const pattern = new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, 'i')
  const match = pattern.exec(html)
  if (!match) return ''
  return match[0].trim().slice(0, MAX_BLOCK_CHARS)
}

function linksIn(fragment) {
  const links = []
  const pattern = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi
  let match = pattern.exec(fragment)
  while (match) {
    const href = String(match[1] ?? match[2] ?? match[3] ?? '').trim()
    const label = String(match[4] ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    if (href && !href.startsWith('#')) links.push({ href, label })
    match = pattern.exec(fragment)
  }
  const seen = new Set()
  return links.filter((link) => {
    const key = `${link.href}|${link.label}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function titleOf(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return match ? String(match[1]).replace(/\s+/g, ' ').trim() : ''
}

function stylesheetsOf(html) {
  const sheets = []
  const pattern = /<link\b[^>]*rel\s*=\s*(?:"[^"]*stylesheet[^"]*"|'[^']*stylesheet[^']*')[^>]*>/gi
  let match = pattern.exec(html)
  while (match) {
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[0])
    const value = String(href?.[1] ?? href?.[2] ?? href?.[3] ?? '').trim()
    if (value) sheets.push(value)
    match = pattern.exec(html)
  }
  return sheets
}

function scriptsOf(html) {
  const scripts = []
  const pattern = /<script\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi
  let match = pattern.exec(html)
  while (match) {
    const value = String(match[1] ?? match[2] ?? match[3] ?? '').trim()
    if (value) scripts.push(value)
    match = pattern.exec(html)
  }
  return scripts
}

function rootTokensOf(css) {
  const match = /:root\s*\{([\s\S]*?)\}/i.exec(String(css ?? ''))
  if (!match) return []
  const tokens = []
  const pattern = /(--[\w-]+)\s*:\s*([^;]+);/g
  let token = pattern.exec(match[1])
  while (token) {
    tokens.push(`${token[1]}: ${String(token[2]).trim()}`)
    token = pattern.exec(match[1])
  }
  return tokens
}

function classNamesOf(css) {
  const names = new Set()
  const stripped = String(css ?? '').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of stripped.matchAll(/\.([A-Za-z_][\w-]*)/g)) names.add(match[1])
  return [...names]
}

function pickMainPage(pages) {
  for (const candidate of MAIN_PAGE_CANDIDATES) {
    const found = pages.find((page) => page.file.toLowerCase() === candidate)
    if (found) return found
  }
  return pages.find((page) => page.file.indexOf('/') === -1) ?? pages[0] ?? null
}

function navLinkLabel(link) {
  const label = link.label || link.href
  return `${link.href}${label && label !== link.href ? ` (${label})` : ''}`
}

const UPDATE_WORKFLOW_SECTION = `UPDATE WORKFLOW (this project already exists — extend it, never rebuild it).

READ FIRST, THEN PLAN, THEN WRITE. This is mandatory for EVERY request that is not an empty project — including a one-line follow-up such as "add a dark mode toggle", "add a pricing page", "navbar ko theek karo" or any other vague instruction. Before you write a single byte:
R1. Read the file tree (the PROJECT SNAPSHOT below lists every file; use list_directory only if it looks truncated).
R2. Read the key files the change touches, with read_file, when the snapshot does not already show their content: the main page (index.html or equivalent), the shared stylesheet(s) (css/base.css, css/theme.css), the shared script (js/main.js) and any file you are about to edit.
R3. Read AGENT.md if a PROJECT HISTORY section is present below: it records what earlier runs were asked for, what they changed and which decisions (palette, structure) they made. Reuse those decisions instead of inventing new ones.
R4. Only then write your plan, as EDITS to what already exists: which existing file gets which change, which classes and tokens you reuse, which new file (if any) is genuinely required. Put the concrete change list in the plan's requirements array so the user can see immediately that you understood.
NEVER assume the project from scratch and NEVER rebuild it because the request was vague. A vague request is a reason to read MORE, not to start over. "Purana design rakhna hai" ("keep the existing design") means: change only what was asked and reuse everything else.

The PROJECT SNAPSHOT below is the source of truth for what exists right now. Never recreate a file that is listed in it.
1. A new page copies the header/nav and footer markup EXACTLY as the snapshot shows them, changing only the active link (class="active" / aria-current="page") and the page content.
2. After adding pages, add the new links to the nav of EVERY existing page and to the footer link lists where they belong, with small edit_file calls.
3. New pages link the SAME shared stylesheet(s) and script as the existing pages (relative paths, never a leading "/") and get their own page CSS; add only new rules, never rewrite rules that already exist.
4. Reuse the existing class names and the :root variables. Do not restyle anything the user did not mention.
5. Every page still has exactly ONE <header>, ONE <main> and ONE <footer>: a new section joins the existing sections inside the single <main> of the page it belongs to. Never insert a second footer or a document tail.
6. AGENT.md is the project's own work log, not a page: never link it from a page, never add it to the nav, never include it in a stylesheet, and never rewrite it yourself — the server appends to it after the run.
7. Finish with the connection check: every page must be reachable from the nav of every other page.`

export { UPDATE_WORKFLOW_SECTION }

export async function buildProjectSnapshot({ projectId = null, root = null, framework = null } = {}) {
  let workspaceRoot = root
  if (!workspaceRoot && projectId) {
    try {
      workspaceRoot = getWorkspacePath(projectId)
    } catch {
      return null
    }
  }
  if (!workspaceRoot) return null

  const files = await walkFiles(workspaceRoot)
  if (files.length === 0) return null

  const read = async (relative) => {
    try {
      return await fs.readFile(path.join(workspaceRoot, cleanPath(relative)), 'utf8')
    } catch {
      return null
    }
  }

  const htmlFiles = files.filter((file) => HTML_EXT.test(file))
  const cssFiles = files.filter((file) => CSS_EXT.test(file))
  const jsFiles = files.filter((file) => JS_EXT.test(file))

  const pages = []
  for (const file of htmlFiles.slice(0, MAX_PAGES)) {
    const html = await read(file)
    if (html === null) continue
    pages.push({
      file,
      html,
      title: titleOf(html),
      css: stylesheetsOf(html),
      js: scriptsOf(html),
    })
  }

  if (pages.length === 0 && cssFiles.length === 0 && jsFiles.length === 0) return null

  const main = pickMainPage(pages)
  const headerMarkup = main ? blockOf(main.html, 'header') : ''
  const footerMarkup = main ? blockOf(main.html, 'footer') : ''
  const navBlock = main ? blockOf(main.html, 'nav') : ''
  const navLinks = navBlock ? linksIn(navBlock) : main ? linksIn(headerMarkup) : []
  const footerLinks = footerMarkup ? linksIn(footerMarkup) : []

  let baseCssFile = cssFiles.find((file) => /(^|\/)(base|style|styles|main)\.css$/i.test(file)) ?? cssFiles[0] ?? null
  let baseCss = baseCssFile ? await read(baseCssFile) : null
  if (baseCss === null && main) {
    const linked = main.css.map((href) => cleanPath(href.replace(/[?#].*$/, ''))).find((file) => files.includes(file))
    if (linked) {
      baseCssFile = linked
      baseCss = await read(linked)
    }
  }

  const tokens = baseCss ? rootTokensOf(baseCss) : []
  const classes = baseCss ? classNamesOf(baseCss) : []

  const sections = []
  sections.push('PROJECT SNAPSHOT (built from disk — this is what already exists)')
  sections.push(['FILES', ...treeLines(files)].join('\n'))

  if (pages.length > 0) {
    sections.push(
      [
        'PAGES',
        ...pages.map(
          (page) =>
            `${page.file} | title "${page.title}" | css ${page.css.join(', ') || 'none'} | js ${page.js.join(', ') || 'none'}`,
        ),
      ].join('\n'),
    )
  }

  if (navLinks.length > 0) {
    sections.push(`NAV LINKS: ${navLinks.map(navLinkLabel).join(' | ')}`)
  }
  if (footerLinks.length > 0) {
    sections.push(`FOOTER LINKS: ${footerLinks.map(navLinkLabel).join(' | ')}`)
  }
  if (tokens.length > 0) {
    sections.push(`${baseCssFile} :root TOKENS: ${tokens.join('; ')}`)
  }
  if (classes.length > 0) {
    const shown = classes.slice(0, MAX_CLASSES)
    sections.push(
      `${baseCssFile} CLASSES (${classes.length}): ${shown.join(', ')}${
        classes.length > shown.length ? `, [… ${classes.length - shown.length} more …]` : ''
      }`,
    )
  }
  if (headerMarkup) {
    sections.push(`HEADER + NAV MARKUP from ${main.file} (copy EXACTLY, change only the active link):\n${headerMarkup}`)
  }
  if (footerMarkup) {
    sections.push(`FOOTER MARKUP from ${main.file} (copy EXACTLY):\n${footerMarkup}`)
  }

  const text = sections.join('\n\n')
  const trimmed = text.length > MAX_TOKENS_CHARS ? `${text.slice(0, MAX_TOKENS_CHARS)}\n[… snapshot truncated …]` : text

  return {
    text: trimmed,
    mainPage: main?.file ?? null,
    pages: pages.map((page) => page.file),
    baseCssFile,
    navLinks,
    footerLinks,
    truncated: text.length > MAX_TOKENS_CHARS,
  }
}

export const __testables = {
  titleOf,
  stylesheetsOf,
  scriptsOf,
  rootTokensOf,
  classNamesOf,
  linksIn,
  blockOf,
  pickMainPage,
}
