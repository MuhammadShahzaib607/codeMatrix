import fs from 'node:fs'
import http from 'node:http'
import { Server } from 'socket.io'
import app from './src/app.js'
import { connectDatabase } from './src/config/db.js'
import { env, resolveCorsOrigin } from './src/config/env.js'
import registerTerminalSocket from './src/socket/terminalSocket.js'
import { WORKSPACES_ROOT } from './src/utils/workspaceManager.js'

// Make sure the ephemeral storage root exists before anything writes to it.
fs.mkdirSync(WORKSPACES_ROOT, { recursive: true })

const server = http.createServer(app)

// Socket.IO shares the same HTTP server as Express.
const io = new Server(server, {
  cors: { origin: resolveCorsOrigin(), methods: ['GET', 'POST'] },
})

registerTerminalSocket(io)

async function start() {
  await connectDatabase()

  server.listen(env.port, () => {
    console.log(`[server] listening on http://localhost:${env.port}`)
    console.log(`[server] health check: http://localhost:${env.port}/api/health`)
    console.log(`[server] workspaces root: ${WORKSPACES_ROOT}`)
    console.log('[server] NOTE: workspace files on disk are ephemeral on the free tier.')
  })
}

// Never leave shell processes behind when the process is stopped.
function shutdown(signal) {
  console.log(`[server] ${signal} received, shutting down.`)
  io.close()
  server.close(() => process.exit(0))
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

start()

export { server, io }
