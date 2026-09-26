import { startWatchingProject, stopWatchingProject } from '../utils/fileWatcher.js'
import { isValidProjectId } from '../utils/workspaceManager.js'

function roomFor(projectId) {
  return `workspace:${projectId}`
}

/**
 * Collaborates with the client's active project:
 *
 *   client -> server: workspace:watch   { projectId }   (project opened/active)
 *                     workspace:unwatch { projectId }   (project changed/closed)
 *   server -> client: workspace:treeChanged { projectId } (debounced, to that
 *                     project's room — the client re-fetches the tree)
 *
 * Watching is reference-counted per socket, so several tabs (or a reconnect)
 * never spin up duplicate watchers and the watcher is closed as soon as the last
 * interested client goes away.
 */
export default function registerWorkspaceSocket(io) {
  io.on('connection', (socket) => {
    // projectIds this particular socket is watching, so we can release exactly
    // as many references as we took on disconnect.
    const watched = new Set()

    socket.on('workspace:watch', (payload) => {
      const projectId = payload?.projectId
      if (!isValidProjectId(projectId) || watched.has(projectId)) return

      socket.join(roomFor(projectId))
      const started = startWatchingProject(projectId, (id) => {
        io.to(roomFor(id)).emit('workspace:treeChanged', { projectId: id })
      })
      // Remember it even when the folder is missing right now: watch it anyway
      // on the next call, and make sure the reference is balanced either way.
      if (started) watched.add(projectId)
    })

    socket.on('workspace:unwatch', (payload) => {
      const projectId = payload?.projectId
      if (!projectId || !watched.has(projectId)) return
      watched.delete(projectId)
      socket.leave(roomFor(projectId))
      stopWatchingProject(projectId)
    })

    socket.on('disconnect', () => {
      // socket.io has already removed the socket from its rooms.
      for (const projectId of watched) stopWatchingProject(projectId)
      watched.clear()
    })
  })
}
