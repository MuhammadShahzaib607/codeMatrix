import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import zlib from 'node:zlib'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const API = 'http://localhost:4000'
const APP = process.env.APP_URL || 'http://localhost:5174'
const PORT = 9344

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index]
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crcBuf])
}

function makeNoisyPng(width, height) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc(height * (1 + width * 4))
  let seed = 0x1234567
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4)
    for (let x = 0; x < width; x += 1) {
      const at = rowStart + 1 + x * 4
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      raw[at] = seed & 0xff
      raw[at + 1] = (seed >> 8) & 0xff
      raw[at + 2] = (seed >> 16) & 0xff
      raw[at + 3] = 255
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 0 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function makePng(width, height) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4)
    for (let x = 0; x < width; x += 1) {
      const at = rowStart + 1 + x * 4
      raw[at] = (x * 30) % 256
      raw[at + 1] = (y * 30) % 256
      raw[at + 2] = 128
      raw[at + 3] = 255
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
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
    body: JSON.stringify({ name: 'UI Verify', email, password }),
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

function dropExpression(selector, fileName, base64) {
  return `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return false;
    const bin = atob(${JSON.stringify(base64)});
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], ${JSON.stringify(fileName)}, { type: 'image/png' }));
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    return true;
  })()`
}

const stamp = Date.now()
const email = `codebuff-ui-verify-${stamp}@example.com`
const password = 'Verify-12345'
const png = makePng(9, 7)
const pngB64 = png.toString('base64')
const profile = mkdtempSync(join(tmpdir(), 'codematrix-ui-'))
const fixturePath = join(profile, 'ui-photo.png')
writeFileSync(fixturePath, png)
const bigFixturePath = join(profile, 'big-photo.png')
const bigPng = makeNoisyPng(1000, 1000)
writeFileSync(bigFixturePath, bigPng)

const registered = await register(email, password)
check('test user registered', registered.status === 201 && Boolean(registered.body?.token), `${registered.status}`)
const token = registered.body?.token

const folder = await apiFetch(token, 'POST', '/api/workspace/container/entry', {
  name: 'ui-audit',
  type: 'folder',
})
const folderName = folder.body?.name
await apiFetch(token, 'POST', '/api/workspace/container/create', {
  path: `${folderName}/assets`,
  type: 'folder',
})
await apiFetch(token, 'PUT', '/api/workspace/container/file', {
  path: `${folderName}/readme.md`,
  content: '# readme\n',
})
check('project + nested folder created via API', Boolean(folderName), String(folderName))

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
      target = list.find((entry) => entry.type === 'page')
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
  cdp.on('Runtime.exceptionThrown', (params) => {
    pageExceptions.push(params.exceptionDetails?.exception?.description || 'exception')
  })
  cdp.on('Log.entryAdded', (params) => {
    if (params.entry?.level === 'error') consoleErrors.push(params.entry.text)
  })
  await cdp.send('Log.enable')
  await cdp.send('Browser.grantPermissions', {
    origin: APP,
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  })
  await cdp.send('Network.enable')
  const badResponses = []
  cdp.on('Network.responseReceived', (params) => {
    const status = params.response?.status ?? 0
    if (status >= 400) badResponses.push({ url: params.response.url, status })
  })

  async function loadApp() {
    const loaded = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve))
    await cdp.send('Page.navigate', { url: APP })
    await loaded
    await sleep(800)
    await evaluate(cdp, `localStorage.setItem('code-matrix:token', ${JSON.stringify(token)}); true`)
    const reloaded = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve))
    await cdp.send('Page.reload')
    await reloaded
    await waitFor(cdp, `Boolean(document.querySelector('.sidebar'))`, { label: 'sidebar' })
  }

  await loadApp()
  await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(sel(folderName))}))`, {
    label: 'project folder row',
    timeout: 20000,
  })

  check(
    'Explorer toolbar has an upload button',
    await evaluate(cdp, `Boolean(document.querySelector('button[aria-label="Upload files"]'))`),
  )

  await evaluate(
    cdp,
    `(() => {
      const row = document.querySelector(${JSON.stringify(sel(folderName))});
      const rect = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 20, clientY: rect.top + 4 }));
      return true;
    })()`,
  )
  await waitFor(cdp, `Boolean(document.querySelector('.tree-context-menu'))`, { label: 'context menu' })
  const menuLabels = await evaluate(
    cdp,
    `[...document.querySelectorAll('.tree-context-item')].map((e) => e.textContent.trim())`,
  )
  check('folder context menu has "Upload files..."', menuLabels.includes('Upload files...'), JSON.stringify(menuLabels))
  check('folder context menu has "Copy relative path"', menuLabels.includes('Copy relative path'))
  check(
    'folder context menu has no "Copy path relative to open file" without an open file',
    !menuLabels.includes('Copy path relative to open file'),
  )

  await evaluate(
    cdp,
    `(() => {
      const item = [...document.querySelectorAll('.tree-context-item')].find((e) => e.textContent.trim() === 'Upload files...');
      item.click();
      return true;
    })()`,
  )
  await evaluate(cdp, `document.querySelector(${JSON.stringify(sel(folderName))}).click(); true`)
  const assetsId = `${folderName}/assets`
  await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(sel(assetsId))}))`, {
    label: 'nested assets row',
  })
  check('expanded project folder shows its nested folder', true)

  await evaluate(
    cdp,
    `(() => {
      const input = document.querySelector('input.sidebar-upload-input');
      window.__picked = null;
      input.addEventListener('change', (e) => { window.__picked = e.target.files ? e.target.files.length : -1; });
      return true;
    })()`,
  )
  const doc = await cdp.send('DOM.getDocument', { depth: -1 })
  const inputNode = await cdp.send('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector: 'input.sidebar-upload-input',
  })
  await cdp.send('DOM.setFileInputFiles', { files: [fixturePath], nodeId: inputNode.nodeId })

  const uploadedId = `${folderName}/ui-photo.png`
  await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(sel(uploadedId))}))`, {
    label: 'uploaded image row',
    timeout: 20000,
  })
  check(
    'context-menu upload lands in the selected folder, live and exactly once',
    (await evaluate(cdp, `document.querySelectorAll(${JSON.stringify(sel(uploadedId))}).length`)) === 1,
  )
  check(
    'upload toast offers a Copy path action',
    await evaluate(cdp, `Boolean(document.querySelector('.toast-action'))`),
  )
  check(
    'file picker delivered exactly one file',
    (await evaluate(cdp, `window.__picked`)) === 1,
    String(await evaluate(cdp, `window.__picked`)),
  )

  await evaluate(cdp, `document.querySelector(${JSON.stringify(sel(assetsId))}).click(); true`)
  await sleep(300)
  await evaluate(cdp, dropExpression(sel(assetsId), 'drop-photo.png', pngB64))
  const nestedId = `${assetsId}/drop-photo.png`
  await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(sel(nestedId))}))`, {
    label: 'nested dropped image',
    timeout: 20000,
  })
  check('drag-and-drop on a nested folder row uploads into that folder', true)

  await evaluate(cdp, dropExpression('.sidebar', 'root-photo.png', pngB64))
  await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(sel('root-photo.png'))}))`, {
    label: 'container-root dropped image',
    timeout: 20000,
  })
  check('drop on the Explorer root uploads to the container root (top level)', true)

  await evaluate(cdp, dropExpression(sel('root-photo.png'), 'filedrop-photo.png', pngB64))
  await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(sel('filedrop-photo.png'))}))`, {
    label: 'file-row dropped image',
    timeout: 20000,
  })
  check('drop on a file row uploads into that file parent folder', true)

  await evaluate(cdp, `document.querySelector(${JSON.stringify(sel(uploadedId))}).click(); true`)
  await waitFor(cdp, `(() => { const img = document.querySelector('.editor-asset-image'); return Boolean(img) && img.complete && img.naturalWidth > 0 })()`, {
    label: 'image preview',
    timeout: 20000,
  })
  const preview = await evaluate(
    cdp,
    `(() => {
      const img = document.querySelector('.editor-asset-image');
      const meta = document.querySelector('.editor-asset-meta');
      const frame = document.querySelector('.editor-asset-frame');
      return {
        width: img.naturalWidth,
        height: img.naturalHeight,
        meta: meta ? meta.textContent : '',
        frameBg: frame ? getComputedStyle(frame).backgroundImage : '',
      };
    })()`,
  )
  check('image opens as a rendered preview', preview.width === 9 && preview.height === 7, `${preview.width}x${preview.height}`)
  check(
    'preview meta shows name, dimensions and size',
    preview.meta.includes('9') && preview.meta.includes('7') && /(B|KB|MB)/.test(preview.meta),
    preview.meta,
  )
  check('preview background uses a checkerboard', preview.frameBg.includes('linear-gradient'))

  await evaluate(cdp, dropExpression('.sidebar', 'ui-doc.pdf', pngB64))
  await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(sel('ui-doc.pdf'))}))`, {
    label: 'uploaded pdf row',
    timeout: 20000,
  })
  await evaluate(cdp, `document.querySelector(${JSON.stringify(sel('ui-doc.pdf'))}).click(); true`)
  await waitFor(cdp, `Boolean(document.querySelector('.editor-asset.is-binary'))`, {
    label: 'binary card',
  })
  check('a non-image binary opens as a binary card', true)

  const readmeId = `${folderName}/readme.md`
  await evaluate(cdp, `document.querySelector(${JSON.stringify(sel(readmeId))}).click(); true`)
  await waitFor(cdp, `Boolean(document.querySelector('.monaco-editor'))`, {
    label: 'text editor',
    timeout: 20000,
  })

  async function openRowMenu(id) {
    await evaluate(
      cdp,
      `(() => {
        const row = document.querySelector(${JSON.stringify(sel(id))});
        const rect = row.getBoundingClientRect();
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 30, clientY: rect.top + 4 }));
        return true;
      })()`,
    )
    await waitFor(cdp, `Boolean(document.querySelector('.tree-context-menu'))`, { label: `menu for ${id}` })
    return evaluate(cdp, `[...document.querySelectorAll('.tree-context-item')].map((e) => e.textContent.trim())`)
  }

  async function clickMenuItem(label) {
    await evaluate(
      cdp,
      `(() => {
        const item = [...document.querySelectorAll('.tree-context-item')].find((e) => e.textContent.trim() === ${JSON.stringify(label)});
        item.click();
        return true;
      })()`,
    )
    await sleep(400)
  }

  const fileMenu = await openRowMenu(readmeId)
  check(
    'file menu offers "Copy path relative to open file" when a text file is open',
    fileMenu.includes('Copy path relative to open file'),
    JSON.stringify(fileMenu),
  )

  await evaluate(
    cdp,
    `(() => {
      window.__copied = null;
      const original = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = (text) => {
        window.__copied = text;
        return original(text).catch(() => {});
      };
      return true;
    })()`,
  )

  await clickMenuItem('Copy relative path')
  const relativeCopy = await evaluate(cdp, `window.__copied`)
  check('"Copy relative path" copies the project-relative path', relativeCopy === 'readme.md', String(relativeCopy))

  await openRowMenu(readmeId)
  await clickMenuItem('Copy path relative to open file')
  const openFileCopy = await evaluate(cdp, `window.__copied`)
  check(
    '"Copy path relative to open file" copies a path relative to the open file',
    openFileCopy === 'readme.md',
    String(openFileCopy),
  )

  async function setPickerFiles(filePaths) {
    const document = await cdp.send('DOM.getDocument', { depth: -1 })
    const node = await cdp.send('DOM.querySelector', {
      nodeId: document.root.nodeId,
      selector: 'input.sidebar-upload-input',
    })
    await cdp.send('DOM.setFileInputFiles', { files: filePaths, nodeId: node.nodeId })
  }

  const progressMenu = await openRowMenu(folderName)
  check('folder menu offers Upload files... for the progress test', progressMenu.includes('Upload files...'))
  await clickMenuItem('Upload files...')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: 8000000,
    uploadThroughput: 1200000,
  })
  await setPickerFiles([bigFixturePath])
  let sawProgress = false
  const progressDeadline = Date.now() + 12000
  while (Date.now() < progressDeadline && !sawProgress) {
    sawProgress = await evaluate(cdp, `Boolean(document.querySelector('.sidebar-upload-progress'))`)
    if (!sawProgress) await sleep(120)
  }
  check(
    `an upload progress indicator appears for a large (${Math.round(bigPng.length / 1024)} KB) upload`,
    sawProgress,
  )
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })
  await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(sel(`${folderName}/big-photo.png`))}))`, {
    label: 'large upload row',
    timeout: 40000,
  })
  check('the large upload still lands in the selected folder', true)

  await evaluate(cdp, `document.querySelector('button[aria-label="Settings"]').click(); true`)
  await waitFor(cdp, `Boolean(document.querySelector('.settings-overlay'))`, { label: 'settings modal' })
  const nonAdminNav = await evaluate(
    cdp,
    `[...document.querySelectorAll('.settings-nav-item')].map((e) => e.textContent.trim())`,
  )
  check('non-admin Settings nav hides Strict Rules', !nonAdminNav.includes('Strict Rules'), JSON.stringify(nonAdminNav))
  check('non-admin Settings nav hides AI Assistant', !nonAdminNav.includes('AI Assistant'))
  check(
    'non-admin Settings nav still shows the other sections',
    ['Appearance', 'Editor', 'Terminal', 'General'].every((label) => nonAdminNav.includes(label)),
  )
  await evaluate(cdp, `document.querySelector('.settings-close').click(); true`)
  await waitFor(cdp, `!document.querySelector('.settings-overlay')`, { label: 'settings closed' })

  // The server reads the caller's role from MongoDB for THIS request.
  const keyDenied = await fetch(`${API}/api/keys`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const keyBody = await keyDenied.json().catch(() => null)
  check('non-admin is refused on the admin-only keys API', keyDenied.status === 403, `${keyDenied.status}`)
  check('refusal uses the FORBIDDEN code', keyBody?.error?.code === 'FORBIDDEN', JSON.stringify(keyBody))

  // The sandbox cannot write to MongoDB from a new process, so the admin branch
  // of the CLIENT is exercised by intercepting /me and returning role:"admin".
  const adminUser = { ...(registered.body?.user ?? {}), role: 'admin' }
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const originalFetch = window.fetch;
      window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf('/api/auth/me') !== -1) {
          return Promise.resolve(new Response(${JSON.stringify(JSON.stringify({ user: adminUser }))}, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }));
        }
        return originalFetch.apply(this, arguments);
      };
    })();`,
  })

  await cdp.send('Page.reload')
  await sleep(2000)
  await waitFor(cdp, `Boolean(document.querySelector('button[aria-label="Settings"]'))`, { label: 'reloaded app' })
  await evaluate(cdp, `document.querySelector('button[aria-label="Settings"]').click(); true`)
  await waitFor(cdp, `Boolean(document.querySelector('.settings-overlay'))`, { label: 'settings modal (admin)' })
  const adminNav = await evaluate(
    cdp,
    `[...document.querySelectorAll('.settings-nav-item')].map((e) => e.textContent.trim())`,
  )
  check('admin Settings nav shows Strict Rules', adminNav.includes('Strict Rules'), JSON.stringify(adminNav))
  if (adminNav.includes('Strict Rules')) {
    await evaluate(
      cdp,
      `(() => {
        const item = [...document.querySelectorAll('.settings-nav-item')].find((e) => e.textContent.trim() === 'Strict Rules');
        item.click();
        return true;
      })()`,
    )
    const strictTitle = await evaluate(
      cdp,
      `document.querySelector('.settings-content .settings-section-title')?.textContent ?? ''`,
    )
    check('admin can open the Strict Rules section', strictTitle === 'Strict Rules', String(strictTitle))
  } else {
    check('admin can open the Strict Rules section', false, 'nav item missing')
  }

  check('no uncaught page exceptions', pageExceptions.length === 0, pageExceptions.slice(0, 2).join(' | '))
  const unexpected = consoleErrors.filter(
    (text) => !/favicon/i.test(text) && !/Failed to load resource/i.test(text),
  )
  check('no unexpected console errors', unexpected.length === 0, unexpected.slice(0, 2).join(' | '))
  const unexpectedBad = badResponses.filter(
    (entry) =>
      !/favicon/i.test(entry.url) &&
      !/(tsconfig|jsconfig)\.json/.test(entry.url) &&
      !(entry.status === 403 && /\/api\/keys/.test(entry.url)),
  )
  check(
    'no unexpected failing requests in the app',
    unexpectedBad.length === 0,
    JSON.stringify([...new Set(unexpectedBad.map((e) => `${e.status} ${e.url}`))].slice(0, 4)),
  )
} finally {
  try {
    cdp?.ws?.close()
  } catch {}
  chrome.kill()
  await sleep(300)
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {}
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) console.log('FAILED:', failed.map((f) => f.name).join(' | '))
process.exit(failed.length ? 1 : 0)
