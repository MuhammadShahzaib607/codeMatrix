import jwt from 'jsonwebtoken'
import { isDatabaseConnected } from '../config/db.js'
import { env } from '../config/env.js'
import { findProject } from '../models/project.repository.js'
import { resolveKeysForUser } from '../services/apiKeyService.js'
import { runAgent } from '../services/agentService.js'
import { adoptScratchProject } from '../services/scratchProjectService.js'
import { ensureScratchWorkspace, isScratchProjectId } from '../utils/workspaceManager.js'

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
        if (!projectId) {
          ack({
            ok: false,
            message: 'The agent needs a workspace to work in.',
            code: 'WORKSPACE_MISSING',
          })
          return
        }
        if (!task) {
          ack({ ok: false, message: 'Describe the task you want the agent to do.' })
          return
        }

        // No "the workspace must already exist / have files" pre-check. A
        // completely empty workspace is a perfectly normal starting point: the
        // agent's first actions simply create the scaffolding. Scratch
        // workspaces are throwaway and created on demand, so make sure the
        // folder is there before the tools write into it.
        if (isScratchProjectId(projectId)) ensureScratchWorkspace(projectId)

        // Ownership: same rule as the REST routes (record's owner must match).
        if (isDatabaseConnected()) {
          const project = await findProject(projectId)
          if (project && String(project.owner) !== userId) {
            ack({ ok: false, message: 'You do not have access to this project.', code: 'FORBIDDEN' })
            return
          }
        }

        // ALL of the user's saved keys, preference-first (explicit keyId, else
        // newest), decrypted in-memory for this run only. The agent's fallback
        // chain cycles through them when one is rate-limited. Never sent on.
        let keys
        try {
          keys = await resolveKeysForUser(userId, payload?.keyId ?? null)
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

        // The rate-limit snapshot captured from the most recent Groq response,
        // streamed alongside the action feed so the AI panel's usage indicator
        // updates live without polling.
        const emitUsage = (usage) => {
          if (socket.connected) socket.emit('agent:usage', usage)
        }

        // Turn an anonymous scratch workspace into a real, NAMED project. The
        // model is asked to open its first message with a PROJECT_NAME line, so
        // adoption runs as soon as that first message arrives; a run that fails
        // before the model speaks is adopted in the `finally` below. Either way
        // the workspace is never left called "Scratch".
        const scratchRun = isScratchProjectId(projectId)
        let scratchAdopted = false
        const adopt = async (modelSuggestedName = null) => {
          if (!scratchRun) return
          try {
            const result = await adoptScratchProject({
              projectId,
              task,
              userId,
              emit,
              modelSuggestedName,
            })
            if (result?.adopted) scratchAdopted = true
          } catch (error) {
            console.warn(`[agent] scratch adoption failed for ${projectId}: ${error.message}`)
          }
        }

        try {
          const result = await runAgent({
            projectId,
            task,
            framework: payload?.framework,
            apiKeys: keys,
            emit,
            emitUsage,
            userId,
            onProjectName: (name) => adopt(name),
          })
          if (socket.connected) {
            socket.emit('agent:done', {
              ok: true,
              message: result.message,
              toolCalls: result.toolCalls,
              durationMs: result.durationMs,
              limitReached: Boolean(result.limitReached),
              model: result.model,
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
          // Safety net: if the run failed before the model named the project,
          // still give the scratch workspace a real name derived from the task.
          if (scratchRun && !scratchAdopted) await adopt(null)
          active = false
          // The plaintext keys live only in this scope; drop the references now.
          keys = null
        }
      } catch (error) {
        active = false
        ack({ ok: false, message: error.message ?? 'The agent could not start.' })
      }
    })
  })
}
