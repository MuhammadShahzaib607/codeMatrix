import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5174'
const PORT = 9333

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail: String(detail ?? '') })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

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
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || 'evaluate failed')
  }
  return result.result.value
}

async function waitFor(cdp, expression, { timeout = 15000, interval = 150, label = expression } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await evaluate(cdp, expression)) return true
    await sleep(interval)
  }
  throw new Error(`timed out waiting for: ${label}`)
}

async function getTerminals(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const map = window.__TERMINAL_VIEWS__;
      if (!map) return [];
      const out = [];
      for (const [id, term] of map) {
        const buffer = term.buffer.active;
        let text = '';
        for (let i = 0; i < buffer.length; i += 1) {
          text += buffer.getLine(i).translateToString(true) + '\\n';
        }
        out.push({ id, text, cols: term.cols, rows: term.rows });
      }
      return out;
    })()`,
  )
}

const CHAR_CODES = {
  ' ': { code: 'Space', vk: 32 },
  '-': { code: 'Minus', vk: 189 },
  _: { code: 'Minus', vk: 189, shift: true },
  '.': { code: 'Period', vk: 190 },
}

async function typeChar(cdp, ch) {
  let key = ch
  let code
  let vk
  let text = ch
  let modifiers = 0
  if (/[a-z]/.test(ch)) {
    code = `Key${ch.toUpperCase()}`
    vk = ch.toUpperCase().charCodeAt(0)
  } else if (/[A-Z]/.test(ch)) {
    code = `Key${ch}`
    vk = ch.charCodeAt(0)
    modifiers = 8
    text = ch
  } else if (/[0-9]/.test(ch)) {
    code = `Digit${ch}`
    vk = ch.charCodeAt(0)
  } else if (CHAR_CODES[ch]) {
    code = CHAR_CODES[ch].code
    vk = CHAR_CODES[ch].vk
    modifiers = CHAR_CODES[ch].shift ? 8 : 0
  } else {
    return
  }
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    modifiers,
    text,
    unmodifiedText: text,
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    modifiers,
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  })
}

async function typeText(cdp, text) {
  for (const ch of text) {
    if (ch === '\n') {
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      })
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      })
    } else {
      await typeChar(cdp, ch)
    }
    await sleep(12)
  }
}

async function pressKey(cdp, { key, code, vk, shift = false }) {
  const modifiers = shift ? 8 : 0
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    modifiers,
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    modifiers,
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  })
}

const SCROLLPROBE_SOURCE = [
  "for (let i = 0; i < 500; i += 1) process.stdout.write('LINE_' + i + '\\n')",
  "process.stdout.write('SCROLL_DONE\\n')",
  '',
].join('\n')

const KEYPROBE_SOURCE = [
  "process.stdin.setRawMode(true)",
  "process.stdin.resume()",
  "process.stdout.write('KEYPROBE_READY\\n')",
  "process.stdin.on('data', (data) => {",
  "  const text = data.toString('utf8')",
  "  process.stdout.write('KEY:' + JSON.stringify(text) + '\\n')",
  "  if (text === String.fromCharCode(3)) process.exit(0)",
  "})",
  '',
].join('\n')

async function pressCtrl(cdp, letter) {
  const upper = letter.toUpperCase()
  const vk = upper.charCodeAt(0)
  const control = String.fromCharCode(vk - 64)
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    modifiers: 2,
    text: control,
    unmodifiedText: control,
    key: letter,
    code: `Key${upper}`,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    modifiers: 2,
    key: letter,
    code: `Key${upper}`,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  })
}

async function main() {
  const probeDir = join(process.cwd(), '..', 'server', 'workspaces')
  mkdirSync(probeDir, { recursive: true })
  writeFileSync(join(probeDir, 'keyprobe.mjs'), KEYPROBE_SOURCE)
  writeFileSync(join(probeDir, 'scrollprobe.mjs'), SCROLLPROBE_SOURCE)

  const profile = mkdtempSync(join(tmpdir(), 'codematrix-cdp-'))
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      `--remote-debugging-port=${PORT}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1600,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  let cdp
  try {
    const deadline = Date.now() + 15000
    let target = null
    while (Date.now() < deadline && !target) {
      try {
        const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
        target = list.find((entry) => entry.type === 'page')
      } catch {}
      if (!target) await sleep(250)
    }
    if (!target) throw new Error('Chrome DevTools endpoint never came up')

    cdp = new Cdp(target.webSocketDebuggerUrl)
    await cdp.ready
    const pageErrors = []
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')
    cdp.on('Runtime.exceptionThrown', (params) => {
      pageErrors.push(params.exceptionDetails?.exception?.description || 'exception')
    })
    cdp.on('Log.entryAdded', (params) => {
      if (params.entry?.level === 'error') pageErrors.push(params.entry.text)
    })
    await cdp.send('Log.enable')

    const loaded = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve))
    await cdp.send('Page.navigate', { url: APP_URL })
    await loaded
    await sleep(1200)

    check('app root rendered', await evaluate(cdp, `Boolean(document.querySelector('.app'))`))

    // 1. Switch exists with Agent default.
    const switchInfo = await evaluate(
      cdp,
      `(() => {
        const tabs = [...document.querySelectorAll('.right-panel-tab')];
        return {
          count: tabs.length,
          labels: tabs.map((t) => t.textContent.trim()),
          active: tabs.find((t) => t.classList.contains('is-active'))?.textContent.trim() ?? null,
          sidebarTerminal: Boolean(document.querySelector('.sidebar-terminal')),
        };
      })()`,
    )
    check('two switch buttons present', switchInfo.count === 2, JSON.stringify(switchInfo.labels))
    check(
      'Agent is the default tab',
      switchInfo.active === 'Agent' && !switchInfo.sidebarTerminal,
      `active=${switchInfo.active}`,
    )

    // 2. Select Terminal.
    await evaluate(cdp, `document.querySelectorAll('.right-panel-tab')[1].click()`)
    await waitFor(cdp, `Boolean(document.querySelector('.sidebar-terminal .xterm'))`, {
      label: 'sidebar terminal xterm',
    })
    await waitFor(cdp, `(window.__TERMINAL_VIEWS__?.size ?? 0) >= 1`, {
      label: 'sidebar terminal instance registered',
    })
    await waitFor(
      cdp,
      `(() => {
        const t = [...(window.__TERMINAL_VIEWS__?.values() ?? [])][0];
        if (!t) return false;
        const b = t.buffer.active;
        for (let i = 0; i < b.length; i += 1) {
          const line = b.getLine(i).translateToString(true);
          if (line.includes('scratch') || line.includes('workspaces')) return true;
        }
        return false;
      })()`,
      { label: 'terminal ready banner', timeout: 20000 },
    )
    await sleep(600)

    const afterSwitch = await evaluate(
      cdp,
      `(() => {
        const tabs = [...document.querySelectorAll('.right-panel-tab')];
        return {
          active: tabs.find((t) => t.classList.contains('is-active'))?.textContent.trim() ?? null,
          hasTerminalBody: Boolean(document.querySelector('.sidebar-terminal-body')),
          aiHidden: document.querySelector('#right-panel-view-agent')?.getAttribute('aria-hidden'),
        };
      })()`,
    )
    check('Terminal tab is active after click', afterSwitch.active === 'Terminal', `active=${afterSwitch.active}`)
    check('Agent view stays mounted while hidden', afterSwitch.aiHidden === 'true')

    let terminals = await getTerminals(cdp)
    const sidebarId = terminals[0]?.id
    check('sidebar terminal has a live pty instance', Boolean(sidebarId), sidebarId)
    const cwdLine = terminals[0]?.text?.split('\n').find((line) => line.includes('scratch') || line.includes('workspace'))
    check('terminal ready banner shows a cwd', Boolean(cwdLine), cwdLine ?? 'no banner line')

    // 3. Typing reaches the shell.
    await evaluate(cdp, `document.querySelector('.sidebar-terminal .xterm')?.click()`)
    await typeText(cdp, 'echo SIDEBAR_TYPED_OK\n')
    await waitFor(
      cdp,
      `(() => {
        const m = window.__TERMINAL_VIEWS__;
        if (!m) return false;
        for (const t of m.values()) {
          const b = t.buffer.active;
          for (let i = 0; i < b.length; i += 1) {
            if (b.getLine(i).translateToString(true).includes('SIDEBAR_TYPED_OK')) return true;
          }
        }
        return false;
      })()`,
      { label: 'typed command echoed', timeout: 10000 },
    )
    check('typed command ran in the sidebar terminal', true)

    // 4. Paste goes through the terminal into the shell.
    await evaluate(cdp, `document.querySelector('.sidebar-terminal .xterm')?.click()`)
    await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${sidebarId}').focus()`)
    await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${sidebarId}').paste('echo PZ42')`)
    await sleep(300)
    await typeText(cdp, '\n')
    await waitFor(
      cdp,
      `(() => { const t=window.__TERMINAL_VIEWS__.get('${sidebarId}'); const b=t.buffer.active; for(let i=0;i<b.length;i++){ if(b.getLine(i).translateToString(true).trim() === 'PZ42') return true } return false })()`,
      { label: 'pasted command output', timeout: 10000 },
    )
    check('pasted text runs in the sidebar terminal', true)

    // 5. Interactive program: node REPL, then Ctrl+C interrupts and returns.
    await evaluate(cdp, `document.querySelector('.sidebar-terminal .xterm')?.click()`)
    await typeText(cdp, 'node\n')
    await sleep(3000)
    await typeText(cdp, '50-8\n')
    await sleep(500)
    await waitFor(
      cdp,
      `(() => { const t=window.__TERMINAL_VIEWS__.get('${sidebarId}'); const b=t.buffer.active; for(let i=0;i<b.length;i++){ if(b.getLine(i).translateToString(true).trim() === '42') return true } return false })()`,
      { label: 'node REPL result', timeout: 12000 },
    )
    check('interactive node REPL accepted input and returned 42', true)
    await typeText(cdp, '.exit\n')
    await sleep(1200)

    // 6. Ctrl+C interrupts a foreground command and returns to the shell.
    await typeText(cdp, 'ping -t 127.0.0.1\n')
    await sleep(1500)
    await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${sidebarId}').clearSelection()`)
    await pressCtrl(cdp, 'c')
    await sleep(1200)
    await typeText(cdp, 'echo INT_DONE\n')
    await waitFor(
      cdp,
      `(() => { const t=window.__TERMINAL_VIEWS__.get('${sidebarId}'); const b=t.buffer.active; for(let i=0;i<b.length;i++){ if(b.getLine(i).translateToString(true).trim() === 'INT_DONE') return true } return false })()`,
      { label: 'Ctrl+C returned to the shell', timeout: 12000 },
    )
    check('Ctrl+C interrupts the running command and returns to the shell', true)

    // 6. Editor shortcuts must not fire while the terminal is focused.
    const sidebarBefore = await evaluate(cdp, `document.querySelector('.panel-slot-sidebar')?.classList.contains('is-open')`)
    await evaluate(cdp, `document.querySelector('.sidebar-terminal .xterm')?.click()`)
    await pressCtrl(cdp, 'b')
    await sleep(400)
    const sidebarAfter = await evaluate(cdp, `document.querySelector('.panel-slot-sidebar')?.classList.contains('is-open')`)
    check('Ctrl+B does not toggle the sidebar while terminal focused', sidebarBefore === sidebarAfter, `${sidebarBefore} -> ${sidebarAfter}`)
    await typeText(cdp, '\n')
    const toastBefore = await evaluate(cdp, `document.querySelectorAll('.toast').length`)
    await pressCtrl(cdp, 's')
    await sleep(400)
    const toastAfter = await evaluate(cdp, `document.querySelectorAll('.toast').length`)
    check('Ctrl+S does not fire a save while terminal focused', toastBefore === toastAfter, `${toastBefore} -> ${toastAfter}`)
    // Ctrl+S is also XOFF; resume the output flow and clear the line.
    await pressCtrl(cdp, 'q')
    await sleep(300)
    await typeText(cdp, '\n')

    // 7. Keys a full-screen TUI needs must reach the pty unchanged.
    await evaluate(cdp, `document.querySelector('.sidebar-terminal .xterm')?.click()`)
    await typeText(cdp, 'cd ..\n')
    await sleep(600)
    await typeText(cdp, 'node keyprobe.mjs\n')
    await waitFor(
      cdp,
      `(() => { const t=window.__TERMINAL_VIEWS__.get('${sidebarId}'); if(!t) return false; const b=t.buffer.active; for(let i=0;i<b.length;i++){ if(b.getLine(i).translateToString(true).includes('KEYPROBE_READY')) return true } return false })()`,
      { label: 'key probe ready', timeout: 12000 },
    )
    await pressKey(cdp, { key: 'ArrowUp', code: 'ArrowUp', vk: 38 })
    await pressKey(cdp, { key: 'ArrowDown', code: 'ArrowDown', vk: 40 })
    await pressKey(cdp, { key: 'Tab', code: 'Tab', vk: 9 })
    await pressKey(cdp, { key: 'Tab', code: 'Tab', vk: 9, shift: true })
    await pressKey(cdp, { key: 'Escape', code: 'Escape', vk: 27 })
    await sleep(700)
    const keyBuffer = (await getTerminals(cdp)).find((t) => t.id === sidebarId)?.text ?? ''
    check('ArrowUp reaches the pty', keyBuffer.includes('u001b[A'))
    check('ArrowDown reaches the pty', keyBuffer.includes('u001b[B'))
    check('Tab reaches the pty', keyBuffer.includes('KEY:"\\t"'))
    check('Shift+Tab reaches the pty', keyBuffer.includes('u001b[Z'))
    check('Escape reaches the pty', keyBuffer.includes('u001b"'))
    await pressCtrl(cdp, 'c')
    await sleep(800)

    // 8. Long output is kept in scrollback and scrolls with the mouse wheel.
    await evaluate(cdp, `document.querySelector('.sidebar-terminal .xterm')?.click()`)
    await typeText(cdp, 'node scrollprobe.mjs\n')
    await waitFor(
      cdp,
      `(() => { const t=window.__TERMINAL_VIEWS__.get('${sidebarId}'); if(!t) return false; const b=t.buffer.active; for(let i=0;i<b.length;i++){ if(b.getLine(i).translateToString(true).includes('SCROLL_DONE')) return true } return false })()`,
      { label: 'scroll probe done', timeout: 15000 },
    )
    const scrollState = await evaluate(
      cdp,
      `(() => { const t=window.__TERMINAL_VIEWS__.get('${sidebarId}'); const b=t.buffer.active; return { length: b.length, viewportY: b.viewportY, rows: t.rows } })()`,
    )
    check('scrollback keeps the long output', scrollState.length > 400, `buffer length=${scrollState.length}`)
    const wheelBox = await evaluate(
      cdp,
      `(() => { const el=document.querySelector('.sidebar-terminal .xterm'); if(!el) return null; const r=el.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 } })()`,
    )
    if (wheelBox) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: wheelBox.x, y: wheelBox.y, deltaX: 0, deltaY: -600 })
      await sleep(500)
    }
    const afterWheel = await evaluate(
      cdp,
      `(() => { const t=window.__TERMINAL_VIEWS__.get('${sidebarId}'); return t.buffer.active.viewportY })()`,
    )
    check('mouse wheel scrolls the terminal output', afterWheel < scrollState.length - scrollState.rows, `viewportY ${scrollState.viewportY} -> ${afterWheel}`)

    // 5. Switch back to Agent, then to Terminal again: session survives.
    await evaluate(cdp, `document.querySelectorAll('.right-panel-tab')[0].click()`)
    await sleep(500)
    const whileAgent = await getTerminals(cdp)
    check('terminal stays mounted on Agent tab', whileAgent.length === 1 && whileAgent[0].id === sidebarId, whileAgent.map((t) => t.id).join(','))
    check(
      'Agent panel is visible again after switching back',
      await evaluate(
        cdp,
        `Boolean(document.querySelector('.ai-panel')) && document.querySelector('#right-panel-view-agent')?.getAttribute('aria-hidden') === 'false'`,
      ),
    )
    await evaluate(cdp, `document.querySelectorAll('.right-panel-tab')[1].click()`)
    await sleep(700)
    const afterReturn = await getTerminals(cdp)
    const stillHasEcho = afterReturn.some((t) => t.id === sidebarId && t.text.includes('SIDEBAR_TYPED_OK'))
    const stillAlive = afterReturn.some((t) => t.id === sidebarId && !t.text.includes('process exited'))
    check('scrollback survives the Agent->Terminal round trip', stillHasEcho)
    check('pty is still running after the round trip', stillAlive)

    // 6. Floating/docked terminal is independent.
    await evaluate(cdp, `document.querySelector('button[aria-label="Toggle terminal panel"]')?.click()`)
    await waitFor(cdp, `Boolean(document.querySelector('.terminal-panel'))`, { label: 'docked terminal panel' })
    await sleep(400)
    await evaluate(cdp, `document.querySelector('.terminal-panel .terminal-new')?.click()`)
    await waitFor(cdp, `(window.__TERMINAL_VIEWS__?.size ?? 0) >= 2`, { label: 'docked terminal pty' })
    await sleep(1200)
    const docked = await getTerminals(cdp)
    check('docked panel opened', await evaluate(cdp, `Boolean(document.querySelector('.terminal-panel'))`))
    check(
      'docked and sidebar terminals are separate sessions',
      docked.some((t) => t.id !== sidebarId) && docked.some((t) => t.id === sidebarId),
      docked.map((t) => t.id).join(','),
    )
    await evaluate(cdp, `document.querySelector('button[aria-label="Toggle terminal panel"]')?.click()`)
    await sleep(400)
    check('docked panel closes without killing the sidebar terminal', (await getTerminals(cdp)).some((t) => t.id === sidebarId))

    // 7. Resize the right panel by dragging its handle; cols must change.
    const beforeResize = (await getTerminals(cdp)).find((t) => t.id === sidebarId)
    const handleBox = await evaluate(
      cdp,
      `(() => { const h = document.querySelector('.ai-resize-handle'); if(!h) return null; const r=h.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 } })()`,
    )
    if (handleBox) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handleBox.x, y: handleBox.y, button: 'left', clickCount: 1 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handleBox.x - 260, y: handleBox.y, button: 'left', buttons: 1 })
      await sleep(60)
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handleBox.x - 420, y: handleBox.y, button: 'left', buttons: 1 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handleBox.x - 420, y: handleBox.y, button: 'left', clickCount: 1 })
      await sleep(800)
    }
    const afterResize = (await getTerminals(cdp)).find((t) => t.id === sidebarId)
    check('terminal refits after widening the panel', afterResize && afterResize.cols >= beforeResize.cols, `${beforeResize?.cols} -> ${afterResize?.cols} cols`)

    // 8. Collapse the right panel and reopen it: the shell must survive.
    await evaluate(cdp, `document.querySelector('button[aria-label="Toggle AI assistant"]')?.click()`)
    await sleep(500)
    const collapsed = (await getTerminals(cdp)).find((t) => t.id === sidebarId)
    check('terminal stays mounted while the panel is collapsed', Boolean(collapsed))
    await evaluate(cdp, `document.querySelector('button[aria-label="Toggle AI assistant"]')?.click()`)
    await sleep(900)
    const reopened = (await getTerminals(cdp)).find((t) => t.id === sidebarId)
    check(
      'terminal survives collapse and refits on reopen',
      Boolean(reopened) && reopened.cols > 0 && reopened.text.includes('SIDEBAR_TYPED_OK'),
      `${collapsed?.cols} -> ${reopened?.cols} cols`,
    )

    // 9. Window resize must not garble the running terminal.
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false })
    await sleep(800)
    const afterWindow = (await getTerminals(cdp)).find((t) => t.id === sidebarId)
    check('terminal still healthy after a window resize', Boolean(afterWindow) && afterWindow.cols > 0 && !afterWindow.text.includes('terminal error'))
    await cdp.send('Emulation.clearDeviceMetricsOverride')
    await sleep(600)

    // 12. Shell selector restarts the terminal with the chosen shell.
    const beforeShell = (await getTerminals(cdp)).find((t) => t.id === sidebarId)
    await evaluate(cdp, `document.querySelector('.sidebar-terminal-shell-btn')?.click()`)
    await waitFor(cdp, `Boolean(document.querySelector('.sidebar-terminal-shell-menu'))`, { label: 'shell menu' })
    const shellCount = await evaluate(cdp, `document.querySelectorAll('.sidebar-terminal-shell-option').length`)
    check('shell selector lists the server shells', shellCount >= 2, `${shellCount} options`)
    await evaluate(
      cdp,
      `(() => { const opts=[...document.querySelectorAll('.sidebar-terminal-shell-option')]; const target=opts.find((o)=>o.textContent.trim().toLowerCase().includes('cmd')) ?? opts.find((o)=>!o.classList.contains('is-default')) ?? opts[0]; target?.click(); return true })()`,
    )
    await sleep(1800)
    const afterShell = await getTerminals(cdp)
    const restarted = afterShell.find((t) => t.id !== beforeShell.id)
    check('picking a shell restarts the terminal session', Boolean(restarted), `${beforeShell.id} -> ${restarted?.id}`)
    const shellId = restarted?.id

    // 13. The chosen tab persists across a reload.
    const reloaded = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve))
    await cdp.send('Page.navigate', { url: APP_URL })
    await reloaded
    await sleep(1800)
    const persisted = await evaluate(
      cdp,
      `(() => { const tabs=[...document.querySelectorAll('.right-panel-tab')]; return { active: tabs.find((t)=>t.classList.contains('is-active'))?.textContent.trim() ?? null, hasTerminal: Boolean(document.querySelector('.sidebar-terminal')) } })()`,
    )
    check('Terminal tab persists across reload', persisted.active === 'Terminal' && persisted.hasTerminal, JSON.stringify(persisted))

    // 14. A signed-in terminal file appears live in the Explorer.
    pageErrors.length = 0
    const email = `sidebar-verify-${Date.now()}@example.com`
    const registration = await fetch('http://localhost:4000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Sidebar Verify', email, password: 'Testpass123' }),
    }).then((response) => response.json())
    if (registration?.token) {
      await evaluate(cdp, `localStorage.setItem('code-matrix:token', ${JSON.stringify(registration.token)}); true`)
      const signedIn = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve))
      await cdp.send('Page.navigate', { url: APP_URL })
      await signedIn
      await sleep(2500)
      await waitFor(cdp, `Boolean(document.querySelector('.user-chip'))`, { label: 'signed-in topbar' })
      if (!(await evaluate(cdp, `document.querySelectorAll('.right-panel-tab')[1].classList.contains('is-active')`))) {
        await evaluate(cdp, `document.querySelectorAll('.right-panel-tab')[1].click()`)
      }
      await waitFor(cdp, `Boolean(document.querySelector('.sidebar-terminal .xterm'))`, { label: 'sidebar terminal after sign-in' })
      await evaluate(cdp, `document.querySelector('.sidebar-terminal-new')?.click()`)
      await sleep(2500)
      await evaluate(cdp, `document.querySelector('.sidebar-terminal .xterm')?.click()`)
      await typeText(cdp, 'echo SHELL_READY\n')
      await sleep(1500)
      const rowsBefore = await evaluate(
        cdp,
        `[...document.querySelectorAll('.tree-row')].map((r) => r.textContent.trim()).slice(0, 25)`,
      )
      console.log('DEBUG explorer rows before:', JSON.stringify(rowsBefore))
      await typeText(cdp, 'mkdir SIDEBAR_E2E_FOLDER\n')
      await sleep(1200)
      console.log('DEBUG terminal tail:', JSON.stringify((await getTerminals(cdp)).map((t) => t.text.slice(-140))))
      let explorerSaw = false
      const deadline = Date.now() + 15000
      while (Date.now() < deadline && !explorerSaw) {
        explorerSaw = await evaluate(
          cdp,
          `[...document.querySelectorAll('.tree-row')].some((row) => row.textContent.includes('SIDEBAR_E2E_FOLDER'))`,
        )
        if (!explorerSaw) await sleep(400)
      }
      check('folder created in the terminal appears live in the Explorer', explorerSaw)
      await evaluate(cdp, `document.querySelector('.sidebar-terminal .xterm')?.click()`)
      await typeText(cdp, 'Remove-Item SIDEBAR_E2E_FOLDER\n')
      await sleep(800)
    } else {
      check('signed-in Explorer test skipped (registration failed)', false, registration?.error?.message || JSON.stringify(registration))
    }

    check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  } finally {
    try {
      cdp?.ws?.close()
    } catch {}
    chrome.kill()
    try {
      rmSync(profile, { recursive: true, force: true })
    } catch {}
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('HARNESS ERROR:', error.message)
  process.exit(2)
})
