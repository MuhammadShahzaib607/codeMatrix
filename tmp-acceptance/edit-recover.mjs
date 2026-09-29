import http from 'node:http'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(here, '..', 'server')
const mode = process.argv[2] ?? 'reported'
const port = Number(process.argv[3] ?? 4801)
const projectId = `editfix-${mode}-${port}`
const workspaceRoot = path.join(here, 'edit-workspaces')
const projectDir = path.join(workspaceRoot, projectId)

const PAGES = [
  {
    file: 'index.html',
    nav_label: 'Home',
    title: 'Northwind Studio — websites, brand systems and product design',
    sections: ['hero', 'services', 'testimonials', 'faq', 'cta'],
  },
]

const PLAN_JSON = {
  project_name: 'northwind-studio',
  type: 'site',
  direction: 'Direction: indigo-modern SaaS studio — clean indigo accents, generous whitespace, crisp sans-serif type.',
  brand: {
    name: 'Northwind Studio',
    tagline: 'Websites, brand systems and product design',
    industry: 'digital studio',
    palette: 'indigo-modern',
    fontStack: 'Inter with a system sans-serif fallback',
  },
  nav: PAGES.map((page) => ({ label: page.nav_label, href: page.file })),
  files: PAGES.map((page) => ({ path: page.file, purpose: `${page.nav_label} page` })),
  pages: PAGES.map((page) => ({ file: page.file, sections: page.sections })),
  requirements: [
    'a website for Northwind Studio, a digital studio',
    'pages: Home',
    'HTML, CSS and vanilla JavaScript only',
  ],
}

const { sectionHtml } = await import(pathToFileURL(path.join(here, '..', 'tmp-harness', 'sections.mjs')).href)

const SLOT_RE = /<!--\s*SLOT:([a-z0-9-]+)\s*-->/g

function tool(name, args) {
  return {
    id: `call_${Math.random().toString(16).slice(2, 14)}`,
    type: 'function',
    function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
  }
}

async function readFileSafe(relative) {
  try {
    return await fsp.readFile(path.join(projectDir, relative), 'utf8')
  } catch {
    return null
  }
}

async function remainingSlots(file) {
  const text = await readFileSafe(file)
  if (!text) return []
  return [...text.matchAll(SLOT_RE)].map((match) => match[1])
}

function themeTarget() {
  return {
    old: '--primary: #4f46e5;',
    next: '--primary: #e94560;',
  }
}

async function themeEditArgs(keyStyle) {
  const css = await readFileSafe('css/theme.css')
  const hit = themeTarget()
  if (!css || !css.includes(hit.old)) return null
  const occurrences = css.split(hit.old).length - 1
  if (occurrences !== 1) return null
  if (keyStyle === 'reported') {
    const payload = { path: 'css/theme.css', old_str: hit.old, new_str: hit.next }
    const embedded = JSON.stringify(payload)
    return {
      rawName: `${embedded}edit_file`,
      rawArgs: JSON.stringify({ path: 'css/theme.css', old_str: hit.old, new_str: hit.next }),
    }
  }
  if (keyStyle === 'alias') {
    return { rawName: 'edit_file', rawArgs: JSON.stringify({ file_path: 'css/theme.css', old_str: hit.old, new_str: hit.next }) }
  }
  return { rawName: 'edit_file', rawArgs: JSON.stringify({ path: 'css/theme.css', old_string: hit.old, new_string: hit.next }) }
}

function malformedEditArgs() {
  return {
    rawName: 'edit_file',
    rawArgs: JSON.stringify({ file: 'css/theme.css', old: '--primary: #4f46e5;', new: '--primary: #e94560;' }),
  }
}

function scaffoldArgs() {
  return {
    brand: 'Northwind Studio',
    tagline: 'Websites, brand systems and product design',
    palette: 'indigo-modern',
    pages: PAGES.map((page) => ({
      file: page.file,
      title: page.title,
      nav_label: page.nav_label,
      sections: page.sections,
    })),
  }
}

let step = 0
let themeDone = false
let malformedLeft = mode === 'recover3' ? 3 : mode === 'hopeless' ? Infinity : 0
const log = []

