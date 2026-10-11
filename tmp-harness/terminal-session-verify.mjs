import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5173/'
const API_URL = 'http://localhost:4000'
const PORT = 9447

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const results = []
function check(name, ok, detail = '') {
  results.push(Boolean(ok))
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
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
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'evaluate failed')
  return result.result.value
}

async function waitFor(cdp, expression, { timeout = 25000, interval = 200, label = expression } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      if (await evaluate(cdp, expression)) return true
    } catch {}
    await sleep(interval)
  }
  throw new Error(`timed out waiting for: ${label}`)
}

const bufferText = `(() => { const views = window.__TERMINAL_VIEWS__; if (!views || views.size === 0) return ''; const [id, term] = views.entries().next().value; let out = ''; const buffer = term.buffer.active; for (let i = 0; i < buffer.length; i += 1) { const line = buffer.getLine(i); if (line) out += line.translateToString(true) + '\\n'; } return JSON.stringify({ id, text: out }); })()`

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'cm-term-'))
  const chrome = spawn(CHROME, ['--headless=new', '--window-size=1440,1000', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', APP_URL], { stdio: 'ignore' })
  try {
    let target = null
    for (let attempt = 0; attempt < 60 && !target; attempt += 1) {
      await sleep(300)
      try {
        const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((res) => res.json())
        target = list.find((entry) => entry.type === 'page' && entry.url.startsWith('http'))
      } catch {}
    }
    if (!target) throw new Error('no chrome page target')
    const cdp = new Cdp(target.webSocketDebuggerUrl)
    await cdp.ready
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Network.enable')
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })

    await waitFor(cdp, 'Boolean(document.querySelector(".right-panel"))', { label: 'right panel' })
    await evaluate(cdp, 'document.getElementById("right-panel-tab-terminal").click()')
    await waitFor(cdp, 'Boolean(window.__TERMINAL_VIEWS__) && window.__TERMINAL_VIEWS__.size > 0', { label: 'sidebar terminal view' })
    await sleep(2500)

    const first = JSON.parse(await evaluate(cdp, bufferText))
    check('sidebar terminal spawned a shell', Boolean(first.id), `id=${first.id} buffer=${first.text.length}`)

    await evaluate(cdp, `window.__TERMINAL_VIEWS__.get(${JSON.stringify(first.id)}).paste('sleep 300\\r')`)
    await sleep(2500)
    const running = JSON.parse(await evaluate(cdp, bufferText))
    check('long command is running', !running.text.includes('[process exited') && running.text.includes('sleep 300'), running.text.replace(/\s+/g, ' ').slice(-90))

    await evaluate(cdp, 'document.getElementById("right-panel-tab-agent").click()')
    await sleep(1500)
    await evaluate(cdp, 'document.getElementById("right-panel-tab-terminal").click()')
    await sleep(1500)
    const afterTabSwitch = JSON.parse(await evaluate(cdp, bufferText))
    check('tab switch keeps the same pty', afterTabSwitch.id === first.id, `id=${afterTabSwitch.id}`)
    check('tab switch does not kill the process', !afterTabSwitch.text.includes('[process exited'))

    await evaluate(cdp, '(() => { window.__SOCKET__.disconnect(); return true; })()')
    await sleep(1500)
    const reconnectingShown = await evaluate(cdp, 'Boolean(document.querySelector(".terminal-reconnect"))')
    check('disconnect shows the Reconnecting indicator', reconnectingShown === true)
    await evaluate(cdp, '(() => { window.__SOCKET__.connect(); return true; })()')
    await sleep(4000)
    const afterDrop = JSON.parse(await evaluate(cdp, bufferText))
    check('reconnect reattaches the same pty', afterDrop.id === first.id && !afterDrop.text.includes('[process exited'), `id=${afterDrop.id}`)
    check('scrollback survives the drop', afterDrop.text.includes('sleep 300'), afterDrop.text.replace(/\s+/g, ' ').slice(-90))
    const reconnectingGone = await evaluate(cdp, 'Boolean(document.querySelector(".terminal-reconnect"))')
    check('reconnecting indicator disappears after reattach', reconnectingGone === false)

    const { io } = await import(new URL('../client/node_modules/socket.io-client/build/esm/index.js', import.meta.url))
    const helper = io(API_URL, { transports: ['websocket'], forceNew: true, reconnection: false })
    await new Promise((resolve) => helper.on('connect', resolve))
    helper.emit('terminal:close', { terminalId: first.id })
    helper.disconnect()
    await sleep(1000)
    await evaluate(cdp, '(() => { window.__SOCKET__.disconnect(); return true; })()')
    await sleep(1200)
    await evaluate(cdp, '(() => { window.__SOCKET__.connect(); return true; })()')
    await sleep(5000)
    const afterLost = JSON.parse(await evaluate(cdp, bufferText))
    const afterLostText = afterLost.text.replace(/\s+/g, '')
    check('lost session shows the restart message', afterLostText.includes('Sessionendedbecausetheserverrestarted.Startanewone.'), afterLostText.slice(-120))

    const passed = results.filter(Boolean).length
    console.log(`\n${passed}/${results.length} checks passed`)
    process.exitCode = passed === results.length ? 0 : 1
  } finally {
    chrome.kill()
    try {
      rmSync(profile, { recursive: true, force: true })
    } catch {}
  }
}

main().catch((error) => {
  console.error('harness error', error)
  process.exit(1)
})
