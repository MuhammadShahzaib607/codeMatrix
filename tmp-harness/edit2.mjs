import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(here, '..', 'server')
const workspaceRoot = path.join(here, 'edit2-workspaces')
const port = 4989

const INDEX = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Test Co</title>
  <link rel="stylesheet" href="css/base.css">
</head>
<body>
  <header class="site-header">
    <nav class="nav"><a class="brand" href="index.html">Test Co</a></nav>
  </header>
  <main>
    <section id="hero" data-section="hero" data-title="Home">
      <div class="container">
        <h1>Old heading</h1>
        <p class="lead">A short lead paragraph.</p>
      </div>
    </section>
    <section id="faq" data-section="faq" data-title="FAQs">
      <div class="container">
        <h2>Questions</h2>
        <p>The answers live here.</p>
      </div>
    </section>
    <section id="pricing" data-section="pricing" data-title="Pricing">
      <div class="container">
        <div class="grid">
          <article class="card">Starter</article>
          <article class="card">Pro</article>
        </div>
      </div>
    </section>
  </main>
  <footer class="site-footer">
    <p>&copy; Test Co</p>
  </footer>
  <script src="js/main.js"></script>
</body>
</html>
`

const CSS = `:root { --brand: #4f46e5; }
#pricing .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.site-footer { background: #111827; color: #ffffff; }
`

const JS = `document.documentElement.classList.add('js');\n`

const SITE = { 'index.html': INDEX, 'css/base.css': CSS, 'js/main.js': JS }

let requestCount = 0
const requestLog = []
const writerCalls = new Map()

function toolCall(name, args) {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: `call_${requestCount}`,
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  }
}

function locatorFor(task) {
  if (/pricing|columns/i.test(task)) {
    return {
      files: ['css/base.css'],
      problem: 'The pricing grid has two columns.',
      region: { file: 'css/base.css', sectionId: null, lineRange: null, cssSelectors: ['#pricing .grid'] },
      instruction: 'Make the pricing grid three columns.',
      newSection: null,
    }
  }
  if (/faq/i.test(task)) {
    return {
      files: ['index.html'],
      problem: 'The FAQ section is a bare heading with no real Q&A.',
      region: { file: 'index.html', sectionId: 'faq', lineRange: null, cssSelectors: [] },
      instruction: 'Rewrite the FAQ section heading and copy.',
      newSection: null,
    }
  }
  if (/footer/i.test(task)) {
    return {
      files: ['css/base.css'],
      problem: 'The footer background is the same as the body.',
      region: { file: 'css/base.css', sectionId: 'footer', lineRange: null, cssSelectors: ['.site-footer'] },
      instruction: 'Make the footer background darker.',
      newSection: null,
    }
  }
  if (/contact/i.test(task)) {
    return {
      files: ['index.html'],
      problem: 'The site has no contact form.',
      region: { file: 'index.html', sectionId: null, lineRange: null, cssSelectors: [] },
      instruction: 'Add a contact form section before the footer.',
      newSection: { type: 'contact-form', position: 'before-footer' },
    }
  }
  if (/testimonial/i.test(task)) {
    return {
      files: ['index.html'],
      problem: 'There is no testimonials section on the home page.',
      region: { file: 'index.html', sectionId: null, lineRange: null, cssSelectors: [] },
      instruction: 'Add a testimonials section just before the footer.',
      newSection: { type: 'testimonials', position: 'before-footer' },
    }
  }
  return {
    files: ['index.html'],
    problem: 'The hero heading is generic.',
    region: { file: 'index.html', sectionId: 'hero', lineRange: null, cssSelectors: [] },
    instruction: 'Replace the hero heading with a specific one.',
    newSection: null,
  }
}

function writerMessage(task, messages) {
  const last = messages[messages.length - 1]
  if (last?.role === 'tool') {
    let toolResult = null
    try {
      toolResult = JSON.parse(String(last.content))
    } catch {
      toolResult = null
    }
    if (toolResult && !toolResult.error) {
      return { role: 'assistant', content: 'Updated the page.' }
    }
  }
  const key = String(task)
  const count = (writerCalls.get(key) ?? 0) + 1
  writerCalls.set(key, count)
  if (/pricing|columns/i.test(task)) {
    return toolCall('replace_text', {
      path: 'css/base.css',
      find: 'grid-template-columns: repeat(2, minmax(0, 1fr));',
      replace: 'grid-template-columns: repeat(3, minmax(0, 1fr));',
    })
  }
  if (/always broken/i.test(task)) {
    return toolCall('replace_text', {
      path: 'index.html',
      find: '<h1>Text that does not exist</h1>',
      replace: '<h1>Never applied</h1>',
    })
  }
  if (/broken tags/i.test(task)) {
    return toolCall('write_file', {
      path: 'index.html',
      content: INDEX.replace('</section>', ''),
    })
  }
  if (/noop/i.test(task)) {
    return { role: 'assistant', content: 'Nothing needs changing.' }
  }
  if (/faq/i.test(task)) {
    return toolCall('replace_text', {
      path: 'index.html',
      find: '<h2>Questions</h2>',
      replace: '<h2>FAQ</h2>',
    })
  }
  if (/footer/i.test(task)) {
    return toolCall('replace_text', {
      path: 'css/base.css',
      find: '.site-footer { background: #111827; color: #ffffff; }',
      replace: '.site-footer { background: #030712; color: #ffffff; }',
    })
  }
  if (/contact/i.test(task)) {
    return toolCall('replace_text', {
      path: 'index.html',
      find: '</main>',
      replace:
        '    <section id="contact" data-section="contact">\n      <div class="container"><h2>Contact us</h2><form><input name="email"></form></div>\n    </section>\n  </main>',
    })
  }
  if (/testimonial/i.test(task)) {
    return toolCall('replace_text', {
      path: 'index.html',
      find: '</main>',
      replace:
        '    <section id="testimonials" data-section="testimonials">\n      <div class="container"><h2>Testimonials</h2></div>\n    </section>\n  </main>',
    })
  }
  if (/broken/i.test(task)) {
    if (count === 1) {
      return toolCall('replace_text', {
        path: 'index.html',
        find: '<h1>Text that does not exist</h1>',
        replace: '<h1>Fresh heading for Test Co</h1>',
      })
    }
    return toolCall('replace_text', {
      path: 'index.html',
      find: '<h1>Old heading</h1>',
      replace: '<h1>Fresh heading for Test Co</h1>',
    })
  }
  return toolCall('replace_text', {
    path: 'index.html',
    find: '<h1>Old heading</h1>',
    replace: '<h1>Fresh heading for Test Co</h1>',
  })
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
  const system = messages.find((m) => m.role === 'system' && String(m.content).includes('locate'))
  const requestKind = system ? 'locate' : 'write'
  const userMessage = messages.find(
    (m) => typeof m.content === 'string' && (m.content.startsWith('REQUEST:') || m.content.startsWith('ORIGINAL REQUEST:')),
  )
  const taskLine = userMessage ? String(userMessage.content).split('\n')[0] : '(none)'
  const task = taskLine.replace(/^(REQUEST|ORIGINAL REQUEST):\s*/, '')

  const message = requestKind === 'locate' ? { role: 'assistant', content: JSON.stringify(locatorFor(task)) } : writerMessage(task, messages)
  requestCount += 1
  requestLog.push({ n: requestCount, kind: requestKind, model: payload.model, task })
  console.error(`[mock] #${requestCount} ${requestKind} model=${payload.model} task="${task}"`)

  const text = JSON.stringify(message)
  const usage = {
    prompt_tokens: Math.ceil(text.length / 4),
    completion_tokens: Math.ceil(text.length / 4),
    total_tokens: Math.ceil(text.length / 2),
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ id: 'mock', object: 'chat.completion', choices: [{ index: 0, message, finish_reason: 'stop' }], usage }))
})

