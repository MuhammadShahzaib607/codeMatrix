import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(here, '..', 'server')
const mode = process.argv[2] ?? 'good'
const port = Number(process.argv[3] ?? 4999)
const projectId = process.argv[4] ?? `harness-${mode}-${port}`
const workspaceRoot = path.join(here, 'workspaces')
const projectDir = path.join(workspaceRoot, projectId)

const PAGES = [
  {
    file: 'index.html',
    nav_label: 'Home',
    title: 'Shahzaib.art — original paintings and signed editions',
    sections: ['hero', 'services', 'testimonials', 'faq', 'cta'],
  },
  {
    file: 'services.html',
    nav_label: 'Services',
    title: 'Services — originals, editions and commissions',
    sections: ['page-hero', 'services', 'cta'],
    pageLabel: 'Services',
    lead: 'Originals, signed editions and bespoke commissions, each with a fixed process, a written timeline and a price agreed before any paint is mixed. Every route below ends with a signed work and a certificate you can insure.',
  },
  {
    file: 'about.html',
    nav_label: 'About',
    title: 'About the studio — painting in Lahore since 2015',
    sections: ['page-hero', 'about-story', 'team', 'cta'],
    pageLabel: 'About',
    lead: 'Who paints the work, how the studio started, and the process every commission follows from the first sketch to the crate on the truck. Eleven years, one workshop in Gulberg, and more than a hundred works now living in private and public collections.',
  },
  {
    file: 'blogs.html',
    nav_label: 'Blogs',
    title: 'Journal — notes from the Shahzaib.art studio',
    sections: ['page-hero', 'blogs', 'cta'],
    pageLabel: 'Journal',
    lead: 'Materials, hanging advice and what actually happens inside a commission, written by the people doing the work. New notes are published most months and every one answers a question collectors actually asked in the studio.',
  },
  {
    file: 'contact.html',
    nav_label: 'Contact',
    title: 'Contact the studio — commission an original painting',
    sections: ['page-hero', 'contact-form', 'contact-info'],
    pageLabel: 'Contact',
    lead: 'Tell the studio about the wall, the light and the mood you want. Every enquiry gets a real reply within one working day, and a commission enquiry comes back with a sketch direction, a size recommendation and a fixed quote before anything is painted.',
  },
]

const NAV = PAGES.map((page) => ({ label: page.nav_label, href: page.file }))

const PLAN_JSON = {
  project_name: 'shahzaib-art',
  type: 'site',
  direction: 'Direction: elegant art/gallery — warm ivory background, serif display headings, generous whitespace, framed panels to suit an artist portfolio.',
  brand: {
    name: 'Shahzaib.art',
    tagline: 'Contemporary paintings made by hand in Lahore',
    industry: 'fine art studio',
    palette: 'gallery-ivory',
    fontStack: 'Cormorant Garamond with a Georgia serif fallback',
  },
  nav: NAV,
  files: PAGES.map((page) => ({ path: page.file, purpose: `${page.nav_label} page` })),
  pages: PAGES.map((page) => ({ file: page.file, sections: page.sections })),
  requirements: [
    'a website for shahzaib.art, an art portfolio',
    'pages: Home, Services, About, Blogs, Contact',
    'HTML, CSS and vanilla JavaScript only',
  ],
}

const { sectionHtml } = await import('./sections.mjs')

