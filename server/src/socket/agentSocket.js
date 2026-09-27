import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { isDatabaseConnected } from '../config/db.js'
import { env } from '../config/env.js'
import { findProject, upsertProject } from '../models/project.repository.js'
import { resolveKeysForUser } from '../services/apiKeyService.js'
import { deriveProjectName, runAgent } from '../services/agentService.js'
import {
  ensureScratchWorkspace,
  getWorkspaceRecord,
  isScratchProjectId,
  renameWorkspaceFolder,
} from '../utils/workspaceManager.js'

// The default on-disk folder name a scratch workspace is registered under. Once
// it has been renamed, the workspace has been adopted as a real project.
const SCRATCH_FOLDER_NAME = 'Scratch'

/**
 * Turns an ANONYMOUS scratch workspace ("Scratch", id scratch-<userId>) into a
 * named, tracked project the first time the agent runs a task in it.
 *
 * The project name is derived from the task itself ("Create a todo app with
 * localStorage" -> "todo-app"), the folder is renamed on disk using the SAME
 * collision-safe naming as regular imports, a Project record is created in
 * MongoDB, and a 'project' event is streamed so the Explorer root label and the
 * topbar chip update immediately.
 *
 * The project id is deliberately UNCHANGED: the folder (and therefore every
 * path the agent's tools resolve) keeps working mid-run. A real imported project
 * is never touched — this only applies to a scratch id.
 */
async function maybeAdoptScratchProject({ projectId, task, userId, emit }) {
  if (!isScratchProjectId(projectId)) return null

  const record = getWorkspaceRecord(projectId)
  const alreadyNamed = Boolean(record && record.folderName !== SCRATCH_FOLDER_NAME)
  if (alreadyNamed) {
    const existing = isDatabaseConnected() ? await findProject(projectId) : null
    const name = existing?.name || record.folderName
    return { projectId, name, adopted: false }
  }

  const name = deriveProjectName(task)
  const folder = renameWorkspaceFolder(projectId, { displayName: name })
  if (!folder) return null

  if (isDatabaseConnected()) {
    await upsertProject({
      projectId,
      name,
      owner: userId,
      diskPath: folder.path,
      diskFolderName: folder.folderName,
    })
  }

  emit({
    type: 'project',
    description: `Named this workspace “${name}” from your task.`,
    details: { status: 'done', projectId, name, tool: 'project' },
    actionId: crypto.randomUUID(),
    at: Date.now(),
  })

  return { projectId, name, adopted: true }
}

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

        // Transition a scratch workspace into a named, tracked project before
        // the first tool call, so the UI shows a real name from the start. A
        // failure here must never block the task itself.
        try {
          await maybeAdoptScratchProject({ projectId, task, userId, emit })
        } catch (error) {
          console.warn(`[agent] scratch adoption failed for ${projectId}: ${error.message}`)
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
