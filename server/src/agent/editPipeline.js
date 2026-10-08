import { scanHtml, findSectionBlock, sectionStructureProblems } from '../utils/htmlStructure.js'
import { escapeHtml, renderSection } from '../templates/vanilla-kit/compose.js'

export const EDIT_SECTION_TYPES = [
  'hero', 'page-hero', 'services', 'features', 'stats', 'testimonials',
  'pricing', 'steps', 'faq', 'gallery', 'about', 'team', 'contact',
  'contact-info', 'values', 'mission', 'blogs', 'cta',
]

const SYNONYMS = {
  hero: ['hero', 'banner', 'headline', 'masthead'],
  faq: ['faqs', 'faq', 'questions', 'accordion', 'q and a', 'q&a'],
  pricing: ['pricing', 'plans', 'plans and pricing', 'packages', 'price list', 'prices', 'tiers', 'price'],
  testimonials: ['testimonials', 'reviews', 'review', 'quotes', 'feedback'],
  services: ['services', 'service'],
  features: ['features', 'feature'],
  stats: ['statistics', 'stats', 'numbers', 'metrics'],
  steps: ['how it works', 'process', 'steps', 'workflow'],
  gallery: ['gallery', 'portfolio', 'showcase'],
  contact: ['contact form', 'contact us', 'contact', 'enquiry form', 'enquiries', 'get in touch'],
  'contact-info': ['contact details', 'contact info', 'contact information'],
  about: ['about us', 'about', 'our story', 'story'],
  team: ['team', 'staff'],
  blogs: ['blogs', 'blog', 'articles', 'news'],
  cta: ['call to action', 'cta'],
  values: ['values'],
  mission: ['mission'],
}

const SECTION_LABELS = {
  hero: 'Home',
  faq: 'FAQ',
  pricing: 'Pricing',
  testimonials: 'Reviews',
  services: 'Services',
  features: 'Features',
  stats: 'Numbers',
  steps: 'How it works',
  gallery: 'Work',
  contact: 'Contact',
  'contact-info': 'Contact',
  about: 'About',
  team: 'Team',
  blogs: 'Blog',
  cta: 'Get in touch',
  values: 'Values',
  mission: 'Mission',
}

const NAV_TYPES = new Set([
  'services', 'features', 'about', 'pricing', 'testimonials', 'faq', 'stats',
  'team', 'gallery', 'steps', 'blogs', 'values', 'mission', 'contact', 'contact-info',
])

const STYLE_INTENT =
  /\b(columns?|darker|lighter|dark|light|colou?rs?|colou?red|spacing|padding|margin|gaps?|fonts?|font-size|sizes?|rounded|radius|borders?|shadows?|backgrounds?|background-colou?r|width|height|align(?:ed|ment)?|cent(?:re|er|red)|grid|layouts?|responsive|bigger|smaller|wider|narrower|bolder|thicker|thinner|styling|restyle|spaced|tighter|looser|cleaner|prettier|nicer)\b/i

const CONTENT_INTENT =
  /\b(ui|user interface|headings?|headlines?|titles?|texts?|copy|wording|contents?|labels?|items?|questions?|answers?|prices?|plans?|reviews?|quotes?|forms?|fields?|add|remove|delete|insert|new|redesign|restructure|rewrite|replace)\b/i

const AREA_PATTERNS = [
  ['header', /\b(header|top bar|nav ?bar|navigation bar)\b/i],
  ['nav', /\b(nav|navigation|menu|nav ?links?)\b/i],
  ['footer', /\b(footer|bottom of the page)\b/i],
]

export const RUNTIME_CLASSES = new Set([
  'reveal', 'in-view', 'is-open', 'is-active', 'is-scrolled', 'is-visible',
  'is-invalid', 'is-valid', 'has-fixed-header', 'no-js', 'js',
])

function slug(value, fallback = 'section') {
  const text = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return text || fallback
}

