import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const API = 'http://localhost:4000'
const APP = 'http://localhost:5173'
const PORT = 9363
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
    this.handlers = new Map()
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve())
      this.ws.addEventListener('error', (event) => reject(new Error(String(event.message || event.type))))
    })
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(message.error.message))
        else resolve(message.result)
        return
      }
      if (message.method && this.handlers.has(message.method)) {
        for (const handler of this.handlers.get(message.method)) handler(message.params)
      }
    })
  }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, new Set())
    this.handlers.get(method).add(handler)
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'evaluate failed')
  return result.result.value
}

async function apiFetch(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

const stamp = Date.now()
const reg = await fetch(`${API}/api/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'R2 Debug', email: `codebuff-r2-debug-${stamp}@example.com`, password: 'Verify-12345' }),
}).then((r) => r.json())
const token = reg.token
await apiFetch(token, 'POST', '/api/workspace/container/entry', { name: 'r2dbg', type: 'folder' })
await apiFetch(token, 'POST', '/api/workspace/container/create', { path: 'r2dbg/subone', type: 'folder' })
await apiFetch(token, 'POST', '/api/workspace/container/create', { path: 'r2dbg/subtwo', type: 'folder' })

const profile = mkdtempSync(join(tmpdir(), 'codematrix-r2-debug-'))
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' })

try {
  let target = null
  const deadline = Date.now() + 15000
  while (Date.now() < deadline && !target) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
      target = list.find((e) => e.type === 'page')
    } catch {}
    if (!target) await sleep(250)
  }
  const cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.ready
  const errors = []
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Log.enable')
  cdp.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails?.exception?.description || 'exception'))
  cdp.on('Log.entryAdded', (p) => {
    if (p.entry?.level === 'error') errors.push(`console: ${p.entry.text}`)
  })

  const loaded = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve))
  await cdp.send('Page.navigate', { url: APP })
  await loaded
  await sleep(800)
  await evaluate(cdp, `localStorage.setItem('code-matrix:token', ${JSON.stringify(token)}); true`)
  const reloaded = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve))
  await cdp.send('Page.reload')
  await reloaded
  await sleep(1500)

  const state = await evaluate(cdp, `({
    pref: JSON.parse(localStorage.getItem('code-matrix:settings') ?? 'null')?.askBeforeMovingFolders,
    hasRow: Boolean(document.querySelector('[data-node-id="r2dbg"]')),
  })`)
  console.log('state', JSON.stringify(state))

  await evaluate(cdp, `document.querySelector('[data-node-id="r2dbg"]').click(); true`)
  await sleep(500)

  await evaluate(cdp, `(() => {
    window.__evts = [];
    for (const t of ['dragstart', 'dragover', 'drop']) {
      document.addEventListener(t, (e) => window.__evts.push(t + ' on ' + (e.target.className || e.target.tagName)), true);
    }
    return true;
  })()`)

  const dragResult = await evaluate(cdp, `(() => {
    const source = document.querySelector('[data-node-id="r2dbg/subone"]');
    if (!source) return 'no-source';
    const dt = new DataTransfer();
    dt.setData('application/x-codematrix-explorer', 'r2dbg/subone');
    dt.setData('text/plain', 'r2dbg/subone');
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const target = document.querySelector('[data-node-id="r2dbg/subtwo"]');
    if (!target) return 'no-target';
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
    target.dispatchEvent(new DragEvent('dragover', opts));
    target.dispatchEvent(new DragEvent('drop', opts));
    return 'ok';
  })()`)
  console.log('dragResult', dragResult)
  await sleep(1500)

  const after = await evaluate(cdp, `({
    events: window.__evts,
    modal: Boolean(document.querySelector('.confirm-overlay')),
    modalLabel: document.querySelector('.confirm-overlay')?.getAttribute('aria-label') ?? null,
    sourceStillThere: Boolean(document.querySelector('[data-node-id="r2dbg/subone"]')),
    destHasIt: Boolean(document.querySelector('[data-node-id="r2dbg/subtwo/subone"]')),
    toasts: [...document.querySelectorAll('.toast-message')].map((e) => e.textContent),
    pref: JSON.parse(localStorage.getItem('code-matrix:settings') ?? 'null')?.askBeforeMovingFolders,
  })`)
  console.log('after', JSON.stringify(after, null, 2))
  console.log('errors', JSON.stringify(errors, null, 2))
} catch (error) {
  console.log('harness error', error.message)
} finally {
  chrome.kill()
}
