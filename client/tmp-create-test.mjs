// TEMPORARY verification (deleted after the run).
//
// Task 1: clicking "New File"/"New Folder" (toolbar AND context menu) must show
// an inline name field and create NOTHING — not even a workspace — until the
// user types a name and presses Enter. Escape cancels with no side effects.
// Also verifies the regular folder delete still works (one-time cleanup).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { startTestEnvironment } from './tmp-test-server.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const WORKSPACES = path.join(ROOT, 'server', 'workspaces')

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) passed += 1
  else failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(fn, timeout = 8000, step = 20) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = fn()
    if (Array.isArray(value) ? value.length > 0 : Boolean(value)) return value
    await sleep(step)
  }
  return Array.isArray(fn()) ? [] : null
}

async function main() {
  const { api, stop } = await startTestEnvironment({ serverPort: 4102, groqPort: 4956 })
  try {
    const email = `create-${Date.now()}@example.com`
    const authRes = await fetch(`${api}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Create Tester', email, password: 'test-pass-123' }),
    })
    const auth = await authRes.json()
    const token = auth.token
    const userId = auth.user.id
    const ownerKey = String(userId).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24)
    const containerDir = path.join(WORKSPACES, `u-${ownerKey}`)

    // ---- jsdom + Vite SSR boot -------------------------------------------
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'http://localhost:5173/',
      pretendToBeVisual: true,
    })
    const { window } = dom
    for (const key of ['document','localStorage','sessionStorage','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Element','Node','Event','MouseEvent','KeyboardEvent','CustomEvent','MutationObserver','SVGElement','getComputedStyle','requestAnimationFrame','cancelAnimationFrame','CSS']) {
      if (window[key] === undefined) continue
      try { Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true }) } catch {}
    }
    globalThis.window = window
    try { Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true }) } catch {}
    class ObserverStub { observe(){} unobserve(){} disconnect(){} }
    window.ResizeObserver = window.ResizeObserver ?? ObserverStub
    window.IntersectionObserver = window.IntersectionObserver ?? ObserverStub
    globalThis.ResizeObserver = window.ResizeObserver
    globalThis.IntersectionObserver = window.IntersectionObserver
    globalThis.matchMedia = window.matchMedia ?? (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
    window.HTMLElement.prototype.scrollIntoView = window.HTMLElement.prototype.scrollIntoView ?? (() => {})
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
    window.localStorage.setItem('code-matrix:token', token)

    const vite = await createServer({
      root: __dirname,
      configFile: path.join(__dirname, 'vite.config.js'),
      server: { middlewareMode: true, hmr: false },
      appType: 'custom',
      logLevel: 'warn',
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

    const $ = (selector) => document.querySelector(selector)
    const $$ = (selector) => [...document.querySelectorAll(selector)]
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
    function press(el, key) {
      el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    }
    async function typeAndEnter(name) {
      const input = await waitFor(() => $('.tree-input'))
      setNativeValue(input, name)
      press(input, 'Enter')
      return input
    }

    await waitFor(() => $('.sidebar'))
    // Let auth load so the scratch id uses the real user id, not "guest".
    await waitFor(() => store.getState().auth.user?.id, 5000)
    check('signed in, no workspace at boot', store.getState().fileSystem.workspace.projectId === null)
    check('no scratch folder on disk yet', !fs.existsSync(containerDir), containerDir)

    // ---- A. toolbar New Folder: inline field, no eager creation ----------
    click($('.sidebar-header-actions button[aria-label="New folder"]'))
    const inlineInput = await waitFor(() => $('.tree-input'))
    check('Task 1: toolbar New Folder shows an inline name field', Boolean(inlineInput))
    check('Task 1: the field is focused', document.activeElement === inlineInput)
    check(
      'Task 1: nothing was created yet (no workspace bootstrapped)',
      store.getState().fileSystem.workspace.projectId === null,
      String(store.getState().fileSystem.workspace.projectId),
    )
    check('Task 1: no folder appeared on disk', !fs.existsSync(containerDir))

    await typeAndEnter('my-app')
    const myAppRow = await waitFor(() => $('.tree-row[data-node-id="my-app"]'), 10000)
    check('Task 1: Enter created the named folder', Boolean(myAppRow))
    check(
      'Task 1: workspace bootstrapped only on confirm',
      store.getState().fileSystem.workspace.source === 'scratch',
      JSON.stringify(store.getState().fileSystem.workspace),
    )
    check(
      'Task 1: folder on disk has the typed name (not a default)',
      fs.existsSync(path.join(containerDir, 'Scratch', 'my-app')) &&
        fs.statSync(path.join(containerDir, 'Scratch', 'my-app')).isDirectory(),
    )
    check(
      'Task 1: the workspace root is the scratch workspace (expected)',
      $$('.tree-label').some((el) => el.textContent === 'Scratch'),
      $$('.tree-label').map((el) => el.textContent).join(', '),
    )

    // ---- B. Escape cancels without creating anything ---------------------
    click($('.sidebar-header-actions button[aria-label="New file"]'))
    const escInput = await waitFor(() => $('.tree-input'))
    setNativeValue(escInput, 'cancel-me')
    press(escInput, 'Escape')
    await sleep(120)
    check('Task 1: Escape closed the inline field', !$('.tree-input'))
    check('Task 1: Escape created no row', !$('.tree-row[data-node-id="cancel-me"]'))
    check('Task 1: Escape created no file on disk', !fs.existsSync(path.join(containerDir, 'Scratch', 'cancel-me')))

    // ---- C. context menu inside a folder --------------------------------
    const rootRow = $('.tree-row[data-node-id="root"]')
    fire(rootRow, 'contextmenu', { clientX: 100, clientY: 100 })
    const menu = await waitFor(() => $('.tree-context-menu'))
    check('Task 1: right-click opens the context menu', Boolean(menu))
    const newFolderItem = $$('.tree-context-item').find((el) => el.textContent.includes('New Folder'))
    click(newFolderItem)
    const ctxInput = await waitFor(() => $('.tree-input'))
    check('Task 1: context-menu New Folder shows the same inline field', Boolean(ctxInput))
    check('Task 1: context menu created nothing on click', !$('.tree-row[data-node-id="nested"]'))
    await typeAndEnter('nested')
    check('Task 1: context-menu folder created with the typed name', Boolean(await waitFor(() => $('.tree-row[data-node-id="nested"]'), 8000)))
    check('Task 1: nested folder exists on disk', fs.existsSync(path.join(containerDir, 'Scratch', 'nested')))

    // ---- D. regular folder delete works (one-time cleanup path) ----------
    const nestedRow = $('.tree-row[data-node-id="nested"]')
    click(nestedRow.querySelector('.tree-action[aria-label="Delete nested"]'))
    const modal = await waitFor(() => $('.confirm-overlay'))
    check('Task 1: delete asks for confirmation', Boolean(modal))
    click($('.confirm-btn.is-danger'))
    await waitFor(() => !$('.tree-row[data-node-id="nested"]'), 8000)
    check('Task 1: folder deleted from the tree', !$('.tree-row[data-node-id="nested"]'))
    await sleep(200)
    check('Task 1: folder deleted from disk', !fs.existsSync(path.join(containerDir, 'Scratch', 'nested')))

    root.unmount()
    await vite.close()
    await dom.window.close()
  } finally {
    stop()
  }

  console.log(`\n${passed}/${passed + failed} checks passed`)
  process.exit(failed ? 1 : 0)
}

main().catch((error) => {
  console.error('FAIL:', error)
  process.exit(1)
})
