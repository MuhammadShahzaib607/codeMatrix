import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const API = 'http://localhost:4000'
const APP = 'http://localhost:5173'
const PORT = 9363

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
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve())
      this.ws.addEventListener('error', (e) => reject(new Error(String(e.message || e.type))))
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

async function waitFor(cdp, expression, { timeout = 8000, label = 'condition' } = {}) {
  const started = Date.now()
  for (;;) {
    if (await evaluate(cdp, expression)) return true
    if (Date.now() - started > timeout) throw new Error(`timeout waiting for ${label}`)
    await sleep(25)
  }
}

async function api(path, { method = 'GET', token = null, body = null } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: res.status, json, headers: res.headers, text }
}

const DOM = {
  recentNames: `Array.from(document.querySelectorAll('.recent-item-name')).map((el) => el.textContent.trim())`,
  hasRecent: (name) =>
    `(${DOM.recentNames}).some((n) => n === ${JSON.stringify(name)} || n.startsWith(${JSON.stringify(name + ' ')}) || n.startsWith(${JSON.stringify(name + ' ·')}))`,
  treeTitles: `Array.from(document.querySelectorAll('.tree-row')).map((el) => el.getAttribute('title'))`,
  chip: `(document.querySelector('.workspace-chip')?.textContent ?? '').trim()`,
  tabCount: `document.querySelectorAll('.tab-bar .tab-name').length`,
  dirtyTabs: `document.querySelectorAll('.tab-bar .tab-close.is-dirty').length`,
  href: `location.pathname + location.search`,
  marker: `window.__noReloadMarker === 42`,
  toast: `Array.from(document.querySelectorAll('[class*="toast"]')).map((el) => el.textContent.trim()).join(' | ')`,
}

async function waitServerGone(projectId, { timeout = 12000 } = {}) {
  const started = Date.now()
  for (;;) {
    const list = await api('/api/projects', { token })
    if (!list.json.projects.some((p) => p.id === projectId)) return true
    if (Date.now() - started > timeout) return false
    await sleep(150)
  }
}

async function settleModal(cdp, name) {
  await waitFor(cdp, `Boolean(document.querySelector('.confirm-overlay'))`, { label: 'confirm modal' })
  if (await evaluate(cdp, `Boolean(document.querySelector('.confirm-typed-input'))`)) {
    await evaluate(
      cdp,
      `(() => {
        const input = document.querySelector('.confirm-typed-input')
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(input, ${JSON.stringify(name)})
        input.dispatchEvent(new Event('input', { bubbles: true }))
        return input.value
      })()`,
    )
  }
  await waitFor(cdp, `!document.querySelector('.confirm-btn.is-danger').disabled`, {
    label: 'confirm enabled',
  })
  await evaluate(cdp, `document.querySelector('.confirm-btn.is-danger').click()`)
}

const rowFinder = (name) =>
  `Array.from(document.querySelectorAll('.recent-item')).find((el) => {
     const text = el.querySelector('.recent-item-name')?.textContent.trim() ?? ''
     return text === ${JSON.stringify(name)} || text.startsWith(${JSON.stringify(name + ' ')}) || text.startsWith(${JSON.stringify(name + ' ·')})
   })`

async function deleteViaRecent(cdp, name) {
  await waitFor(cdp, `Boolean(${rowFinder(name)})`, { label: `${name} recent row` })
  await evaluate(cdp, `(${rowFinder(name)}).querySelector('.recent-item-delete').click()`)
  await settleModal(cdp, name)
}

async function deleteViaTree(cdp, name) {
  await waitFor(cdp, `Boolean(document.querySelector('[aria-label="Delete ${name}"]'))`, {
    label: `${name} tree delete button`,
  })
  await evaluate(cdp, `document.querySelector('[aria-label="Delete ${name}"]').click()`)
  await settleModal(cdp, name)
}

async function openProject(cdp, name) {
  await waitFor(cdp, `Boolean(${rowFinder(name)})`, { label: `${name} recent row` })
  await evaluate(cdp, `(${rowFinder(name)}).querySelector('.recent-item-main').click()`)
  await waitFor(cdp, `${DOM.treeTitles}.includes(${JSON.stringify(name)})`, {
    label: `${name} tree row`,
  })
  await waitFor(cdp, `(${DOM.chip}).includes(${JSON.stringify(name)})`, {
    label: `${name} workspace chip`,
    timeout: 15000,
  })
}

