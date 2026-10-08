import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(here, '..', 'server')
const workspaceRoot = path.join(here, 'workspaces')
const port = Number(process.argv[2] ?? 4987)

const SITE = {
  brand: 'Northwind Studio',
  tagline: 'Websites that win work',
  palette: 'indigo-modern',
  pages: [
    {
      file: 'index.html',
      title: 'Northwind Studio — digital design',
      nav_label: 'Home',
      sections: [
        {
          type: 'hero',
          title: 'We design websites that',
          highlight: 'win work',
          eyebrow: 'Digital studio',
          lead: 'Strategy, design and build for teams that need a site that sells.',
          card: { icon: 'code', title: 'Built to convert', text: 'Every page earns its place.' },
          stats: [
            { value: '120+', label: 'Projects shipped' },
            { value: '4.9/5', label: 'Client rating' },
          ],
        },
        {
          type: 'services',
          eyebrow: 'Services',
          title: 'What we do',
          items: [
            { icon: 'layers', title: 'Brand systems', text: 'Identity, voice and design tokens that scale.' },
            { icon: 'code', title: 'Web development', text: 'Fast, accessible, hand-built front ends.' },
            { icon: 'bar-chart', title: 'Growth', text: 'Content, SEO and conversion work.' },
          ],
        },
        {
          type: 'testimonials',
          eyebrow: 'Clients',
          title: 'What clients say',
          items: [
            { quote: 'They shipped in three weeks.', name: 'Ada Lovelace', role: 'CTO, Analytical' },
            { quote: 'Our leads doubled.', name: 'Grace Hopper', role: 'COO, Compiler Co' },
            { quote: 'The clearest process we have used.', name: 'Alan Turing', role: 'Founder, Enigma' },
          ],
        },
        {
          type: 'faq',
          eyebrow: 'FAQ',
          title: 'Questions, answered',
          items: [
            { question: 'How long does a project take?', answer: 'Four to six weeks for a full site.' },
            { question: 'Do you work with existing brands?', answer: 'Yes, we extend what you already have.' },
            { question: 'What do you need from us?', answer: 'Access to your content and one decision maker.' },
            { question: 'How do you handle revisions?', answer: 'Two rounds are included in every quote.' },
            { question: 'Do you offer support after launch?', answer: 'Yes, a monthly retainer is available.' },
          ],
        },
        {
          type: 'pricing',
          eyebrow: 'Pricing',
          title: 'Simple pricing',
          items: [
            { name: 'Starter', price: '£2,400', period: 'one-off', features: ['Five pages', 'Copy polish', 'Launch support'], cta: 'Choose Starter' },
            { name: 'Studio', price: '£5,900', period: 'one-off', features: ['Ten pages', 'Custom components', 'SEO setup'], cta: 'Choose Studio', featured: true },
            { name: 'Scale', price: '£9,500', period: 'one-off', features: ['Unlimited pages', 'CMS setup', 'Analytics'], cta: 'Choose Scale' },
          ],
        },
      ],
    },
  ],
}

const GALLERY_HTML = [
  '<section class="section" data-section="gallery">',
  '  <div class="container">',
  '    <div class="section-header reveal">',
  '      <p class="section-header__eyebrow">Work</p>',
  '      <h2 class="section-header__title">Selected projects</h2>',
  '    </div>',
  '    <div class="grid grid--3">',
  '      <article class="card reveal"><h3 class="card__title">Atlas rebrand</h3><p class="card__text">A full identity refresh for a growing studio.</p></article>',
  '      <article class="card reveal"><h3 class="card__title">Harbour booking</h3><p class="card__text">A booking flow that cut support tickets in half.</p></article>',
  '      <article class="card reveal"><h3 class="card__title">Northline app</h3><p class="card__text">A field tool built for offline crews.</p></article>',
  '    </div>',
  '  </div>',
  '</section>',
].join('\n')

