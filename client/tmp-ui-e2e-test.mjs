// TEMPORARY test (deleted after verification): drives the REAL UI in headless
// Chrome against the mock Groq, and verifies all four fixes together:
//
//   1. a fresh agent task produces a FLAT project folder named from the task
//      (no Scratch container, no nested <project>/<project>/ folder);
//   2. the generated index.html's <link>/<script> actually load in the Live
//      Preview — real CSS applied and real JS executed in the browser;
//   3. every row in the AI action feed keeps its natural height while the task
//      streams (no collapsed "flat gray line" slivers) and the feed scrolls;
//   4. the AI panel shows a real progress bar for the daily request budget that
//      grows as the run consumes requests.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const WORKSPACES = path.resolve(ROOT, 'server/workspaces')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const API_PORT = 4401
const GROQ_PORT = 5501
const VITE_PORT = 5175
const API = `http://localhost:${API_PORT}`
const WEB = `http://localhost:${VITE_PORT}`

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) passed += 1
  else failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function req(method, p, body, token) {
  const response = await fetch(`${API}${p}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`${method} ${p} -> ${response.status} ${JSON.stringify(data)}`)
  return data
}

// ---------------------------------------------------------------------------
// Headless Chrome over CDP (Node's built-in WebSocket — no dependencies)
// ---------------------------------------------------------------------------
const cdp = { chrome: null, socket: null, id: 0, events: [] }

async function cdpConnect() {
  const port = 9500 + Math.floor(Math.random() * 300)
  cdp.chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${process.env.TEMP}\\cdp-e2e-${Date.now()}`,
      '--window-size=1360,900',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )

  let targets = null
  for (let i = 0; i < 120; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        targets = await response.json()
        break
      }
    } catch {}
    await sleep(100)
  }
  const page = targets?.find((entry) => entry.type === 'page')
  if (!page) throw new Error('no CDP page target')

  cdp.socket = await new Promise((resolve, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    ws.addEventListener('open', () => resolve(ws), { once: true })
    ws.addEventListener('error', () => reject(new Error('CDP websocket failed')), { once: true })
  })
  // Persistent capture of CDP events (network responses, console errors).
  cdp.socket.addEventListener('message', (event) => {
    let message = null
    try {
      message = JSON.parse(event.data)
    } catch {
      return
    }
    if (message && message.method) cdp.events.push(message)
  })
}

function cdpSend(method, params = {}) {
  const id = ++cdp.id
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 30000)
    const onMessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== id) return
      clearTimeout(timer)
      cdp.socket.removeEventListener('message', onMessage)
      if (message.error) reject(new Error(`${method}: ${message.error.message}`))
      else resolve(message.result)
    }
    cdp.socket.addEventListener('message', onMessage)
    cdp.socket.send(JSON.stringify({ id, method, params }))
  })
}

/** Evaluates a JS function body in the page and returns its JSON value. */
async function js(body) {
  const result = await cdpSend('Runtime.evaluate', {
    expression: `(function () { ${body} })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) {
    throw new Error(`page eval failed: ${JSON.stringify(result.exceptionDetails.exception ?? result.exceptionDetails.text)}`)
  }
  return result.result?.value
}

async function waitFor(body, timeout = 20000, label = 'condition') {
  const deadline = Date.now() + timeout
  let lastError = null
  for (;;) {
    try {
      const value = await js(body)
      if (value) return value
    } catch (error) {
      lastError = error
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}${lastError ? ` (${lastError.message})` : ''}`)
    await sleep(200)
  }
}

async function navigate(url) {
  await cdpSend('Page.navigate', { url })
  await sleep(1500)
}

