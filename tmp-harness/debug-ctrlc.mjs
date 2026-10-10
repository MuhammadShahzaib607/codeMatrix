import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5173'
const PORT = 9352
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
    this.handlers = new Map()
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener('open', () => res())
      this.ws.addEventListener('error', (e) => rej(new Error(String(e.message || e.type))))
    })
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id)
        this.pending.delete(m.id)
        m.error ? reject(new Error(m.error.message)) : resolve(m.result)
        return
      }
      if (m.method && this.handlers.has(m.method)) for (const h of this.handlers.get(m.method)) h(m.params)
    })
  }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  on(method, h) {
    if (!this.handlers.has(method)) this.handlers.set(method, new Set())
    this.handlers.get(method).add(h)
  }
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval fail')
  return r.result.value
}

async function typeText(cdp, text) {
  for (const ch of text) {
    if (ch === '\n') {
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
    } else {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch, code: 'KeyA' })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'KeyA' })
    }
    await sleep(8)
  }
}

async function press(cdp, key, modifiers, vk) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers, key, code: `Key${key.toUpperCase()}`, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, key, code: `Key${key.toUpperCase()}`, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
}

const profile = mkdtempSync(join(tmpdir(), 'cm-dbg-'))
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' })

let cdp
try {
  let target = null
  for (let i = 0; i < 60 && !target; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
      target = list.find((e) => e.type === 'page')
    } catch {}
    if (!target) await sleep(250)
  }
  const version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json())
  const browserCdp = new Cdp(version.webSocketDebuggerUrl)
  await browserCdp.ready
  await browserCdp.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: APP_URL })

  cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.ready
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Page.navigate', { url: APP_URL })
  await sleep(2500)
  await cdp.send('Page.bringToFront')
  await sleep(500)
  console.log('hasFocus:', await evaluate(cdp, `document.hasFocus()`))
  await evaluate(cdp, `document.querySelectorAll('.right-panel-tab')[1].click()`)
  await sleep(4000)
  const id = await evaluate(cdp, `[...window.__TERMINAL_VIEWS__.keys()][0]`)
  console.log('terminalId', id)

  await evaluate(cdp, `
    window.__events = []
    document.addEventListener('copy', (e) => { window.__events.push({ type: 'copy', data: e.clipboardData ? e.clipboardData.getData('text/plain') : null, active: document.activeElement?.tagName + '.' + (document.activeElement?.className || '') }) }, true)
    document.addEventListener('keydown', (e) => { window.__events.push({ phase: 'capture', key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, target: e.target?.tagName + '.' + (e.target?.className || '') }) }, true)
    document.addEventListener('keydown', (e) => { window.__events.push({ phase: 'bubble', key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, prevented: e.defaultPrevented, target: e.target?.tagName + '.' + (e.target?.className || '') }) })
    true
  `)
  console.log('clipboard at start:', JSON.stringify(await evaluate(cdp, `navigator.clipboard.readText()`)))

  await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${id}').focus()`)
  await sleep(200)
  console.log('active after focus:', await evaluate(cdp, `document.activeElement.tagName + '.' + document.activeElement.className + ' in-terminal=' + Boolean(document.activeElement.closest?.('.terminal-view'))`))

  await typeText(cdp, 'node "D:/Projects/CodeMatrix/tmp-harness/ticker.js"\n')
  await sleep(1500)
  await evaluate(cdp, `window.__events = []`)

  const sel = await evaluate(cdp, `(() => { const t = window.__TERMINAL_VIEWS__.get('${id}'); const b = t.buffer.active; for (let i = 0; i < b.length; i++) { const line = b.getLine(i).translateToString(true); if (line.trim().length >= 14) { t.select(0, i, 16); return t.getSelection() } } return '' })()`)
  console.log('selected:', JSON.stringify(sel))
  console.log('active before focus():', await evaluate(cdp, `document.activeElement.tagName + '.' + document.activeElement.className`))
  await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${id}').focus()`)
  console.log('active after focus():', await evaluate(cdp, `document.activeElement.tagName + '.' + document.activeElement.className`))
  console.log('hasSelection:', await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${id}').hasSelection()`))

  await press(cdp, 'c', 2, 67)
  await sleep(700)
  console.log('events:', JSON.stringify(await evaluate(cdp, `JSON.stringify(window.__events)`), null, 1))
  console.log('clipboard:', JSON.stringify(await evaluate(cdp, `navigator.clipboard.readText()`)))
  console.log('hasSelection after:', await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${id}').hasSelection()`))
  console.log('notice:', await evaluate(cdp, `document.querySelector('.terminal-notice')?.textContent ?? ''`))
  console.log('tail:', JSON.stringify(await evaluate(cdp, `(() => { const t = window.__TERMINAL_VIEWS__.get('${id}'); const b = t.buffer.active; let s = ''; for (let i = Math.max(0, b.length - 6); i < b.length; i++) s += b.getLine(i).translateToString(true) + '|'; return s })()`)))

  await sleep(800)
  await evaluate(cdp, `window.__events = []`)
  await press(cdp, 'c', 2, 67)
  await sleep(700)
  console.log('events2:', JSON.stringify(await evaluate(cdp, `JSON.stringify(window.__events)`)))
  console.log('notice2:', await evaluate(cdp, `document.querySelector('.terminal-notice')?.textContent ?? ''`))

  cdp.ws.close()
  browserCdp.ws.close()
} finally {
  chrome.kill()
  await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch {}
}
