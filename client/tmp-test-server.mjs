// TEMPORARY helper (deleted after verification): boots the scripted mock Groq +
// a throwaway API server on its own ports, so a test does not depend on a dev
// server already running.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export async function startTestEnvironment({ serverPort = 4101, groqPort = 4955 } = {}) {
  process.env.MOCK_GROQ_PORT = String(groqPort)
  const mock = await import(pathToFileURL(path.join(ROOT, 'tmp-mock-groq.mjs')).href)

  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(serverPort),
      GROQ_BASE_URL: `http://localhost:${groqPort}`,
      CLIENT_ORIGIN: 'http://localhost:5173',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs = []
  let exitCode = null
  child.stdout.on('data', (data) => logs.push(String(data)))
  child.stderr.on('data', (data) => logs.push(String(data)))
  child.on('exit', (code) => {
    exitCode = code
  })

  const api = `http://localhost:${serverPort}`
  const deadline = Date.now() + 30000
  for (;;) {
    if (exitCode !== null) {
      throw new Error(`test server exited early (code ${exitCode}):\n${logs.join('')}`)
    }
    if (Date.now() > deadline) throw new Error(`test server did not start:\n${logs.join('')}`)
    try {
      const response = await fetch(`${api}/api/health`)
      if (response.ok) break
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  return {
    api,
    mockState: mock.mockState,
    stop() {
      try {
        child.kill('SIGKILL')
      } catch {}
      try {
        mock.mockServer.close()
      } catch {}
    },
  }
}
