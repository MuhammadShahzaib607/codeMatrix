import fs from 'node:fs'
import http from 'node:http'
import { Server } from 'socket.io'
import app from './src/app.js'
import { connectDatabase, isDatabaseConnected } from './src/config/db.js'
import { migrateLegacyGroqKeys } from './src/models/ApiKey.model.js'
import { env, resolveCorsOrigin } from './src/config/env.js'
import registerAgentSocket from './src/socket/agentSocket.js'
import registerTerminalSocket from './src/socket/terminalSocket.js'
import registerWorkspaceSocket from './src/socket/workspaceSocket.js'
import { closeAllWatchers } from './src/utils/fileWatcher.js'
import { killAllTerminals } from './src/utils/terminalManager.js'
import { migrateWorkspaceFolders } from './src/utils/workspaceMigration.js'
import { WORKSPACES_ROOT } from './src/utils/workspaceManager.js'
import { describeProcess, findListeningPid } from './src/utils/portOwner.js'

fs.mkdirSync(WORKSPACES_ROOT, { recursive: true })  

// node-pty's Windows ConPTY kill path fires a helper and, if the shell already
// exited, throws inside a fire-and-forget .then(). node-pty exposes no hook for
// it, so an unhandled rejection there would otherwise take the whole server
// down. Keep the process alive and log it instead.
process.on('unhandledRejection', (reason) => {
  const message = reason?.stack ?? reason?.message ?? String(reason)
  console.error(`[server] unhandled rejection (kept alive): ${message}`)
})

const server = http.createServer(app);

let shuttingDown = false

function onListening() {
  console.log(`[server] listening on http://localhost:${env.port}`)
  console.log(`[server] health check: http://localhost:${env.port}/api/health`)
  console.log(`[server] workspaces root: ${WORKSPACES_ROOT}`)
  console.log('[server] NOTE: workspace files on disk are ephemeral on the free tier.')
}

function reportPortInUse() {
  const pid = findListeningPid(env.port)
  const owner = pid ? `by PID ${pid} (${describeProcess(pid)})` : 'by another process'
  console.error(
    `[server] Port ${env.port} is already in use ${owner}. Run "npm run predev" in server/ to free it when that is a stale CodeMatrix server.`,
  )
}

// Fail gracefully on listen errors instead of dumping an unhandled stack trace.
server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err
  reportPortInUse()
  process.exit(1)
})

const io = new Server(server, {
  cors: { origin: resolveCorsOrigin(), methods: ['GET', 'POST'] },
  maxHttpBufferSize: 25 * 1024 * 1024,
})

registerTerminalSocket(io)
registerWorkspaceSocket(io)
registerAgentSocket(io)

async function start() {
  await connectDatabase()

  if (isDatabaseConnected()) {
    try {
      const { migrated, normalised } = await migrateLegacyGroqKeys()
      if (migrated > 0) console.log(`[keys] migrated ${migrated} legacy Groq key(s) to provider "groq"`)
      if (normalised > 0) console.log(`[keys] normalised ${normalised} key(s) to a supported provider`)
    } catch (error) {
      console.warn(`[keys] legacy key migration failed: ${error.message}`)
    }
  }

  // Rename any legacy UUID-named project folders to their display-name names so
  // every existing project matches its Explorer root (and `cd <name>` works).
  try {
    const { migrated, checked } = await migrateWorkspaceFolders()
    if (checked > 0) {
      console.log(`[workspace] folder migration: checked ${checked}, renamed ${migrated}`)
    }
  } catch (error) {
    console.warn(`[workspace] folder migration failed: ${error.message}`)
  }

  server.listen(env.port, onListening)
}

function exitNow() {
  process.exit(0)
}

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[server] ${signal} received, shutting down.`)
  killAllTerminals()
  try {
    await closeAllWatchers()
  } catch (error) {
    console.warn(`[server] watcher shutdown failed: ${error?.message ?? error}`)
  }
  server.closeAllConnections?.()
  try {
    io.close()
  } catch {}
  server.close(exitNow)
  setTimeout(exitNow, 3000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGBREAK', () => shutdown('SIGBREAK'))
process.on('exit', () => killAllTerminals())

start()

export { server, io }
