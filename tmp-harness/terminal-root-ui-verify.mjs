import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { io } = await import(
  new URL('../client/node_modules/socket.io-client/build/esm/index.js', import.meta.url)
)

const here = path.dirname(fileURLToPath(import.meta.url))
const API_URL = process.env.API_URL || 'http://localhost:4000'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5173/'
const CDP_PORT = 9448

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

const viewsSnapshot = `(() => {
  const views = window.__TERMINAL_VIEWS__
  if (!views || views.size === 0) return null
  const entries = []
  for (const [id, term] of views) {
    let out = ''
    const buffer = term.buffer.active
    for (let i = 0; i < buffer.length; i += 1) {
      const line = buffer.getLine(i)
      if (line) out += line.translateToString(true) + '\\n'
    }
    entries.push({ id, text: out })
  }
  return JSON.stringify(entries)
})()`

function parseViews(raw) {
  if (!raw) return []
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

const cwdHook = `(() => {
  if (window.__CWD_BY_ID__) return true
  if (!window.__SOCKET__) return false
  window.__CWD_BY_ID__ = {}
  for (const name of ['terminal:ready', 'terminal:attach']) {
    window.__SOCKET__.on(name, (payload) => {
      if (payload && payload.terminalId && payload.cwd) {
        window.__CWD_BY_ID__[payload.terminalId] = payload.cwd
      }
    })
  }
  return true
})()`

async function installHook(cdp) {
  await waitFor(cdp, 'Boolean(window.__SOCKET__)', { label: 'socket' })
  await waitFor(cdp, cwdHook, { label: 'cwd hook' })
}

async function cwdOf(cdp, terminalId) {
  if (!terminalId) return null
  return await evaluate(
    cdp,
    `window.__CWD_BY_ID__ ? (window.__CWD_BY_ID__[${JSON.stringify(terminalId)}] ?? null) : null`,
  )
}

function pidFrom(text) {
  const lines = String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').trim())
    .filter(Boolean)
  const markerIndex = lines.findIndex((line) => line.includes('$PID'))
  if (markerIndex === -1) return null
  for (let index = markerIndex + 1; index < lines.length; index += 1) {
    if (/^\d{2,7}$/.test(lines[index])) return Number(lines[index])
  }
  return null
}

function removeWithRetry(target) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      rmSync(target, { recursive: true, force: true })
      if (!existsSync(target)) return true
    } catch {}
    if (!existsSync(target)) return true
  }
  return !existsSync(target)
}

function isProcessAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function launchChrome() {
  const profile = mkdtempSync(path.join(tmpdir(), 'cm-rootui-'))
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--window-size=1440,1000',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      APP_URL,
    ],
    { stdio: 'ignore' },
  )
  let target = null
  for (let attempt = 0; attempt < 60 && !target; attempt += 1) {
    await sleep(300)
    try {
      const list = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((res) => res.json())
      target = list.find((entry) => entry.type === 'page' && entry.url.startsWith('http'))
    } catch {}
  }
  if (!target) {
    chrome.kill()
    try {
      rmSync(profile, { recursive: true, force: true })
    } catch {}
    throw new Error('no chrome page target')
  }
  const cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.ready
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  return { chrome, profile, cdp }
}

async function openTerminalTab(cdp) {
  const present = await evaluate(cdp, 'Boolean(document.getElementById("right-panel-tab-terminal"))')
  if (!present) return false
  await evaluate(cdp, 'document.getElementById("right-panel-tab-terminal").click()')
  await waitFor(cdp, 'Boolean(window.__TERMINAL_VIEWS__) && window.__TERMINAL_VIEWS__.size > 0', {
    label: 'terminal view',
  })
  return true
}

async function capturePid(cdp, terminalId) {
  await evaluate(
    cdp,
    `window.__TERMINAL_VIEWS__.get(${JSON.stringify(terminalId)}).paste('$PID\\r')`,
  )
  await sleep(2000)
  const views = parseViews(await evaluate(cdp, viewsSnapshot))
  const view = views.find((entry) => entry.id === terminalId)
  return pidFrom(view?.text)
}

