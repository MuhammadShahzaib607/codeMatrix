import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { THEMES } from '../client/src/utils/themes.js'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const API = 'http://localhost:4000'
const APP = 'http://localhost:5173'
const PORT = 9361
const EXPLORER_DRAG_TYPE = 'application/x-codematrix-explorer'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) pass += 1
  else fail += 1
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

async function register(email, password) {
  const res = await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Round2 Verify', email, password }),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

async function apiFetch(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

function sel(id) {
  return `[data-node-id=${JSON.stringify(id)}]`
}

function dragStartExpr(sourceId, { copy = false } = {}) {
  return `(() => {
    const source = document.querySelector(${JSON.stringify(sel(sourceId))});
    if (!source) return 'no-source';
    const dt = new DataTransfer();
    dt.setData(${JSON.stringify(EXPLORER_DRAG_TYPE)}, ${JSON.stringify(sourceId)});
    dt.setData('text/plain', ${JSON.stringify(sourceId)});
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt, ctrlKey: ${copy} }));
    return 'ok';
  })()`
}

function dragDropExpr(sourceId, targetId, { copy = false } = {}) {
  return `(() => {
    const dt = new DataTransfer();
    dt.setData(${JSON.stringify(EXPLORER_DRAG_TYPE)}, ${JSON.stringify(sourceId)});
    dt.setData('text/plain', ${JSON.stringify(sourceId)});
    const target = document.querySelector(${JSON.stringify(sel(targetId))});
    if (!target) return 'no-target';
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt, ctrlKey: ${copy} };
    target.dispatchEvent(new DragEvent('dragover', opts));
    target.dispatchEvent(new DragEvent('drop', opts));
    return 'ok';
  })()`
}

function contextExpr(id) {
  return `(() => {
    const row = document.querySelector(${JSON.stringify(sel(id))});
    if (!row) return false;
    const rect = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 24, clientY: rect.top + 4 }));
    return true;
  })()`
}

function menuExpr(label) {
  return `(() => {
    const item = [...document.querySelectorAll('.tree-context-item')].find((e) => e.textContent.trim() === ${JSON.stringify(label)});
    if (!item) return false;
    item.click();
    return true;
  })()`
}

const MODAL_EL = `document.querySelector('.confirm-overlay[aria-label="Move folder?"]')`
const MODAL = `Boolean(${MODAL_EL})`

function modalInfoExpr() {
  return `(() => {
    const overlay = ${MODAL_EL};
    if (!overlay) return null;
    const card = overlay.querySelector('.confirm-card');
    const checkbox = overlay.querySelector('.move-confirm-check input');
    const active = document.activeElement;
    const cs = getComputedStyle(card);
    return {
      title: overlay.querySelector('.confirm-title')?.textContent ?? '',
      message: overlay.querySelector('.confirm-message')?.textContent ?? '',
      buttons: [...overlay.querySelectorAll('.confirm-actions button')].map((b) => b.textContent.trim()),
      checked: checkbox ? checkbox.checked : null,
      activeText: active && active !== document.body ? active.textContent.trim() : '',
      overlayCount: document.querySelectorAll('.confirm-overlay').length,
      cardBg: cs.backgroundColor,
      cardColor: cs.color,
      cardFont: cs.fontFamily,
    };
  })()`
}

function clickModalButton(label) {
  return `(() => {
    const btn = [...document.querySelectorAll('.confirm-actions button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)});
    if (!btn) return false;
    btn.click();
    return true;
  })()`
}

const noModal = `!${MODAL}`

function firstFamily(stack) {
  return stack.split(',')[0].replace(/['"]/g, '').trim()
}

function rgbOf(hex) {
  const raw = hex.replace('#', '')
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `rgb(${r}, ${g}, ${b})`
}

const NEW_THEMES = [
  'eye-bleach-reversed',
  'comic-sans-casino',
  'wet-carpet-rave',
  'clown-dentist',
  'windows-95-fever-dream',
]
const NEW_NAMES = [
  'Eye Bleach Reversed',
  'Comic Sans Casino',
  'Wet Carpet Rave',
  'Clown Dentist',
  'Windows 95 Fever Dream',
]
const ANIM = {
  'eye-bleach-reversed': [
    ['.sidebar', 'cm-extreme-pan-diag'],
    ['.monaco-editor', 'cm-extreme-hue'],
  ],
  'comic-sans-casino': [['.topbar', 'cm-extreme-pan-x']],
  'wet-carpet-rave': [
    ['.sidebar', 'cm-extreme-pan-xy'],
    ['.sidebar-title', 'cm-extreme-wobble'],
  ],
  'clown-dentist': [['.topbar', 'cm-extreme-pan-diag']],
  'windows-95-fever-dream': [
    ['.topbar', 'cm-extreme-pan-x'],
    ['.sidebar-title', 'cm-extreme-wobble-soft'],
  ],
}

const stamp = Date.now()
const email = `codebuff-round2-${stamp}@example.com`
const password = 'Verify-12345'
const profile = mkdtempSync(join(tmpdir(), 'codematrix-round2-'))

const registered = await register(email, password)
check('test user registered', registered.status === 201 && Boolean(registered.body?.token), `${registered.status}`)
const token = registered.body?.token

const entry = await apiFetch(token, 'POST', '/api/workspace/container/entry', {
  name: 'r2proj',
  type: 'folder',
})
const project = entry.body?.name ?? 'r2proj'
for (const sub of ['subone', 'subtwo', 'subthree', 'subfour', 'subfive', 'inner']) {
  await apiFetch(token, 'POST', '/api/workspace/container/create', { path: `${project}/${sub}`, type: 'folder' })
}
await apiFetch(token, 'PUT', '/api/workspace/container/file', {
  path: `${project}/notes.txt`,
  content: 'notes\n',
})
await apiFetch(token, 'PUT', '/api/workspace/container/file', {
  path: `${project}/app.js`,
  content: "const greeting = 'hi';\n// note\nfunction hi() { return greeting; }\n",
})
check('fixture project created', project === 'r2proj', project)

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

let cdp = null
try {
  const deadline = Date.now() + 15000
  let target = null
  while (Date.now() < deadline && !target) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
      target = list.find((entryItem) => entryItem.type === 'page')
    } catch {}
    if (!target) await sleep(250)
  }
  if (!target) throw new Error('Chrome DevTools endpoint never came up')

  cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.ready
  const pageExceptions = []
  const consoleErrors = []
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('DOM.enable')
  await cdp.send('Log.enable')
  cdp.on('Runtime.exceptionThrown', (params) => {
    pageExceptions.push(params.exceptionDetails?.exception?.description || 'exception')
  })
  cdp.on('Log.entryAdded', (params) => {
    if (params.entry?.level === 'error') consoleErrors.push(params.entry?.text)
  })

  async function pressKey(key, code, vk, modifiers = 0) {
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      modifiers,
    })
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      modifiers,
    })
  }

  async function openSettings(sectionLabel) {
    await evaluate(cdp, `document.querySelector('button[aria-label="Settings"]').click(); true`)
    await waitFor(cdp, `Boolean(document.querySelector('.settings-overlay'))`, { label: 'settings open' })
    if (sectionLabel) {
      await evaluate(
        cdp,
        `(() => {
          const item = [...document.querySelectorAll('.settings-nav-item')].find((e) => e.textContent.trim() === ${JSON.stringify(sectionLabel)});
          if (item) item.click();
          return true;
        })()`,
      )
      await sleep(250)
    }
  }

  async function closeSettings() {
    await pressKey('Escape', 'Escape', 27)
    await waitFor(cdp, `!document.querySelector('.settings-overlay')`, { label: 'settings closed' })
  }

  async function clickSwatch(name) {
    const clicked = await evaluate(
      cdp,
      `(() => {
        const btn = [...document.querySelectorAll('.theme-swatch')].find((b) => b.querySelector('.theme-swatch-name')?.textContent.trim() === ${JSON.stringify(name)});
        if (!btn) return false;
        btn.click();
        return true;
      })()`,
    )
    if (!clicked) throw new Error(`swatch not found: ${name}`)
  }

  async function dragExpect(sourceId, targetId, options) {
    const started = await evaluate(cdp, dragStartExpr(sourceId, options))
    if (started !== 'ok') throw new Error(`dragstart failed ${sourceId}: ${started}`)
    await sleep(250)
    const dropped = await evaluate(cdp, dragDropExpr(sourceId, targetId, options))
    if (dropped !== 'ok') throw new Error(`drop failed ${targetId}: ${dropped}`)
    await sleep(150)
  }

  const loaded = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve))
  await cdp.send('Page.navigate', { url: APP })
  await loaded
  await sleep(800)
  await evaluate(cdp, `localStorage.setItem('code-matrix:token', ${JSON.stringify(token)}); true`)
  const reloaded = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve))
  await cdp.send('Page.reload')
  await reloaded
  await waitFor(cdp, `Boolean(document.querySelector('.sidebar'))`, { label: 'sidebar' })
  await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(sel(project))}))`, { label: 'project row', timeout: 20000 })

  const initialSettings = await evaluate(
    cdp,
    `JSON.parse(localStorage.getItem('code-matrix:settings') ?? 'null')?.askBeforeMovingFolders`,
  )
  check('ask-before-moving-folders defaults to true', initialSettings === true, String(initialSettings))

  await evaluate(cdp, `document.querySelector(${JSON.stringify(sel(project))}).click(); true`)
  for (const sub of ['subone', 'subtwo', 'subthree', 'subfour', 'subfive', 'inner']) {
    await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(sel(`${project}/${sub}`))}))`, { label: `row ${sub}` })
  }
  check('project expanded shows all fixture children', true)

  await dragExpect(`${project}/subone`, `${project}/subtwo`)
  await waitFor(cdp, MODAL, { label: 'move modal appears' })
  const info1 = await evaluate(cdp, modalInfoExpr())
  check('modal title is "Move folder?"', info1?.title === 'Move folder?', info1?.title)
  check(
    'modal names folder and destination as short names',
    info1?.message.includes('subone') && info1?.message.includes('subtwo'),
    info1?.message,
  )
  check('modal message has no path separators', !info1?.message.includes('/'), info1?.message)
  check(
    'modal message has no server path',
    !/workspaces|[A-Za-z]:\\\\/.test(info1?.message),
    info1?.message,
  )
  check('modal buttons are Cancel and Move', JSON.stringify(info1?.buttons) === JSON.stringify(['Cancel', 'Move']), JSON.stringify(info1?.buttons))
  check('checkbox present and unchecked', info1?.checked === false, String(info1?.checked))
  check('focus starts on Move', info1?.activeText === 'Move', info1?.activeText)
  check('exactly one modal overlay', info1?.overlayCount === 1, String(info1?.overlayCount))
  const unchanged1 = await evaluate(
    cdp,
    `Boolean(document.querySelector(${JSON.stringify(sel(`${project}/subone`))})) && !document.querySelector(${JSON.stringify(sel(`${project}/subtwo/subone`))})`,
  )
  check('no optimistic move before confirmation', unchanged1)

  await pressKey('Escape', 'Escape', 27)
  await waitFor(cdp, noModal, { label: 'modal closed by Escape' })
  const unchanged2 = await evaluate(
    cdp,
    `Boolean(document.querySelector(${JSON.stringify(sel(`${project}/subone`))})) && !document.querySelector(${JSON.stringify(sel(`${project}/subtwo/subone`))})`,
  )
  check('Escape cancels with no move', unchanged2)

  await dragExpect(`${project}/subone`, `${project}/subtwo`)
  await waitFor(cdp, MODAL, { label: 'modal reappears' })
  await evaluate(
    cdp,
    `(() => {
      const o = ${MODAL_EL};
      if (!o) return false;
      o.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      return true;
    })()`,
  )
  await waitFor(cdp, noModal, { label: 'modal closed by backdrop' })
  const unchanged3 = await evaluate(
    cdp,
    `Boolean(document.querySelector(${JSON.stringify(sel(`${project}/subone`))})) && !document.querySelector(${JSON.stringify(sel(`${project}/subtwo/subone`))})`,
  )
  check('backdrop click cancels with no move', unchanged3)

  await dragExpect(`${project}/subone`, `${project}/subtwo`)
  await waitFor(cdp, MODAL, { label: 'modal for Move test' })
  await evaluate(cdp, clickModalButton('Move'))
  await waitFor(cdp, noModal, { label: 'modal closed by Move' })
  const toast1 = await waitFor(cdp, `[...document.querySelectorAll('.toast-message')].some((el) => el.textContent.includes(${JSON.stringify(`${project}/subtwo/subone`)}))`, { label: 'move toast', timeout: 8000 }).catch(() => false)
  check('Move confirms and moves (toast shows destination)', Boolean(toast1))
  await evaluate(cdp, `document.querySelector(${JSON.stringify(sel(`${project}/subtwo`))}).click(); true`)
  await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(sel(`${project}/subtwo/subone`))}))`, { label: 'moved row visible live' })
  check('moved folder visible in Explorer without reload', true)

  await dragExpect(`${project}/notes.txt`, `${project}/subthree`)
  await sleep(700)
  const fileNoModal = await evaluate(cdp, noModal)
  check('single file drag never shows the modal', fileNoModal)
  const fileMoved = await waitFor(cdp, `[...document.querySelectorAll('.toast-message')].some((el) => el.textContent.includes(${JSON.stringify(`${project}/subthree/notes.txt`)}))`, { label: 'file move toast', timeout: 8000 }).catch(() => false)
  check('single file move still works', Boolean(fileMoved))

  await dragExpect(`${project}/subthree`, `${project}/subtwo`, { copy: true })
  await sleep(700)
  const copyNoModal = await evaluate(cdp, noModal)
  check('Ctrl+drop folder copy never shows the modal', copyNoModal)
  const copyToast = await waitFor(cdp, `[...document.querySelectorAll('.toast-message')].some((el) => el.textContent.includes(${JSON.stringify(`${project}/subtwo/subthree`)}))`, { label: 'copy toast', timeout: 8000 }).catch(() => false)
  check('Ctrl+drop copy works', Boolean(copyToast))
  const bothExist = await evaluate(
    cdp,
    `Boolean(document.querySelector(${JSON.stringify(sel(`${project}/subthree`))})) && Boolean(document.querySelector(${JSON.stringify(sel(`${project}/subtwo/subthree`))}))`,
  )
  check('copy keeps the original', bothExist)

  await evaluate(cdp, `document.querySelector(${JSON.stringify(sel(`${project}/subthree`))}).click(); true`)
  await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(sel(`${project}/subthree/notes.txt`))}))`, { label: 'subthree expanded' })

  await evaluate(cdp, contextExpr(`${project}/inner`))
  await waitFor(cdp, `Boolean(document.querySelector('.tree-context-menu'))`, { label: 'inner context menu' })
  await evaluate(cdp, menuExpr('Cut'))
  await sleep(300)
  await evaluate(cdp, contextExpr(`${project}/subthree`))
  await waitFor(cdp, `Boolean(document.querySelector('.tree-context-menu'))`, { label: 'target context menu' })
  await evaluate(cdp, menuExpr('Paste'))
  await waitFor(cdp, MODAL, { label: 'cut+paste folder modal' })
  const info2 = await evaluate(cdp, modalInfoExpr())
  check(
    'cut+paste modal names folder and destination',
    info2?.message.includes('inner') && info2?.message.includes('subthree'),
    info2?.message,
  )
  await evaluate(cdp, clickModalButton('Cancel'))
  await waitFor(cdp, noModal, { label: 'paste modal cancelled' })
  const pasteCancelled = await evaluate(
    cdp,
    `Boolean(document.querySelector(${JSON.stringify(sel(`${project}/inner`))})) && !document.querySelector(${JSON.stringify(sel(`${project}/subthree/inner`))})`,
  )
  check('cut+paste Cancel moves nothing', pasteCancelled)

  await evaluate(cdp, contextExpr(`${project}/subthree`))
  await waitFor(cdp, `Boolean(document.querySelector('.tree-context-menu'))`, { label: 'target context menu 2' })
  await evaluate(cdp, menuExpr('Paste'))
  await waitFor(cdp, MODAL, { label: 'cut+paste modal 2' })
  await evaluate(cdp, clickModalButton('Move'))
  await waitFor(cdp, noModal, { label: 'paste modal closed' })
  await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(sel(`${project}/subthree/inner`))})) && !document.querySelector(${JSON.stringify(sel(`${project}/inner`))})`, { label: 'folder moved by paste' })
  check('cut+paste Move moves the folder', true)

  await evaluate(cdp, contextExpr(`${project}/app.js`))
  await waitFor(cdp, `Boolean(document.querySelector('.tree-context-menu'))`, { label: 'file context menu' })
  await evaluate(cdp, menuExpr('Copy'))
  await sleep(300)
  await evaluate(cdp, contextExpr(`${project}/subthree`))
  await waitFor(cdp, `Boolean(document.querySelector('.tree-context-menu'))`, { label: 'target context menu 3' })
  await evaluate(cdp, menuExpr('Paste'))
  await sleep(800)
  const copyPasteNoModal = await evaluate(cdp, noModal)
  check('copy+paste never shows the modal', copyPasteNoModal)
  const copyPasteMoved = await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(sel(`${project}/subthree/app.js`))}))`)
  check('copy+paste still duplicates', copyPasteMoved)

  await dragExpect(`${project}/subfour`, `${project}/subtwo`)
  await waitFor(cdp, MODAL, { label: 'modal for dont-ask test' })
  await evaluate(
    cdp,
    `(() => {
      const box = document.querySelector('.move-confirm-check input');
      box.click();
      return true;
    })()`,
  )
  const checkedNow = await evaluate(cdp, `document.querySelector('.move-confirm-check input').checked`)
  check('checkbox ticks', checkedNow === true)
  await evaluate(cdp, clickModalButton('Move'))
  await waitFor(cdp, noModal, { label: 'modal closed after dont-ask' })
  await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(sel(`${project}/subtwo/subfour`))}))`, { label: 'subfour moved' })
  const prefOff = await evaluate(
    cdp,
    `JSON.parse(localStorage.getItem('code-matrix:settings') ?? 'null')?.askBeforeMovingFolders`,
  )
  check('dont-ask-again stored preference false', prefOff === false, String(prefOff))

  await dragExpect(`${project}/subfive`, `${project}/subtwo`)
  await sleep(800)
  const noModalAfterDontAsk = await evaluate(cdp, noModal)
  check('next folder move shows no modal', noModalAfterDontAsk)
  await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(sel(`${project}/subtwo/subfive`))}))`, { label: 'subfive moved without modal' })
  check('move still happens without modal', true)

  const reload1 = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve))
  await cdp.send('Page.reload')
  await reload1
  await sleep(800)
  await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(sel(project))}))`, { label: 'project row after reload', timeout: 20000 })
  const prefAfterReload = await evaluate(
    cdp,
    `JSON.parse(localStorage.getItem('code-matrix:settings') ?? 'null')?.askBeforeMovingFolders`,
  )
  check('preference persists across reload', prefAfterReload === false, String(prefAfterReload))
  await evaluate(cdp, `document.querySelector(${JSON.stringify(sel(project))}).click(); true`)
  await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(sel(`${project}/subtwo`))}))`, { label: 'subtwo row' })
  await evaluate(cdp, `document.querySelector(${JSON.stringify(sel(`${project}/subtwo`))}).click(); true`)
  await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(sel(`${project}/subtwo/subfive`))}))`, { label: 'subfive row' })
  await dragExpect(`${project}/subtwo/subfive`, project)
  await sleep(800)
  const noModalAfterReload = await evaluate(cdp, noModal)
  check('after reload folder move still shows no modal', noModalAfterReload)
  await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(sel(`${project}/subfive`))})) && !document.querySelector(${JSON.stringify(sel(`${project}/subtwo/subfive`))})`, { label: 'subfive moved back' })

  await openSettings('General')
  const switchState1 = await evaluate(
    cdp,
    `document.querySelector('.settings-content [role="switch"][aria-label="Ask before moving folders"]')?.getAttribute('aria-checked')`,
  )
  check('Settings toggle exists and reflects the stored value', switchState1 === 'false', String(switchState1))
  await evaluate(
    cdp,
    `document.querySelector('.settings-content [role="switch"][aria-label="Ask before moving folders"]').click(); true`,
  )
  const switchState2 = await evaluate(
    cdp,
    `document.querySelector('.settings-content [role="switch"][aria-label="Ask before moving folders"]')?.getAttribute('aria-checked')`,
  )
  check('Settings toggle turns on', switchState2 === 'true', String(switchState2))
  await closeSettings()
  await dragExpect(`${project}/subfive`, `${project}/subtwo`)
  await waitFor(cdp, MODAL, { label: 'modal restored immediately after toggle', timeout: 4000 })
  check('modal returns immediately when toggled on (no reload)', true)
  await evaluate(cdp, clickModalButton('Cancel'))
  await waitFor(cdp, noModal, { label: 'modal cancelled' })

  await openSettings('General')
  await evaluate(
    cdp,
    `document.querySelector('.settings-content [role="switch"][aria-label="Ask before moving folders"]').click(); true`,
  )
  await closeSettings()
  await dragExpect(`${project}/subfive`, `${project}/subtwo`)
  await sleep(800)
  const offAgain = await evaluate(cdp, noModal)
  check('toggling off hides the modal immediately', offAgain)
  await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(sel(`${project}/subtwo/subfive`))}))`, { label: 'subfive moved while off' })

  await openSettings('General')
  await evaluate(
    cdp,
    `document.querySelector('.settings-content [role="switch"][aria-label="Ask before moving folders"]').click(); true`,
  )
  await closeSettings()
  await dragExpect(`${project}/subtwo/subfive`, project)
  await waitFor(cdp, MODAL, { label: 'modal before Enter test' })
  const focusInfo = await evaluate(cdp, `document.activeElement?.textContent?.trim() ?? ''`)
  check('focus on Move before Enter', focusInfo === 'Move', focusInfo)
  await pressKey('Enter', 'Enter', 13)
  await waitFor(cdp, noModal, { label: 'Enter confirmed modal' })
  await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(sel(`${project}/subfive`))}))`, { label: 'folder moved by Enter' })
  check('Enter confirms the move', true)

  await evaluate(cdp, `document.querySelector(${JSON.stringify(sel(`${project}/app.js`))}).click(); true`)
  await waitFor(cdp, `Boolean(document.querySelector('.monaco-editor') && document.querySelector('.view-lines'))`, { label: 'monaco open', timeout: 20000 })
  await waitFor(cdp, `document.querySelector('.view-lines')?.textContent.includes('const') ?? false`, { label: 'file content rendered' })
  check('editor file open for theme checks', true)

  await evaluate(cdp, `document.querySelector('button[aria-label="Toggle terminal panel"]').click(); true`)
  const hasView = await waitFor(
    cdp,
    `Boolean(document.querySelector('.terminal-view')) || Boolean(document.querySelector('button[aria-label="New terminal"]'))`,
    { label: 'terminal panel', timeout: 10000 },
  ).catch(() => false)
  if (hasView && !(await evaluate(cdp, `Boolean(document.querySelector('.terminal-view'))`))) {
    await evaluate(cdp, `document.querySelector('button[aria-label="New terminal"]').click(); true`)
  }
  await waitFor(cdp, `(window.__TERMINAL_VIEWS__?.size ?? 0) > 0`, { label: 'terminal instance', timeout: 15000 })
  check('terminal open for theme checks', true)

  await openSettings('Appearance')
  const themeCountText = await evaluate(
    cdp,
    `document.querySelector('.settings-section-desc')?.textContent ?? ''`,
  )
  check('Settings reports 63 themes', themeCountText.includes('63 themes'), themeCountText.slice(0, 60))
  const swatchTail = await evaluate(
    cdp,
    `[...document.querySelectorAll('.theme-swatch-name')].slice(-5).map((e) => e.textContent.trim())`,
  )
  check('new five themes are last, in order', JSON.stringify(swatchTail) === JSON.stringify(NEW_NAMES), JSON.stringify(swatchTail))

  for (const themeId of NEW_THEMES) {
    const spec = THEMES.find((t) => t.id === themeId)
    const name = spec.name
    await clickSwatch(name)
    await waitFor(cdp, `document.documentElement.getAttribute('data-theme') === ${JSON.stringify(themeId)}`, { label: `theme ${themeId}` })

    const accentVar = await evaluate(cdp, `getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`)
    check(`${name}: accent applied`, accentVar.toLowerCase() === spec.palette['--accent'].toLowerCase(), accentVar)

    const extremeAttr = await evaluate(cdp, `document.documentElement.getAttribute('data-extreme')`)
    check(`${name}: data-extreme set`, extremeAttr === 'true', String(extremeAttr))

    const settingsCard = await evaluate(
      cdp,
      `(() => {
        const card = document.querySelector('.settings-card');
        if (!card) return null;
        const cs = getComputedStyle(card);
        return { bg: cs.backgroundColor, color: cs.color, font: cs.fontFamily, w: card.getBoundingClientRect().width, h: card.getBoundingClientRect().height };
      })()`,
    )
    check(`${name}: settings card locked surface`, settingsCard?.bg === 'rgb(38, 40, 44)', settingsCard?.bg)
    check(`${name}: settings card locked text`, settingsCard?.color === 'rgb(215, 217, 221)', settingsCard?.color)
    check(`${name}: settings card locked font`, (settingsCard?.font ?? '').includes('Segoe UI'), settingsCard?.font)
    check(`${name}: settings card geometry intact`, (settingsCard?.w ?? 0) >= 600 && (settingsCard?.h ?? 0) >= 500, `${settingsCard?.w}x${settingsCard?.h}`)

    const swatchActive = await evaluate(
      cdp,
      `[...document.querySelectorAll('.theme-swatch')].find((b) => b.querySelector('.theme-swatch-name')?.textContent.trim() === ${JSON.stringify(name)})?.getAttribute('aria-pressed')`,
    )
    check(`${name}: picker marks the theme active`, swatchActive === 'true', String(swatchActive))

    await closeSettings()

    const bodyFont = await evaluate(cdp, `getComputedStyle(document.body).fontFamily`)
    check(`${name}: UI font changed`, bodyFont.includes(firstFamily(spec.fonts.ui)), firstFamily(spec.fonts.ui))

    const sidebarInfo = await evaluate(
      cdp,
      `(() => {
        const sb = document.querySelector('.sidebar');
        const cs = getComputedStyle(sb);
        const topbar = getComputedStyle(document.querySelector('.topbar'));
        return { image: cs.backgroundImage, shadow: cs.boxShadow, topbarH: document.querySelector('.topbar').getBoundingClientRect().height };
      })()`,
    )
    check(`${name}: sidebar gradient/stripe applied`, sidebarInfo.image !== 'none', sidebarInfo.image.slice(0, 60))
    check(`${name}: chunky inset border applied`, sidebarInfo.shadow.includes('inset'), sidebarInfo.shadow.slice(0, 60))
    check(`${name}: topbar height unchanged (48px)`, sidebarInfo.topbarH === 48, String(sidebarInfo.topbarH))

    const monacoInfo = await evaluate(
      cdp,
      `(() => {
        const editor = document.querySelector('.monaco-editor');
        const lines = document.querySelector('.view-lines');
        if (!editor || !lines) return null;
        const colors = new Set([...lines.querySelectorAll('span')].map((s) => getComputedStyle(s).color));
        return {
          bg: getComputedStyle(editor).backgroundColor,
          font: getComputedStyle(lines).fontFamily,
          colors: [...colors],
        };
      })()`,
    )
    check(`${name}: monaco background follows theme`, monacoInfo?.bg === rgbOf(spec.palette['--bg-editor']), monacoInfo?.bg)
    check(`${name}: monaco font is the theme font`, (monacoInfo?.font ?? '').includes(firstFamily(spec.fonts.editor)), firstFamily(spec.fonts.editor))
    const discriminating = spec.monacoRules.find(
      (r) =>
        ['comment', 'keyword', 'string', 'number'].includes(r.token) &&
        r.foreground.toLowerCase() !== spec.palette['--accent'].toLowerCase() &&
        r.foreground.toLowerCase() !== spec.monacoColors.foreground.toLowerCase(),
    )
    check(
      `${name}: monaco syntax token uses the clashing accent`,
      Boolean(discriminating) && monacoInfo?.colors.includes(rgbOf(discriminating.foreground)),
      discriminating ? `${discriminating.token} ${rgbOf(discriminating.foreground)}` : 'no rule',
    )

    const termInfo = await evaluate(
      cdp,
      `(() => {
        const term = [...(window.__TERMINAL_VIEWS__?.values() ?? [])][0];
        if (!term) return null;
        return { bg: term.options.theme?.background, red: term.options.theme?.red, font: term.options.fontFamily };
      })()`,
    )
    check(`${name}: xterm background follows theme`, termInfo?.bg?.toLowerCase() === spec.palette['--bg-editor'].toLowerCase(), String(termInfo?.bg))
    check(`${name}: xterm full 16-color palette applied`, termInfo?.red === spec.ansi.red, String(termInfo?.red))
    check(`${name}: xterm font is the theme font`, (termInfo?.font ?? '').includes(firstFamily(spec.fonts.terminal)), String(termInfo?.font))

    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    })
    for (const [selector, expectedName] of ANIM[themeId]) {
      const anim = await evaluate(
        cdp,
        `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;
          const cs = getComputedStyle(el);
          return { name: cs.animationName, duration: cs.animationDuration };
        })()`,
      )
      check(
        `${name}: ${selector} animates slowly`,
        anim?.name === expectedName && parseFloat(anim?.duration) >= 5,
        `${anim?.name} ${anim?.duration}`,
      )
    }

    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    })
    const reduceActive = await evaluate(cdp, `matchMedia('(prefers-reduced-motion: reduce)').matches`)
    check(`${name}: reduced-motion emulation active`, reduceActive === true)
    for (const [selector] of ANIM[themeId]) {
      const animName = await evaluate(
        cdp,
        `getComputedStyle(document.querySelector(${JSON.stringify(selector)})).animationName`,
      )
      check(`${name}: ${selector} animation stops under prefers-reduced-motion`, animName === 'none', animName)
    }
    await cdp.send('Emulation.setEmulatedMedia', { features: [] })
    const reduceCleared = await waitFor(cdp, `!matchMedia('(prefers-reduced-motion: reduce)').matches`, { label: 'emulation cleared' }).catch(() => false)
    check(`${name}: reduced-motion emulation cleared`, Boolean(reduceCleared))

    await dragExpect(`${project}/subfive`, `${project}/subtwo`)
    await waitFor(cdp, MODAL, { label: `modal under ${themeId}` })
    const modalTheme = await evaluate(cdp, modalInfoExpr())
    check(`${name}: move modal locked surface`, modalTheme?.cardBg === 'rgb(38, 40, 44)', modalTheme?.cardBg)
    check(`${name}: move modal locked text`, modalTheme?.cardColor === 'rgb(215, 217, 221)', modalTheme?.cardColor)
    check(`${name}: move modal locked font`, (modalTheme?.cardFont ?? '').includes('Segoe UI'), modalTheme?.cardFont)
    await evaluate(cdp, clickModalButton('Cancel'))
    await waitFor(cdp, noModal, { label: `modal cancelled under ${themeId}` })

    await openSettings('Appearance')
  }

  const tooltipTarget = await (async () => {
    await closeSettings()
    return evaluate(
      cdp,
      `(() => {
        const btn = document.querySelector('button[aria-label="New file"]');
        if (!btn) return null;
        const rect = btn.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`,
    )
  })()
  if (tooltipTarget) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tooltipTarget.x, y: tooltipTarget.y })
    const tipShown = await waitFor(cdp, `Boolean(document.querySelector('.tooltip-bubble.is-placed'))`, { label: 'tooltip shown', timeout: 5000 }).catch(() => false)
    if (tipShown) {
      const tip = await evaluate(
        cdp,
        `(() => {
          const bubble = document.querySelector('.tooltip-bubble');
          const cs = getComputedStyle(bubble);
          return { bg: cs.backgroundColor, font: cs.fontFamily };
        })()`,
      )
      check('tooltip locked surface under extreme theme', tip.bg === 'rgb(38, 40, 44)', tip.bg)
      check('tooltip locked font under extreme theme', tip.font.includes('Segoe UI'), tip.font)
    } else {
      check('tooltip shown under extreme theme', false, 'tooltip never appeared')
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 800, y: 40 })
  } else {
    check('tooltip target found', false)
  }

  await closeSettings()
  await openSettings('Appearance')
  await clickSwatch('Cartoon Overdose')
  await waitFor(cdp, `document.documentElement.getAttribute('data-theme') === 'cartoon-overdose'`, { label: 'cartoon theme' })
  const oldExtremity = await evaluate(cdp, `document.documentElement.getAttribute('data-extreme')`)
  check('existing theme does NOT get the extreme flag', oldExtremity === null, String(oldExtremity))
  const oldCard = await evaluate(cdp, `getComputedStyle(document.querySelector('.settings-card')).backgroundColor`)
  check('existing theme settings keep theme colors (lock not applied)', oldCard === 'rgb(255, 210, 74)', oldCard)

  await clickSwatch('Clown Dentist')
  await waitFor(cdp, `document.documentElement.getAttribute('data-theme') === 'clown-dentist'`, { label: 'clown theme' })
  const resetClicked = await evaluate(
    cdp,
    `(() => {
      const btn = [...document.querySelectorAll('.settings-btn')].find((b) => b.textContent.includes('Reset to default theme'));
      if (!btn) return false;
      btn.click();
      return true;
    })()`,
  )
  check('Reset to default theme button found', Boolean(resetClicked))
  await waitFor(cdp, `document.documentElement.getAttribute('data-theme') === 'default-purple' && !document.documentElement.hasAttribute('data-extreme')`, { label: 'reset to default', timeout: 5000 })
  check('Reset to default theme restores the default', true)

  await clickSwatch('Comic Sans Casino')
  await waitFor(cdp, `document.documentElement.getAttribute('data-theme') === 'comic-sans-casino'`, { label: 'casino theme for shortcut' })
  await closeSettings()
  await evaluate(cdp, `document.querySelector('.monaco-editor textarea')?.focus(); true`)
  await pressKey('0', 'Digit0', 48, 11)
  await waitFor(cdp, `document.documentElement.getAttribute('data-theme') === 'default-purple' && !document.documentElement.hasAttribute('data-extreme')`, { label: 'Ctrl+Alt+Shift+0 resets theme', timeout: 5000 })
  check('Ctrl+Alt+Shift+0 restores default theme from the editor', true)

  await openSettings('Appearance')
  await clickSwatch('Windows 95 Fever Dream')
  await waitFor(cdp, `document.documentElement.getAttribute('data-theme') === 'windows-95-fever-dream'`, { label: 'w95 theme' })
  await closeSettings()
  const reload2 = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve))
  await cdp.send('Page.reload')
  await reload2
  await sleep(800)
  await waitFor(cdp, `Boolean(document.querySelector('.sidebar'))`, { label: 'sidebar after reload' })
  const persistedTheme = await evaluate(
    cdp,
    `({ theme: document.documentElement.getAttribute('data-theme'), extreme: document.documentElement.getAttribute('data-extreme') })`,
  )
  check(
    'extreme theme selection persists after reload',
    persistedTheme.theme === 'windows-95-fever-dream' && persistedTheme.extreme === 'true',
    JSON.stringify(persistedTheme),
  )
  await pressKey('0', 'Digit0', 48, 11)
  await waitFor(cdp, `document.documentElement.getAttribute('data-theme') === 'default-purple'`, { label: 'shortcut after reload', timeout: 5000 })
  check('Ctrl+Alt+Shift+0 works after reload', true)

  const uncaught = pageExceptions.filter((entryItem) => !/favicon/i.test(entryItem))
  check('no uncaught page exceptions', uncaught.length === 0, uncaught.slice(0, 3).join(' | '))
  const badConsole = consoleErrors.filter((text) => /Uncaught|TypeError|ReferenceError/.test(text))
  check('no app console errors', badConsole.length === 0, badConsole.slice(0, 3).join(' | '))
} catch (error) {
  fail += 1
  console.log(`FAIL  harness error — ${error.message}`)
} finally {
  try {
    if (cdp) cdp.ws.close()
  } catch {}
  chrome.kill()
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
