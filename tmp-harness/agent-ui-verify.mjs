import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:4173/'
const PORT = 9446

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

async function waitFor(cdp, expression, { timeout = 20000, interval = 150, label = expression } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      if (await evaluate(cdp, expression)) return true
    } catch {}
    await sleep(interval)
  }
  throw new Error(`timed out waiting for: ${label}`)
}

const BOOT_SCRIPT = `
localStorage.setItem('code-matrix:token', 'fake-non-admin-token');
const user = { id: '000000000000000000000001', name: 'Test User', email: 'user@example.com', role: localStorage.getItem('cm-test-role') || 'user' };
function json(body) { return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (url.includes('/api/auth/me')) return Promise.resolve(json({ user }));
  if (url.includes('/api/keys/usage')) return Promise.resolve(json({ keys: [], capturedAt: new Date().toISOString() }));
  if (url.includes('/api/keys')) return Promise.resolve(json({ keys: [], max: 5, providers: [{ id: 'groq', label: 'Groq' }, { id: 'mistral', label: 'Mistral' }] }));
  if (url.includes('/api/terminal/shells')) return Promise.resolve(json({ platform: 'linux', default: 'bash', shells: [{ id: 'bash', label: 'bash' }] }));
  if (url.includes('/api/projects')) return Promise.resolve(json({ projects: [] }));
  if (url.includes('/api/')) return Promise.resolve(json({}));
  return originalFetch(input, init);
};
`

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'cm-ui-'))
  const chrome = spawn(CHROME, ['--headless=new', '--window-size=1440,1000', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'], { stdio: 'ignore' })
  try {
    let target = null
    for (let attempt = 0; attempt < 40 && !target; attempt += 1) {
      await sleep(300)
      try {
        const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((res) => res.json())
        target = list.find((entry) => entry.type === 'page')
      } catch {}
    }
    if (!target) throw new Error('no chrome page target')
    const cdp = new Cdp(target.webSocketDebuggerUrl)
    await cdp.ready
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Browser.grantPermissions', {
      origin: APP_URL.replace(/\/$/, ''),
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    })
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: BOOT_SCRIPT })
    await cdp.send('Page.navigate', { url: APP_URL })
    await waitFor(cdp, 'document.readyState === "complete"', { label: 'app loaded' })
    await waitFor(cdp, 'Boolean(document.querySelector(".ai-framework-btn")) || Boolean(document.querySelector(".right-panel"))', { label: 'agent panel' })
    await sleep(1200)

    const agentTabSelected = await evaluate(cdp, 'document.getElementById("right-panel-tab-agent")?.getAttribute("aria-selected")')
    check('non-admin defaults to the Agent tab', agentTabSelected === 'true', String(agentTabSelected))
    check('real agent panel rendered for a non-admin', await evaluate(cdp, 'Boolean(document.querySelector(".ai-framework-btn")) && !document.querySelector(".agent-placeholder")'))

    await evaluate(cdp, 'document.querySelector(".ai-framework-btn").click()')
    await waitFor(cdp, 'document.querySelectorAll(".ai-framework-item").length > 0', { label: 'framework menu' })
    const currentLabel = await evaluate(cdp, 'document.querySelector(".ai-framework-label")?.textContent ?? ""')
    check('default stack is Vanilla for a non-admin', currentLabel.includes('Vanilla'), currentLabel)
    const locked = await evaluate(cdp, 'Array.from(document.querySelectorAll(".ai-framework-item")).filter((el) => el.disabled).map((el) => el.textContent)')
    check('every non-vanilla stack is disabled with Admin only', locked.length === 7 && locked.every((text) => text.includes('Admin only')), `locked=${locked.length}`)
    const vanillaItem = await evaluate(cdp, 'Array.from(document.querySelectorAll(".ai-framework-item")).find((el) => el.textContent.includes("Vanilla"))?.disabled')
    check('vanilla stack stays selectable', vanillaItem === false, String(vanillaItem))
    await evaluate(cdp, 'document.body.click()')

    await evaluate(cdp, 'document.querySelector("[aria-label=\\"Settings\\"]").click()')
    await waitFor(cdp, 'Boolean(document.querySelector(".settings-nav"))', { label: 'settings modal' })
    const settingsNav = await evaluate(cdp, 'Array.from(document.querySelectorAll(".settings-nav-item")).map((el) => el.textContent)')
    check('Settings shows AI Assistant for a non-admin', settingsNav.some((text) => /AI Assistant/i.test(text)), settingsNav.join(' | '))
    check('Settings shows Strict Rules for a non-admin', settingsNav.some((text) => /Strict Rules/i.test(text)), settingsNav.join(' | '))
    await evaluate(cdp, 'document.querySelector(".settings-modal-close")?.click() ?? document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))')
    await sleep(400)

    await evaluate(cdp, 'document.querySelector("[aria-label=\\"Help\\"]").click()')
    await waitFor(cdp, 'Boolean(document.querySelector(".help-nav"))', { label: 'help modal' })
    const helpNav = await evaluate(cdp, 'Array.from(document.querySelectorAll(".help-nav-item")).map((el) => el.textContent)')
    check('Help lists the Save your work topic', helpNav.some((text) => text === 'Save your work'), helpNav.join(' | '))

    await evaluate(cdp, 'Array.from(document.querySelectorAll(".help-nav-item")).find((el) => el.textContent === "Save your work").click()')
    await waitFor(cdp, 'document.querySelectorAll(".help-code").length > 0', { label: 'save topic commands' })
    const commands = await evaluate(cdp, 'Array.from(document.querySelectorAll(".help-code-text")).map((el) => el.textContent)')
    check('save topic shows the git commands', ['git init', 'git add .', 'git commit -m "save"', 'git remote add origin <your-repo-url>', 'git push -u origin main'].every((cmd) => commands.includes(cmd)), commands.join(' | '))
    const copyButtons = await evaluate(cdp, 'document.querySelectorAll(".help-copy-btn").length')
    check('save topic commands have Copy buttons', copyButtons >= 5, `copyButtons=${copyButtons}`)
    const copyPoint = await evaluate(cdp, '(() => { const el = document.querySelector(".help-copy-btn"); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()')
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: copyPoint.x, y: copyPoint.y, button: 'left', clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: copyPoint.x, y: copyPoint.y, button: 'left', clickCount: 1 })
    await waitFor(cdp, 'document.querySelector(".help-copy-btn")?.textContent.includes("Copied")', { timeout: 4000, label: 'copy feedback' }).catch(() => {})
    const copied = await evaluate(cdp, 'document.querySelector(".help-copy-btn")?.textContent ?? ""')
    check('Copy button reports Copied', copied.includes('Copied'), copied.trim())

    await evaluate(cdp, 'Array.from(document.querySelectorAll(".help-nav-item")).find((el) => el.textContent === "Freebuff").click()')
    await waitFor(cdp, 'document.querySelector(".help-content")?.textContent.includes("Save your work")', { label: 'freebuff pointer' })
    check('Freebuff topic points to Save your work', true)

    await evaluate(cdp, 'localStorage.setItem("cm-test-role", "admin")')
    await cdp.send('Page.reload', { ignoreCache: false })
    await waitFor(cdp, 'Boolean(document.querySelector(".ai-framework-btn"))', { label: 'admin agent panel' })
    await sleep(800)
    await evaluate(cdp, 'document.querySelector(".ai-framework-btn").click()')
    await waitFor(cdp, 'document.querySelectorAll(".ai-framework-item").length > 0', { label: 'admin framework menu' })
    const adminLocked = await evaluate(cdp, 'Array.from(document.querySelectorAll(".ai-framework-item")).filter((el) => el.disabled).length')
    check('admin can select every stack', adminLocked === 0, `locked=${adminLocked}`)

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
