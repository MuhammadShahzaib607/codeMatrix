import jwt from 'jsonwebtoken'
import { isDatabaseConnected } from '../config/db.js'
import { env } from '../config/env.js'
import { findProject } from '../models/project.repository.js'
import { resolveKeyForUser } from '../services/apiKeyService.js'
import { runAgent } from '../services/agentService.js'
import { workspaceExists } from '../utils/workspaceManager.js'

// ---------------------------------------------------------------------------
// The agent's real-time channel.
//
//   client -> server: agent:run { token, projectId, task, framework, keyId? }
//                     (ack)     { ok: true } | { ok: false, message }
//   server -> client: agent:action { type, description, details, actionId, at }
//                     agent:done   { ok, message, toolCalls, durationMs, ... }
//
// The JWT is verified here (the socket layer itself is unauthenticated for
// terminal/workspace events), the project's ownership is checked the same way
// the REST routes do it, and the Groq key is chosen from the caller's OWN
// saved keys — decrypted in memory for exactly this run.
// ---------------------------------------------------------------------------

function verifyUser(token) {
  try {
    const payload = jwt.verify(String(token ?? ''), env.jwtSecret)
    return payload?.id ?? null
  } catch {
    return null
  }
}

export default function registerAgentSocket(io) {
  io.on('connection', (socket) => {
    // One agent run per connection: a second request is rejected instead of
    // interleaving two loops' tool results.
    let active = false

    socket.on('agent:run', async (payload, acknowledge) => {
      const ack = typeof acknowledge === 'function' ? acknowledge : () => {}

      try {
        if (active) {
          ack({ ok: false, message: 'An agent task is already running. Let it finish first.' })
          return
        }

        const userId = verifyUser(payload?.token)
        if (!userId) {
          ack({
            ok: false,
            message: 'Please sign in to use the AI assistant.',
            code: 'UNAUTHORIZED',
          })
          return
        }

        const projectId = String(payload?.projectId ?? '')
        const task = String(payload?.task ?? '').trim()
        if (!projectId || !workspaceExists(projectId)) {
          ack({
            ok: false,
            message: 'Open a project first — the agent needs a workspace to work in.',
            code: 'WORKSPACE_MISSING',
          })
          return
        }
        if (!task) {
          ack({ ok: false, message: 'Describe the task you want the agent to do.' })
          return
        }

        // Ownership: same rule as the REST routes (record's owner must match).
        if (isDatabaseConnected()) {
          const project = await findProject(projectId)
          if (project && String(project.owner) !== userId) {
            ack({ ok: false, message: 'You do not have access to this project.', code: 'FORBIDDEN' })
            return
          }
        }

        // Pick ONE of the user's saved keys (explicit keyId, else newest) and
        // decrypt it in-memory for this run only. Never sent anywhere.
        let key
        try {
          key = await resolveKeyForUser(userId, payload?.keyId ?? null)
        } catch (error) {
          ack({
            ok: false,
            message: error.message,
            code: error.code ?? 'NO_KEYS',
          })
          return
        }

        active = true
        ack({ ok: true, started: true })

        const emit = (event) => {
          if (socket.connected) socket.emit('agent:action', event)
        }

        try {
          const result = await runAgent({
            projectId,
            task,
            framework: payload?.framework,
            apiKey: key.plain,
            emit,
          })
          if (socket.connected) {
            socket.emit('agent:done', {
              ok: true,
              message: result.message,
              toolCalls: result.toolCalls,
              durationMs: result.durationMs,
              limitReached: Boolean(result.limitReached),
            })
          }
        } catch (error) {
          if (socket.connected) {
            socket.emit('agent:done', {
              ok: false,
              message: error.message,
              code: error.code ?? null,
            })
          }
        } finally {
          active = false
          // The plaintext key lives only in this scope; drop our reference now.
          key = null
        }
      } catch (error) {
        active = false
        ack({ ok: false, message: error.message ?? 'The agent could not start.' })
      }
    })
  })
}