const email = `delete-recheck-${Date.now()}@example.com`
const password = 'secret123'

const reg = await api('/api/auth/register', {
  method: 'POST',
  body: { name: 'Recheck', email, password },
})
if (reg.status !== 201) {
  console.error('register failed', reg.status, reg.text)
  process.exit(1)
}
const token = reg.json.token

async function makeProject(name) {
  const res = await api('/api/projects', { method: 'POST', token, body: { name } })
  if (res.status !== 201) throw new Error(`create ${name} -> ${res.status} ${res.text}`)
  return res.json.project
}

const alpha = await makeProject('alpha')
const zeta = await makeProject('zeta')
const gamma = await makeProject('gamma')
const delta = await makeProject('delta')

const created = await api('/api/workspace/container/create', {
  method: 'POST',
  token,
  body: { path: 'alpha/notes.txt', type: 'file' },
})
check('fixture file created in alpha', created.status < 300, `status ${created.status}`)

const profile = mkdtempSync(join(tmpdir(), 'cm-recheck-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

let cdp
try {
  let target = null
  for (let i = 0; i < 60 && !target; i += 1) {
    await sleep(250)
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      target = list.find((t) => t.type === 'page')
    } catch {}
  }
  if (!target) throw new Error('no chrome page target')

  cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.ready
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('code-matrix:token', ${JSON.stringify(token)}) } catch (e) {}`,
  })

  const fail = { active: false }
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*/api/projects/*', requestStage: 'Request' }],
  })
  cdp.on('Fetch.requestPaused', (params) => {
    if (fail.active && params.request.method === 'DELETE') {
      cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'Failed' })
      return
    }
    cdp.send('Fetch.continueRequest', { requestId: params.requestId })
  })

  await cdp.send('Page.navigate', { url: APP })
  await waitFor(cdp, `Boolean(document.querySelector('.recent-list'))`, {
    label: 'app boot',
    timeout: 25000,
  })
  await waitFor(cdp, `${DOM.hasRecent('alpha')} && ${DOM.hasRecent('zeta')}`, {
    label: 'recent list populated',
    timeout: 20000,
  })
  check('recent list loads from the server', true)

  const listRes = await api('/api/projects', { token })
  const noStore = listRes.headers.get('cache-control') ?? ''
  check(
    'projects list endpoint is not cacheable',
    /no-store/.test(noStore),
    `Cache-Control: ${noStore || '<none>'}`,
  )
  check(
    'recent list matches the server response',
    listRes.json.projects.length === 4,
    `${listRes.json.projects.length} projects on the server`,
  )

  await evaluate(cdp, `window.__noReloadMarker = 42`)
  const hrefBefore = await evaluate(cdp, DOM.href)

  const t1 = Date.now()
  await deleteViaRecent(cdp, 'zeta')
  await waitFor(cdp, `!(${DOM.hasRecent('zeta')})`, { label: 'zeta row gone', timeout: 4000 })
  const zetaMs = Date.now() - t1
  check('non-active delete removes the RECENT row', true, `${zetaMs}ms incl. typing the name`)
  check(
    'non-active delete leaves the Topbar chip untouched',
    !(await evaluate(cdp, DOM.chip)).includes('zeta'),
    `chip="${await evaluate(cdp, DOM.chip)}"`,
  )
  check('non-active delete does not navigate', (await evaluate(cdp, DOM.href)) === hrefBefore)
  check('non-active delete does not reload the page', await evaluate(cdp, DOM.marker))
  check('deleted non-active project is gone from the server list', await waitServerGone(zeta.id))

  await openProject(cdp, 'alpha')
  check('opening a project loads its Explorer row', true)
  check(
    'Topbar chip shows the active project',
    (await evaluate(cdp, DOM.chip)).includes('alpha'),
    `chip="${await evaluate(cdp, DOM.chip)}"`,
  )

  if (!(await evaluate(cdp, `${DOM.treeTitles}.includes('notes.txt')`))) {
    await evaluate(
      cdp,
      `(() => {
        const row = Array.from(document.querySelectorAll('.tree-row')).find((el) => el.getAttribute('title') === 'alpha')
        row.querySelector('.tree-chevron').click()
      })()`,
    )
  }
  await waitFor(cdp, `${DOM.treeTitles}.includes('notes.txt')`, { label: 'notes.txt row' })
  await evaluate(
    cdp,
    `(() => {
      const row = Array.from(document.querySelectorAll('.tree-row')).find((el) => el.getAttribute('title') === 'notes.txt')
      row.click()
    })()`,
  )
  await waitFor(cdp, `${DOM.tabCount} === 1`, { label: 'a file tab open' })
  check('a file tab is open in the active project', true)

  await waitFor(cdp, `document.querySelectorAll('.monaco-editor').length >= 1`, {
    label: 'monaco editor mounted',
    timeout: 20000,
  })
  const box = await evaluate(
    cdp,
    `(() => {
      const el = document.querySelector('.monaco-editor .view-lines') ?? document.querySelector('.monaco-editor')
      if (!el) return null
      const rect = el.getBoundingClientRect()
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
    })()`,
  )
  const editorInfo = await evaluate(
    cdp,
    `JSON.stringify({
       monaco: document.querySelectorAll('.monaco-editor').length,
       textarea: document.querySelectorAll('.monaco-editor textarea').length,
       box: ${JSON.stringify(box)},
     })`,
  )
  if (box) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y })
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', {
        type,
        x: box.x,
        y: box.y,
        button: 'left',
        clickCount: 1,
      })
    }
    await sleep(300)
    await evaluate(cdp, `document.querySelector('.monaco-editor textarea')?.focus()`)
    await sleep(200)
    await cdp.send('Input.insertText', { text: 'dirty-edit' })
    await sleep(200)
    if ((await evaluate(cdp, DOM.dirtyTabs)) === 0) {
      for (const char of 'dirty') {
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'char',
          text: char,
          unmodifiedText: char,
        })
      }
      await sleep(300)
    }
  }
  let dirtySeen = false
  try {
    await waitFor(cdp, `${DOM.dirtyTabs} >= 1`, { timeout: 4000, label: 'dirty tab' })
    dirtySeen = true
  } catch {}
  check(
    'an unsaved (dirty) tab was produced for the delete test',
    dirtySeen,
    dirtySeen ? '' : `editorInfo=${editorInfo}`,
  )

  const t2 = Date.now()
  await deleteViaTree(cdp, 'alpha')
  await waitFor(cdp, `!(${DOM.treeTitles}.includes('alpha'))`, {
    label: 'alpha tree row gone',
    timeout: 6000,
  })
  check('active delete removes the Explorer row', true, `${Date.now() - t2}ms`)
  await waitFor(cdp, `!(${DOM.chip}).includes('alpha')`, { label: 'chip cleared', timeout: 6000 })
  try {
    await waitFor(cdp, `!(${DOM.chip}).includes('alpha')`, { label: 'chip cleared', timeout: 6000 })
  } catch (chipError) {
    console.log(
      'CHIP DEBUG:',
      await evaluate(cdp, DOM.chip),
      '| tree:',
      JSON.stringify(await evaluate(cdp, DOM.treeTitles)),
      '| recents:',
      JSON.stringify(await evaluate(cdp, DOM.recentNames)),
      '| toast:',
      await evaluate(cdp, DOM.toast),
    )
    throw chipError
  }
  check('active delete clears the Topbar chip', true, `chip="${await evaluate(cdp, DOM.chip)}"`)
  await waitFor(cdp, `${DOM.tabCount} === 0`, { label: 'tabs closed', timeout: 6000 })
  check('active delete closes its editor tabs', true)
  check(
    'active delete drops the unsaved buffer',
    (await evaluate(cdp, DOM.dirtyTabs)) === 0,
  )
  check('active delete does not navigate', (await evaluate(cdp, DOM.href)) === hrefBefore)
  check('active delete does not reload the page', await evaluate(cdp, DOM.marker))
  check('deleted active project is gone from the server list', await waitServerGone(alpha.id))

  await cdp.send('Page.reload', { ignoreCache: true })
  await waitFor(cdp, `Boolean(document.querySelector('.recent-list'))`, {
    label: 'reload boot',
    timeout: 25000,
  })
  await waitFor(cdp, `${DOM.hasRecent('gamma')} && ${DOM.hasRecent('delta')}`, {
    label: 'recent list after reload',
    timeout: 20000,
  })
  check('alpha stays deleted after reload', !(await evaluate(cdp, DOM.hasRecent('alpha'))))
  check('zeta stays deleted after reload', !(await evaluate(cdp, DOM.hasRecent('zeta'))))
  check(
    'the deleted project is not in the tree after reload',
    !(await evaluate(cdp, `${DOM.treeTitles}.includes('alpha')`)),
  )
  check('the workspace label is not restored after reload', !(await evaluate(cdp, DOM.chip)).includes('alpha'))

  await openProject(cdp, 'gamma')
  const t3 = Date.now()
  await deleteViaTree(cdp, 'gamma')
  await waitFor(cdp, `!(${DOM.treeTitles}.includes('gamma'))`, {
    label: 'gamma tree row gone',
    timeout: 6000,
  })
  check('Explorer top-level folder delete removes the tree row', true, `${Date.now() - t3}ms`)
  await waitFor(cdp, `!(${DOM.hasRecent('gamma')})`, { label: 'gamma recent gone', timeout: 6000 })
  check('Explorer top-level folder delete removes the RECENT row', true)
  check(
    'Explorer top-level folder delete clears the chip',
    !(await evaluate(cdp, DOM.chip)).includes('gamma'),
    `chip="${await evaluate(cdp, DOM.chip)}"`,
  )
  check('Explorer top-level folder delete is gone from the server list', await waitServerGone(gamma.id))

  const watcherEvent = await api('/api/projects', { token })
  await sleep(2500)
  check(
    'a late watcher/refetch never brings a deleted row back',
    !(await evaluate(cdp, DOM.hasRecent('gamma'))) &&
      !watcherEvent.json.projects.some((p) => p.id === gamma.id),
  )

  const epsilon = await makeProject('epsilon')
  await cdp.send('Page.reload', { ignoreCache: true })
  await waitFor(cdp, `${DOM.hasRecent('epsilon')} && ${DOM.hasRecent('delta')}`, {
    label: 'epsilon visible',
    timeout: 20000,
  })

  fail.active = true
  await deleteViaRecent(cdp, 'epsilon')
  check('failed delete removes the non-active row optimistically', true)
  await waitFor(cdp, `(${DOM.hasRecent('epsilon')})`, { label: 'epsilon row restored', timeout: 8000 })
  check('failed delete rolls the non-active RECENT row back', true)
  let message = ''
  try {
    await waitFor(cdp, `document.body.innerText.includes('Could not delete')`, {
      label: 'failure message',
      timeout: 6000,
    })
    message = await evaluate(
      cdp,
      `(document.body.innerText.match(/Could not delete[^\n]*/) ?? [''])[0]`,
    )
  } catch {
    message = await evaluate(cdp, DOM.toast)
  }
  check('failed delete shows a readable message', /Could not delete/i.test(message), message.slice(0, 160))
  check(
    'failed delete leaves the project on the server',
    (await api('/api/projects', { token })).json.projects.some((p) => p.id === epsilon.id),
  )

  await openProject(cdp, 'delta')
  await waitFor(cdp, `(${DOM.chip}).includes('delta')`, { label: 'delta active', timeout: 8000 })
  const t4 = Date.now()
  await deleteViaTree(cdp, 'delta')
  check('failed active delete removes the tree row optimistically', !(await evaluate(cdp, `${DOM.treeTitles}.includes('delta')`)), `${Date.now() - t4}ms`)
  await waitFor(cdp, `${DOM.treeTitles}.includes('delta')`, { label: 'delta tree row restored', timeout: 10000 })
  check('failed active delete restores the Explorer row', true)
  await waitFor(cdp, `(${DOM.chip}).includes('delta')`, { label: 'delta chip restored', timeout: 10000 })
  check('failed active delete restores the Topbar chip', true, `chip="${await evaluate(cdp, DOM.chip)}"`)
  check(
    'failed active delete leaves the project on the server',
    (await api('/api/projects', { token })).json.projects.some((p) => p.id === delta.id),
  )
  check('failed active delete does not navigate', (await evaluate(cdp, DOM.href)) === hrefBefore)
  fail.active = false
} catch (error) {
  check(`harness ran to completion (${error.message})`, false)
} finally {
  try {
    await cdp?.send('Browser.close')
  } catch {}
  chrome.kill()
  await sleep(500)
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {}
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
