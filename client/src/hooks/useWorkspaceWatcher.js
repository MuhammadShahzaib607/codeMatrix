import { useEffect, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { refreshWorkspaceTree } from '../features/workspaceThunks'
import { getSocket } from '../services/socket'
import { hasActiveWorkspace } from '../utils/workspace'

// The server already debounces (750ms), but a second short debounce on the
// client coalesces anything that still arrives in quick succession — including
// events triggered by our own save — into one GET /tree.
const REFRESH_DEBOUNCE_MS = 400

/**
 * Keeps the Explorer in step with the folder on disk. While a project is active
 * we tell the server to watch it; when the server reports a change we re-fetch
 * the tree automatically, so `npm install` (or any terminal command that adds or
 * removes files) appears in the Explorer with no manual refresh.
 */
export default function useWorkspaceWatcher() {
  const dispatch = useDispatch()
  // Depend on primitives only: the workspace object identity changes on every
  // tree refresh, which would otherwise tear the watcher down and rebuild it.
  const projectId = useSelector((state) => state.fileSystem.workspace.projectId)
  const source = useSelector((state) => state.fileSystem.workspace.source)
  const timerRef = useRef(null)

  useEffect(() => {
    if (!hasActiveWorkspace({ projectId, source })) return undefined

    const socket = getSocket()
    socket.emit('workspace:watch', { projectId })

    function scheduleRefresh() {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        dispatch(refreshWorkspaceTree({ projectId }))
      }, REFRESH_DEBOUNCE_MS)
    }

    function handleTreeChanged(payload) {
      if (payload?.projectId !== projectId) return
      scheduleRefresh()
    }

    socket.on('workspace:treeChanged', handleTreeChanged)

    return () => {
      socket.off('workspace:treeChanged', handleTreeChanged)
      socket.emit('workspace:unwatch', { projectId })
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [projectId, source, dispatch])
}
