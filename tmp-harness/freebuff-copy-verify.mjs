import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5173'
const PORT = 9355
const PROJECT_DIR = 'D:/Projects/CodeMatrix/tmp-harness/fbtest'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval fail')
  return r.result.value
}

async function typeText(cdp, text, delay = 8) {
  for (const ch of text) {
    if (ch === '\n') {
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
    } else {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch, code: 'KeyA' })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'KeyA' })
    }
    await sleep(delay)
  }
}

const bufferExpr = (id) => `(() => {
  const t = window.__TERMINAL_VIEWS__.get('${id}')
  if (!t) return ''
  const b = t.buffer.active
  let s = ''
  for (let i = 0; i < b.length; i++) s += b.getLine(i).translateToString(true) + '|'
  return s
})()`

const profile = mkdtempSync(join(tmpdir(), 'cm-fb-'))
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
  await sleep(400)
  check('page is focused', await evaluate(cdp, `document.hasFocus()`))

  await evaluate(cdp, `document.querySelectorAll('.right-panel-tab')[1].click()`)
  await sleep(4500)
  const id = await evaluate(cdp, `[...window.__TERMINAL_VIEWS__.keys()][0]`)
  check('terminal session opened', Boolean(id), `id=${id}`)
  await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${id}').focus()`)
  await sleep(300)

  await typeText(cdp, `cd "${PROJECT_DIR}"` + '\n')
  await sleep(1200)
  await typeText(cdp, 'npx freebuff' + '\n')

  let buffer = ''
  const loginWaitEnd = Date.now() + 90000
  while (Date.now() < loginWaitEnd) {
    buffer = await evaluate(cdp, bufferExpr(id))
    if (/https?:\/\/\S+/.test(buffer) && /login|Open this URL|browser/i.test(buffer)) break
    await sleep(1000)
  }

  check('freebuff produced a login prompt', /Open this URL in your browser to login|login/i.test(buffer), `len=${buffer.length}`)
  const urlMatch = buffer.match(/https?:\/\/[^\s|]+/)
  check('freebuff printed a login URL', Boolean(urlMatch), urlMatch ? urlMatch[0] : `buffer tail=${JSON.stringify(buffer.slice(-500))}`)

  if (urlMatch) {
    const printedUrl = urlMatch[0].replace(/[.,)]+$/, '')
    await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${id}').focus()`)
    await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${id}').clearSelection()`)
    await sleep(200)
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: 'c', unmodifiedText: 'c', key: 'c', code: 'KeyC' })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC' })
    await sleep(1200)

    const clipboard = await evaluate(cdp, `navigator.clipboard.readText()`)
    check(
      'freebuff "Copy link" puts the URL in the clipboard',
      typeof clipboard === 'string' && clipboard.startsWith('http'),
      `clipboard=${JSON.stringify(clipboard)}`,
    )
    if (typeof clipboard === 'string' && clipboard.startsWith('http')) {
      check(
        'clipboard URL matches the printed link',
        clipboard.replace(/\/$/, '') === printedUrl.replace(/\/$/, ''),
        `printed=${printedUrl} copied=${clipboard}`,
      )
    }
    const notice = await evaluate(cdp, `document.querySelector('.terminal-notice')?.textContent ?? ''`)
    check('copy shows the Copied notice', notice.trim() === 'Copied', `notice=${JSON.stringify(notice)}`)
  }

  console.log('\nBUFFER TAIL:\n' + buffer.slice(-1500))
  browserCdp.ws.close()
} finally {
  try { cdp?.ws.close() } catch {}
  chrome.kill()
  await sleep(400)
  try { rmSync(profile, { recursive: true, force: true }) } catch {}
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
