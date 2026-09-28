// TEMPORARY verification helper (deleted after the run): drives headless Chrome
// over CDP with Node's built-in WebSocket — no npm dependencies — so a test page
// can be loaded and measured with REAL layout (jsdom cannot do this).
// Usage: node tmp-cdp.mjs <file-url> <js-expression-returning-json>
import { spawn } from 'node:child_process'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const targetUrl = process.argv[2]
const expression = process.argv[3] || '() => document.title'
const PORT = 9333 + Math.floor(Math.random() * 400)

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.TEMP}\\cdp-${Date.now()}`,
    '--window-size=1200,900',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
)

let chromeErr = ''
chrome.stderr.on('data', (chunk) => {
  chromeErr += String(chunk)
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function json(pathname) {
  for (let i = 0; i < 100; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}${pathname}`)
      if (response.ok) return await response.json()
    } catch {}
    await sleep(100)
  }
  throw new Error(`CDP did not answer on :${PORT}\n${chromeErr}`)
}

let socket = null
function send(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e9)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 20000)
    const onMessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== id) return
      clearTimeout(timer)
      ws.removeEventListener('message', onMessage)
      if (message.error) reject(new Error(`${method}: ${message.error.message}`))
      else resolve(message.result)
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

try {
  const targets = await json('/json/list')
  const page = targets.find((entry) => entry.type === 'page')
  if (!page) throw new Error('no page target')

  socket = await new Promise((resolve, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    ws.addEventListener('open', () => resolve(ws), { once: true })
    ws.addEventListener('error', () => reject(new Error('websocket failed')), { once: true })
  })

  await send(socket, 'Page.enable')
  await send(socket, 'Page.navigate', { url: targetUrl })
  await sleep(1200)

  const result = await send(socket, 'Runtime.evaluate', {
    expression: `(${expression})()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) {
    console.error(JSON.stringify(result.exceptionDetails, null, 2))
    process.exitCode = 1
  } else {
    const value = result.result?.value
    console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
  }
} catch (error) {
  console.error('CDP ERROR:', error.message)
  process.exitCode = 1
} finally {
  try {
    socket?.close()
  } catch {}
  try {
    chrome.kill()
  } catch {}
}