function tool(name, args) {
  return {
    id: `call_${Math.random().toString(16).slice(2, 14)}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }
}

const SLOT_RE = /<!--\s*SLOT:([a-z0-9-]+)\s*-->/

async function readFileSafe(root, relative) {
  try {
    return await fsp.readFile(path.join(root, relative), 'utf8')
  } catch {
    return null
  }
}

function scaffoldArgs() {
  return {
    brand: 'Shahzaib.art',
    tagline: 'Contemporary paintings made by hand in Lahore',
    palette: 'gallery-ivory',
    pages: PAGES.map((page) => ({
      file: page.file,
      title: page.title,
      nav_label: page.nav_label,
      sections: page.sections,
    })),
  }
}

function truncatedNavOnly(html) {
  const bodyIndex = html.indexOf('<body>')
  const headerEnd = html.indexOf('</header>')
  if (bodyIndex === -1 || headerEnd === -1) return html.slice(0, 400)
  return html.slice(0, headerEnd + '</header>'.length)
}

function rewriteWithAllSections(html, page) {
  let next = html
  for (const section of page.sections) {
    const marker = `<!-- SLOT:${section} -->`
    if (!next.includes(marker)) continue
    next = next.replace(marker, sectionHtml(section, { pageLabel: page.pageLabel, title: page.title, lead: page.lead }))
  }
  return next
}

function pageFor(file) {
  return PAGES.find((page) => page.file === file)
}

async function remainingSlots(file) {
  const html = await readFileSafe(projectDir, file)
  if (!html) return []
  return [...html.matchAll(new RegExp(SLOT_RE.source, 'g'))].map((match) => match[1])
}

async function nextAction(step, supportsSurgical) {
  if (step === 0) {
    return { content: JSON.stringify(PLAN_JSON, null, 2) }
  }
  if (step === 1) {
    return { calls: [tool('scaffold_site', scaffoldArgs())] }
  }

  if (mode === 'broken' && step === 2) {
    const html = await readFileSafe(projectDir, 'index.html')
    if (html) {
      return { calls: [tool('edit_file', { path: 'index.html', content: truncatedNavOnly(html) })] }
    }
  }
  if (mode === 'broken' && step >= 3 && step <= 5) {
    const section = sectionHtml('hero', {})
    return { calls: [tool('edit_file', { path: 'index.html', content: section })] }
  }
  if (mode === 'broken' && step >= 6) {
    return { content: 'The Shahzaib.art portfolio site is complete.' }
  }

  for (const page of PAGES) {
    const slots = await remainingSlots(page.file)
    if (slots.length === 0) continue
    if (supportsSurgical) {
      return {
        calls: slots.map((slot) =>
          tool('edit_file', {
            path: page.file,
            old_string: `<!-- SLOT:${slot} -->`,
            new_string: sectionHtml(slot, { pageLabel: page.pageLabel, title: page.title, lead: page.lead }),
          }),
        ),
      }
    }
    const html = await readFileSafe(projectDir, page.file)
    if (html) {
      return { calls: [tool('edit_file', { path: page.file, content: rewriteWithAllSections(html, page) })] }
    }
  }

  return {
    content:
      'The Shahzaib.art site is finished: index.html, services.html, about.html, blogs.html and contact.html, each with the planned sections and real studio copy. Open index.html to browse the site.',
  }
}

function sseFrame(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function streamBody(message, finishReason, usage) {
  const frames = []
  if (message.content) {
    frames.push(sseFrame({ choices: [{ index: 0, delta: { content: message.content } }] }))
  }
  if (Array.isArray(message.tool_calls)) {
    message.tool_calls.forEach((call, index) => {
      frames.push(
        sseFrame({
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index, id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments } },
                ],
              },
            },
          ],
        }),
      )
    })
  }
  frames.push(sseFrame({ choices: [{ index: 0, delta: {}, finish_reason: finishReason }] }))
  frames.push(sseFrame({ choices: [], usage }))
  frames.push('data: [DONE]\n\n')
  return frames.join('')
}

function countChars(messages, tools) {
  let chars = 0
  for (const message of messages ?? []) {
    if (typeof message.content === 'string') chars += message.content.length
    if (Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) chars += String(call?.function?.arguments ?? '').length + 24
    }
    chars += 12
  }
  if (Array.isArray(tools)) chars += JSON.stringify(tools).length
  return chars
}

let step = 0
const log = []

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url.includes('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'mistral-large-latest', object: 'model' }] }))
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(404).end()
    return
  }
  let raw = ''
  for await (const chunk of req) raw += chunk
  const payload = JSON.parse(raw || '{}')
  const tools = Array.isArray(payload.tools) ? payload.tools : []
  const editTool = tools.find((entry) => entry?.function?.name === 'edit_file')
  const supportsSurgical = Boolean(editTool?.function?.parameters?.properties?.old_string)

  const action = await nextAction(step, supportsSurgical)
  console.error(`[mock] #${step} -> ${action.calls ? action.calls.map((call) => call.function.name).join(',') : 'text'} surgical=${supportsSurgical} at=${new Date().toISOString().slice(11, 19)}`)
  const message = { role: 'assistant', content: action.content ?? '' }
  if (action.calls) message.tool_calls = action.calls
  const finishReason = action.calls ? 'tool_calls' : 'stop'

  const promptTokens = Math.ceil(countChars(payload.messages, tools) / 4)
  const completionTokens = Math.max(
    1,
    Math.ceil((String(message.content ?? '').length + JSON.stringify(message.tool_calls ?? []).length) / 4),
  )
  const usage = { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens }
  log.push({ step, action: action.calls ? action.calls.map((call) => call.function.name).join(',') : 'text', promptTokens, completionTokens })

  if (payload.stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(streamBody(message, finishReason, usage))
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        id: 'mock',
        object: 'chat.completion',
        choices: [{ index: 0, message, finish_reason: finishReason }],
        usage,
      }),
    )
  }
  step += 1
})