async function main() {
  // ---- servers -----------------------------------------------------------
  process.env.MOCK_GROQ_PORT = String(GROQ_PORT)
  const mock = await import('../tmp-mock-groq-nested.mjs')

  const api = spawn(process.execPath, ['server.js'], {
    cwd: path.join(ROOT, 'server'),
    env: {
      ...process.env,
      PORT: String(API_PORT),
      GROQ_BASE_URL: `http://localhost:${GROQ_PORT}`,
      CLIENT_ORIGIN: WEB,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(VITE_PORT), '--strictPort'], {
    cwd: path.join(ROOT, 'client'),
    env: { ...process.env, VITE_API_BASE_URL: API },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let apiLog = ''
  api.stdout.on('data', (c) => (apiLog += String(c)))
  api.stderr.on('data', (c) => (apiLog += String(c)))
  vite.stdout.on('data', () => {})
  vite.stderr.on('data', () => {})

  const stop = () => {
    try {
      api.kill('SIGKILL')
    } catch {}
    try {
      vite.kill('SIGKILL')
    } catch {}
    try {
      mock.mockServer.close()
    } catch {}
    try {
      cdp.socket?.close()
    } catch {}
    try {
      cdp.chrome?.kill()
    } catch {}
  }

  try {
    // Wait for BOTH servers.
    const deadline = Date.now() + 40000
    for (;;) {
      if (Date.now() > deadline) throw new Error(`servers did not start:\n${apiLog}`)
      try {
        const [health, web] = await Promise.all([fetch(`${API}/api/health`), fetch(WEB)])
        if (health.ok && web.ok) break
      } catch {}
      await sleep(300)
    }

    // ---- account + key ---------------------------------------------------
    const auth = await req('POST', '/api/auth/register', {
      name: 'UI E2E',
      email: `ui-e2e-${Date.now()}@example.com`,
      password: 'test-pass-123',
    })
    const token = auth.token
    await req('POST', '/api/keys', { key: 'gsk_mockkeyformockgroq0000000000cc', label: 'mock' }, token)

    // ---- open the app signed in -----------------------------------------
    await cdpConnect()
    await cdpSend('Page.enable')
    await cdpSend('Runtime.enable')
    await cdpSend('Network.enable')
    await navigate(`${WEB}/`)
    await js(`localStorage.setItem('code-matrix:token', ${JSON.stringify(token)});`)
    await navigate(`${WEB}/`)

    await waitFor(
      `var el = document.querySelector('.ai-composer'); return el ? true : false;`,
      25000,
      'the AI composer (signed in + key loaded)',
    )
    check('app boots signed in with the composer visible', true)

    // Framework: HTML/CSS/JS (matches the generated vanilla site).
    await js(`
      document.querySelector('.ai-framework-btn').click();
    `)
    await sleep(300)
    await js(`
      var items = [...document.querySelectorAll('.ai-framework-item')];
      var html = items.find(function (el) { return el.textContent.indexOf('HTML/CSS/JS') !== -1; });
      if (html) html.click();
      return Boolean(html);
    `)
    await sleep(300)
    const frameworkChosen = await js(`return document.querySelector('.ai-framework-label').textContent;`)
    check('framework selector set to HTML/CSS/JS', /HTML\/CSS\/JS/.test(frameworkChosen), frameworkChosen)

    // ---- start the task, sampling the feed WHILE it streams ---------------
    await js(`
      window.__feed = { samples: 0, min: Infinity, collapsed: 0, rows: 0, fills: [], rails: [] };
      window.__feedTimer = setInterval(function () {
        var rows = [...document.querySelectorAll('.ai-action')];
        if (!rows.length) return;
        window.__feed.samples += 1;
        window.__feed.rows = Math.max(window.__feed.rows, rows.length);
        var min = Math.min.apply(null, rows.map(function (r) { return r.getBoundingClientRect().height; }));
        if (min < window.__feed.min) window.__feed.min = min;
        if (min < 20) window.__feed.collapsed += 1;
        var rail = document.querySelector('.ai-usage-row .usage-bar-track');
        var fill = document.querySelector('.ai-usage-row .usage-bar-fill');
        if (rail) window.__feed.rails.push(rail.getBoundingClientRect().height);
        if (fill) window.__feed.fills.push(fill.getBoundingClientRect().width);
      }, 120);
      return true;
    `)

    await js(`
      var ta = document.querySelector('.ai-textarea');
      var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, 'create a todo app with localStorage');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return ta.value;
    `)
    await sleep(150)

    // Snapshot the usage indicator BEFORE the run consumes anything, so the
    // "it updates live" assertion has a real before/after pair.
    const usageBefore = JSON.parse(
      (await js(`
        var fill = document.querySelector('.ai-usage-row .usage-bar-fill');
        var text = document.querySelector('.ai-model-usage');
        return JSON.stringify({
          fill: fill ? fill.getBoundingClientRect().width : null,
          text: text ? text.textContent : '',
        });
      `)) ?? '{}',
    )

    cdp.events.length = 0
    await js(`
      var ta = document.querySelector('.ai-textarea');
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      return true;
    `)

    const summary = await waitFor(
      `var rows = [...document.querySelectorAll('.ai-message.is-ai .ai-text')];
       var hit = rows.find(function (el) { return el.textContent.indexOf('Done —') !== -1; });
       return hit ? hit.textContent : false;`,
      90000,
      'the agent summary bubble',
    )
    check('agent run finished and the summary rendered', /todo app/.test(summary), summary.slice(0, 70))

    const feed = await js(`
      clearInterval(window.__feedTimer);
      var rows = [...document.querySelectorAll('.ai-action')];
      var feedEl = document.querySelector('.ai-messages');
      var feedStyle = getComputedStyle(feedEl);
      var rowStyle = rows.length ? getComputedStyle(rows[0]) : null;
      var labels = rows.map(function (r) { return (r.querySelector('.ai-action-desc') || {}).textContent || ''; });
      return JSON.stringify({
        sampled: window.__feed,
        liveRows: rows.length,
        labels: labels,
        clientH: feedEl.clientHeight,
        scrollH: feedEl.scrollHeight,
        overflowY: feedStyle.overflowY,
        rowFlexShrink: rowStyle ? rowStyle.flexShrink : 'n/a',
        thinking: Boolean(document.querySelector('.ai-thinking')),
      });
    `)
    const feedData = JSON.parse(feed)

    // ---- issue #3: no collapsed rows, ever --------------------------------
    check(
      'every action card kept its natural height while streaming',
      Number.isFinite(feedData.sampled.min) && feedData.sampled.min >= 20,
      `min ${Math.round(feedData.sampled.min)}px over ${feedData.sampled.samples} samples`,
    )
    check('no collapsed "flat line" sample was ever observed', feedData.sampled.collapsed === 0, `${feedData.sampled.collapsed} collapsed samples`)
    check('action rows rendered (Create index.html etc.)', feedData.liveRows >= 3 && feedData.labels.some((l) => /Create index\.html/.test(l)), feedData.labels.join(' | ').slice(0, 120))
    check(
      'feed is a non-shrinking scrolling flex column (the fix itself)',
      feedData.overflowY === 'auto' && feedData.rowFlexShrink === '0' && feedData.scrollH >= feedData.clientH,
      `overflow-y:${feedData.overflowY} row-flex-shrink:${feedData.rowFlexShrink} ${feedData.clientH}px viewport / ${feedData.scrollH}px content`,
    )
    const runningHeight = await js(`
      var el = [...document.querySelectorAll('.ai-action')].pop();
      return el ? Math.round(el.getBoundingClientRect().height) : 0;
    `)
    check('a completed action card is a full-size card (>=24px)', runningHeight >= 24, `${runningHeight}px`)

    // ---- issue #4: the progress bar --------------------------------------
    await sleep(500) // let the CSS width transition settle before measuring
    const usage = await js(`
      var rail = document.querySelector('.ai-usage-row .usage-bar-track');
      var fill = document.querySelector('.ai-usage-row .usage-bar-fill');
      var bar = document.querySelector('.ai-usage-row .usage-bar');
      var label = document.querySelector('.ai-model-usage');
      if (!rail) return JSON.stringify({ present: false });
      var rb = rail.getBoundingClientRect();
      var fb = fill.getBoundingClientRect();
      return JSON.stringify({
        present: true,
        railW: Math.round(rb.width), railH: Math.round(rb.height),
        fillW: Math.round(fb.width * 10) / 10,
        fillPct: fill.style.width,
        tone: bar.className,
        text: label ? label.textContent : '',
        fills: window.__feed.fills,
        rails: window.__feed.rails,
      });
    `)
    const usageData = JSON.parse(usage)
    check('progress bar rail rendered at a visible size', usageData.present && usageData.railW > 100 && usageData.railH >= 4, usageData.present ? `${usageData.railW}x${usageData.railH}px` : 'missing')
    check(
      'the bar fills as the run consumes requests (live update)',
      (usageBefore.fill ?? 0) === 0 && usageData.fillW > 10 && usageData.fillW >= usageBefore.fill,
      `${Math.round(usageBefore.fill ?? 0)}px (before) -> ${usageData.fillW}px (after, ${usageData.fillPct})`,
    )
    check(
      'the usage text also updated live',
      /not used yet/.test(usageBefore.text ?? '') && /% daily requests remaining/.test(usageData.text),
      `"${usageBefore.text}" -> "${usageData.text}"`,
    )
    check('tone class matches the shared usage thresholds', /is-(ok|warn|danger)/.test(usageData.tone), usageData.tone)
    check('the usage text still sits next to the model name', /daily requests remaining/.test(usageData.text), usageData.text)

    // ---- issue #1 in the UI: flat project, correct root label ------------
    const workspaceRef = JSON.parse(await js(`return localStorage.getItem('code-matrix:workspace') || 'null';`) ?? 'null')
    const projectId = workspaceRef?.projectId
    check('workspace ref saved for the new project', Boolean(projectId && workspaceRef.name), JSON.stringify(workspaceRef))

    const tree = await req('GET', `/api/workspace/${projectId}/tree`, null, token)
    const childNames = (tree.tree?.children ?? []).map((n) => n.name).sort()
    check(
      'project root holds the three site files (flat, no nested folder)',
      JSON.stringify(childNames) === JSON.stringify(['index.html', 'script.js', 'style.css']),
      childNames.join(', '),
    )
    check('project folder is named from the model suggestion, not Scratch', tree.name === 'task-tracker', tree.name)
    const registry = JSON.parse(fs.readFileSync(path.join(WORKSPACES, '.workspaces.json'), 'utf8'))
    const folderOnDisk = path.join(WORKSPACES, registry[projectId].container, registry[projectId].folderName)
    check(
      'no Scratch or self-named nested folder on disk',
      path.basename(folderOnDisk) === 'task-tracker' &&
        !fs.existsSync(path.join(folderOnDisk, 'task-tracker')) &&
        !fs.existsSync(path.join(folderOnDisk, 'todo-app')),
      folderOnDisk + ' | ' + fs.readdirSync(folderOnDisk).join(', '),
    )

    let explorerRows = []
    // The server debounces watcher events (750ms) and the client debounces
    // again (400ms), so the generated files land in the Explorer a moment after
    // the run finishes. Make sure the root is expanded and wait for them — the
    // same thing a user does.
    const explorerDeadline = Date.now() + 10000
    for (;;) {
      const state = JSON.parse(
        await js(`
          var rows = [...document.querySelectorAll('.tree-row')].map(function (r) { return r.textContent.trim(); });
          var rootRow = document.querySelector('.tree-row[data-node-id="root"]') || document.querySelector('.tree-row');
          var chevron = rootRow ? rootRow.querySelector('.tree-chevron svg') : null;
          var cls = chevron ? (chevron.getAttribute('class') || '') : '';
          return JSON.stringify({ rows: rows, open: cls.indexOf('chevron-down') !== -1 });
        `),
      )
      explorerRows = state.rows
      const haveFiles = ['index.html', 'script.js', 'style.css'].every((f) => explorerRows.some((r) => r.includes(f)))
      if (haveFiles) break
      if (!state.open) {
        await js(`
          var root = document.querySelector('.tree-row[data-node-id="root"]') || document.querySelector('.tree-row');
          if (root) root.click();
          return true;
        `)
      }
      if (Date.now() > explorerDeadline) break
      await sleep(400)
    }
    check('Explorer root is labelled with the project name', explorerRows.some((r) => /task-tracker/.test(r)), explorerRows.slice(0, 6).join(' | '))
    check(
      'Explorer lists the generated files under the root',
      ['index.html', 'script.js', 'style.css'].every((f) => explorerRows.some((r) => r.includes(f))),
      explorerRows.join(' | '),
    )
    if (!['index.html', 'script.js', 'style.css'].every((f) => explorerRows.some((r) => r.includes(f)))) {
      const treeCalls = cdp.events
        .filter((e) => e.method === 'Network.responseReceived')
        .map((e) => ({ url: e.params.response.url, status: e.params.response.status }))
        .filter((entry) => entry.url.includes('/api/workspace') || entry.url.includes('/tree'))
      const errors = cdp.events
        .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
        .map((e) => e.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
      const exceptions = cdp.events
        .filter((e) => e.method === 'Runtime.exceptionThrown')
        .map((e) => e.params.exceptionDetails?.text)
      const frames = cdp.events
        .filter((e) => e.method === 'Network.webSocketFrameSent' || e.method === 'Network.webSocketFrameReceived')
        .map((e) => String(e.params.response?.payloadData ?? e.params.response.payloadData ?? ''))
        .filter((data) => data.includes('workspace:') || data.includes('preview:'))
        .map((data) => data.slice(0, 140))
      console.log('   [network]', JSON.stringify(treeCalls))
      console.log('   [socket frames]', JSON.stringify(frames.slice(0, 12)))
      console.log('   [console errors]', JSON.stringify(errors.slice(0, 5)))
      console.log('   [exceptions]', JSON.stringify(exceptions.slice(0, 5)))
      console.log('   [server log]', JSON.stringify(apiLog.split('\n').filter((l) => l.includes('watcher') || l.includes('tree')).slice(-8)))
    }

    // ---- issue #2 in the browser: the LIVE PREVIEW really renders --------
    await navigate(`${API}/preview/${projectId}/index.html?token=${encodeURIComponent(token)}`)
    const preview = await waitFor(
      `if (!document.querySelector('h1')) return false;
       return JSON.stringify({
         bg: getComputedStyle(document.body).backgroundColor,
         h1: getComputedStyle(document.querySelector('h1')).color,
         sheets: document.styleSheets.length,
         saveTodo: typeof window.saveTodo,
       });`,
      15000,
      'the previewed page',
    )
    const previewData = JSON.parse(preview)
    check('preview serves the page (title + heading present)', Boolean(previewData), preview)
    check('linked stylesheet really applied in the browser', previewData.bg === 'rgb(15, 23, 42)' && previewData.h1 === 'rgb(167, 139, 250)', `body ${previewData.bg}, h1 ${previewData.h1}`)
    check('linked script really executed in the browser', previewData.saveTodo === 'function', previewData.saveTodo)
    const functional = await js(`
      window.saveTodo('buy milk');
      return localStorage.getItem('todos');
    `)
    check('the page is functional (JS writes localStorage)', functional === '["buy milk"]', String(functional))

    console.log(`\n${passed}/${passed + failed} checks passed`)
    process.exitCode = failed ? 1 : 0
  } catch (error) {
    console.error('FAIL:', error.message)
    process.exitCode = 1
  } finally {
    stop()
  }
}

await main()