const FAQ_HTML = [
  '<section class="section section--alt" data-section="faq">',
  '  <div class="container">',
  '    <div class="section-header reveal">',
  '      <p class="section-header__eyebrow">FAQ</p>',
  '      <h2 class="section-header__title">Everything you asked</h2>',
  '    </div>',
  '    <div class="faq reveal">',
  '      <div class="faq-item"><h3 class="faq-item__question"><button class="faq-item__toggle" type="button" aria-expanded="false" aria-controls="faq-1">How long does it take? <i class="icon" data-icon="chevron-down" aria-hidden="true"></i></button></h3><div class="faq-item__panel" id="faq-1"><p class="faq-item__answer">Most sites go live in four to six weeks.</p></div></div>',
  '      <div class="faq-item"><h3 class="faq-item__question"><button class="faq-item__toggle" type="button" aria-expanded="false" aria-controls="faq-2">What do you need from us? <i class="icon" data-icon="chevron-down" aria-hidden="true"></i></button></h3><div class="faq-item__panel" id="faq-2"><p class="faq-item__answer">Your content and one decision maker.</p></div></div>',
  '      <div class="faq-item"><h3 class="faq-item__question"><button class="faq-item__toggle" type="button" aria-expanded="false" aria-controls="faq-3">Can you keep our brand? <i class="icon" data-icon="chevron-down" aria-hidden="true"></i></button></h3><div class="faq-item__panel" id="faq-3"><p class="faq-item__answer">Yes, we work inside your existing system.</p></div></div>',
  '      <div class="faq-item"><h3 class="faq-item__question"><button class="faq-item__toggle" type="button" aria-expanded="false" aria-controls="faq-4">How many revisions? <i class="icon" data-icon="chevron-down" aria-hidden="true"></i></button></h3><div class="faq-item__panel" id="faq-4"><p class="faq-item__answer">Two rounds are included in the quote.</p></div></div>',
  '      <div class="faq-item"><h3 class="faq-item__question"><button class="faq-item__toggle" type="button" aria-expanded="false" aria-controls="faq-5">Do you offer support? <i class="icon" data-icon="chevron-down" aria-hidden="true"></i></button></h3><div class="faq-item__panel" id="faq-5"><p class="faq-item__answer">Monthly retainers are available after launch.</p></div></div>',
  '    </div>',
  '  </div>',
  '</section>',
].join('\n')

const HERO_HTML = [
  '<section class="hero" data-section="hero">',
  '  <span class="hero__blob" aria-hidden="true"></span>',
  '  <div class="container hero__inner">',
  '    <div class="hero__content reveal">',
  '      <p class="hero__eyebrow">Digital studio</p>',
  '      <h1 class="hero__title">Design that turns visitors into customers</h1>',
  '      <p class="hero__lead">Strategy, design and build for teams that need a site that sells.</p>',
  '      <div class="hero__actions"><a class="btn btn--primary btn--lg" href="#services">See our work</a></div>',
  '    </div>',
  '    <div class="hero__visual reveal" aria-hidden="true">',
  '      <div class="hero__card"><span class="icon-badge icon-badge--lg"><i class="icon" data-icon="sparkle" aria-hidden="true"></i></span><h3>Built to convert</h3><p class="card__text">Every page earns its place.</p></div>',
  '    </div>',
  '  </div>',
  '</section>',
].join('\n')

const BROKEN_HTML = '<section class="section"><h2>Team</h2><p class="card__text">Half a section'

function replyFor(task) {
  const text = String(task).toLowerCase()
  if (text.includes('contact form')) {
    return { html: '', css: '', summary: 'Added a contact form section with validation.' }
  }
  if (text.includes('faq')) {
    return { html: FAQ_HTML, css: '', summary: 'Refreshed the FAQ section layout.' }
  }
  if (text.includes('pricing') && text.includes('column')) {
    return { css: '#pricing .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }', summary: 'Set the pricing grid to three columns.' }
  }
  if (text.includes('hero')) {
    return { html: HERO_HTML, css: '', summary: 'Updated the hero heading and copy.' }
  }
  if (text.includes('footer')) {
    return { css: '.site-footer { background-color: #0b1220; }', summary: 'Made the footer darker.' }
  }
  if (text.includes('gallery')) {
    return { html: GALLERY_HTML, css: '', summary: 'Added a gallery section.' }
  }
  if (text.includes('team')) {
    return { html: BROKEN_HTML, css: '', summary: 'Added a team section.' }
  }
  return { html: '', css: '', summary: 'No change.' }
}

