import { ChevronsUp, FilePlus, FolderPlus, Info } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { clearClipboard, setClipboard } from '../../features/clipboardSlice'
import { recordExplorerAction } from '../../features/explorerHistorySlice'
import { deleteExplorerEntry } from '../../features/explorerHistoryThunks'
import { collapseAll, setFolderOpen } from '../../features/fileSystemSlice'
import { showToast } from '../../features/uiSlice'
import {
  createWorkspaceEntry,
  duplicateWorkspaceEntry,
  openScratchWorkspace,
  renameWorkspaceEntry,
} from '../../features/workspaceThunks'
import useAuthGuard from '../../hooks/useAuthGuard'
import ConfirmModal from '../Common/ConfirmModal'
import { ROOT_ID } from '../../services/fileSystemAccess'
import { baseNameOf, joinPath, parentPathOf } from '../../utils/cloudTree'
import { copyTextToClipboard } from '../../utils/clipboard'
import { findNode, findParentId } from '../../utils/tree'
import { hasActiveWorkspace, scratchProjectIdFor } from '../../utils/workspace'
import FileTree from './FileTree'
import './Sidebar.css'

export default function Sidebar() {
  const dispatch = useDispatch()
  const guard = useAuthGuard()
  const tree = useSelector((state) => state.fileSystem.tree)
  const workspace = useSelector((state) => state.fileSystem.workspace)
  const clipboard = useSelector((state) => state.clipboard)
  const userId = useSelector((state) => state.auth.user?.id)
  // A scratch workspace counts as an active workspace: everything below treats
  // it exactly like an imported project.
  const hasProject = hasActiveWorkspace(workspace)

  const [selectedId, setSelectedId] = useState(null)
  const [creating, setCreating] = useState(null)
  const [isPreparing, setIsPreparing] = useState(false)
  // Node awaiting confirmation from the delete modal (file or folder).
  const [pendingDelete, setPendingDelete] = useState(null)

  // The active project id can change asynchronously (scratch workspace
  // bootstrap) while submit handlers from an older render are still mounted, so
  // the mutations read it from a ref that always holds the latest value.
  const projectIdRef = useRef(workspace.projectId)
  useEffect(() => {
    projectIdRef.current = workspace.projectId
  }, [workspace.projectId])

  // Stable identities for every callback handed to the memoized tree rows, so a
  // background tree refresh (chokidar auto-refresh) does not force the whole
  // Explorer to re-render just because a new function object was created.
  const reportError = useCallback(
    (message) => {
      dispatch(showToast({ message, type: 'error' }))
    },
    [dispatch],
  )

  const handleCancelCreate = useCallback(() => setCreating(null), [])

  /**
   * Makes sure there is a workspace to write into. With no imported project it
   * opens (or reuses) the per-user scratch workspace on the server — the very
   * same folder the terminal runs in. Returns false when the bootstrap failed.
   */
  async function ensureWorkspaceReady() {
    if (hasActiveWorkspace(workspace)) return true
    setIsPreparing(true)
    try {
      await dispatch(openScratchWorkspace({ projectId: scratchProjectIdFor(userId) })).unwrap()
      return true
    } catch (error) {
      reportError(`Could not open a scratch workspace: ${error.message}`)
      return false
    } finally {
      setIsPreparing(false)
    }
  }

  function resolveTargetParentId() {
    if (!selectedId) return ROOT_ID
    const selected = findNode(tree, selectedId)
    if (!selected) return ROOT_ID
    if (selected.type === 'folder') return selected.id
    const parentId = findParentId(tree, selectedId)
    return parentId === undefined ? ROOT_ID : parentId
  }

  async function beginCreatingIn(parentId, type) {
    const ready = await ensureWorkspaceReady()
    if (!ready) return

    setCreating({ parentId, type })
    if (parentId) dispatch(setFolderOpen({ id: parentId, isOpen: true }))
  }

  // Creating a file is a server-side operation, so sign-in comes first — the
  // same guard the Import/Export/Save buttons use.
  function startCreating(type) {
    guard(() => beginCreatingIn(resolveTargetParentId(), type), 'Please sign in to create files')
  }

  /** "New File" / "New Folder" from a folder's context menu. */
  function handleRequestCreate(parentId, type) {
    guard(() => beginCreatingIn(parentId, type), 'Please sign in to create files')
  }

  function handleCut(node) {
    dispatch(setClipboard({ path: node.id, type: node.type, mode: 'cut' }))
    dispatch(showToast({ message: `Cut ${node.name}`, type: 'info' }))
  }

  function handleCopy(node) {
    dispatch(setClipboard({ path: node.id, type: node.type, mode: 'copy' }))
    dispatch(showToast({ message: `Copied ${node.name}`, type: 'info' }))
  }

  /**
   * Paste into a folder: a CUT is a server-side move (rename endpoint), a COPY
   * is a server-side duplicate (POST /duplicate). Only a file/folder reference
   * travels through Redux — never content.
   *
   * The target is the FOLDER being pasted INTO (its own path), never the source
   * item's path. On success the clipboard is cleared, so a second Paste does
   * nothing until something new is cut/copied.
   */
  async function handlePaste(folderNode) {
    const activeProjectId = projectIdRef.current
    const sourcePath = clipboard.path
    if (!activeProjectId || !sourcePath) return

    const targetFolderPath = folderNode?.id === ROOT_ID ? '' : (folderNode?.id ?? '')
    const name = baseNameOf(sourcePath)

    if (clipboard.mode === 'cut') {
      if (parentPathOf(sourcePath) === targetFolderPath) {
        dispatch(showToast({ message: `${name} is already in that folder.`, type: 'info' }))
        dispatch(clearClipboard())
        return
      }
      const newPath = joinPath(targetFolderPath, name)
      try {
        await dispatch(
          renameWorkspaceEntry({ projectId: activeProjectId, oldPath: sourcePath, newPath }),
        ).unwrap()
        dispatch(recordExplorerAction({ kind: 'move', oldPath: sourcePath, newPath }))
        dispatch(clearClipboard())
        dispatch(showToast({ message: `Moved ${name}`, type: 'success' }))
      } catch (error) {
        reportError(`Could not move ${name}: ${error.message}`)
      }
      return
    }

    try {
      const result = await dispatch(
        duplicateWorkspaceEntry({ projectId: activeProjectId, sourcePath, targetFolderPath }),
      ).unwrap()
      dispatch(
        recordExplorerAction({
          kind: 'duplicate',
          sourcePath,
          targetFolderPath,
          newPath: result.newPath,
        }),
      )
      // Consumed only AFTER the copy succeeded, so a failed paste keeps the
      // clipboard and can be retried.
      dispatch(clearClipboard())
      dispatch(showToast({ message: `Copied ${name} → ${result.newPath}`, type: 'success' }))
    } catch (error) {
      reportError(`Could not copy ${name}: ${error.message}`)
    }
  }

  async function handleCopyPath(node) {
    const relativePath = node.id === ROOT_ID ? '' : node.id
    const copied = await copyTextToClipboard(relativePath)
    dispatch(
      showToast({
        message: copied ? `Copied path: ${relativePath || '/'}` : 'Could not access the clipboard.',
        type: copied ? 'success' : 'error',
      }),
    )
  }

  const submitCreate = useCallback(
    async (rawName) => {
      const { parentId, type } = creating
      setCreating(null)

      const name = rawName.trim()
      const activeProjectId = projectIdRef.current
      if (!name || !activeProjectId) return

      const parentPath = parentId === ROOT_ID ? '' : parentId
      const newPath = joinPath(parentPath, name)
      try {
        await dispatch(
          createWorkspaceEntry({ projectId: activeProjectId, path: newPath, type }),
        ).unwrap()
        dispatch(recordExplorerAction({ kind: 'create', path: newPath, type }))
      } catch (error) {
        reportError(`Could not create ${name}: ${error.message}`)
      }
    },
    [creating, dispatch, reportError],
  )

  const handleRename = useCallback(
    async (node, nextName) => {
      const activeProjectId = projectIdRef.current
      if (!activeProjectId || node.id === ROOT_ID) return

      const newPath = joinPath(parentPathOf(node.id), nextName)
      try {
        await dispatch(
          renameWorkspaceEntry({ projectId: activeProjectId, oldPath: node.id, newPath }),
        ).unwrap()
        dispatch(recordExplorerAction({ kind: 'rename', oldPath: node.id, newPath }))
      } catch (error) {
        reportError(`Could not rename ${node.name}: ${error.message}`)
      }
    },
    [dispatch, reportError],
  )

  /** Opens the confirmation modal; the delete only runs if the user confirms. */
  const requestDelete = useCallback((node) => {
    if (node.id === ROOT_ID) return
    setPendingDelete(node)
  }, [])

  async function confirmDelete() {
    const node = pendingDelete
    setPendingDelete(null)
    const activeProjectId = projectIdRef.current
    if (!node || !activeProjectId || node.id === ROOT_ID) return

    try {
      await dispatch(deleteExplorerEntry({ projectId: activeProjectId, node })).unwrap()
    } catch (error) {
      reportError(`Could not delete ${node.name}: ${error.message}`)
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Explorer</span>
        <div className="sidebar-header-actions">
          <button
            type="button"
            className="icon-btn-sm"
            title="New File"
            aria-label="New file"
            disabled={isPreparing}
            onClick={() => startCreating('file')}
          >
            <FilePlus size={16} />
          </button>
          <button
            type="button"
            className="icon-btn-sm"
            title="New Folder"
            aria-label="New folder"
            disabled={isPreparing}
            onClick={() => startCreating('folder')}
          >
            <FolderPlus size={16} />
          </button>
          <button
            type="button"
            className="icon-btn-sm"
            title="Collapse All"
            aria-label="Collapse all folders"
            disabled={!hasProject}
            onClick={() => dispatch(collapseAll())}
          >
            <ChevronsUp size={16} />
          </button>
        </div>
      </div>

      {!hasProject && (
        <div className="sidebar-notice">
          <Info size={14} />
          <span>
            No project imported — <strong>New File</strong> starts a scratch workspace, or click{' '}
            <strong>Import Folder</strong> to import a folder from your device.
          </span>
        </div>
      )}

      <div className="sidebar-body">
        <FileTree
          nodes={tree}
          selectedId={selectedId}
          onSelect={setSelectedId}
          creating={creating}
          onSubmitCreate={submitCreate}
          onCancelCreate={handleCancelCreate}
          onRename={handleRename}
          onDelete={requestDelete}
          lockedId={ROOT_ID}
          onRequestCreate={handleRequestCreate}
          onCut={handleCut}
          onCopy={handleCopy}
          onPaste={handlePaste}
          onCopyPath={handleCopyPath}
        />
      </div>

      {pendingDelete && (
        <ConfirmModal
          title={`Delete '${pendingDelete.name}'?`}
          message={
            pendingDelete.type === 'folder'
              ? 'This will permanently delete this folder and everything inside it. This action cannot be undone.'
              : 'This action cannot be undone.'
          }
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </aside>
  )
}
