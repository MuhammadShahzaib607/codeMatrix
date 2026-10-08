import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5173'
const PORT = 9334
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

async function waitFor(cdp, expr, timeout = 15000, label = expr) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await evaluate(cdp, expr)) return true
    await sleep(150)
  }
  throw new Error('timeout: ' + label)
}

async function typeText(cdp, text) {
  for (const ch of text) {
    const code = /[a-z]/.test(ch) ? `Key${ch.toUpperCase()}` : /[0-9]/.test(ch) ? `Digit${ch}` : ch === ' ' ? 'Space' : ch === '-' ? 'Minus' : 'KeyA'
    const vk = /[a-z]/.test(ch) ? ch.toUpperCase().charCodeAt(0) : /[0-9]/.test(ch) ? ch.charCodeAt(0) : ch === ' ' ? 32 : ch === '-' ? 189 : 65
    if (ch === '\n') {
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
    } else {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
    }
    await sleep(12)
  }
}

async function tail(cdp) {
  const text = await evaluate(
    cdp,
    `(() => { const t=[...window.__TERMINAL_VIEWS__.values()][0]; if(!t) return ''; const b=t.buffer.active; let s=''; const start=Math.max(0,b.length-14); for(let i=start;i<b.length;i++){ s+=b.getLine(i).translateToString(true)+'\\n' } return s })()`,
  )
  return text
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'cm-ctrlc-'))
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
    cdp = new Cdp(target.webSocketDebuggerUrl)
    await cdp.ready
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')
    const loaded = new Promise((r) => cdp.on('Page.loadEventFired', r))
    await cdp.send('Page.navigate', { url: APP_URL })
    await loaded
    await sleep(1500)
    await evaluate(cdp, `document.querySelectorAll('.right-panel-tab')[1].click()`)
    await waitFor(cdp, `Boolean(document.querySelector('.sidebar-terminal .xterm'))`)
    await sleep(2500)
    const id = await evaluate(cdp, `[...window.__TERMINAL_VIEWS__.keys()][0]`)
    await evaluate(cdp, `document.querySelector('.sidebar-terminal .xterm')?.click()`)

    // Method A: current pressCtrl (rawKeyDown)
    await typeText(cdp, 'ping -t 127.0.0.1\n')
    await sleep(1500)
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67 })
    await sleep(1000)
    await typeText(cdp, 'echo A_DONE\n')
    await sleep(1200)
    console.log('MODIFIER-ONLY-DOWN tail:\n' + (await tail(cdp)))

    // Method B: keyDown with text = \u0003
    await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${id}').clearSelection()`)
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, text: '\u0003', unmodifiedText: '\u0003', key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67 })
    await sleep(1000)
    await typeText(cdp, 'echo B_DONE\n')
    await sleep(1200)
    console.log('TEXT-0003 tail:\n' + (await tail(cdp)))

    console.log('METHOD-B-result:', await evaluate(cdp, `(window.__terminalTail = 'x', true)`))
  } finally {
    try { cdp?.ws?.close() } catch {}
    chrome.kill()
    try { rmSync(profile, { recursive: true, force: true }) } catch {}
  }
}
main().catch((e) => { console.error('PROBE ERROR', e.message); process.exit(1) })
