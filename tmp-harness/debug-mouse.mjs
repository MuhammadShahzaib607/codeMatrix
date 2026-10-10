import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5173'
const PORT = 9354
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
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) {
    throw new Error((r.exceptionDetails.exception?.description || 'eval fail') + ' ||| ' + expression.slice(0, 240))
  }
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

const profile = mkdtempSync(join(tmpdir(), 'cm-mouse-'))
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' })

try {
  let target = null
  for (let i = 0; i < 60 && !target; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
      target = list.find((e) => e.type === 'page')
    } catch {}
    if (!target) await sleep(250)
  }
  const cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.ready
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Page.navigate', { url: APP_URL })
  await sleep(2500)
  await cdp.send('Page.bringToFront')
  await sleep(400)
  await evaluate(cdp, `document.querySelectorAll('.right-panel-tab')[1].click()`)
  await sleep(4500)

  const id = await evaluate(cdp, `[...window.__TERMINAL_VIEWS__.keys()][0]`)
  console.log('id', id)
  await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${id}').focus()`)
  await sleep(300)

  await evaluate(cdp, `(() => {
    const term = window.__TERMINAL_VIEWS__.get('${id}')
    window.__raw = []
    const original = term.write.bind(term)
    term.write = (data, cb) => {
      window.__raw.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
      return original(data, cb)
    }
    return true
  })()`)

  await typeText(cdp, 'node "D:/Projects/CodeMatrix/tmp-harness/mouse-on.js"' + '\n')
  await sleep(2500)

  const bufferDump = await evaluate(cdp, `(() => {
    const term = window.__TERMINAL_VIEWS__.get('${id}')
    const buffer = term.buffer.active
    const rows = []
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i).translateToString(true)
      if (line.trim()) rows.push(i + ':' + JSON.stringify(line))
    }
    return rows.join(' | ')
  })()`)
  console.log('buffer:', bufferDump)
  console.log('xterm classes:', await evaluate(cdp, `document.querySelector('.terminal-view .xterm').className`))
  console.log('raw saw 1000h:', await evaluate(cdp, `window.__raw.some((chunk) => chunk.includes('?1000h'))`))
  console.log('raw length:', await evaluate(cdp, `window.__raw.join('').length`))
  console.log('raw tail:', JSON.stringify(await evaluate(cdp, `window.__raw.join('').slice(-400)`)))

  const forced = await evaluate(cdp, `(() => {
    const term = window.__TERMINAL_VIEWS__.get('${id}')
    const own = Object.getOwnPropertyNames(term).filter((k) => /mouse|core/i.test(k))
    const coreKeys = Object.keys(term._core || {}).filter((k) => /mouse/i.test(k))
    const svc = term._core?.coreMouseService || term._coreMouseService
    if (!svc) return JSON.stringify({ own, coreKeys, found: false })
    svc.activeProtocol = 'NORMAL'
    return JSON.stringify({ own, coreKeys, found: true, className: document.querySelector('.terminal-view .xterm').className })
  })()`)
  console.log('after forcing protocol:', forced)

  await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${id}').clearSelection()`)
  const box = await evaluate(cdp, `(() => { const r = document.querySelector('.sidebar-terminal .xterm-screen').getBoundingClientRect(); return { x1: Math.round(r.left + 40), y1: Math.round(r.top + 40), x2: Math.round(r.left + 260), y2: Math.round(r.top + 70) } })()`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x1, y: box.y1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x1, y: box.y1, button: 'left', clickCount: 1 })
  await sleep(60)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x2, y: box.y2 })
  await sleep(60)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x2, y: box.y2, button: 'left', clickCount: 1 })
  await sleep(800)
  console.log('selection after plain drag:', JSON.stringify(await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${id}').getSelection()`)))

  await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${id}').clearSelection()`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x1, y: box.y1, modifiers: 8 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x1, y: box.y1, button: 'left', clickCount: 1, modifiers: 8 })
  await sleep(60)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x2, y: box.y2, modifiers: 8 })
  await sleep(60)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x2, y: box.y2, button: 'left', clickCount: 1, modifiers: 8 })
  await sleep(800)
  console.log('selection after shift drag:', JSON.stringify(await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${id}').getSelection()`)))
} finally {
  chrome.kill()
  await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch {}
}
