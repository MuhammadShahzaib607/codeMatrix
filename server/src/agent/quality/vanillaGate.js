import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import * as cheerio from 'cheerio'
import { getWorkspacePath } from '../../utils/workspaceManager.js'
import {
  APP_REQUIRED_JS_SNIPPETS,
  APP_SCRIPT,
  APP_STYLESHEET,
  CONTACT_FIELDS,
  GATE_MAX_REPAIR_ROUNDS,
  MAX_MISSING_CLASS_RATIO,
  MIN_FAQ_ITEMS,
  MIN_MEDIA_RULES,
  MIN_MISSING_CLASSES,
  MIN_REPEATED_ITEMS,
  REPEATED_SECTION_IDS,
  REQUIRED_JS_SNIPPETS,
  REQUIRED_SCRIPT,
  BASE_STYLESHEET,
  SHARED_STYLESHEETS,
  SECTION_MIN_CHARS,
  minLinesFor,
} from './thresholds.js'

const REMOTE_PREFIXES = ['http://', 'https://', '//']
const IGNORED_SCHEMES = /^(mailto:|tel:|sms:|data:|javascript:|blob:)/i
const BANNED_TEXT = [
  ['lorem ipsum', /\blorem ipsum\b/i],
  ['TODO', /\bTODO\b/],
  ['coming soon', /coming soon/i],
]
const ID_PATTERN = /^[A-Za-z][\w-]*$/
const HTTP_URL = /url\(\s*['"]?https?:\/\//i

function promisedScript(paths) {
  return paths.find((file) => /(^|\/)js\/main\.js$/i.test(file))
}

function promisedAppScript(paths) {
  return paths.find((file) => /(^|\/)js\/app\.js$/i.test(file))
}

function pageStylesheetFor(pageFile) {
  const name = path.posix.basename(String(pageFile ?? '')).replace(/\.[^.]+$/, '')
  return `css/${name}.css`
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanRelative(value) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^\.\//, '')
    .trim()
}

function posixJoin(fromFile, reference) {
  const dir = path.posix.dirname(String(fromFile ?? '').replace(/\\/g, '/'))
  return path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, reference))
}

function normalizePlan(plan) {
  const source = plan && typeof plan === 'object' ? plan : {}

  const files = []
  for (const entry of Array.isArray(source.files) ? source.files : []) {
    const candidate = typeof entry === 'string' ? entry : entry?.path
    const filePath = cleanRelative(candidate)
    if (!filePath || files.some((file) => file.path === filePath)) continue
    files.push({
      path: filePath,
      purpose: typeof entry === 'object' && entry ? String(entry.purpose ?? '') : '',
    })
  }

  const pages = []
  for (const entry of Array.isArray(source.pages) ? source.pages : []) {
    const candidate = typeof entry === 'string' ? entry : entry?.file
    const file = cleanRelative(candidate)
    if (!file) continue
    const sections = (Array.isArray(entry?.sections) ? entry.sections : [])
      .map((section) => String(section ?? '').trim())
      .filter(Boolean)
    pages.push({ file, sections })
  }

  const nav = []
  for (const entry of Array.isArray(source.nav) ? source.nav : []) {
    const label = normalizeText(typeof entry === 'string' ? entry : entry?.label)
    const href = normalizeText(typeof entry === 'object' && entry ? entry.href : '')
    if (label || href) nav.push({ label, href })
  }

  const requirements = (Array.isArray(source.requirements) ? source.requirements : [])
    .map((item) => normalizeText(item))
    .filter(Boolean)

  const declaredType = String(source.type ?? source.project_type ?? '')
    .trim()
    .toLowerCase()
  const type = declaredType === 'app' || declaredType === 'site' ? declaredType : null

  return { files, pages, nav, requirements, type }
}