function escapeRegExp(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function sectionOutlineOf(source) {
  const { tags } = scanHtml(String(source ?? ''))
  const sections = []
  const seen = new Set()
  for (const tag of tags) {
    if (tag.closing || tag.selfClosing) continue
    const id = tag.attrs.id
    if (!id || seen.has(id)) continue
    if (!['section', 'article', 'header', 'footer', 'nav'].includes(tag.name)) continue
    seen.add(id)
    sections.push({
      id,
      type: tag.attrs['data-section'] || (tag.name === 'section' ? id : tag.name),
      title: tag.attrs['data-title'] || '',
      tag: tag.name,
    })
  }
  return sections
}

export function buildEditOutline(pages) {
  return {
    pages: (Array.isArray(pages) ? pages : []).map((page) => ({
      file: String(page?.file ?? '').replace(/\\/g, '/').replace(/^\.?\//, ''),
      label: String(page?.label ?? '').trim(),
      sections: sectionOutlineOf(page?.content ?? ''),
    })),
  }
}

function matchTypes(text) {
  const found = []
  for (const [type, words] of Object.entries(SYNONYMS)) {
    for (const word of words) {
      if (!new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i').test(text)) continue
      found.push({ type, word })
    }
  }
  found.sort((a, b) => b.word.length - a.word.length)
  const ordered = []
  for (const item of found) {
    if (!ordered.includes(item.type)) ordered.push(item.type)
  }
  return ordered
}

function matchArea(text) {
  for (const [area, pattern] of AREA_PATTERNS) {
    if (pattern.test(text)) return area
  }
  return null
}

function pickPage(text, pages, types, area) {
  if (pages.length === 0) return null
  for (const page of pages) {
    const base = page.file.split('/').pop()
    const stem = base.replace(/\.html?$/i, '')
    if (new RegExp(`\\b${escapeRegExp(base)}\\b`, 'i').test(text)) return page
    if (stem && stem !== 'index' && new RegExp(`\\b${escapeRegExp(stem)}\\b`, 'i').test(text)) return page
    if (page.label && new RegExp(`\\b${escapeRegExp(page.label)}\\b`, 'i').test(text)) return page
  }
  if (/\b(home|homepage|landing)\b/i.test(text)) {
    const home = pages.find((page) => /(^|\/)index\.html?$/i.test(page.file))
    if (home) return home
  }
  if (types.length > 0 && !area) {
    const withType = pages.find((page) => page.sections.some((section) => types.includes(section.type)))
    if (withType) return withType
  }
  return pages[0]
}

export function resolveEditTarget(task, outline) {
  const text = String(task ?? '')
  const pages = outline?.pages ?? []
  const types = matchTypes(text)
  const area = matchArea(text)
  const page = pickPage(text, pages, types, area)
  if (!page) {
    return { kind: 'unresolved', page: null, reason: 'there is no page to edit in this project' }
  }
  const sections = page.sections ?? []
  const cssOnly = STYLE_INTENT.test(text) && !CONTENT_INTENT.test(text)
  const wanted = types[0] ?? null

  if (area && !wanted) {
    return {
      kind: 'area',
      area,
      page: page.file,
      targetLabel: area === 'nav' ? 'navigation' : area,
      cssOnly,
      sectionType: area,
    }
  }

  if (!wanted) {
    return {
      kind: 'unresolved',
      page: page.file,
      reason: 'the request did not name a section, the header, the footer or the navigation',
    }
  }

  const existing = sections.find((section) => section.type === wanted) ?? null
  if (existing) {
    return {
      kind: 'section',
      page: page.file,
      sectionId: existing.id,
      sectionType: existing.type,
      sectionTag: existing.tag === 'section' ? 'section' : existing.tag,
      targetLabel: existing.title || SECTION_LABELS[wanted] || wanted,
      cssOnly: cssOnly && existing.tag === 'section',
      existing: true,
    }
  }

  return {
    kind: 'new-section',
    page: page.file,
    sectionId: uniqueId(sections, wanted),
    sectionType: wanted,
    sectionTag: 'section',
    targetLabel: SECTION_LABELS[wanted] || wanted,
    navLabel: SECTION_LABELS[wanted] || wanted,
    cssOnly: false,
    existing: false,
  }
}

function uniqueId(sections, type) {
  const base = slug(type, 'section')
  if (!sections.some((section) => section.id === base)) return base
  for (let counter = 2; counter < 40; counter += 1) {
    const candidate = `${base}-${counter}`
    if (!sections.some((section) => section.id === candidate)) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
}

export function classesIn(html) {
  const set = new Set()
  const text = String(html ?? '')
  for (const pattern of [/class\s*=\s*"([^"]*)"/gi, /class\s*=\s*'([^']*)'/gi]) {
    pattern.lastIndex = 0
    let match = pattern.exec(text)
    while (match) {
      for (const value of String(match[1]).split(/\s+/)) {
        if (value) set.add(value)
      }
      match = pattern.exec(text)
    }
  }
  return set
}

export function cssClassesIn(css) {
  const set = new Set()
  const text = String(css ?? '').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of text.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) set.add(match[1])
  return set
}

export function cssRuleBlocks(css) {
  const text = String(css ?? '')
  const blocks = []
  let index = 0
  while (index < text.length) {
    const open = text.indexOf('{', index)
    if (open === -1) break
    const prelude = text.slice(index, open).trim()
    let depth = 0
    let cursor = open
    for (; cursor < text.length; cursor += 1) {
      if (text[cursor] === '{') depth += 1
      else if (text[cursor] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    blocks.push({
      prelude,
      body: text.slice(open + 1, cursor),
      raw: text.slice(index, cursor + 1),
      start: index,
      end: cursor + 1,
    })
    index = cursor + 1
  }
  return blocks
}

function cleanPrelude(prelude) {
  return String(prelude ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').trim()
}

function selectorMatchesClasses(prelude, classes) {
  for (const part of String(prelude ?? '').split(',')) {
    for (const match of part.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
      if (classes.has(match[1])) return true
    }
  }
  return false
}

export function extractCssForClasses(cssTexts, html, { maxChars = 4200 } = {}) {
  const classes = classesIn(html)
  if (classes.size === 0) return ''
  const chunks = []
  for (const css of Array.isArray(cssTexts) ? cssTexts : [cssTexts]) {
    for (const block of cssRuleBlocks(css)) {
      if (block.prelude.startsWith('@')) {
        if (selectorMatchesClasses(block.prelude.replace(/^@[^{]+/, ''), classes)) {
          chunks.push(block.raw.trim())
          continue
        }
        const inner = cssRuleBlocks(block.body)
          .filter((entry) => !entry.prelude.startsWith('@') && selectorMatchesClasses(entry.prelude, classes))
          .map((entry) => `  ${entry.raw.trim()}`)
        if (inner.length > 0) chunks.push(`${block.prelude} {\n${inner.join('\n')}\n}`)
        continue
      }
      if (selectorMatchesClasses(block.prelude, classes)) chunks.push(block.raw.trim())
    }
  }
  const text = chunks.join('\n\n')
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…` : text
}

export function normalizeSelector(value) {
  return cleanPrelude(value).toLowerCase()
}

function declarationsOf(body) {
  const map = new Map()
  for (const part of String(body ?? '').split(';')) {
    const declaration = part.trim()
    if (!declaration) continue
    const colon = declaration.indexOf(':')
    if (colon === -1) continue
    const property = declaration.slice(0, colon).trim().toLowerCase()
    if (!property) continue
    map.set(property, declaration)
  }
  return map
}

export function mergeDeclarations(existingBody, nextBody) {
  const merged = declarationsOf(existingBody)
  for (const [property, declaration] of declarationsOf(nextBody)) merged.set(property, declaration)
  return [...merged.values()].join('; ')
}

export function upsertCssRules(cssText, newCss) {
  let text = String(cssText ?? '')
  const changed = []
  for (const block of cssRuleBlocks(newCss)) {
    const prelude = block.prelude.trim()
    if (!prelude) continue
    if (prelude.startsWith('@')) {
      text = `${text.trimEnd()}\n\n${block.raw.trim()}\n`
      changed.push(prelude)
      continue
    }
    const existing = cssRuleBlocks(text).find(
      (entry) => !entry.prelude.startsWith('@') && normalizeSelector(entry.prelude) === normalizeSelector(prelude),
    )
    const mergeable = existing && !/^(:root|html|body|\*)$/.test(normalizeSelector(prelude))
    if (mergeable) {
      const mergedBody = mergeDeclarations(existing.body, block.body)
      text = `${text.slice(0, existing.start)}${existing.prelude} { ${mergedBody} }${text.slice(existing.end)}`
    } else {
      text = `${text.trimEnd()}\n\n${prelude} { ${block.body.trim()} }\n`
    }
    changed.push(prelude)
  }
  return { text, changed }
}

export function stampSection(html, { id, type, title, tag = 'section' }) {
  const value = String(html ?? '').trim()
  const match = new RegExp(`^<${tag}\\b([^>]*)>`, 'i').exec(value)
  if (!match) return value
  let attrs = match[1]
    .replace(/\s+id\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+data-section\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+data-title\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  if (!/\bclass\s*=/i.test(attrs)) attrs += ' class="section"'
  const owned =
    tag === 'section' || tag === 'article'
      ? ` id="${escapeHtml(id)}" data-section="${escapeHtml(type)}" data-title="${escapeHtml(title)}"`
      : id
        ? ` id="${escapeHtml(id)}"`
        : ''
  return `<${tag}${attrs}${owned}>${value.slice(match[0].length)}`
}

export function countH1(text) {
  return (String(text ?? '').match(/<h1\b/gi) || []).length
}

export function validateFragment({ html, tag = 'section', restH1 = 0, definedClasses = new Set(), addedCss = '' }) {
  const problems = []
  const value = String(html ?? '').trim()
  if (!value) return ['the replacement was empty']
  if (!new RegExp(`^<${tag}\\b`, 'i').test(value) || !new RegExp(`</${tag}>\\s*$`, 'i').test(value)) {
    problems.push(`the replacement must be ONE complete <${tag}> element, from its opening tag to its closing tag`)
  }
  const structure = sectionStructureProblems(value)
  if (structure.length > 0) problems.push(...structure.slice(0, 3))
  if (/<!--\s*SLOT:/i.test(value)) problems.push('the replacement still contains a scaffold slot marker')
  if (/<!--[^>]*ONE DOCUMENT PER FILE/i.test(value)) problems.push('the replacement contains an internal template comment')
  if (/<script\b/i.test(value)) problems.push('the replacement must not contain a <script> tag')
  if (/<style\b/i.test(value)) problems.push('the replacement must not contain a <style> tag')
  const h1 = countH1(value)
  if (h1 + restH1 > 1) {
    problems.push(`the page would end up with ${h1 + restH1} <h1> headings — a page is allowed exactly one`)
  }
  const added = cssClassesIn(addedCss)
  const unknown = []
  for (const cls of classesIn(value)) {
    if (definedClasses.has(cls) || added.has(cls)) continue
    unknown.push(cls)
  }
  if (unknown.length > 0) {
    problems.push(`these classes have no CSS rule: ${unknown.slice(0, 6).join(', ')} — reuse a kit class or add each rule under "css"`)
  }
  return problems
}

export function documentIssues(text) {
  const problems = []
  const value = String(text ?? '')
  if (!/<\/html>\s*$/i.test(value.trimEnd())) problems.push('the page does not end with </html>')
  if (!/<header\b/i.test(value)) problems.push('the page has no <header>')
  if (!/<footer\b/i.test(value)) problems.push('the page has no <footer>')
  const h1 = countH1(value)
  if (h1 !== 1) problems.push(`the page must contain exactly one <h1> (found ${h1})`)
  return problems
}

export function applySectionEdit(document, sectionId, newHtml) {
  const text = String(document ?? '')
  const block = findSectionBlock(text, sectionId)
  if (!block || block.ambiguous || block.unbalanced) return null
  const next = `${text.slice(0, block.start)}${newHtml}${text.slice(block.end)}`
  return { text: next, before: text.slice(0, block.start), after: text.slice(block.end) }
}

export function insertSection(document, newHtml) {
  const text = String(document ?? '')
  const closeMain = /<\/main>/i.exec(text)
  const footer = /<footer\b/i.exec(text)
  const anchor = closeMain ?? footer
  if (!anchor) return null
  const lineStart = text.lastIndexOf('\n', anchor.index - 1) + 1
  return `${text.slice(0, lineStart)}${newHtml}\n${text.slice(lineStart)}`
}

export function navHasAnchor(document) {
  return /<a class="nav-link[^"]*"\s+href="#/i.test(String(document ?? '')) || /<a[^>]*class="[^"]*\bnav-link\b[^"]*"[^>]*href="#/i.test(String(document ?? ''))
}

export function pageCount(pages) {
  return (Array.isArray(pages) ? pages : []).length
}

export function addNavAnchor(document, { id, label }) {
  const text = String(document ?? '')
  if (new RegExp(`href="#${escapeRegExp(id)}"`).test(text)) return text
  const listOpen = /<ul[^>]*class="[^"]*\bnav-list\b[^"]*"[^>]*>/i.exec(text)
  if (!listOpen) return text
  const listClose = text.indexOf('</ul>', listOpen.index)
  if (listClose === -1) return text
  const inner = text.slice(listOpen.index, listClose)
  const lasts = [...inner.matchAll(/\n([ \t]*)<li class="nav-item"/g)]
  const indent = lasts.length > 0 ? lasts[lasts.length - 1][1] : '          '
  const lastItemEnd = text.lastIndexOf('</li>', listClose)
  const item = `\n${indent}<li class="nav-item"><a class="nav-link" href="#${id}">${escapeHtml(label)}</a></li>`
  if (lastItemEnd === -1 || lastItemEnd < listOpen.index) {
    return `${text.slice(0, listClose)}${item}\n${text.slice(listClose)}`
  }
  const at = lastItemEnd + '</li>'.length
  return `${text.slice(0, at)}${item}${text.slice(at)}`
}

export function navLabelFor(type) {
  return SECTION_LABELS[type] ?? String(type ?? '').replace(/-/g, ' ')
}

export function shouldAddNavLink(type) {
  return NAV_TYPES.has(String(type ?? ''))
}

export function renderContactSection({ id, title, lead, task }) {
  return renderSection(
    {
      type: 'contact',
      id,
      title: title || 'Get in touch',
      lead: lead || 'Tell us what you need and we will reply within one working day.',
      eyebrow: 'Contact',
      items: [
        { icon: 'mail', title: 'Email', text: 'hello@example.com' },
        { icon: 'phone', title: 'Phone', text: '+44 20 7946 0123' },
        { icon: 'map-pin', title: 'Studio', text: '14 Bridge Street, London' },
      ],
      form: { submit: 'Send message' },
      _task: task,
    },
    { hasContact: true, contactId: id },
  )
}

export function parseEditReply(content) {
  const raw = String(content ?? '').trim()
  if (!raw) return null
  const fenced = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1))
    if (!parsed || typeof parsed !== 'object') return null
    return {
      html: typeof parsed.html === 'string' ? parsed.html : null,
      css: typeof parsed.css === 'string' ? parsed.css : null,
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
    }
  } catch {
    return null
  }
}

export const EDIT_SYSTEM_PROMPT = `You edit ONE part of an existing static HTML/CSS website. You never rebuild the page and you never touch anything else.
Reply with ONLY a JSON object — no prose, no markdown fences. Shape:
{"html":"<the complete replacement element>","css":"optional CSS rules","summary":"one short sentence"}
Rules for "html":
- It must be ONE complete element: the whole <section> (or the whole <footer>/<header>/<nav> when that is the target), opening tag through closing tag, perfectly balanced. Nothing before or after it.
- Do NOT set id, data-section or data-title on that element. The server owns and restores them.
- Keep the existing classes and reuse the design system's class names shown in the current markup. Never invent class names: any new class you introduce must have a rule in "css".
- Write real, specific content. No placeholders, no lorem ipsum, no TODO.
- Never include <script> or <style>.
Rules for "css":
- Use it for layout, spacing, colour and any styling change. Return the exact selector(s) with only the declarations you want to change, for example ".pricing .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }".
- For a styling-only request (colours, columns, spacing, darker/lighter, sizes) return NO "html" at all — only "css". Never restate the whole stylesheet.
- Prefer a component selector (".site-footer", ".pricing .grid") over :root/html/body.
Keep "summary" to one short sentence describing what changed.`

export function buildEditUserMessage({ task, target, currentHtml, currentCss, retryProblems }) {
  const lines = [
    `TASK: ${String(task ?? '').trim()}`,
    '',
    `PAGE: ${target.page}`,
    `TARGET: ${target.kind === 'new-section' ? `a NEW ${target.sectionType} section, to be inserted before the footer` : `${target.sectionTag || 'section'}#${target.sectionId || target.area} (data-section="${target.sectionType}")`}`,
  ]
  if (target.kind === 'new-section') {
    lines.push(
      `The page has no ${target.sectionType} section yet. Return the complete <section> for it. Match the page's existing section style and class vocabulary.`,
    )
  }
  if (target.cssOnly) {
    lines.push('This is a STYLING change: return ONLY "css". Do not return "html".')
  }
  if (target.kind === 'area') {
    lines.push(
      `The target is the page's ${target.area}. Return the complete replacement <${target.area === 'nav' ? 'nav' : target.area}> element (no scripts, no <style>).`,
    )
  }
  if (currentHtml) {
    lines.push('', 'CURRENT MARKUP OF THE TARGET:', String(currentHtml).trim())
  }
  if (currentCss) {
    lines.push('', 'CURRENT CSS USED BY THE TARGET:', String(currentCss).trim())
  }
  if (Array.isArray(retryProblems) && retryProblems.length > 0) {
    lines.push(
      '',
      'YOUR PREVIOUS REPLY WAS REJECTED. Fix exactly these problems and reply with the corrected JSON:',
      ...retryProblems.map((problem, index) => `${index + 1}. ${problem}`),
    )
  }
  return lines.join('\n')
}

export const __testables = {
  matchTypes,
  matchArea,
  pickPage,
  uniqueId,
  normalizeSelector,
  selectorMatchesClasses,
  sectionOutlineOf,
}
