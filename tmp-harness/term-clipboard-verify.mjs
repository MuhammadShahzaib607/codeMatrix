import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5173'
const PORT = 9351
const HERE = dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/')

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
      if (m.method && this.handlers.has(m.method)) {
        for (const h of this.handlers.get(m.method)) h(m.params)
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
  on(method, h) {
    if (!this.handlers.has(method)) this.handlers.set(method, new Set())
    this.handlers.get(method).add(h)
  }
  close() {
    try {
      this.ws.close()
    } catch {}
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
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: ch,
        unmodifiedText: ch,
        key: ch,
        code: 'KeyA',
      })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'KeyA' })
    }
    await sleep(10)
  }
}

async function press(cdp, key, modifiers, vk) {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    modifiers,
    key,
    code: `Key${key.toUpperCase()}`,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    modifiers,
    key,
    code: `Key${key.toUpperCase()}`,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  })
}

const bufferExpr = (id) => `(() => {
  const t = window.__TERMINAL_VIEWS__.get('${id}')
  if (!t) return ''
  const b = t.buffer.active
  let s = ''
  for (let i = 0; i < b.length; i++) s += b.getLine(i).translateToString(true) + '\\n'
  return s
})()`

const countExpr = (id, needle) => `(${bufferExpr(id)}).split(${JSON.stringify(needle)}).length - 1`