let requestCount = 0
const requestLog = []

function sseFrame(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function streamBody(message, usage) {
  const frames = []
  if (message.content) frames.push(sseFrame({ choices: [{ index: 0, delta: { content: message.content } }] }))
  frames.push(sseFrame({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }))
  frames.push(sseFrame({ choices: [], usage }))
  frames.push('data: [DONE]\n\n')
  return frames.join('')
}

function countChars(messages) {
  let chars = 0
  for (const message of messages ?? []) {
    if (typeof message.content === 'string') chars += message.content.length
    chars += 12
  }
  return chars
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url.includes('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        data: [
          { id: 'mistral-large-latest', object: 'model' },
          { id: 'mistral-small-latest', object: 'model' },
          { id: 'codestral-latest', object: 'model' },
        ],
      }),
    )
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(404).end()
    return
  }
  let raw = ''
  for await (const chunk of req) raw += chunk
  const payload = JSON.parse(raw || '{}')
  const messages = Array.isArray(payload.messages) ? payload.messages : []
  const userMessage = messages.find((message) => typeof message.content === 'string' && message.content.startsWith('TASK:'))
  const task = userMessage ? userMessage.content.split('\n')[0].replace(/^TASK:\s*/, '') : '(none)'
  const reply = replyFor(task)
  requestCount += 1
  requestLog.push({ n: requestCount, task, hasTools: Array.isArray(payload.tools) && payload.tools.length > 0, sentHtml: Boolean(reply.html), sentCss: Boolean(reply.css) })
  console.error(`[mock] request #${requestCount} task="${task}" -> html=${Boolean(reply.html)} css=${Boolean(reply.css)} tools=${requestLog[requestLog.length - 1].hasTools}`)

  const content = JSON.stringify(reply)
  const message = { role: 'assistant', content }
  const promptTokens = Math.ceil(countChars(messages) / 4)
  const completionTokens = Math.max(1, Math.ceil(content.length / 4))
  const usage = { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens }

  if (payload.stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(streamBody(message, usage))
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ id: 'mock', object: 'chat.completion', choices: [{ index: 0, message, finish_reason: 'stop' }], usage }))
  }
})

await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))

process.env.WORKSPACES_ROOT = workspaceRoot
process.env.MISTRAL_BASE_URL = `http://127.0.0.1:${port}/v1`

const { buildComposePlan } = await import(pathToFileURL(path.join(serverRoot, 'src/templates/vanilla-kit/index.js')).href)
const { runAgent } = await import(pathToFileURL(path.join(serverRoot, 'src/services/agentService.js')).href)

const plan = await buildComposePlan(SITE)
const pristine = new Map(plan.files.map((file) => [file.path, String(file.content ?? '')]))

async function writeSite(root) {
  await fsp.rm(root, { recursive: true, force: true })
  for (const [file, content] of pristine) {
    const target = path.join(root, file)
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, content, 'utf8')
  }
}

async function readAll(root) {
  const out = new Map()
  async function walk(dir, prefix = '') {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel)
      else out.set(rel, await fsp.readFile(path.join(dir, entry.name), 'utf8'))
    }
  }
  await walk(root)
  return out
}

function firstSectionRange(doc, id) {
  const match = new RegExp(`<section[^>]*\\bid="${id}"[^>]*>`).exec(doc)
  if (!match) return null
  const end = doc.indexOf('</section>', match.index)
  if (end === -1) return null
  return { start: match.index, end: end + '</section>'.length }
}

