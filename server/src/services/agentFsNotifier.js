import crypto from 'node:crypto'

const BATCH_MS = 150
const MAX_CHANGES_PER_BATCH = 200

const emitters = new Map()
const queues = new Map()

export function workspaceRoomName(projectId) {
  return `workspace:${projectId}`
}

export function registerAgentFsEmitter(projectId, emitter) {
  if (!projectId || typeof emitter !== 'function') return false
  emitters.set(projectId, emitter)
  return true
}

export function unregisterAgentFsEmitter(projectId) {
  // Deliver whatever is still queued before the emitter goes away, so the last
  // file of a run never disappears from the Explorer.
  flushAgentFsChanges(projectId)
  emitters.delete(projectId)
  const queue = queues.get(projectId)
  if (queue?.timer) clearTimeout(queue.timer)
  queues.delete(projectId)
}

export function hasAgentFsEmitter(projectId) {
  return emitters.has(projectId)
}

function mergeType(previous, next) {
  if (!previous) return next
  if (previous === 'add' && next === 'change') return 'add'
  if (previous === 'unlink' || next === 'unlink') return 'unlink'
  return next
}

export function flushAgentFsChanges(projectId) {
  const queue = queues.get(projectId)
  if (!queue || queue.changes.size === 0) {
    if (queue?.timer) clearTimeout(queue.timer)
    queues.delete(projectId)
    return null
  }
  if (queue.timer) clearTimeout(queue.timer)
  queues.delete(projectId)
  const changes = [...queue.changes.entries()].map(([path, type]) => ({ path, type }))
  const emitter = emitters.get(projectId)
  if (!emitter) return null
  const payload = {
    projectId,
    changes,
    batchId: crypto.randomUUID(),
    at: Date.now(),
  }
  try {
    emitter(payload)
  } catch (error) {
    console.warn(`[agent] fs change emit failed for ${projectId}: ${error?.message ?? error}`)
    return null
  }
  return payload
}

export function queueAgentFsChange(projectId, change) {
  if (!projectId || !change?.path || !change?.type) return false
  if (!emitters.has(projectId)) return false

  let queue = queues.get(projectId)
  if (!queue) {
    queue = { changes: new Map(), timer: null }
    queues.set(projectId, queue)
  }
  const path = String(change.path).replace(/\\/g, '/').replace(/^\/+/, '')
  if (!path) return false
  queue.changes.set(path, mergeType(queue.changes.get(path), change.type))

  if (queue.changes.size >= MAX_CHANGES_PER_BATCH) {
    flushAgentFsChanges(projectId)
    return true
  }

  if (!queue.timer) {
    queue.timer = setTimeout(() => {
      const current = queues.get(projectId)
      if (current) current.timer = null
      flushAgentFsChanges(projectId)
    }, BATCH_MS)
    if (typeof queue.timer.unref === 'function') queue.timer.unref()
  }
  return true
}

export const __testables = { BATCH_MS, emitters, queues }
