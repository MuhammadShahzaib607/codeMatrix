import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import {
  startWatchingContainer,
  startWatchingProject,
  stopWatchingContainer,
  stopWatchingProject,
} from '../utils/fileWatcher.js'
import { getOwnerContainerPath, isValidProjectId } from '../utils/workspaceManager.js'

export function roomFor(projectId) {
  return `workspace:${projectId}`
}

function verifyUser(token) {
  try {
    const payload = jwt.verify(String(token ?? ''), env.jwtSecret)
    return payload?.id ?? null
  } catch {
    return null
  }
}

/**
 * Collaborates with the client's active project:
 *
 *   client -> server: workspace:watch   { projectId }   (project opened/active)
 *                     preview:watch    { projectId }   (a live-preview tab loaded)
 *                     workspace:unwatch { projectId }   (project changed/closed)
 *   server -> client: workspace:treeChanged { projectId } (debounced, to that
 *                     project's room — the client re-fetches the tree)
 *                     workspace:fsChanged { projectId, changes: [{path,type}] }
 *                     (batched by the agent tool executor, ~150ms — the client
 *                     applies the change to the tree incrementally)
 *                     preview:reload      { projectId } (debounced, to that
 *                     project's room — an open preview tab calls location.reload())
 *
 * Watching is reference-counted per socket, so several tabs (or a reconnect)
 * never spin up duplicate watchers and the watcher is closed as soon as the last
 * interested client goes away. A preview tab takes the SAME kind of reference,
 * so a preview left open with no editor connected keeps the watcher — and
 * therefore live reload — alive on its own.
 */
export default function registerWorkspaceSocket(io) {
  io.on('connection', (socket) => {
    // projectIds this particular socket is watching, so we can release exactly
    // as many references as we took on disconnect.
    const watched = new Set()

    // One watcher serves both signals: the Explorer's tree refresh and the live
    // preview's reload. Consumers that only care about one simply ignore the
    // other event.
    const watchProject = (projectId) => {
      socket.join(roomFor(projectId))
      return startWatchingProject(
        projectId,
        (id) => io.to(roomFor(id)).emit('workspace:treeChanged', { projectId: id }),
        (id) => io.to(roomFor(id)).emit('preview:reload', { projectId: id }),
      )
    }

    socket.on('workspace:watch', (payload) => {
      const projectId = payload?.projectId
      if (!isValidProjectId(projectId) || watched.has(projectId)) return

      // Remember it even when the folder is missing right now: watch it anyway
      // on the next call, and make sure the reference is balanced either way.
      if (watchProject(projectId)) watched.add(projectId)
    })

    // Emitted by the injected live-reload script in a /preview tab.
    socket.on('preview:watch', (payload) => {
      const projectId = payload?.projectId
      if (!isValidProjectId(projectId) || watched.has(projectId)) return
      if (watchProject(projectId)) watched.add(projectId)
    })

    socket.on('workspace:unwatch', (payload) => {
      const projectId = payload?.projectId
      if (!projectId || !watched.has(projectId)) return
      watched.delete(projectId)
      socket.leave(roomFor(projectId))
      stopWatchingProject(projectId)
    })

    // The Explorer's tree is the WHOLE container, so a top-level folder created
    // outside the active project (terminal, another project, a new sibling) is
    // invisible to the per-project watcher. The container gets its own watcher.
    const watchedContainers = new Set()

    socket.on('container:watch', (payload, acknowledge) => {
      const ack = typeof acknowledge === 'function' ? acknowledge : () => {}
      const userId = verifyUser(payload?.token)
      if (!userId) {
        ack({ ok: false, code: 'UNAUTHORIZED' })
        return
      }
      const containerPath = getOwnerContainerPath(userId)
      socket.join(`container:user:${userId}`)
      if (watchedContainers.has(containerPath)) {
        ack({ ok: true })
        return
      }
      const started = startWatchingContainer(containerPath, () =>
        io.to(`container:user:${userId}`).emit('container:treeChanged', { userId }),
      )
      if (started) watchedContainers.add(containerPath)
      ack({ ok: started })
    })

    socket.on('container:unwatch', () => {
      for (const containerPath of watchedContainers) stopWatchingContainer(containerPath)
      watchedContainers.clear()
    })

    socket.on('disconnect', () => {
      // socket.io has already removed the socket from its rooms.
      for (const projectId of watched) stopWatchingProject(projectId)
      watched.clear()
      for (const containerPath of watchedContainers) stopWatchingContainer(containerPath)
      watchedContainers.clear()
    })
  })
}
