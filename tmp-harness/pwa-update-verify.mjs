import { spawn } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:4173/'
const PORT = 9445
const SW_PATH = fileURLToPath(new URL('../client/dist/sw.js', import.meta.url))
const SW_BACKUP = `${SW_PATH}.bak`

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

async function waitFor(cdp, expression, { timeout = 25000, interval = 150, label = expression } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      if (await evaluate(cdp, expression)) return true
    } catch {}
    await sleep(interval)
  }
  throw new Error(`timed out waiting for: ${label}`)
}

async function main() {
  copyFileSync(SW_PATH, SW_BACKUP)
  const profile = mkdtempSync(join(tmpdir(), 'cm-pwau-'))
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', APP_URL], { stdio: 'ignore' })
  try {
    let target = null
    for (let attempt = 0; attempt < 40 && !target; attempt += 1) {
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

    await waitFor(cdp, 'navigator.serviceWorker && navigator.serviceWorker.ready.then(() => navigator.serviceWorker.controller !== null)', { label: 'controller ready' })
    const initialCaches = await evaluate(cdp, 'caches.keys()')
    check('v1 cache is active before update', initialCaches.includes('codematrix-static-v1'), JSON.stringify(initialCaches))

    const next = `${readFileSync(SW_PATH, 'utf8').replace(/codematrix-static-v1/g, 'codematrix-static-v2')}\n// build 2 ${Date.now()}\n`
    writeFileSync(SW_PATH, next)
    await sleep(300)

    await evaluate(cdp, 'navigator.serviceWorker.getRegistration().then((r) => r.update().then(() => true))')
    await waitFor(cdp, 'Boolean(document.querySelector(".toast-action"))', { timeout: 25000, label: 'update toast action' })
    const toastText = await evaluate(cdp, 'document.querySelector(".toast")?.textContent ?? ""')
    check('reload toast appears on a new version', /New version available/i.test(toastText), toastText.trim())

    await evaluate(cdp, 'document.querySelector(".toast-action").click()')
    await sleep(1000)
    await waitFor(cdp, 'document.readyState === "complete"', { label: 'reload after skipWaiting', timeout: 25000 })
    await waitFor(cdp, 'navigator.serviceWorker.controller !== null', { label: 'controller after reload' })
    await sleep(800)
    const afterCaches = await evaluate(cdp, 'caches.keys()')
    check('old cache cleared after update', !afterCaches.includes('codematrix-static-v1') && afterCaches.includes('codematrix-static-v2'), JSON.stringify(afterCaches))
    check('page still controlled after update', (await evaluate(cdp, 'Boolean(navigator.serviceWorker.controller)')) === true)

    const passed = results.filter(Boolean).length
    console.log(`\n${passed}/${results.length} checks passed`)
    process.exitCode = passed === results.length ? 0 : 1
  } finally {
    chrome.kill()
    copyFileSync(SW_BACKUP, SW_PATH)
    rmSync(SW_BACKUP, { force: true })
    try {
      rmSync(profile, { recursive: true, force: true })
    } catch {}
  }
}

main().catch((error) => {
  console.error('harness error', error)
  process.exit(1)
})
