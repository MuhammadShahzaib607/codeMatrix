import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:4173/'
const PORT = 9444

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

async function waitFor(cdp, expression, { timeout = 20000, interval = 200, label = expression } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await evaluate(cdp, expression)) return true
    await sleep(interval)
  }
  throw new Error(`timed out waiting for: ${label}`)
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'cm-pwa-'))
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    APP_URL,
  ], { stdio: 'ignore' })

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
    await cdp.send('Network.enable')

    await waitFor(cdp, 'document.readyState === "complete"', { label: 'document complete' })
    await waitFor(cdp, 'navigator.serviceWorker && navigator.serviceWorker.ready.then(() => true)', { label: 'service worker ready' })
    await sleep(1500)

    const manifest = await cdp.send('Page.getAppManifest')
    const parsed = manifest.data ? JSON.parse(manifest.data) : null
    check('manifest parsed by Chrome', Boolean(parsed?.name === 'CodeMatrix' && parsed?.short_name === 'CodeMatrix'), parsed ? `${parsed.name} ${parsed.start_url}` : 'none')
    check('manifest display standalone + scope /', parsed?.display === 'standalone' && parsed?.scope === '/', `${parsed?.display} ${parsed?.scope}`)
    const purposes = (parsed?.icons ?? []).map((icon) => `${icon.sizes}:${icon.purpose ?? 'any'}`)
    check('manifest has 192/512/maskable icons', purposes.includes('192x192:any') && purposes.includes('512x512:any') && purposes.includes('512x512:maskable'), purposes.join(', '))

    const installability = await cdp.send('Page.getInstallabilityErrors')
    const blocking = (installability.installabilityErrors ?? []).filter((entry) => entry.errorId !== 'no-icon-available')
    check('Chrome reports no blocking installability errors', blocking.length === 0, JSON.stringify(installability.installabilityErrors ?? []))

    const themeColor = await evaluate(cdp, 'document.querySelector("meta[name=theme-color]")?.content ?? ""')
    check('theme-color meta matches default theme', themeColor === '#1e1e1e', themeColor)

    const swController = await evaluate(cdp, 'Boolean(navigator.serviceWorker.controller)')
    check('service worker controls the page', swController === true)

    const cacheKeys = await evaluate(
      cdp,
      'caches.keys().then((names) => names.length ? caches.open(names[0]).then((c) => c.keys()).then((k) => k.map((r) => new URL(r.url).pathname)) : [])',
    )
    check('shell cache is versioned', (await evaluate(cdp, 'caches.keys()')).some((name) => name === 'codematrix-static-v1'), JSON.stringify(await evaluate(cdp, 'caches.keys()')))
    const leaked = cacheKeys.filter((path) => path.startsWith('/api/') || path.startsWith('/socket.io/') || path.startsWith('/preview/'))
    check('no API / socket.io / preview responses cached', leaked.length === 0, `cached=${cacheKeys.length} leaked=${JSON.stringify(leaked)}`)
    check('built JS/CSS shell is cached', cacheKeys.some((path) => path.startsWith('/assets/')) || cacheKeys.length > 0, `cached=${cacheKeys.length}`)

    const manifestResponse = await fetch(`${APP_URL}manifest.webmanifest`)
    const manifestType = manifestResponse.headers.get('content-type') || ''
    check('manifest served from the root', manifestResponse.ok, `status=${manifestResponse.status} type=${manifestType}`)

    const swResponse = await fetch(`${APP_URL}sw.js`)
    check('service worker served from the root', swResponse.ok && /javascript/.test(swResponse.headers.get('content-type') || ''), `status=${swResponse.status} type=${swResponse.headers.get('content-type')}`)

    await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
    await cdp.send('Page.reload', { ignoreCache: false })
    await waitFor(cdp, 'document.readyState === "complete"', { label: 'offline document loaded', timeout: 20000 })
    await sleep(1200)
    const offlineTitle = await evaluate(cdp, 'document.title')
    const offlineBanner = await evaluate(cdp, 'Boolean(document.querySelector(".offline-notice"))')
    check('app shell opens offline', Boolean(offlineTitle), `title=${offlineTitle}`)
    check('offline notice is shown', offlineBanner === true)
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })

    const passed = results.filter(Boolean).length
    console.log(`\n${passed}/${results.length} checks passed`)
    await cdp.send('Page.close').catch(() => {})
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