function sseFrame(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function streamChunks(chunks, finishReason, usage) {
  const frames = []
  for (const delta of chunks) {
    frames.push(sseFrame({ choices: [{ index: 0, delta: { tool_calls: [delta] } }] }))
  }
  frames.push(sseFrame({ choices: [{ index: 0, delta: {}, finish_reason: finishReason }] }))
  frames.push(sseFrame({ choices: [], usage }))
  frames.push('data: [DONE]\n\n')
  return frames.join('')
}

function streamText(text, finishReason, usage) {
  const frames = [
    sseFrame({ choices: [{ index: 0, delta: { content: text } }] }),
    sseFrame({ choices: [{ index: 0, delta: {}, finish_reason: finishReason }] }),
    sseFrame({ choices: [], usage }),
    'data: [DONE]\n\n',
  ]
  return frames.join('')
}

const KNOWN_FILES = new Set(PAGES.map((page) => page.file))

function sanitizeLinks(html) {
  return String(html).replace(/href="([^"#][^"]*)\.html"/g, (match, target) =>
    KNOWN_FILES.has(`${target}.html`) ? match : 'href="#services"',
  )
}

async function nextAction() {
  if (step === 0) return { kind: 'text', text: JSON.stringify(PLAN_JSON, null, 2) }
  if (step === 1) return { kind: 'calls', calls: [tool('scaffold_site', scaffoldArgs())] }

  if (malformedLeft > 0) {
    malformedLeft -= 1
    const bad = malformedEditArgs()
    return { kind: 'calls', calls: [tool(bad.rawName, bad.rawArgs)], malformed: true }
  }

  if (!themeDone) {
    const keyStyle = mode === 'reported' ? 'reported' : mode === 'oldkeys' ? 'alias' : 'canonical'
    const args = await themeEditArgs(keyStyle)
    if (args) {
      themeDone = true
      if (keyStyle === 'reported') {
        return {
          kind: 'calls',
          reportedShape: true,
          calls: [
            {
              id: `call_${Math.random().toString(16).slice(2, 14)}`,
              type: 'function',
              function: { name: args.rawName, arguments: args.rawArgs },
            },
          ],
        }
      }
      return { kind: 'calls', calls: [tool(args.rawName, args.rawArgs)] }
    }
    themeDone = true
  }

  for (const page of PAGES) {
    const slots = await remainingSlots(page.file)
    if (slots.length === 0) continue
    const slot = slots[0]
    const marker = `<!-- SLOT:${slot} -->`
    const html = sanitizeLinks(await sectionHtml(slot, { pageLabel: page.nav_label, title: page.title, lead: '' }))
    if (mode === 'oldkeys') {
      return {
        kind: 'calls',
        calls: [tool('edit_file', { file_path: page.file, old_str: marker, new_str: html })],
      }
    }
    return { kind: 'calls', calls: [tool('edit_file', { path: page.file, old_string: marker, new_string: html })] }
  }

  return {
    kind: 'text',
    text: 'The Northwind Studio site is complete: index.html with the planned sections, the theme recoloured, and every slot filled.',
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url.includes('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        data: [
          { id: 'mistral-large-latest', object: 'model' },
          { id: 'mistral-small-latest', object: 'model' },
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
  const action = await nextAction()
  const streaming = Boolean(payload.stream)
  const label =
    action.kind === 'text'
      ? 'text'
      : `${action.calls.map((call) => call.function.name).slice(0, 1).join(',')}`
  log.push({
    request: step,
    stream: streaming,
    action: action.reportedShape ? 'reported-shape edit_file (JSON+edit_file in name)' : label,
    malformed: Boolean(action.malformed),
  })
  console.error(
    `[mock] #${step} stream=${streaming} ${action.reportedShape ? 'reported-shape' : ''} ${label} at ${new Date().toISOString().slice(11, 19)}`,
  )

  const promptTokens = Math.max(1, Math.ceil(String(raw).length / 4))
  const completionBody =
    action.kind === 'text' ? action.text : JSON.stringify(action.calls)
  const completionTokens = Math.max(1, Math.ceil(String(completionBody).length / 4))
  const usage = { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens }
  const message = {
    role: 'assistant',
    content: action.kind === 'text' ? action.text : '',
  }
  if (action.kind === 'calls') message.tool_calls = action.calls
  const finishReason = action.kind === 'calls' ? 'tool_calls' : 'stop'

  if (streaming) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (action.kind === 'text') res.end(streamText(action.text, finishReason, usage))
    else if (action.reportedShape) {
      const call = action.calls[0]
      res.end(
        streamChunks(
          [
            {
              index: 0,
              id: call.id,
              type: 'function',
              function: { name: call.function.name, arguments: call.function.arguments },
            },
          ],
          finishReason,
          usage,
        ),
      )
    } else {
      res.end(
        streamChunks(
          action.calls.map((call, index) => ({
            index,
            id: call.id,
            type: 'function',
            function: { name: call.function.name, arguments: call.function.arguments },
          })),
          finishReason,
          usage,
        ),
      )
    }
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({ id: 'mock', object: 'chat.completion', choices: [{ index: 0, message, finish_reason: finishReason }], usage }),
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
const startedAt = Date.now()
let result = null
let thrown = null
try {
  result = await runAgent({
    projectId,
    task: 'build a website for Northwind Studio, a digital studio, with a Home page',
    framework: 'html',
    apiKeys: [{ id: 'editfix-key', label: 'editfix', provider: 'mistral', plain: 'test-key' }],
    requestedProvider: 'mistral',
    requestedModel: 'mistral-large-latest',
    taskId: `task-${projectId}`,
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

const themeCss = (await readFileSafe('css/theme.css')) ?? ''
const indexHtml = (await readFileSafe('index.html')) ?? ''

console.log(
  JSON.stringify(
    {
      mode,
      durationMs,
      requests: log.length,
      result: result
        ? { message: result.message, toolCalls: result.toolCalls, limitReached: result.limitReached ?? false }
        : null,
      thrown: thrown ? thrown.message : null,
      notesAndFallbacks: events
        .filter((event) => ['note', 'fallback', 'error', 'complete', 'gate'].includes(event.type))
        .map((event) => `${event.type}: ${event.description}`),
      toolLog: log,
      themePrimaryRedone: themeCss.includes('#e94560'),
      index: {
        lines: indexHtml ? indexHtml.split('\n').length : 0,
        slotsLeft: [...indexHtml.matchAll(SLOT_RE)].length,
        header: (indexHtml.match(/<header\b/gi) || []).length,
        h1: (indexHtml.match(/<h1\b/gi) || []).length,
      },
      projectDir,
    },
    null,
    2,
  ),
)
