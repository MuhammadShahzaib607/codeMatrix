import { useEffect, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { markChangedOnDisk, removeContent } from '../features/editorSlice'
import { applyFsChanges } from '../features/fileSystemSlice'
import { readWorkspaceFile, refreshWorkspaceTree } from '../features/workspaceThunks'
import { getAuthToken } from '../services/api'
import { getSocket } from '../services/socket'
import { projectFolderNameForId } from '../utils/containerPaths'
import { hasActiveWorkspace } from '../utils/workspace'

// The server already debounces its chokidar notify (750ms), but a second short
// debounce on the client coalesces anything that still arrives in quick
// succession — including events triggered by our own save — into one tree fetch.
const REFRESH_DEBOUNCE_MS = 400

// Reconciliation for agent-driven changes: the incremental update lands
// immediately, this background refetch (leading + trailing) fixes ordering and
// anything the event stream missed. It is deliberately slower than the
// incremental path so the Explorer never waits for a full tree walk.
const RECONCILE_MS = 500

export default function useWorkspaceWatcher() {
  const dispatch = useDispatch()
  const projectId = useSelector((state) => state.fileSystem.workspace.projectId)
  const source = useSelector((state) => state.fileSystem.workspace.source)
  const tree = useSelector((state) => state.fileSystem.tree)
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)
  const openTabs = useSelector((state) => state.fileSystem.openTabs)
  const unsavedFileIds = useSelector((state) => state.editor.unsavedFileIds)
  const timerRef = useRef(null)
  const reconcileRef = useRef(null)
  const treeRef = useRef(tree)
  const tabsRef = useRef({ openTabs: [], unsavedFileIds: [] })

  useEffect(() => {
    treeRef.current = tree
  }, [tree])

  useEffect(() => {
    tabsRef.current = { openTabs, unsavedFileIds }
  }, [openTabs, unsavedFileIds])

  // The Explorer's tree is the user's WHOLE container, so it is watched at the
  // container level: a new sibling folder created by the terminal (or another
  // project) refreshes it live, not just changes inside the focused project.
  useEffect(() => {
    if (!isAuthenticated) return undefined

    const socket = getSocket()
    const watchContainer = () => socket.emit('container:watch', { token: getAuthToken() })
    watchContainer()

    function handleConnect() {
      watchContainer()
    }

    function scheduleRefresh() {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        dispatch(refreshWorkspaceTree({}))
      }, REFRESH_DEBOUNCE_MS)
    }

    socket.on('connect', handleConnect)
    socket.on('container:treeChanged', scheduleRefresh)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('container:treeChanged', scheduleRefresh)
      socket.emit('container:unwatch')
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [isAuthenticated, dispatch])

  useEffect(() => {
    if (!projectId || !hasActiveWorkspace({ projectId, source })) return undefined

    const socket = getSocket()
    socket.emit('workspace:watch', { projectId })

    function handleConnect() {
      socket.emit('workspace:watch', { projectId })
    }
    socket.on('connect', handleConnect)

    function scheduleRefresh() {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        dispatch(refreshWorkspaceTree({}))
      }, REFRESH_DEBOUNCE_MS)
    }

    function handleTreeChanged(payload) {
      if (payload?.projectId && payload.projectId !== projectId) return
      scheduleRefresh()
    }

    /**
     * The agent's own tool results, emitted with PROJECT-relative paths. The
     * Explorer tree is container-relative, so each path is prefixed with the
     * project's folder name; the tree is patched in place and one throttled
     * refetch runs behind it as reconciliation.
     */
    function handleFsChanged(payload) {
      if (payload?.projectId && payload.projectId !== projectId) return
      const rawChanges = Array.isArray(payload.changes) ? payload.changes : []
      if (rawChanges.length === 0) return

      const folderName = projectFolderNameForId(projectId, treeRef.current)
      const prefix = folderName ? `${folderName}/` : ''
      const changes = rawChanges
        .map((change) => ({
          ...change,
          path: prefix && !String(change.path ?? '').startsWith(prefix)
            ? `${prefix}${String(change.path ?? '').replace(/^\/+/, '')}`
            : change.path,
        }))
        .filter((change) => change.path)

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
          dispatch(markChangedOnDisk(change.path))
          continue
        }
        dispatch(readWorkspaceFile({ path: change.path, fileId: change.path }))
      }

      if (!reconcileRef.current) {
        dispatch(refreshWorkspaceTree({}))
        reconcileRef.current = setTimeout(() => {
          reconcileRef.current = null
          dispatch(refreshWorkspaceTree({}))
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
      if (reconcileRef.current) {
        clearTimeout(reconcileRef.current)
        reconcileRef.current = null
      }
    }
  }, [projectId, source, dispatch])
}