await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))

process.env.WORKSPACES_ROOT = workspaceRoot
process.env.MISTRAL_BASE_URL = `http://127.0.0.1:${port}/v1`

const { runAgent } = await import(pathToFileURL(path.join(serverRoot, 'src/services/agentService.js')).href)

async function writeSite(root) {
  await fsp.rm(root, { recursive: true, force: true })
  for (const [file, content] of Object.entries(SITE)) {
    const target = path.join(root, file)
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, content, 'utf8')
  }
}

const CASES = [
  { name: 'hero heading', task: 'change the hero heading', expect: 'index.html' },
  { name: 'pricing columns', task: 'make the pricing 3 columns', expect: 'css/base.css' },
  { name: 'broken then fixed', task: 'change the hero heading broken', expect: 'index.html' },
  { name: 'update FAQ UI', task: 'update the UI of the FAQs on the home page', expect: 'index.html' },
  { name: 'footer darker', task: 'make the footer darker', expect: 'css/base.css' },
  { name: 'add contact form', task: 'add a contact form', expect: 'index.html' },
  { name: 'new section', task: 'add a testimonials section', expect: 'index.html' },
  { name: 'always broken replacement', task: 'change the hero heading always broken', expect: 'index.html' },
  { name: 'unbalanced write reverted', task: 'change the hero heading broken tags', expect: 'index.html' },
  { name: 'writer never acts', task: 'change the hero heading noop', expect: null },
]

