import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { isDatabaseConnected } from '../config/db.js'
import { env } from '../config/env.js'
import { findProject } from '../models/project.repository.js'
import { resolveKeysForUser } from '../services/apiKeyService.js'
import { runAgent } from '../services/agentService.js'
import { hasResumableSession } from '../services/agentSessionService.js'
import { adoptScratchProject } from '../services/scratchProjectService.js'
import { sanitizeStrictRules } from '../services/strictRules.js'
import { ensureScratchWorkspace, isScratchProjectId } from '../utils/workspaceManager.js'

// ---------------------------------------------------------------------------
// The agent's real-time channel.
//
//   client -> server: agent:run    { token, projectId, task, framework, keyId? }
//                     (ack)        { ok: true, started: true, runId, startedAt }
//                                  | { ok: false, message }
//                     agent:attach { token }  re-join the run after a reconnect
//                     (ack)        { ok, active, runId, startedAt }
//                     agent:stop   { token }  end the current run deliberately
//   server -> client: agent:action { type, description, details, actionId, at }
//                     agent:delta  { runId, text }  live assistant text, token by
//                                  token; { runId, text: '', reset: true } drops
//                                  text that a non-streamed retry is replacing
//                     agent:done   { ok, message, toolCalls, durationMs, startedAt,
//                                    requests, totalTokens, stopped, ... }
//
// The JWT is verified here (the socket layer itself is unauthenticated for
// terminal/workspace events), the project's ownership is checked the same way
// the REST routes do it, and the Groq key is chosen from the caller's OWN
// saved keys — decrypted in memory for exactly this run.
// ---------------------------------------------------------------------------

const activeRuns = new Map()
const stopRequests = new Set()

const userRoom = (userId) => `agent-user:${userId}`

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

    socket.on('agent:attach', (payload, acknowledge) => {
      const ack = typeof acknowledge === 'function' ? acknowledge : () => {}
      const userId = verifyUser(payload?.token)
      if (!userId) {
        ack({ ok: false, code: 'UNAUTHORIZED' })
        return
      }
      socket.join(userRoom(userId))
      const run = activeRuns.get(userId)
      ack({
        ok: true,
        active: Boolean(run),
        runId: run?.runId ?? null,
        startedAt: run?.startedAt ?? null,
      })
    })

    socket.on('agent:stop', (payload, acknowledge) => {
      const ack = typeof acknowledge === 'function' ? acknowledge : () => {}
      const userId = verifyUser(payload?.token)
      if (!userId) {
        ack({ ok: false, code: 'UNAUTHORIZED' })
        return
      }
      if (activeRuns.has(userId)) stopRequests.add(userId)
      ack({ ok: true })
    })

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

        if (activeRuns.has(userId)) {
          ack({
            ok: false,
            message: 'An agent task is already running. Let it finish first.',
            code: 'ALREADY_RUNNING',
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

        const wantsResume = payload?.resume === true
        const strictRules = sanitizeStrictRules(payload?.strictRules)
        if (wantsResume && !hasResumableSession(projectId)) {
          ack({
            ok: false,
            message: 'There is no paused task to continue in this workspace.',
            code: 'NO_SESSION',
          })
          return
        }

        active = true
        // One id per run: every streamed delta carries it, so a client that has
        // already moved on (or a resumed run) can ignore stale text.
        const runId = crypto.randomUUID()
        const startedAt = Date.now()
        socket.join(userRoom(userId))
        stopRequests.delete(userId)
        activeRuns.set(userId, { runId, startedAt, task, projectId })
        ack({ ok: true, started: true, runId, startedAt })

        const room = io.to(userRoom(userId))
        const emit = (event) => {
          room.emit('agent:action', event)
        }

        const emitDelta = (delta) => {
          if (!delta) return
          room.emit('agent:delta', { runId, text: delta.text ?? '', reset: Boolean(delta.reset) })
        }

        const emitUsage = (usage) => {
          room.emit('usage:update', usage)
        }

        // Turn an anonymous scratch workspace into a real, NAMED project.
        //
        // The name is settled BEFORE the first tool call runs:
        //   1. `adopt(null)` below renames any still-anonymous folder to a slug
        //      derived from the task, so the agent's very first file-write
        //      already lands in the final project folder (a true top-level
        //      folder rename — contents keep their relative paths);
        //   2. the model is asked to open its first message with a PROJECT_NAME
        //      line, so a BETTER name from the model renames the folder again as
        //      soon as that message arrives — still before any file is written;
        //   3. the `finally` below is the safety net for a run that dies before
        //      either chance to name it.
        // Either way the workspace is never left called "Scratch", and no file
        // is ever written into a generic Scratch container.
        const scratchRun = isScratchProjectId(projectId)
        let scratchAdopted = false
        const adopt = async (suggestedName = null) => {
          if (!scratchRun) return
          try {
            const result = await adoptScratchProject({
              projectId,
              task,
              userId,
              emit,
              modelSuggestedName: suggestedName,
              framework: payload?.framework,
              fresh: !wantsResume,
            })
            if (result?.adopted) scratchAdopted = true
          } catch (error) {
            console.warn(`[agent] scratch adoption failed for ${projectId}: ${error.message}`)
          }
        }

        // The workspace is named from the plan's project_name (see runAgent's
        // onProjectName) or, when the plan omits it, from the framework.
        await adopt(null)

        try {
          const result = await runAgent({
            projectId,
            task,
            framework: payload?.framework,
            apiKeys: keys,
            emit,
            emitUsage,
            emitDelta,
            userId,
            requestedModel: payload?.model ?? null,
            requestedProvider: payload?.provider ?? null,
            providerPreference: payload?.providerPreference ?? 'auto',
            taskId: crypto.randomUUID(),
            resume: wantsResume,
            runStartedAt: startedAt,
            shouldStop: () => stopRequests.has(userId),
            onProjectName: (name) => adopt(name),
            strictRules,
          })
          room.emit('agent:done', {
            ok: true,
            message: result.message,
            toolCalls: result.toolCalls,
            durationMs: result.durationMs,
            startedAt,
            limitReached: Boolean(result.limitReached),
            stopped: Boolean(result.stopped),
            requests: result.requests ?? 0,
            totalTokens: result.totalTokens ?? 0,
            model: result.model,
            provider: result.provider ?? null,
          })
        } catch (error) {
          room.emit('agent:done', {
            ok: false,
            message: error.message,
            code: error.code ?? null,
            startedAt,
          })
        } finally {
          // Safety net: if the run failed before the model named the project,
          // still give the scratch workspace a real name derived from the task.
          if (scratchRun && !scratchAdopted) await adopt(null)
          active = false
          activeRuns.delete(userId)
          stopRequests.delete(userId)
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