await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))

process.env.WORKSPACES_ROOT = workspaceRoot
process.env.MISTRAL_BASE_URL = `http://127.0.0.1:${port}/v1`

await fsp.rm(projectDir, { recursive: true, force: true })
await fsp.mkdir(projectDir, { recursive: true })

const { runAgent } = await import(pathToFileURL(path.join(serverRoot, 'src/services/agentService.js')).href)

const events = []
const usageEvents = []
const taskId = `task-${projectId}`
const startedAt = Date.now()
let result = null
let thrown = null
try {
  result = await runAgent({
    projectId,
    task: 'build a website for shahzaib.art, an art portfolio, with Home, Services, About, Blogs, Contact',
    framework: 'html',
    apiKeys: [{ id: 'harness-key', label: 'harness', provider: 'mistral', plain: 'test-key' }],
    requestedProvider: 'mistral',
    requestedModel: 'mistral-large-latest',
    taskId,
    emit: (event) => events.push(event),
    emitUsage: (payload) => usageEvents.push(payload),
    emitDelta: () => {},
    resume: false,
  })
} catch (error) {
  thrown = error
}
const durationMs = Date.now() - startedAt

server.close()

const totals = usageEvents.length > 0 ? usageEvents[usageEvents.length - 1].task : null
const files = {}
for (const page of PAGES) {
  const html = (await readFileSafe(projectDir, page.file)) ?? ''
  const textOf = (id) => {
    const match = new RegExp(`<section[^>]*id="${id}"[\\s\\S]*?</section>`, 'i').exec(html)
    if (!match) return null
    return match[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }
  files[page.file] = {
    exists: html.length > 0,
    lines: html ? html.split('\n').length : 0,
    bytes: html.length,
    header: (html.match(/<header\b/gi) || []).length,
    footer: (html.match(/<footer\b/gi) || []).length,
    h1: (html.match(/<h1\b/gi) || []).length,
    slotsLeft: [...html.matchAll(new RegExp(SLOT_RE.source, 'g'))].length,
    sections: page.sections.map((id) => ({ id, chars: textOf(id)?.length ?? 0 })),
    words: html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length,
  }
}

console.log(
  JSON.stringify(
    {
      mode,
      port,
      projectId,
      durationMs,
      requests: log.length,
      totals,
      result,
      thrown: thrown ? { message: thrown.message } : null,
      events: events.map((event) => ({ type: event.type, description: event.description, limitReached: event.details?.limitReached ?? undefined })),
      toolLog: log,
      files,
      projectDir,
    },
    null,
    2,
  ),
)
