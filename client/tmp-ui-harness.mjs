// TEMPORARY verification harness (deleted after the run): mounts the REAL App
// (Topbar, Sidebar, Editor, AIPanel, Settings) in jsdom through Vite SSR, with
// VITE_API_BASE_URL pointing at the live TEST server (:4100) whose Groq base
// URL points at the scripted mock (:4999). Verifies the whole acceptance flow:
//   zero-key prompt -> add key in Settings (masked, 3-key cap) -> framework
//   dropdown (per-project persistence) -> "create a todo app" -> LIVE action
//   feed rows (running -> done, real shell output, final summary) -> Explorer
//   picks up the new files -> drag the AI panel's left edge to resize.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const API = process.env.VITE_API_BASE_URL ?? 'http://localhost:4100'
const WORKSPACES = path.resolve(__dirname, '../server/workspaces')
const FULL_KEY = `gsk_uiprobe_full_key_value_1234567890abcd`

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, timeout = 8000, step = 20) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = fn()
    const found = Array.isArray(value) ? value.length > 0 : Boolean(value)
    if (found) return value
    await sleep(step)
  }
  return Array.isArray(fn()) ? [] : null
}

async function api(method, p, body, token) {
  const response = await fetch(`${API}${p}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`${method} ${p} -> ${response.status} ${JSON.stringify(data)}`)
  return data
}

// ---------------------------------------------------------------------------
// jsdom globals (before any client module loads)
// ---------------------------------------------------------------------------
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:5173/',
  pretendToBeVisual: true,
})
const { window } = dom
for (const key of [
  'document',
  'localStorage',
  'sessionStorage',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLTextAreaElement',
  'Element',
  'Node',
  'Event',
  'MouseEvent',
  'KeyboardEvent',
  'CustomEvent',
  'MutationObserver',
  'SVGElement',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'CSS',
]) {
  if (window[key] === undefined) continue
  try {
    Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true })
  } catch {}
}
globalThis.window = window
try {
  Object.defineProperty(globalThis, 'navigator', {
    value: window.navigator,
    configurable: true,
    writable: true,
  })
} catch {}
class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver ?? ObserverStub
window.IntersectionObserver = window.IntersectionObserver ?? ObserverStub
globalThis.ResizeObserver = window.ResizeObserver
globalThis.IntersectionObserver = window.IntersectionObserver
globalThis.matchMedia =
  window.matchMedia ??
  (() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }))
window.HTMLElement.prototype.scrollIntoView = window.HTMLElement.prototype.scrollIntoView ?? (() => {})
globalThis.IS_REACT_ACT_ENVIRONMENT = false

// ---------------------------------------------------------------------------
// Server setup: account, project, workspace ref (NO keys yet — zero state)
// ---------------------------------------------------------------------------
const email = `ui-agent-${Date.now()}@example.com`
const auth = await api('POST', '/api/auth/register', {
  name: 'UI Agent',
  email,
  password: 'test-pass-123',
})
const token = auth.token
const projectId = crypto.randomUUID()
await api(
  'POST',
  `/api/workspace/${projectId}/import`,
  { name: 'ui-agent-app', files: [{ relativePath: 'README.md', content: '# ui agent test' }] },
  token,
)
const registry = JSON.parse(fs.readFileSync(path.join(WORKSPACES, '.workspaces.json'), 'utf8'))
const record = registry[projectId]
const folder = path.join(WORKSPACES, record.container, record.folderName)

window.localStorage.setItem('code-matrix:token', token)
window.localStorage.setItem(
  'code-matrix:workspace',
  JSON.stringify({ projectId, name: 'ui-agent-app' }),
)

// ---------------------------------------------------------------------------
// Mount the REAL App through Vite SSR
// ---------------------------------------------------------------------------
const vite = await createServer({
  root: __dirname,
  configFile: path.join(__dirname, 'vite.config.js'),
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'warn',
  // @xterm/xterm is CJS; SSR must RUN it through the commonjs transform to
  // support its named exports (the browser build does this automatically).
  ssr: { noExternal: ['@xterm/xterm'] },
})

const { Provider } = await import('react-redux')
const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { default: App } = await vite.ssrLoadModule('/src/App.jsx')
const { store } = await vite.ssrLoadModule('/src/app/store.js')

const container = window.document.createElement('div')
window.document.body.appendChild(container)
const root = createRoot(container)
root.render(React.createElement(Provider, { store }, React.createElement(App)))

function fire(target, type, init = {}) {
  target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, ...init }))
}
function click(el) {
  fire(el, 'click')
}
function setNativeValue(element, value) {
  const proto = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(element, value)
  element.dispatchEvent(new window.Event('input', { bubbles: true }))
}
function submit(form) {
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
}
const $ = (selector) => document.querySelector(selector)
const $$ = (selector) => [...document.querySelectorAll(selector)]

// Wait for boot: project restored + panel rendered
const rootRow = await waitFor(() => $('.tree-row[data-node-id="root"]'))
check('App booted with the project restored (Explorer shows the root)', Boolean(rootRow))
check('AI panel is mounted', Boolean($('.ai-panel')))

// ---------------------------------------------------------------------------
// 1. ZERO-KEY state: clear prompt, no broken/silent chat input
// ---------------------------------------------------------------------------
const noKeyCard = await waitFor(() => $('.ai-nokey'))
check('zero-key prompt shown instead of a chat input', Boolean(noKeyCard))
check(
  'prompt text matches the required message',
  /Add a Groq API key in Settings to use the AI assistant/.test(noKeyCard?.textContent ?? ''),
  noKeyCard?.textContent?.trim().slice(0, 70),
)
check('composer hidden while there is no key', !$('.ai-composer'))
check('framework selector already visible', Boolean($('.ai-framework-btn')))

// ---------------------------------------------------------------------------
// 2. Add keys in Settings (masked, cap of 3)
// ---------------------------------------------------------------------------
click($('.ai-nokey-btn'))
const settingsOpen = await waitFor(() => $('.settings-overlay'))
check('the button jumps to Settings', Boolean(settingsOpen))
const aiSection = await waitFor(() =>
  $$('.settings-nav-item').find((item) => item.textContent.includes('AI Assistant')),
)
check('Settings has an AI Assistant section', Boolean(aiSection))
click(aiSection)
const keyForm = await waitFor(() => $('.settings-key-form'))
check('key form visible in Settings', Boolean(keyForm))

// add key 1
setNativeValue($('.settings-key-input'), FULL_KEY)
setNativeValue($('.settings-key-input-label'), 'main key')
submit($('.settings-key-form'))
const keyRow = await waitFor(() => $('.settings-key-row'))
check('key saved and listed', Boolean(keyRow))
check(
  'list shows MASKED key only (full key never in the DOM)',
  ($('.settings-key-masked')?.textContent ?? '').includes('...') &&
    !document.body.textContent.includes(FULL_KEY),
  $('.settings-key-masked')?.textContent,
)
check('newest key marked "In use"', /In use/.test(keyRow?.textContent ?? ''))

// add keys 2 and 3 -> cap message replaces the form
setNativeValue($('.settings-key-input'), 'gsk_second_key_00000000000000000022')
submit($('.settings-key-form'))
await waitFor(() => $$('.settings-key-row').length === 2)
setNativeValue($('.settings-key-input'), 'gsk_third_key_00000000000000000033')
submit($('.settings-key-form'))
await waitFor(() => $$('.settings-key-row').length === 3)
const capMessage = await waitFor(() =>
  $$('.settings-section-desc').find((element) => /Maximum 3 API keys allowed/.test(element.textContent)),
)
check('3-key cap message shown, form hidden at the limit', Boolean(capMessage) && !$('.settings-key-form'))

// delete one -> form comes back
click($$('.settings-key-delete')[2])
const formBack = await waitFor(() => $('.settings-key-form'), 5000)
check('deleting a key re-enables the form', Boolean(formBack))
check('back to 2 keys', $$('.settings-key-row').length === 2, `${$$('.settings-key-row').length} rows`)

// close Settings (Escape)
document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
await waitFor(() => !$('.settings-overlay'), 3000)
check('Settings closed', !$('.settings-overlay'))

// ---------------------------------------------------------------------------
// 3. Framework dropdown: 8 stacks + per-project persistence + "React" selected
// ---------------------------------------------------------------------------
await waitFor(() => $('.ai-composer'))
check('composer appears once a key exists', Boolean($('.ai-composer')))

click($('.ai-framework-btn'))
const frameworkMenu = await waitFor(() => $('.ai-framework-menu'))
const frameworkItems = $$('.ai-framework-item')
check('framework dropdown opens with all 8 stacks', frameworkItems.length === 8, `${frameworkItems.length} items`)
check('colored dot per framework', $$('.ai-framework-item .ai-framework-dot').length === 8)

const nextItem = frameworkItems.find((item) => item.textContent.includes('Next.js'))
click(nextItem)
await sleep(30)
const storedMap = JSON.parse(window.localStorage.getItem('code-matrix:aiFrameworks') ?? '{}')
check('selection remembered PER PROJECT in localStorage', storedMap[projectId] === 'next', JSON.stringify(storedMap))

// spec flow: select React
click($('.ai-framework-btn'))
const reactItem = (await waitFor(() => $$('.ai-framework-item'))).find((item) =>
  item.textContent.includes('React'),
)
click(reactItem)
await sleep(30)
check('React selected for the task', store.getState().ai.framework === 'react')

// ---------------------------------------------------------------------------
// 4. Run the task: "create a todo app" -> LIVE action feed
// ---------------------------------------------------------------------------
const textarea = $('.ai-textarea')
setNativeValue(textarea, 'create a todo app')

// watch the feed WHILE it runs
let maxRowsDuringRun = 0
let sawThinking = false
const watcher = setInterval(() => {
  maxRowsDuringRun = Math.max(maxRowsDuringRun, $$('.ai-action').length)
  if ($('.ai-thinking')) sawThinking = true
}, 15)

const runStartedAt = Date.now()
textarea.dispatchEvent(
  new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
)

const agentMessage = await waitFor(
  () => $$('.ai-message.is-ai').find((element) => /scaffolded the React todo app/.test(element.textContent)),
  60000,
)
clearInterval(watcher)
const runMs = Date.now() - runStartedAt
check('agent finished with its final summary in the feed', Boolean(agentMessage), `${runMs}ms`)
check('run state cleared (input usable again)', store.getState().ai.running === false)

const actionRows = $$('.ai-action')
check('one feed row per tool call (10)', actionRows.length === 10, `${actionRows.length} rows`)
check('feed streamed progressively (rows grew during the run)', maxRowsDuringRun >= 2, `max ${maxRowsDuringRun} while running`)
check('thinking/working indicator appeared', sawThinking)

const allText = $$('.ai-action-desc').map((element) => element.textContent)
for (const label of ['List project root', 'Create package.json', 'Edit src/App.jsx', 'Delete tmp-agent.txt']) {
  check(`feed shows "${label}"`, allText.some((text) => text.includes(label)), allText.join(' | ').slice(0, 160))
}
check(
  'run_command row shows exit code badge',
  $$('.ai-action-meta').some((element) => element.textContent.includes('exit 0')),
  $$('.ai-action-meta').map((element) => element.textContent).join(', '),
)

// expand the run_command row -> captured output
const runRow = $$('.ai-action').find((row) => row.textContent.includes('echo agent-shell-works'))
check('run_command row present', Boolean(runRow))
click(runRow?.querySelector('.ai-action-head'))
await sleep(50) // let React render the expanded details
const details = runRow?.querySelector('.ai-action-details')
check('expanding shows the captured shell output', /agent-shell-works/.test(details?.textContent ?? ''))

// summary meta (tool calls)
check(
  'summary shows tool-call count',
  /10 tool calls/.test(agentMessage?.textContent ?? ''),
  agentMessage?.textContent?.slice(-60),
)

// ---------------------------------------------------------------------------
// 5. Explorer picked up the agent's files (watcher refresh)
// ---------------------------------------------------------------------------
const packageRow = await waitFor(() => $('.tree-row[data-node-id="package.json"]'), 10000)
check('Explorer updated live: package.json appeared', Boolean(packageRow))
const srcRow = await waitFor(() => $('.tree-row[data-node-id="src"]'), 6000)
check('Explorer updated live: src folder appeared', Boolean(srcRow))
if (srcRow) click(srcRow) // expand so the nested file renders
const appRow = await waitFor(() => $('.tree-row[data-node-id="src/App.jsx"]'), 6000)
check('Explorer shows the nested src/App.jsx after expanding', Boolean(appRow))
check('tmp-agent.txt NOT in the tree (deleted)', !$('.tree-row[data-node-id="tmp-agent.txt"]'))

// ---------------------------------------------------------------------------
// 6. Real files on disk
// ---------------------------------------------------------------------------
check('package.json on disk', fs.existsSync(path.join(folder, 'package.json')))
check('src/App.jsx on disk (post-edit)', /addItem/.test(fs.readFileSync(path.join(folder, 'src', 'App.jsx'), 'utf8')))
check('tmp-agent.txt removed from disk', !fs.existsSync(path.join(folder, 'tmp-agent.txt')))

// ---------------------------------------------------------------------------
// 7. Resizable AI panel (drag the LEFT edge)
// ---------------------------------------------------------------------------
const handle = await waitFor(() => $('.ai-resize-handle'))
check('resize handle on the AI panel', Boolean(handle))
const css = fs.readFileSync(path.join(__dirname, 'src/App.css'), 'utf8')
check('handle uses col-resize cursor', /\.ai-resize-handle\s*\{[^}]*cursor:\s*col-resize/.test(css.replace(/\s+/g, ' ')) || /cursor: col-resize/.test(css))

const widthBefore = store.getState().ui.aiPanelWidth
fire(handle, 'mousedown', { clientX: 900 })
fire(document, 'mousemove', { clientX: 850 }) // pull left -> wider
await sleep(30)
const widthAfterDrag = store.getState().ui.aiPanelWidth
check('dragging left widens the panel (+50px)', widthAfterDrag === widthBefore + 50, `${widthBefore} -> ${widthAfterDrag}`)
check('panel width applied inline', $('.panel-slot-ai').style.width === `${widthAfterDrag}px`, $('.panel-slot-ai').style.width)

// Dragging the LEFT edge far RIGHT shrinks the panel -> clamps at the 280 min.
fire(document, 'mousemove', { clientX: 5000 })
await sleep(30)
check('clamped to the 280px minimum', store.getState().ui.aiPanelWidth === 280, String(store.getState().ui.aiPanelWidth))
// Dragging it far LEFT widens it -> clamps at the 600 max.
fire(document, 'mousemove', { clientX: -5000 })
await sleep(30)
check('clamped to the 600px maximum', store.getState().ui.aiPanelWidth === 600, String(store.getState().ui.aiPanelWidth))
fire(document, 'mouseup', {})
await sleep(30)
check(
  'width persisted to localStorage',
  window.localStorage.getItem('code-matrix:aiPanelWidth') === '600',
  window.localStorage.getItem('code-matrix:aiPanelWidth'),
)
check('is-resizing class removed after the drag', !$('.panel-slot-ai.is-resizing'))

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const failed = results.filter((entry) => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILED:')
  for (const entry of failed) console.log(`  - ${entry.name}`)
}

root.unmount()
await vite.close()
await dom.window.close()
process.exit(failed.length ? 1 : 0)