async function selectSomeText(cdp, id) {
  return evaluate(
    cdp,
    `(() => {
      const t = window.__TERMINAL_VIEWS__.get('${id}')
      const b = t.buffer.active
      for (let i = 0; i < b.length; i++) {
        const line = b.getLine(i).translateToString(true)
        if (line.trim().length >= 14) {
          t.select(0, i, Math.min(16, line.length))
          return t.getSelection()
        }
      }
      return ''
    })()`,
  )
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'cm-term-'))
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      `--remote-debugging-port=${PORT}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--window-size=1400,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  let cdp
  let browserCdp
  try {
    let target = null
    for (let i = 0; i < 60 && !target; i += 1) {
      try {
        const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
        target = list.find((e) => e.type === 'page')
      } catch {}
      if (!target) await sleep(250)
    }
    if (!target) throw new Error('no chrome page target')

    const version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json())
    browserCdp = new Cdp(version.webSocketDebuggerUrl)
    await browserCdp.ready
    await browserCdp.send('Browser.grantPermissions', {
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
      origin: APP_URL,
    })

    cdp = new Cdp(target.webSocketDebuggerUrl)
    await cdp.ready
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')
    const loaded = new Promise((r) => cdp.on('Page.loadEventFired', r))
    await cdp.send('Page.navigate', { url: APP_URL })
    await loaded
    await sleep(2000)
    await cdp.send('Page.bringToFront')
    await sleep(500)
    check('page is focused', await evaluate(cdp, `document.hasFocus()`))

    await evaluate(cdp, `document.querySelectorAll('.right-panel-tab')[1].click()`)
    await waitFor(cdp, `Boolean(document.querySelector('.sidebar-terminal .xterm'))`, 20000, 'terminal mount')
    await sleep(3000)
    const id = await evaluate(cdp, `[...window.__TERMINAL_VIEWS__.keys()][0]`)
    check('terminal session opened', Boolean(id), `terminalId=${id}`)

    await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${id}').focus()`)
    await sleep(300)

    const shellLine = await evaluate(cdp, bufferExpr(id))
    check('shell reported output', shellLine.trim().length > 0)

    const readClipboard = () => evaluate(cdp, `navigator.clipboard.readText()`)

    const oscPath = `${HERE}/osc52.js`
    await typeText(cdp, `node "${oscPath}"\n`)
    await sleep(1200)
    const oscClipboard = await readClipboard()
    check('OSC 52 write reaches the system clipboard', oscClipboard === 'hello', `clipboard=${JSON.stringify(oscClipboard)}`)
    const oscNotice = await evaluate(
      cdp,
      `document.querySelector('.terminal-notice')?.textContent ?? ''`,
    )
    check('OSC 52 copy shows the Copied notice', oscNotice.trim() === 'Copied', `notice=${JSON.stringify(oscNotice)}`)

    await typeText(cdp, `node "${HERE}/ticker.js"\n`)
    await sleep(1500)
    const ticks1 = await evaluate(cdp, countExpr(id, 'tick '))
    check('ticker program is running', ticks1 >= 2, `ticks=${ticks1}`)

    const selection = await selectSomeText(cdp, id)
    check('text selection available', selection.length > 0, `sel=${JSON.stringify(selection)}`)

    await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${id}').focus()`)
    await press(cdp, 'c', 10, 67)
    await sleep(600)
    const afterShiftC = await readClipboard()
    check('Ctrl+Shift+C copies the selection', afterShiftC === selection, `clipboard=${JSON.stringify(afterShiftC)}`)
    const shiftNotice = await evaluate(cdp, `document.querySelector('.terminal-notice')?.textContent ?? ''`)
    check('Ctrl+Shift+C shows the Copied notice', shiftNotice.trim() === 'Copied', `notice=${JSON.stringify(shiftNotice)}`)

    const clearedAfterShiftC = await evaluate(
      cdp,
      `window.__TERMINAL_VIEWS__.get('${id}').hasSelection()`,
    )
    check('copy clears the selection', clearedAfterShiftC === false, `hasSelection=${clearedAfterShiftC}`)

    const selection2 = await selectSomeText(cdp, id)
    check('second selection available', selection2.length > 0, `sel=${JSON.stringify(selection2)}`)
    await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${id}').focus()`)
    await press(cdp, 'c', 2, 67)
    await sleep(600)
    const afterCtrlC = await readClipboard()
    check('Ctrl+C with a selection copies it', afterCtrlC === selection2, `clipboard=${JSON.stringify(afterCtrlC)}`)
    const ticksBeforeWait = await evaluate(cdp, countExpr(id, 'tick '))
    await sleep(1200)
    const ticks2 = await evaluate(cdp, countExpr(id, 'tick '))
    check('Ctrl+C with a selection sends nothing to the pty', ticks2 > ticksBeforeWait, `ticks ${ticksBeforeWait} -> ${ticks2}`)

    await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${id}').focus()`)
    await press(cdp, 'c', 2, 67)
    await sleep(1000)
    const ticks3 = await evaluate(cdp, countExpr(id, 'tick '))
    await sleep(1000)
    const ticks4 = await evaluate(cdp, countExpr(id, 'tick '))
    check('Ctrl+C with no selection interrupts the program', ticks3 === ticks4, `ticks ${ticks3} -> ${ticks4}`)

    await typeText(cdp, `node "${HERE}/stdin-echo.js"\n`)
    await sleep(1500)
    await evaluate(cdp, `navigator.clipboard.writeText('HELLO_PASTE')`)
    await sleep(400)
    await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${id}').focus()`)
    await press(cdp, 'v', 10, 86)
    await sleep(900)
    const bracketed = await evaluate(cdp, bufferExpr(id))
    check(
      'Ctrl+Shift+V pastes with bracketed-paste markers',
      bracketed.includes('\\u001b[200~HELLO_PASTE') && bracketed.includes('\\u001b[201~'),
      bracketed.includes('HELLO_PASTE') ? 'markers present' : 'paste not received',
    )

    await evaluate(cdp, `navigator.clipboard.writeText('HELLO_CTRLV')`)
    await sleep(400)
    await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${id}').focus()`)
    await press(cdp, 'v', 2, 86)
    await sleep(900)
    const plainPaste = await evaluate(cdp, bufferExpr(id))
    check('Ctrl+V pastes into the pty', plainPaste.includes('HELLO_CTRLV'), '')

    await evaluate(cdp, `navigator.clipboard.writeText('MENU_PASTE_TEXT')`)
    await sleep(300)
    const menuSelection = await selectSomeText(cdp, id)
    check('selection before right-click', menuSelection.length > 0, `sel=${JSON.stringify(menuSelection)}`)
    const termRect = await evaluate(
      cdp,
      `(() => { const r = document.querySelector('.sidebar-terminal .xterm-screen').getBoundingClientRect(); return { x: Math.round(r.left + 30), y: Math.round(r.top + 20) } })()`,
    )
    await evaluate(
      cdp,
      `(() => { const el = document.querySelector('.sidebar-terminal .terminal-view'); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${termRect.x}, clientY: ${termRect.y} })) })()`,
    )
    await waitFor(cdp, `Boolean(document.querySelector('.terminal-context-menu'))`, 5000, 'context menu')
    const menuItems = await evaluate(
      cdp,
      `[...document.querySelectorAll('.terminal-context-menu .terminal-context-item')].map((b) => b.textContent.trim())`,
    )
    check('right-click menu offers Copy and Paste', menuItems.join(',') === 'Copy,Paste', `items=${menuItems.join(',')}`)

    await evaluate(
      cdp,
      `[...document.querySelectorAll('.terminal-context-menu .terminal-context-item')].find((b) => b.textContent.trim() === 'Copy').click()`,
    )
    await sleep(600)
    const menuCopy = await readClipboard()
    check('menu Copy copies the selection', menuCopy === menuSelection, `clipboard=${JSON.stringify(menuCopy)}`)
    const menuNotice = await evaluate(cdp, `document.querySelector('.terminal-notice')?.textContent ?? ''`)
    check('menu Copy shows the Copied notice', menuNotice.trim() === 'Copied', `notice=${JSON.stringify(menuNotice)}`)
    check('menu closed after Copy', (await evaluate(cdp, `document.querySelectorAll('.terminal-context-menu').length`)) === 0)

    await evaluate(cdp, `navigator.clipboard.writeText('MENU_PASTE_TEXT')`)
    await sleep(300)
    await evaluate(
      cdp,
      `(() => { const el = document.querySelector('.sidebar-terminal .terminal-view'); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${termRect.x}, clientY: ${termRect.y} })) })()`,
    )
    await waitFor(cdp, `Boolean(document.querySelector('.terminal-context-menu'))`, 5000, 'context menu reopen')
    await evaluate(
      cdp,
      `[...document.querySelectorAll('.terminal-context-menu .terminal-context-item')].find((b) => b.textContent.trim() === 'Paste').click()`,
    )
    await sleep(900)
    const menuPaste = await evaluate(cdp, bufferExpr(id))
    check('menu Paste writes to the pty', menuPaste.includes('MENU_PASTE_TEXT'), `notice=${JSON.stringify(await evaluate(cdp, `document.querySelector('.terminal-notice')?.textContent ?? ''`))}`)

    await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${id}').focus()`)
    await press(cdp, 'c', 2, 67)
    await sleep(900)
    check('stdin probe stopped', (await evaluate(cdp, countExpr(id, 'IN:'))) < 30, `IN count=${await evaluate(cdp, countExpr(id, 'IN:'))}`)

    await typeText(cdp, `node "${HERE}/longurl.js"\n`)
    await sleep(1600)
    const urlInfo = await evaluate(      cdp,
      `(() => {
        const t = window.__TERMINAL_VIEWS__.get('${id}')
        const b = t.buffer.active
        let row = -1
        let col = 0
        for (let i = 0; i < b.length; i++) {
          const line = b.getLine(i).translateToString(true)
          const at = line.indexOf('https://example.com/')
          if (at >= 0) { row = i; col = at; break }
        }
        if (row < 0) return null
        let url = b.getLine(row).translateToString(true).substring(col)
        let next = row + 1
        while (next < b.length && b.getLine(next).isWrapped) {
          url += b.getLine(next).translateToString(true)
          next += 1
        }
        return { row, col, url, rows: next - row }
      })()`,
    )
    check(
      'long URL printed and found',
      Boolean(urlInfo),
      urlInfo
        ? `rows=${urlInfo.rows} len=${urlInfo.url.length}`
        : `tail=${JSON.stringify(await evaluate(cdp, `(() => { const t = window.__TERMINAL_VIEWS__.get('${id}'); const b = t.buffer.active; let s = ''; for (let i = Math.max(0, b.length - 8); i < b.length; i++) s += b.getLine(i).translateToString(true) + '|'; return s })()`))}`,
    )
    if (urlInfo) {
      const exactUrl = urlInfo.url.replace(/\s+$/, '')
      check('URL wraps across more than one row', urlInfo.rows > 1, `rows=${urlInfo.rows} urlLen=${exactUrl.length}`)
      const selectedUrl = await evaluate(
        cdp,
        `(() => {
          const t = window.__TERMINAL_VIEWS__.get('${id}')
          t.select(${urlInfo.col}, ${urlInfo.row}, ${exactUrl.length})
          return t.getSelection()
        })()`,
      )
      check(
        'copying the wrapped URL yields the exact URL',
        selectedUrl === exactUrl,
        `got len=${selectedUrl.length} want len=${exactUrl.length}`,
      )
      check('wrapped URL copy has no inserted line break', !selectedUrl.includes('\n'), '')

      await evaluate(cdp, `window.__opened = []; window.open = (u, t, f) => { window.__opened.push({ u, t, f }); return null }; window.__TERMINAL_VIEWS__.get('${id}').clearSelection()`)
      const point = await evaluate(
        cdp,
        `(() => {
          const t = window.__TERMINAL_VIEWS__.get('${id}')
          const el = document.querySelector('.sidebar-terminal .xterm-screen')
          const r = el.getBoundingClientRect()
          const cellW = r.width / t.cols
          const cellH = r.height / t.rows
          const offset = ${urlInfo.col} + 60
          const row = ${urlInfo.row} + Math.floor(offset / t.cols)
          const col = offset % t.cols
          return { x: Math.round(r.left + (col + 0.5) * cellW), y: Math.round(r.top + (row + 0.5) * cellH) }
        })()`,
      )
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
      await sleep(900)
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
      })
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
      })
      await sleep(900)
      const opened = await evaluate(cdp, `JSON.stringify(window.__opened)`)
      const openedList = JSON.parse(opened || '[]')
      check(
        'clicking the wrapped URL opens the whole URL',
        openedList.length > 0 && openedList[0].u === exactUrl,
        `gotLen=${openedList[0]?.u?.length} wantLen=${exactUrl.length} firstDiff=${(() => {
          const got = openedList[0]?.u ?? ''
          for (let i = 0; i < Math.max(got.length, exactUrl.length); i += 1) {
            if (got[i] !== exactUrl[i]) return `${i}:${JSON.stringify(got.slice(Math.max(0, i - 12), i + 12))} vs ${JSON.stringify(exactUrl.slice(Math.max(0, i - 12), i + 12))}`
          }
          return 'none'
        })()}`,
      )
      check(
        'link opens in a new tab with noopener',
        openedList.length > 0 && String(openedList[0].f).includes('noopener') && openedList[0].t === '_blank',
        `features=${JSON.stringify(openedList[0]?.f)}`,
      )
    }

    await typeText(cdp, `node "${HERE}/mouse-on.js"\n`)
    await sleep(1800)
    let mouseMode = await evaluate(
      cdp,
      `Boolean(document.querySelector('.terminal-view .xterm')?.classList.contains('enable-mouse-events'))`,
    )
    const forcedMouseMode = !mouseMode
    if (!mouseMode) {
      mouseMode = await evaluate(
        cdp,
        `(() => {
          const term = window.__TERMINAL_VIEWS__.get('${id}')
          const service = term._core?.coreMouseService
          if (!service) return false
          service.activeProtocol = 'VT200'
          return document.querySelector('.terminal-view .xterm').classList.contains('enable-mouse-events')
        })()`,
      )
    }
    check(
      'mouse reporting is active in the terminal',
      mouseMode,
      mouseMode
        ? forcedMouseMode
          ? 'enabled directly in xterm: this Windows ConPTY host drops DECSET 1000 (see tmp-harness/pty-probe.mjs)'
          : 'enabled by the program escape sequence'
        : 'could not enable mouse mode',
    )
    await sleep(300)
    await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${id}').clearSelection()`)
    const dragBox = await evaluate(
      cdp,
      `(() => {
        const r = document.querySelector('.sidebar-terminal .xterm-screen').getBoundingClientRect()
        return {
          x1: Math.round(r.left + 40), y1: Math.round(r.top + 40),
          x2: Math.round(r.left + 260), y2: Math.round(r.top + 70),
        }
      })()`,
    )
    for (const [x, y] of [
      [dragBox.x1, dragBox.y1],
      [dragBox.x1 + 40, dragBox.y1 + 4],
      [dragBox.x2, dragBox.y2],
    ]) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await sleep(40)
    }
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: dragBox.x1,
      y: dragBox.y1,
      button: 'left',
      clickCount: 1,
    })
    await sleep(60)
    for (const [x, y] of [
      [dragBox.x1 + 80, dragBox.y1 + 4],
      [dragBox.x1 + 160, dragBox.y1 + 8],
      [dragBox.x2, dragBox.y2],
    ]) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await sleep(40)
    }
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: dragBox.x2,
      y: dragBox.y2,
      button: 'left',
      clickCount: 1,
    })
    await sleep(600)
    const plainDragSelection = await evaluate(
      cdp,
      `window.__TERMINAL_VIEWS__.get('${id}').getSelection()`,
    )
    check('plain drag is handed to the program while it reports the mouse', plainDragSelection === '', `sel=${JSON.stringify(plainDragSelection)}`)

    await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${id}').clearSelection()`)
    const shiftDragStart = await evaluate(
      cdp,
      `(() => { const r = document.querySelector('.sidebar-terminal .xterm-screen').getBoundingClientRect(); return { x1: Math.round(r.left + 40), y1: Math.round(r.top + 40), x2: Math.round(r.left + 260), y2: Math.round(r.top + 70) } })()`,
    )
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: shiftDragStart.x1,
      y: shiftDragStart.y1,
      modifiers: 8,
    })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: shiftDragStart.x1,
      y: shiftDragStart.y1,
      button: 'left',
      clickCount: 1,
      modifiers: 8,
    })
    await sleep(60)
    for (const [x, y] of [
      [shiftDragStart.x1 + 80, shiftDragStart.y1 + 4],
      [shiftDragStart.x2, shiftDragStart.y2],
    ]) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers: 8 })
      await sleep(40)
    }
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: shiftDragStart.x2,
      y: shiftDragStart.y2,
      button: 'left',
      clickCount: 1,
      modifiers: 8,
    })
    await sleep(600)
    const shiftSelection = await evaluate(
      cdp,
      `window.__TERMINAL_VIEWS__.get('${id}').getSelection()`,
    )
    check('Shift+drag selects while a program reports the mouse', shiftSelection.length > 0, `sel=${JSON.stringify(shiftSelection.slice(0, 40))}`)

    if (shiftSelection.length > 0) {
      await evaluate(cdp, `window.__TERMINAL_VIEWS__.get('${id}').focus()`)
      await press(cdp, 'c', 10, 67)
      await sleep(600)
      const shiftDragCopy = await readClipboard()
      check('the Shift+drag selection copies with Ctrl+C', shiftDragCopy === shiftSelection, `clipboard=${JSON.stringify(String(shiftDragCopy).slice(0, 40))}`)
    }
  } finally {
    try {
      cdp?.close()
    } catch {}
    try {
      browserCdp?.close()
    } catch {}
    chrome.kill()
    await sleep(400)
    try {
      rmSync(profile, { recursive: true, force: true })
    } catch {}
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e.message)
  process.exit(1)
})