function maxRepeatedGroup($section) {
  const root = $section.get(0)
  if (!root) return 0
  let best = 0

  const visit = (element) => {
    const children = (element.children ?? []).filter((child) => child.type === 'tag')
    if (children.length > 0) {
      const groups = new Map()
      for (const child of children) {
        const className = String(child.attribs?.class ?? '')
          .split(/\s+/)
          .filter(Boolean)
          .sort()
          .join('.')
        const key = `${String(child.tagName ?? '?').toLowerCase()}.${className}`
        groups.set(key, (groups.get(key) ?? 0) + 1)
      }
      for (const size of groups.values()) if (size > best) best = size
    }
    for (const child of children) visit(child)
  }

  visit(root)
  return best
}

export async function vanillaGate({ projectId = null, root = null, plan = null, now = new Date() } = {}) {
  const failures = []
  const checks = []
  const record = (id, count, problems, detail = null) => {
    checks.push({ id, ok: problems === 0, count, detail })
    return problems === 0
  }

  let workspaceRoot = root
  if (!workspaceRoot) {
    try {
      workspaceRoot = getWorkspacePath(projectId)
    } catch (error) {
      failures.push(`The workspace folder could not be resolved: ${error.message}`)
      return { ok: false, failures, checks, files: [] }
    }
  }

  const cache = new Map()
  const readFile = (relativePath) => {
    const clean = cleanRelative(relativePath)
    if (!clean || clean.split('/').includes('..')) return null
    if (cache.has(clean)) return cache.get(clean)
    let content = null
    try {
      content = fs.readFileSync(path.join(workspaceRoot, clean), 'utf8')
    } catch {
      content = null
    }
    cache.set(clean, content)
    return content
  }
  const hasFile = (relativePath) => readFile(relativePath) !== null

  const normalizedPlan = normalizePlan(plan)
  const plannedPaths = normalizedPlan.files.map((file) => file.path)

  const projectType =
    normalizedPlan.type ?? (hasFile(APP_STYLESHEET) && !hasFile(BASE_STYLESHEET) ? 'app' : 'site')
  const isApp = projectType === 'app'

  const htmlByFile = new Map()
  const loadPage = (file) => {
    if (htmlByFile.has(file)) return htmlByFile.get(file)
    const html = readFile(file)
    if (html === null) {
      htmlByFile.set(file, null)
      return null
    }
    const page = { file, html, $: cheerio.load(html) }
    htmlByFile.set(file, page)
    return page
  }

  let pageFiles = normalizedPlan.pages
    .map((page) => page.file)
    .filter((file) => /\.html?$/i.test(file) && hasFile(file))
  if (pageFiles.length === 0) pageFiles = plannedPaths.filter((file) => /\.html?$/i.test(file) && hasFile(file))
  if (pageFiles.length === 0) {
    try {
      pageFiles = fs
        .readdirSync(workspaceRoot)
        .filter((name) => /\.html?$/i.test(name))
        .sort()
    } catch {
      pageFiles = []
    }
  }
  pageFiles = [...new Set(pageFiles)]
  const pages = pageFiles.map(loadPage).filter(Boolean)

  const usesPageStylesheets = pages.some((page) => {
    const hrefs = page
      .$('link[rel~="stylesheet"]')
      .map((_, element) => page.$(element).attr('href'))
      .get()
      .filter(Boolean)
    const own = pageStylesheetFor(page.file)
    return hrefs.some(
      (href) => posixJoin(page.file, cleanRelative(String(href).split('?')[0].split('#')[0])) === own,
    )
  })

  if (pages.length === 0) failures.push('No HTML page was created at the project root.')

  let fileProblems = 0
  for (const file of normalizedPlan.files) {
    const content = readFile(file.path)
    if (content === null) {
      failures.push(`Planned file "${file.path}" is missing — create it.`)
      fileProblems += 1
      continue
    }
    const lines = content.split('\n').length
    const minimum = minLinesFor(file.path, { type: projectType })
    if (lines < minimum) {
      failures.push(
        `"${file.path}" has ${lines} lines; at least ${minimum} lines of real content are required — extend it with append_to_file.`,
      )
      fileProblems += 1
    }
  }
  record('planned-files', normalizedPlan.files.length, fileProblems)

  let structureProblems = 0
  for (const page of pages) {
    const { file, html, $ } = page
    const before = failures.length
    if (!/^\s*<!doctype\s+html/i.test(html)) failures.push(`${file}: start the file with <!DOCTYPE html>.`)
    if (!$('html[lang]').length) failures.push(`${file}: the <html> tag needs lang="en".`)
    if (!$('meta[charset]').length) failures.push(`${file}: add <meta charset="utf-8">.`)
    if (!$('meta[name="viewport"]').length) failures.push(`${file}: add a viewport meta tag.`)
    if (!normalizeText($('meta[name="description"]').attr('content')))
      failures.push(`${file}: add a non-empty <meta name="description">.`)
    if (!normalizeText($('title').first().text())) failures.push(`${file}: add a non-empty <title>.`)
    const h1Count = $('h1').length
    if (h1Count !== 1) failures.push(`${file}: needs exactly one <h1> (found ${h1Count}).`)
    if (!$('main').length) failures.push(`${file}: add a <main> landmark.`)
    if (isApp) {
      if ($('header nav').length > 0)
        failures.push(
          `${file}: this is a utility APP, so it must not have a <nav>. The app bar holds only the app title — delete the navbar markup with edit_file.`,
        )
      if ($('footer').length > 0)
        failures.push(
          `${file}: this is a utility APP, so it must not have a <footer>. Delete the marketing footer (brand blurb, quick links, social icons) with edit_file and keep the app single-screen.`,
        )
      if ($('#hero, .hero, .pricing-card, #pricing, #faq, .faq-item, #testimonials, .testimonial').length > 0)
        failures.push(
          `${file}: this is a utility APP — a calculator/tool must not include hero, pricing, testimonial or FAQ sections. Keep only the functional UI.`,
        )
    } else {
      if (!$('header').length) failures.push(`${file}: add a <header> landmark.`)
      if (!$('header nav').length) failures.push(`${file}: the header needs a <nav> with the site links.`)
      if (!$('footer').length) failures.push(`${file}: add a <footer> landmark.`)
      if (!$('header button[aria-expanded][aria-controls]').length)
        failures.push(`${file}: the header needs a hamburger button carrying aria-expanded and aria-controls.`)
    }

    const headerCount = $('header').length
    const footerCount = $('footer').length
    const bodyCloseCount = (html.match(/<\/body\s*>/gi) ?? []).length
    if (headerCount > 1)
      failures.push(
        `${file}: contains ${headerCount} <header> elements. Every page has exactly ONE header at the top of <body> — a single-page site with many sections still has one. Delete the repeats with edit_file.`,
      )
    if (footerCount > 1)
      failures.push(
        `${file}: contains ${footerCount} <footer> elements. Every page has exactly ONE footer at the bottom of <body>; sections belong inside <main> between the single header and the single footer. Delete the repeats with edit_file.`,
      )
    if (bodyCloseCount > 1)
      failures.push(
        `${file}: closes </body> ${bodyCloseCount} times — a "page tail" (</main>, <footer>, </body>, </html>) was repeated after sections. Keep exactly one of each at the end of the file.`,
      )

    const stylesheets = $('link[rel~="stylesheet"]')
      .map((_, element) => $(element).attr('href'))
      .get()
      .filter(Boolean)
    const stylesheetRef = (href) => String(href).split('?')[0].split('#')[0]
    const resolvedSheets = stylesheets
      .filter((href) => !stylesheetRef(href).startsWith('/'))
      .map((href) => posixJoin(file, cleanRelative(stylesheetRef(href))))
    const sharedSheet = resolvedSheets.find((sheet) => SHARED_STYLESHEETS.includes(sheet))
    if (!sharedSheet)
      failures.push(
        isApp
          ? `${file}: link the app stylesheet with <link rel="stylesheet" href="css/app.css"> after css/theme.css — a valid, RELATIVE path with no leading "/".`
          : `${file}: link the shared stylesheet with <link rel="stylesheet" href="css/base.css"> (or css/style.css for a single-stylesheet project) — a valid, RELATIVE path with no leading "/".`,
      )
    else if (!isApp && sharedSheet === BASE_STYLESHEET && usesPageStylesheets) {
      const pageSheet = pageStylesheetFor(file)
      if (!resolvedSheets.includes(pageSheet))
        failures.push(
          `${file}: link its own page stylesheet after base.css — <link rel="stylesheet" href="${pageSheet}">.`,
        )
      if (!hasFile(pageSheet))
        failures.push(`"${pageSheet}" is missing — every page gets its own page stylesheet with only that page's sections.`)
    }

    const scripts = $('script[src]')
      .map((_, element) => $(element).attr('src'))
      .get()
      .filter(Boolean)
    const wantedScript = isApp ? APP_SCRIPT : REQUIRED_SCRIPT
    const linksScript = scripts.some(
      (src) =>
        !String(src).split('?')[0].split('#')[0].startsWith('/') &&
        posixJoin(file, cleanRelative(String(src).split('?')[0].split('#')[0])) === wantedScript,
    )
    if (!linksScript)
      failures.push(
        `${file}: include <script src="${wantedScript}" defer></script> as a relative path with no leading "/".`,
      )

    structureProblems += failures.length - before
  }
  record('page-structure', pages.length, structureProblems)

  let consistencyProblems = 0
  if (!isApp && pages.length > 1) {
    const signature = (page) => ({
      nav: page
        .$('header nav a')
        .map((_, element) => `${normalizeText(page.$(element).text())}|${page.$(element).attr('href') ?? ''}`)
        .get()
        .join(' > '),
      footer: normalizeText(page.$('footer').text()).replace(/\b(19|20)\d{2}\b/g, 'YYYY'),
    })
    const reference = pages[0]
    const expected = signature(reference)
    for (const page of pages.slice(1)) {
      const actual = signature(page)
      if (actual.nav !== expected.nav) {
        failures.push(
          `${page.file}: the header nav labels or hrefs differ from ${reference.file}; every page must share identical header markup (only class="active" changes).`,
        )
        consistencyProblems += 1
      }
      if (actual.footer !== expected.footer) {
        failures.push(`${page.file}: the footer text differs from ${reference.file}; keep the footer markup identical on every page.`)
        consistencyProblems += 1
      }
    }
  }
  record('shared-header-footer', pages.length, consistencyProblems)

  const idsOf = (file) => {
    const page = loadPage(file)
    if (!page) return new Set()
    const ids = new Set()
    page.$('[id]').each((_, element) => {
      const id = page.$(element).attr('id')
      if (id) ids.add(String(id))
    })
    return ids
  }

  let linkProblems = 0
  for (const page of pages) {
    page.$('[href]').each((_, element) => {
      const raw = String(page.$(element).attr('href') ?? '').trim()
      if (!raw || raw === '#') {
        failures.push(`${page.file}: "${raw === '' ? 'empty href' : 'href="#"'}" is a dead link — point it at a real page or section id.`)
        linkProblems += 1
        return
      }
      if (IGNORED_SCHEMES.test(raw) || REMOTE_PREFIXES.some((prefix) => raw.startsWith(prefix))) return

      if (raw.startsWith('/')) {
        failures.push(
          `${page.file}: "${raw}" is a root-absolute path. The preview serves this project under /preview/<projectId>/, so it is fetched from the server root and 404s. Use a relative path with no leading "/" (for example "${raw.replace(/^\/+/, '')}").`,
        )
        linkProblems += 1
        return
      }

      const hashIndex = raw.indexOf('#')
      const fragment = hashIndex >= 0 ? raw.slice(hashIndex + 1) : ''
      const reference = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw
      let target = page.file
      if (reference) {
        const joined = posixJoin(page.file, reference)
        if (joined.startsWith('..')) {
          failures.push(`${page.file}: "${raw}" points outside the project.`)
          linkProblems += 1
          return
        }
        if (!hasFile(joined) && !reference.includes('.') && hasFile(`${joined}/index.html`)) {
          target = `${joined}/index.html`
        } else {
          target = joined
        }
      }
      if (!hasFile(target)) {
        failures.push(`${page.file}: "${raw}" points at "${target}", which does not exist.`)
        linkProblems += 1
        return
      }
      if (fragment && !idsOf(target).has(fragment)) {
        failures.push(`${page.file}: "${raw}" — no element with id="${fragment}" exists in ${target}.`)
        linkProblems += 1
      }
    })

    page.$('img[src]').each((_, element) => {
      const src = String(page.$(element).attr('src') ?? '').trim()
      if (REMOTE_PREFIXES.some((prefix) => src.startsWith(prefix))) {
        failures.push(`${page.file}: remote <img src="${src}"> will break — use an inline SVG or a CSS shape instead.`)
        linkProblems += 1
        return
      }
      if (src.startsWith('/')) {
        failures.push(
          `${page.file}: <img src="${src}"> is a root-absolute path and will 404 under /preview/<projectId>/. Use a relative path with no leading "/".`,
        )
        linkProblems += 1
      }
    })
  }
  record('links', pages.length, linkProblems)

  if (!isApp && normalizedPlan.nav.length > 0 && pages.length > 0) {
    const homeLabels = new Set(
      pages[0]
        .$('header nav a')
        .map((_, element) => normalizeText(pages[0].$(element).text()).toLowerCase())
        .get(),
    )
    for (const item of normalizedPlan.nav) {
      const wanted = String(item.label || item.href).toLowerCase()
      if (wanted && !homeLabels.has(wanted)) {
        failures.push(`${pages[0].file}: the navbar is missing the planned nav item "${item.label || item.href}".`)
      }
    }
  }

  let sectionProblems = 0
  for (const planned of isApp ? [] : normalizedPlan.pages) {
    if (!/\.html?$/i.test(planned.file)) continue
    const page = loadPage(planned.file)
    if (!page) continue
    for (const id of planned.sections) {
      if (!ID_PATTERN.test(id)) continue
      const $section = page.$(`#${id}`)
      if (!$section.length) {
        failures.push(`${planned.file}: the planned section <section id="${id}"> is missing.`)
        sectionProblems += 1
        continue
      }
      const text = normalizeText($section.text())
      if (text.length < SECTION_MIN_CHARS) {
        failures.push(
          `${planned.file} #${id}: only ${text.length} characters of text; write at least ${SECTION_MIN_CHARS} characters of real copy.`,
        )
        sectionProblems += 1
      }
      if (REPEATED_SECTION_IDS.includes(id) && maxRepeatedGroup($section) < MIN_REPEATED_ITEMS) {
        failures.push(
          `${planned.file} #${id}: needs at least ${MIN_REPEATED_ITEMS} repeated sibling cards (same tag and class).`,
        )
        sectionProblems += 1
      }
    }
  }

  // The FAQ accordion belongs to the HOME page. A follow-up that only adds
  // other pages must not be asked to invent one, so the requirement applies
  // only when the run actually builds (or rebuilds) the home page.
  const declaredHome = !isApp && normalizedPlan.pages.some((entry) => /(^|\/)(index|home)\.html?$/i.test(entry.file))
  const faqButtons = pages.reduce((total, page) => total + page.$('#faq button[aria-expanded]').length, 0)
  if (declaredHome && faqButtons < MIN_FAQ_ITEMS) {
    failures.push(`The #faq section needs at least ${MIN_FAQ_ITEMS} accordion buttons carrying aria-expanded (found ${faqButtons}).`)
    sectionProblems += 1
  }

  // Only a page that IS the contact page (by name) or that DECLARES a contact
  // form section is held to the contact-form requirements. A follow-up run that
  // adds unrelated pages must not be told to put a form on the first page it
  // happened to create.
  const contactPage =
    (isApp ? undefined : pages.find((page) => /contact/i.test(page.file))) ??
    pages.find((page) =>
      normalizedPlan.pages.some(
        (entry) => entry.file === page.file && (entry.sections ?? []).includes('contact-form'),
      ),
    ) ??
    null
  if (contactPage) {
    const $form = contactPage.$('form').first()
    if (!$form.length) {
      failures.push(`${contactPage.file}: add a <form> with the contact fields.`)
      sectionProblems += 1
    } else {
      const fields = $form.find('input, textarea, select').toArray()
      for (const key of CONTACT_FIELDS) {
        const element = fields.find((field) => {
          const $field = contactPage.$(field)
          const name = String($field.attr('name') ?? $field.attr('id') ?? '')
            .toLowerCase()
            .replace(/[^a-z]/g, '')
          return name === key || name.startsWith(key)
        })
        if (!element) {
          failures.push(`${contactPage.file}: the contact form is missing the "${key}" field.`)
          sectionProblems += 1
          continue
        }
        const $field = contactPage.$(element)
        const id = $field.attr('id')
        const hasLabel =
          ($field.attr('aria-label') && String($field.attr('aria-label')).trim().length > 0) ||
          $field.parents('label').length > 0 ||
          (id && contactPage.$(`label[for="${id}"]`).length > 0)
        if (!hasLabel) failures.push(`${contactPage.file}: the "${key}" field needs a <label> (for/id or aria-label).`)
      }
      if (!$form.find('button[type="submit"], input[type="submit"]').length && !$form.find('button').length) {
        failures.push(`${contactPage.file}: the contact form needs a submit button.`)
        sectionProblems += 1
      }
    }
  }
  record('sections', normalizedPlan.pages.length, sectionProblems)

  const cssDirFiles = (() => {
    try {
      return fs
        .readdirSync(path.join(workspaceRoot, 'css'))
        .filter((name) => /\.css$/i.test(name))
        .sort()
        .slice(0, 24)
        .map((name) => `css/${name}`)
    } catch {
      return []
    }
  })()
  const sharedCssPath =
    SHARED_STYLESHEETS.find((sheet) => hasFile(sheet)) ??
    plannedPaths.find((file) => SHARED_STYLESHEETS.includes(cleanRelative(file))) ??
    cssDirFiles[0] ??
    BASE_STYLESHEET
  const cssPaths = [...new Set([sharedCssPath, ...cssDirFiles])]

  let contentProblems = 0
  const year = now.getFullYear()
  for (const content of [
    ...pages.map((page) => [page.file, page.html]),
    ...[...cssPaths, REQUIRED_SCRIPT].map((file) => [file, readFile(file) ?? '']),
  ]) {
    const [file, text] = content
    for (const [label, pattern] of BANNED_TEXT) {
      if (pattern.test(text)) {
        failures.push(`${file}: contains placeholder text ("${label}") — replace it with real content.`)
        contentProblems += 1
      }
    }
  }
  for (const page of pages) {
    const footerText = page.$('footer').text()
    if (!/©|\(c\)|&copy;/i.test(footerText)) continue
    const years = (footerText.match(/\b(19|20)\d{2}\b/g) ?? []).filter((value) => Number(value) !== year)
    if (years.length > 0 && page.$('footer [id="year"]').length === 0) {
      failures.push(
        `${page.file}: the footer copyright year (${years.join(', ')}) must be ${year}, or filled at runtime from <span id="year">.`,
      )
      contentProblems += 1
    }
  }
  record('content-year', pages.length, contentProblems)

  const jsPath =
    (isApp ? promisedAppScript(plannedPaths) : promisedScript(plannedPaths)) ??
    (isApp ? APP_SCRIPT : REQUIRED_SCRIPT)
  const cssPath = sharedCssPath
  let assetProblems = 0

  const js = readFile(jsPath)
  if (js === null) {
    failures.push(`"${jsPath}" is missing — create it.`)
    assetProblems += 1
  } else {
    try {
      new vm.Script(js, { filename: jsPath })
    } catch (error) {
      failures.push(`${jsPath} does not compile: ${error.message}`)
      assetProblems += 1
    }
    for (const [needle, why] of isApp ? APP_REQUIRED_JS_SNIPPETS : REQUIRED_JS_SNIPPETS) {
      if (!js.includes(needle)) {
        failures.push(`${jsPath} must contain "${needle}" (${why}).`)
        assetProblems += 1
      }
    }
  }

  const css = readFile(cssPath)
  const allCssText = cssPaths
    .map((file) => readFile(file))
    .filter((text) => text !== null)
    .join('\n')
  if (css === null) {
    failures.push(`"${cssPath}" is missing — create it.`)
    assetProblems += 1
  } else {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const strippedAll = allCssText.replace(/\/\*[\s\S]*?\*\//g, '')
    const open = (stripped.match(/\{/g) ?? []).length
    const close = (stripped.match(/\}/g) ?? []).length
    if (open !== close) {
      failures.push(`${cssPath}: unbalanced braces (${open} "{" vs ${close} "}").`)
      assetProblems += 1
    }
    if (!/:root\s*\{/.test(stripped)) {
      failures.push(`${cssPath}: add a :root block holding the design tokens.`)
      assetProblems += 1
    }
    const mediaCount = (stripped.match(/@media\b/g) ?? []).length
    if (mediaCount < MIN_MEDIA_RULES) {
      failures.push(`${cssPath}: needs at least ${MIN_MEDIA_RULES} @media rules (found ${mediaCount}).`)
      assetProblems += 1
    }
    if (!/prefers-reduced-motion/.test(stripped)) {
      failures.push(`${cssPath}: add a prefers-reduced-motion block that disables motion.`)
      assetProblems += 1
    }
    if (HTTP_URL.test(strippedAll)) {
      failures.push(`${cssPaths.join(', ')}: remote image URLs are not allowed — use gradients, shapes or inline SVG.`)
      assetProblems += 1
    }

    const htmlClasses = new Set()
    for (const page of pages) {
      page.$('[class]').each((_, element) => {
        const value = String(page.$(element).attr('class') ?? '')
        for (const name of value.split(/\s+/)) if (name) htmlClasses.add(name)
      })
    }
    const cssClasses = new Set()
    for (const match of strippedAll.matchAll(/\.([A-Za-z_][\w-]*)/g)) cssClasses.add(match[1])
    const missingClasses = [...htmlClasses].filter((name) => !cssClasses.has(name))
    if (
      htmlClasses.size > 0 &&
      missingClasses.length >= MIN_MISSING_CLASSES &&
      missingClasses.length / htmlClasses.size > MAX_MISSING_CLASS_RATIO
    ) {
      failures.push(
        `${cssPaths.join(', ')}: style almost none of the classes used in the HTML (missing: ${missingClasses
          .slice(0, 12)
          .join(', ')}${missingClasses.length > 12 ? ', …' : ''}). Style the classes the HTML uses.`,
      )
      assetProblems += 1
    }
  }
  record('assets', 2, assetProblems)

  return {
    ok: failures.length === 0,
    failures,
    checks,
    files: [...new Set([...plannedPaths, ...pageFiles])],
  }
}

export function formatGateReport(result, { maxRounds = GATE_MAX_REPAIR_ROUNDS } = {}) {
  const lines = result.failures.map((failure, index) => `${index + 1}. ${failure}`)
  return [
    `QUALITY GATE FAILED: ${result.failures.length} problem(s)`,
    ...lines,
    `Fix exactly these problems with edit_file or append_to_file (never rewrite a file that already passes). You have up to ${maxRounds} repair rounds, then stop and finish.`,
  ].join('\n')
}

export const __testables = { normalizePlan, maxRepeatedGroup, posixJoin }