async function main() {
  const { chrome, profile, cdp } = await launchChrome()
  try {
    await waitFor(cdp, 'Boolean(document.querySelector(".right-panel"))', { label: 'right panel' })
    await installHook(cdp)
    await openTerminalTab(cdp)
    await sleep(3000)

    let views = parseViews(await evaluate(cdp, viewsSnapshot))
    check('sidebar terminal opened', views.length > 0, `views=${views.length}`)
    let sidebarId = views[0]?.id ?? null
    const containerCwd = await cwdOf(cdp, sidebarId)
    check('the server reports the working directory', Boolean(containerCwd), containerCwd)
    check(
      'the terminal starts in the per-user container, not a project folder',
      Boolean(containerCwd) && /[\\/]u-[^\\/]+$/.test(containerCwd),
      containerCwd,
    )
    check('no [terminal error] on open', !views[0]?.text.includes('[terminal error]'))

    const marker = `UIMARK-${Date.now()}`
    await evaluate(
      cdp,
      `window.__TERMINAL_VIEWS__.get(${JSON.stringify(sidebarId)}).paste(${JSON.stringify(`echo ${marker}\\r`)})`,
    )
    await sleep(2500)
    views = parseViews(await evaluate(cdp, viewsSnapshot))
    check('the shell runs a command', views[0]?.text.includes(marker))

    await evaluate(cdp, 'document.getElementById("right-panel-tab-agent").click()')
    await sleep(1200)
    await evaluate(cdp, 'document.getElementById("right-panel-tab-terminal").click()')
    await sleep(1200)
    views = parseViews(await evaluate(cdp, viewsSnapshot))
    check('Agent/Terminal tab switch keeps the same session', views[0]?.id === sidebarId, views[0]?.id)
    check('tab switch does not kill the process', !views[0]?.text.includes('[process exited'))

    await cdp.send('Page.reload', { ignoreCache: true })
    await waitFor(cdp, 'Boolean(document.querySelector(".right-panel"))', { label: 'app after reload' })
    await installHook(cdp)
    const tabShown = await evaluate(
      cdp,
      'Boolean(window.__TERMINAL_VIEWS__) && window.__TERMINAL_VIEWS__.size > 0',
    )
    if (!tabShown) await openTerminalTab(cdp)
    await sleep(3000)
    views = parseViews(await evaluate(cdp, viewsSnapshot))
    check('reload inside the grace window reattaches the same session', views[0]?.id === sidebarId, views[0]?.id)
    check('scrollback survives the reload', views[0]?.text.includes(marker))
    check('no [terminal error] after the reload', !views[0]?.text.includes('[terminal error]'))

    await evaluate(
      cdp,
      `(() => { window.__SOCKET__.emit('terminal:close', { terminalId: ${JSON.stringify(sidebarId)} }); return true })()`,
    )
    await sleep(2000)
    const removed = removeWithRetry(containerCwd)
    check('the container folder was deleted while the app is open', removed, containerCwd)

    if (removed) {
      await evaluate(cdp, 'document.querySelector(".sidebar-terminal-new").click()')
      await sleep(3500)
      views = parseViews(await evaluate(cdp, viewsSnapshot))
      const freshId = views[0]?.id ?? null
      const freshCwd = await cwdOf(cdp, freshId)
      check('a new terminal opened after the wipe', Boolean(freshId) && freshId !== sidebarId, freshId)
      check(
        'it starts at the recreated container root',
        freshCwd === containerCwd && existsSync(containerCwd),
        freshCwd,
      )
      check('no [terminal error] after the container was deleted', !views[0]?.text.includes('[terminal error]'))
      check('the fresh terminal has no old output', !views[0]?.text.includes(marker))
      sidebarId = freshId
    }

    await evaluate(cdp, 'document.querySelector(\'button[aria-label="Toggle terminal panel"]\').click()')
    await sleep(1200)
    await evaluate(cdp, 'document.querySelector(".terminal-new").click()')
    await sleep(3000)
    views = parseViews(await evaluate(cdp, viewsSnapshot))
    const floating = views.find((entry) => entry.id !== sidebarId) ?? null
    const floatingCwd = await cwdOf(cdp, floating?.id)
    check('the floating terminal panel opens a terminal', Boolean(floating), `views=${views.length}`)
    check(
      'the floating terminal starts at the per-user container root',
      Boolean(floating) && floatingCwd === containerCwd,
      floatingCwd,
    )
    check('no [terminal error] in the floating terminal', !floating?.text.includes('[terminal error]'))

    const gracePid = await capturePid(cdp, sidebarId)
    check('captured the pty pid for the grace test', Boolean(gracePid), `pid=${gracePid}`)

    chrome.kill()
    await sleep(3000)
    check('the pty stays alive inside the grace window after the window closes', isProcessAlive(gracePid), `pid=${gracePid}`)

    console.log('... waiting out the 60s grace period ...')
    await sleep(66000)
    check('the pty process is gone after the grace period', !isProcessAlive(gracePid), `pid=${gracePid}`)

    const helper = io(API_URL, { transports: ['websocket'], forceNew: true, reconnection: false })
    await new Promise((resolve) => helper.on('connect', resolve))
    const lost = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 8000)
      helper.once('terminal:lost', (payload) => {
        clearTimeout(timer)
        resolve(payload)
      })
      helper.emit('terminal:create', { terminalId: sidebarId, reattach: true }, (ack) => {
        if (ack?.ok === false && ack?.code === 'SESSION_LOST') {
          clearTimeout(timer)
          resolve({ terminalId: ack.terminalId })
        }
      })
    })
    check('the closed session is gone server-side (SESSION_LOST)', Boolean(lost), JSON.stringify(lost))
    helper.disconnect()

    try {
      rmSync(profile, { recursive: true, force: true })
    } catch {}

    const second = await launchChrome()
    try {
      await waitFor(second.cdp, 'Boolean(document.querySelector(".right-panel"))', { label: 'second run' })
      await installHook(second.cdp)
      await openTerminalTab(second.cdp)
      await sleep(3500)
      const reopened = parseViews(await evaluate(second.cdp, viewsSnapshot))
      const reopenedCwd = await cwdOf(second.cdp, reopened[0]?.id)
      check('reopening the window starts a terminal', reopened.length > 0)
      check(
        'the reopened terminal starts at the container root',
        reopenedCwd === containerCwd,
        reopenedCwd,
      )
      check('the reopened terminal has no old output', !reopened[0]?.text.includes(marker))
      check('no [terminal error] on reopen', !reopened[0]?.text.includes('[terminal error]'))

      const registration = await fetch('http://localhost:4000/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Root Verify',
          email: `root-verify-${Date.now()}@example.com`,
          password: 'Testpass123',
        }),
      }).then((response) => response.json())
      check('registered a signed-in test user', Boolean(registration?.token), registration?.error?.message)

      if (registration?.token) {
        await evaluate(
          second.cdp,
          `localStorage.setItem('code-matrix:token', ${JSON.stringify(registration.token)}); true`,
        )
        await second.cdp.send('Page.navigate', { url: APP_URL })
        await waitFor(second.cdp, 'Boolean(document.querySelector(".right-panel"))', {
          label: 'signed-in app',
        })
        await waitFor(second.cdp, 'Boolean(document.querySelector(".user-chip"))', {
          label: 'signed-in topbar',
        })
        await installHook(second.cdp)
        await evaluate(second.cdp, 'document.getElementById("right-panel-tab-terminal").click()')
        await waitFor(
          second.cdp,
          'Boolean(window.__TERMINAL_VIEWS__) && window.__TERMINAL_VIEWS__.size > 0',
          { label: 'signed-in terminal view' },
        )
        await sleep(3500)
        const signedViews = parseViews(await evaluate(second.cdp, viewsSnapshot))
        const signedId = signedViews[0]?.id ?? null
        const signedCwd = await cwdOf(second.cdp, signedId)
        check(
          'signed-in terminal starts in the signed-in user container',
          Boolean(signedCwd) && signedCwd !== containerCwd && /[\\/]u-[^\\/]+$/.test(signedCwd),
          signedCwd,
        )
        check(
          'a guest terminal id is not reused after sign-in',
          Boolean(signedId) && signedId !== reopened[0]?.id,
          `${reopened[0]?.id} -> ${signedId}`,
        )
        check('no [terminal error] as a signed-in user', !signedViews[0]?.text.includes('[terminal error]'))

        const authMarker = `AUTHMARK-${Date.now()}`
        await evaluate(
          second.cdp,
          `window.__TERMINAL_VIEWS__.get(${JSON.stringify(signedId)}).paste(${JSON.stringify(`echo ${authMarker}\r`)})`,
        )
        await sleep(2500)
        const signedWithMarker = parseViews(await evaluate(second.cdp, viewsSnapshot))
        check('the signed-in shell runs a command', signedWithMarker[0]?.text.includes(authMarker))

        await second.cdp.send('Page.reload', { ignoreCache: true })
        await waitFor(second.cdp, 'Boolean(document.querySelector(".right-panel"))', {
          label: 'signed-in app after reload',
        })
        await installHook(second.cdp)
        const signedTabShown = await evaluate(
          second.cdp,
          'Boolean(window.__TERMINAL_VIEWS__) && window.__TERMINAL_VIEWS__.size > 0',
        )
        if (!signedTabShown) {
          await evaluate(second.cdp, 'document.getElementById("right-panel-tab-terminal").click()')
          await waitFor(
            second.cdp,
            'Boolean(window.__TERMINAL_VIEWS__) && window.__TERMINAL_VIEWS__.size > 0',
            { label: 'signed-in terminal view after reload' },
          )
        }
        await sleep(3500)
        const afterSignInReload = parseViews(await evaluate(second.cdp, viewsSnapshot))
        check(
          'signed-in reload reattaches the same session',
          afterSignInReload[0]?.id === signedId,
          `${signedId} -> ${afterSignInReload[0]?.id}`,
        )
        check('signed-in reload keeps the scrollback', afterSignInReload[0]?.text.includes(authMarker))
        check(
          'no [terminal error] on a signed-in reload',
          !afterSignInReload[0]?.text.includes('[terminal error]'),
        )
      }

      second.chrome.kill()
      await sleep(1500)
    } finally {
      try {
        rmSync(second.profile, { recursive: true, force: true })
      } catch {}
    }

    const passed = results.filter(Boolean).length
    console.log(`\n${passed}/${results.length} checks passed`)
    process.exitCode = passed === results.length ? 0 : 1
  } finally {
    try {
      chrome.kill()
    } catch {}
    try {
      rmSync(profile, { recursive: true, force: true })
    } catch {}
  }
}

main().catch((error) => {
  console.error('harness error', error)
  process.exit(1)
})