function diffSpan(before, after) {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1
  }
  return { prefix, suffix, beforeChanged: before.length - prefix - suffix, afterChanged: after.length - prefix - suffix }
}

function cssRule(css, selector) {
  const index = css.indexOf(`${selector} {`)
  if (index === -1) return null
  const end = css.indexOf('}', index)
  return css.slice(index, end === -1 ? undefined : end + 1)
}

function declarationsOf(rule) {
  if (!rule) return []
  const body = rule.slice(rule.indexOf('{') + 1, rule.lastIndexOf('}'))
  return body
    .split(';')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

function restIdenticalSection(beforeDoc, afterDoc, id) {
  const a = firstSectionRange(beforeDoc, id)
  const b = firstSectionRange(afterDoc, id)
  if (!a || !b) return { ok: false, reason: 'section not found' }
  const prefixOk = beforeDoc.slice(0, a.start) === afterDoc.slice(0, b.start)
  const suffixOk = beforeDoc.slice(a.end) === afterDoc.slice(b.end)
  return { ok: prefixOk && suffixOk, prefixOk, suffixOk }
}

function restIdenticalInsert(beforeDoc, afterDoc, id, label) {
  const b = firstSectionRange(afterDoc, id)
  if (!b) return { ok: false, reason: 'inserted section not found' }
  const trim = afterDoc[b.end] === '\n' ? 1 : 0
  let stripped = afterDoc.slice(0, b.start) + afterDoc.slice(b.end + trim)
  const nav = new RegExp(`\\n[ \\t]*<li class="nav-item"><a class="nav-link" href="#${id}">${label}</a></li>`)
  stripped = stripped.replace(nav, '')
  return { ok: stripped === beforeDoc, reason: stripped === beforeDoc ? null : 'stripped doc differs' }
}

const CASES = [
  { name: '1 add contact form section', task: 'add a contact form section to the home page' },
  { name: '2 update the FAQ UI', task: 'update the UI of the FAQs on the home page' },
  { name: '3 pricing 3 columns', task: 'make the pricing 3 columns' },
  { name: '4 change hero heading', task: 'change the hero heading' },
  { name: '5 darker footer', task: 'make the footer darker' },
  { name: '6 nonexistent section (gallery)', task: 'add a gallery section' },
  { name: '7 broken fragment (team)', task: 'add a team section' },
  { name: '8 auto model, hero heading', task: 'change the hero heading', unpinned: true },
]

const results = []

for (const [index, testCase] of CASES.entries()) {
  const projectId = `editcase-${index + 1}`
  const root = path.join(workspaceRoot, projectId)
  const before = await writeSite(root).then(() => readAll(root))
  const events = []
  const usageEvents = []
  const startCount = requestCount
  let result = null
  let thrown = null
  try {
    result = await runAgent({
      projectId,
      task: testCase.task,
      framework: 'html',
      apiKeys: [{ id: 'harness-key', label: 'harness', provider: 'mistral', plain: 'test-key' }],
      requestedProvider: testCase.unpinned ? null : 'mistral',
      requestedModel: testCase.unpinned ? null : 'mistral-large-latest',
      taskId: `task-${projectId}`,
      emit: (event) => events.push(event),
      emitUsage: (payload) => usageEvents.push(payload),
      emitDelta: () => {},
      resume: false,
    })
  } catch (error) {
    thrown = error
  }
  const requests = requestCount - startCount
  const after = await readAll(root)
  const beforeKeys = [...before.keys()].sort()
  const afterKeys = [...after.keys()].sort()
  const changed = []
  for (const file of afterKeys) {
    if (!before.has(file) || before.get(file) !== after.get(file)) changed.push(file)
  }
  for (const file of beforeKeys) {
    if (!after.has(file)) changed.push(`${file} (removed)`)
  }
  const indexHtml = after.get('index.html') ?? ''
  const docIssues = []
  if (!/<\/html>\s*$/i.test(indexHtml.trimEnd())) docIssues.push('no </html>')
  if (!/<header\b/i.test(indexHtml)) docIssues.push('no header')
  if (!/<footer\b/i.test(indexHtml)) docIssues.push('no footer')
  if ((indexHtml.match(/<h1\b/gi) || []).length !== 1) docIssues.push('h1 count')
  const rawErrorEvents = events.filter(
    (event) =>
      event.type === 'error' ||
      /wrap up|View full error/i.test(String(event.description ?? '')) ||
      (event.details && typeof event.details.result === 'string' && /Error/i.test(event.details.result)),
  )
  const totals = usageEvents.length > 0 ? usageEvents[usageEvents.length - 1].task : null
  const beforeDoc = before.get('index.html') ?? ''
  const beforeCss = before.get('css/base.css') ?? ''
  const afterCss = after.get('css/base.css') ?? ''
  const sectionTargets = { 2: 'faq', 4: 'hero', 8: 'hero' }
  const insertTargets = { 1: ['contact', 'Contact'], 6: ['gallery', 'Work'] }
  const restCheck = sectionTargets[index + 1]
    ? restIdenticalSection(beforeDoc, after.get('index.html') ?? '', sectionTargets[index + 1])
    : insertTargets[index + 1]
      ? restIdenticalInsert(beforeDoc, after.get('index.html') ?? '', ...insertTargets[index + 1])
      : null
  const cssDiff = diffSpan(beforeCss, afterCss)
  const footerBefore = declarationsOf(cssRule(beforeCss, '.site-footer'))
  const footerAfter = declarationsOf(cssRule(afterCss, '.site-footer'))
  const footerMergeKeptAll = footerBefore.every((declaration) => footerAfter.includes(declaration))
  results.push({
    restCheck,
    cssDiff,
    cssAppendedOnly: afterCss.startsWith(beforeCss),
    footerMergeKeptAll,
    footerRule: cssRule(afterCss, '.site-footer'),
    name: testCase.name,
    task: testCase.task,
    requests,
    model: result?.model ?? null,
    ok: Boolean(result) && !thrown,
    thrown: thrown ? thrown.message : null,
    message: result?.message ?? null,
    changed,
    indexHtmlUnchanged: before.get('index.html') === after.get('index.html'),
    docIssues,
    eventTypes: [...new Set(events.map((event) => event.type))],
    rawErrorEvents: rawErrorEvents.length,
    eventLines: events.map((event) => `${event.type}: ${String(event.description ?? '').slice(0, 90)}`),
    totals: totals ? { requests: totals.requests, totalTokens: totals.totalTokens } : null,
    hasContactForm: /<form[^>]*data-validate/i.test(indexHtml),
    contactFields: ['name', 'email', 'message'].every((field) => new RegExp(`(name|id)="${field}"`).test(indexHtml)),
    hasFormSuccess: /class="form-success"/.test(indexHtml),
    galleryNavLink: /href="#gallery"/.test(indexHtml),
    gallerySection: /id="gallery"/.test(indexHtml),
    faqReplaced: /Everything you asked/.test(indexHtml),
    heroReplaced: /Design that turns visitors into customers/.test(indexHtml),
    cssHasThreeColumns: [...after.entries()].some(([file, content]) => file.endsWith('.css') && /repeat\(3, minmax/.test(content) && /#pricing/.test(content)),
    cssHasDarkerFooter: [...after.entries()].some(([file, content]) => file.endsWith('.css') && /site-footer\s*\{[^}]*#0b1220/i.test(content)),
  })
  console.error(`[case] ${testCase.name}: requests=${requests} ok=${Boolean(result) && !thrown} changed=${changed.join(',') || 'none'}`)
  if (thrown) console.error(`[case] thrown: ${thrown.message}`)
}

server.close()

await fsp.writeFile(
  path.join(here, 'edit-cases.result.json'),
  JSON.stringify({ requestLog, results }, null, 2),
  'utf8',
)
console.error(`[harness] wrote edit-cases.result.json — ${results.length} case(s)`)