const results = []
for (const [index, testCase] of CASES.entries()) {
  const projectId = `edit2-${index + 1}`
  const root = path.join(workspaceRoot, projectId)
  await writeSite(root)
  const before = new Map(Object.entries(SITE))
  const events = []
  const usageEvents = []
  let result = null
  let thrown = null
  try {
    result = await runAgent({
      projectId,
      task: testCase.task,
      framework: 'html',
      apiKeys: [{ id: 'harness-key', label: 'harness', provider: 'mistral', plain: 'test-key' }],
      requestedProvider: 'mistral',
      requestedModel: null,
      taskId: `task-${projectId}`,
      emit: (event) => events.push(event),
      emitUsage: (payload) => usageEvents.push(payload),
      emitDelta: () => {},
      resume: false,
    })
  } catch (error) {
    thrown = error
  }
  const indexAfter = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  const cssAfter = fs.readFileSync(path.join(root, 'css/base.css'), 'utf8')
  const kinds = requestLog.map((entry) => entry.kind)
  const models = requestLog.map((entry) => entry.model)
  const errorEvents = events.filter((event) => event.type === 'error')
  const completeEvents = events.filter((event) => event.type === 'complete')
  results.push({
    name: testCase.name,
    thrown: thrown ? thrown.message : null,
    ok: Boolean(result) && !thrown,
    message: result?.message ?? null,
    indexChanged: indexAfter !== INDEX,
    cssChanged: cssAfter !== CSS,
    heroReplaced: indexAfter.includes('Fresh heading for Test Co'),
    testimonialsAdded: indexAfter.includes('id="testimonials"'),
    faqHeading: indexAfter.includes('<h2>FAQ</h2>'),
    contactAdded: indexAfter.includes('id="contact"'),
    footerDarker: cssAfter.includes('#030712'),
    indexUnchanged: indexAfter === INDEX,
    threeColumns: /repeat\(3, minmax/.test(cssAfter),
    otherIndexUntouched: indexAfter.replace('Fresh heading for Test Co', 'Old heading') === INDEX,
    errorEvents: errorEvents.length,
    completeEvents: completeEvents.length,
    requestCount: requestLog.length,
    requests: requestLog.map((entry) => `#${entry.n} ${entry.kind} ${entry.model}`),
    eventLines: events.map((event) => `${event.type}: ${String(event.description ?? '').slice(0, 80)}`),
    kinds,
    models,
  })
  requestLog.length = 0
  writerCalls.clear()
  console.error(`[case] ${testCase.name}: ok=${Boolean(result) && !thrown} message="${result?.message ?? ''}" unchanged=${indexAfter === INDEX && cssAfter === CSS} events=${events.length}`)
  if (thrown) console.error(`[case] thrown: ${thrown.message}`)
}

server.close()
await fsp.writeFile(path.join(here, 'edit2.result.json'), JSON.stringify(results, null, 2), 'utf8')
console.error(`[harness] wrote edit2.result.json — ${results.length} case(s)`)
