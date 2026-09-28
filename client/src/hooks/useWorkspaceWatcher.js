import { useEffect, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { markChangedOnDisk, removeContent } from '../features/editorSlice'
import { applyFsChanges } from '../features/fileSystemSlice'
import { readWorkspaceFile, refreshWorkspaceTree } from '../features/workspaceThunks'
import { getSocket } from '../services/socket'
import { hasActiveWorkspace } from '../utils/workspace'

// The server already debounces its chokidar notify (750ms), but a second short
// debounce on the client coalesces anything that still arrives in quick
// succession — including events triggered by our own save — into one GET /tree.
const REFRESH_DEBOUNCE_MS = 400

// Reconciliation for agent-driven changes: the incremental update lands
// immediately, this background refetch (leading + trailing) fixes ordering and
// anything the event stream missed. It is deliberately slower than the
// incremental path so the Explorer never waits for a full tree walk.
const RECONCILE_MS = 500

export default function useWorkspaceWatcher() {
  const dispatch = useDispatch()
  // Depend on primitives only: the workspace object identity changes on every
  // tree refresh, which would otherwise tear the watcher down and rebuild it.
  const projectId = useSelector((state) => state.fileSystem.workspace.projectId)
  const source = useSelector((state) => state.fileSystem.workspace.source)
  const openTabs = useSelector((state) => state.fileSystem.openTabs)
  const unsavedFileIds = useSelector((state) => state.editor.unsavedFileIds)
  const timerRef = useRef(null)
  const reconcileRef = useRef(null)
  const tabsRef = useRef({ openTabs: [], unsavedFileIds: [] })

  useEffect(() => {
    tabsRef.current = { openTabs, unsavedFileIds }
  }, [openTabs, unsavedFileIds])

  useEffect(() => {
    if (!hasActiveWorkspace({ projectId, source })) return undefined

    const socket = getSocket()
    socket.emit('workspace:watch', { projectId })

    // A reconnect (server restart, tunnel hiccup) drops the rooms the socket was
    // in, so the watch subscription is re-sent on every connect.
    function handleConnect() {
      socket.emit('workspace:watch', { projectId })
    }
    socket.on('connect', handleConnect)

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

    /**
     * The agent's own tool results. Files appear one by one: the tree is patched
     * in place (with new folders opened) and one throttled refetch runs behind
     * it as reconciliation.
     */
    function handleFsChanged(payload) {
      if (payload?.projectId !== projectId) return
      const changes = Array.isArray(payload.changes) ? payload.changes : []
      if (changes.length === 0) return

      dispatch(applyFsChanges({ changes }))

      const removed = changes
        .filter((change) => change.type === 'unlink' || change.type === 'unlinkDir')
        .map((change) => change.path)
      if (removed.length > 0) dispatch(removeContent(removed))

      const { openTabs: openIds, unsavedFileIds: dirtyIds } = tabsRef.current
      for (const change of changes) {
        if (change.type === 'unlink' || change.type === 'unlinkDir') continue
        if (!openIds.includes(change.path)) continue
        if (dirtyIds.includes(change.path)) {
          // Never throw away what the user typed: keep the buffer and mark the
          // tab so the change on disk is visible instead of silent.
          dispatch(markChangedOnDisk(change.path))
          continue
        }
        dispatch(readWorkspaceFile({ projectId, path: change.path, fileId: change.path }))
      }

      if (!reconcileRef.current) {
        dispatch(refreshWorkspaceTree({ projectId }))
        reconcileRef.current = setTimeout(() => {
          reconcileRef.current = null
          dispatch(refreshWorkspaceTree({ projectId }))
        }, RECONCILE_MS)
      }
    }

    socket.on('workspace:treeChanged', handleTreeChanged)
    socket.on('workspace:fsChanged', handleFsChanged)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('workspace:treeChanged', handleTreeChanged)
      socket.off('workspace:fsChanged', handleFsChanged)
      socket.emit('workspace:unwatch', { projectId })
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (reconcileRef.current) {
        clearTimeout(reconcileRef.current)
        reconcileRef.current = null
      }
    }
  }, [projectId, source, dispatch])
}
