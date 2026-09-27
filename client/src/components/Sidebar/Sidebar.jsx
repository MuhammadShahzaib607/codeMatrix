import { ChevronsUp, FilePlus, FolderPlus, Info } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { clearClipboard, setClipboard } from '../../features/clipboardSlice'
import { recordExplorerAction } from '../../features/explorerHistorySlice'
import { deleteExplorerEntry } from '../../features/explorerHistoryThunks'
import { collapseAll, setFolderOpen } from '../../features/fileSystemSlice'
import {
  closeDeleteProjectModal,
  openDeleteProjectModal,
  showToast,
} from '../../features/uiSlice'
import {
  createWorkspaceEntry,
  deleteWorkspaceProject,
  duplicateWorkspaceEntry,
  openScratchWorkspace,
  renameWorkspaceEntry,
} from '../../features/workspaceThunks'
import useAuthGuard from '../../hooks/useAuthGuard'
import ConfirmModal from '../Common/ConfirmModal'
import Tooltip from '../Common/Tooltip'
import { ROOT_ID } from '../../services/fileSystemAccess'
import { baseNameOf, joinPath, parentPathOf } from '../../utils/cloudTree'
import { copyTextToClipboard } from '../../utils/clipboard'
import { openPreviewTab } from '../../utils/preview'
import { findNode, findParentId } from '../../utils/tree'
import { hasActiveWorkspace, isCloudWorkspace, scratchProjectIdFor } from '../../utils/workspace'
import FileTree from './FileTree'
import './Sidebar.css'

export default function Sidebar() {
  const dispatch = useDispatch()
  const guard = useAuthGuard()
  const tree = useSelector((state) => state.fileSystem.tree)
  const workspace = useSelector((state) => state.fileSystem.workspace)
  const clipboard = useSelector((state) => state.clipboard)
  const userId = useSelector((state) => state.auth.user?.id)
  const isDeleteProjectOpen = useSelector((state) => state.ui.isDeleteProjectModalOpen)
  // A scratch workspace counts as an active workspace: everything below treats
  // it exactly like an imported project.
  const hasProject = hasActiveWorkspace(workspace)
  // Only a real imported project (backed by a Project record) can be deleted as
  // a whole; the scratch workspace is not a project.
  const canDeleteProject = isCloudWorkspace(workspace)

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

  // Stable identity so the memoized FileTree is not re-rendered by this prop.
  const requestDeleteProject = useCallback(
    () => dispatch(openDeleteProjectModal()),
    [dispatch],
  )

  // Fresh-instance mirrors for the two handlers that genuinely need live
  // component state (clipboard, workspace). The refs are updated in an effect
  // (never during render) so the stable wrappers below can be handed to the
  // memoized FileTree without capturing stale values.
  const pasteRef = useRef(null)
  const requestCreateRef = useRef(null)
  const previewRef = useRef(null)

  /**
   * Makes sure there is a workspace to write into and returns its project id —
   * or null when the bootstrap failed. With no imported project it opens (or
   * reuses) the per-user scratch workspace on the server, the very same folder
   * the terminal runs in.
   *
   * It is deliberately called from submitCreate (AFTER the user names the new
   * item) and never from the "New File"/"New Folder" click itself: clicking the
   * button must not create ANYTHING yet — see beginCreatingIn.
   */
  const ensureWorkspaceReady = useCallback(async () => {
    if (projectIdRef.current) return projectIdRef.current
    setIsPreparing(true)
    try {
      const scratchId = scratchProjectIdFor(userId)
      const data = await dispatch(openScratchWorkspace({ projectId: scratchId })).unwrap()
      return data?.projectId ?? scratchId
    } catch (error) {
      reportError(`Could not open a scratch workspace: ${error.message}`)
      return null
    } finally {
      setIsPreparing(false)
    }
  }, [dispatch, reportError, userId])

  function resolveTargetParentId() {
    if (!selectedId) return ROOT_ID
    const selected = findNode(tree, selectedId)
    if (!selected) return ROOT_ID
    if (selected.type === 'folder') return selected.id
    const parentId = findParentId(tree, selectedId)
    return parentId === undefined ? ROOT_ID : parentId
  }

  /**
   * Starts an inline "name your new file/folder" row at `parentId`.
   *
   * Nothing is created here and no default name is ever used: the temporary
   * input row is all the user sees until they type a name and press Enter. A
   * scratch workspace is bootstrapped later, in submitCreate, so clicking the
   * button can never leave a surprise folder (e.g. "Scratch") behind.
   */
  function beginCreatingIn(parentId, type) {
    setCreating({ parentId, type })
    if (parentId && parentId !== ROOT_ID) {
      dispatch(setFolderOpen({ id: parentId, isOpen: true }))
    }
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

  const handleCut = useCallback(
    (node) => {
      dispatch(setClipboard({ path: node.id, type: node.type, mode: 'cut' }))
      dispatch(showToast({ message: `Cut ${node.name}`, type: 'info' }))
    },
    [dispatch],
  )

  const handleCopy = useCallback(
    (node) => {
      dispatch(setClipboard({ path: node.id, type: node.type, mode: 'copy' }))
      dispatch(showToast({ message: `Copied ${node.name}`, type: 'info' }))
    },
    [dispatch],
  )

  /**
   * Paste into a folder: a CUT is a server-side move (rename endpoint), a COPY
   * is a server-side duplicate (POST /duplicate). Only a file/folder reference
   * travels through Redux — never content.
   *
   * The target is the FOLDER being pasted INTO (its own path), never the source
   * item's path. A CUT is consumed (the source moved, so the clipboard is
   * cleared); a COPY is kept, exactly like VS Code, so the same item can be
   * pasted into several folders in a row without copying it again.
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
      // The clipboard is intentionally NOT cleared after a copy-paste: the user
      // must be able to paste the SAME item into several folders (A, B, C) in a
      // row. Clearing it here made every paste after the first a silent no-op,
      // because handlePaste bails out when clipboard.path is null.
      dispatch(showToast({ message: `Copied ${name} → ${result.newPath}`, type: 'success' }))
    } catch (error) {
      reportError(`Could not copy ${name}: ${error.message}`)
    }
  }

  /**
   * "Open with Live Server" for a .html file: opens a new browser tab at
   * /preview/:projectId/<path>?token=<jwt>. The current token is read at click
   * time by buildPreviewUrl, so it is always fresh.
   */
  const handlePreview = useCallback(
    (node) => {
      const activeProjectId = projectIdRef.current
      if (!activeProjectId) return
      guard(
        () => openPreviewTab(activeProjectId, node.path ?? node.id),
        'Please sign in to open a live preview',
      )
    },
    [guard],
  )

  const handleCopyPath = useCallback(async (node) => {
    const relativePath = node.id === ROOT_ID ? '' : node.id
    const copied = await copyTextToClipboard(relativePath)
    dispatch(
      showToast({
        message: copied ? `Copied path: ${relativePath || '/'}` : 'Could not access the clipboard.',
        type: copied ? 'success' : 'error',
      }),
    )
  }, [dispatch])

  // Keep the mirrors current after every commit so the stable wrappers always
  // call the latest handler.
  useEffect(() => {
    pasteRef.current = handlePaste
    requestCreateRef.current = handleRequestCreate
    previewRef.current = handlePreview
  })

  const stablePaste = useCallback((folderNode) => pasteRef.current?.(folderNode), [])
  const stableRequestCreate = useCallback(
    (parentId, type) => requestCreateRef.current?.(parentId, type),
    [],
  )
  const stablePreview = useCallback((node) => previewRef.current?.(node), [])

  const submitCreate = useCallback(
    async (rawName) => {
      const { parentId, type } = creating ?? {}
      setCreating(null)

      // An empty name cancels silently: Escape and confirming an empty field
      // must both leave the workspace untouched (never a default-named folder).
      const name = String(rawName ?? '').trim()
      if (!name) return

      // First real write: bootstrap the workspace NOW (scratch if nothing is
      // imported). ensureWorkspaceReady returns the id directly, because the
      // projectIdRef effect has not run yet inside this same async handler.
      const activeProjectId = await ensureWorkspaceReady()
      if (!activeProjectId) return

      const parentPath = parentId === ROOT_ID || parentId == null ? '' : parentId
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
    [creating, dispatch, ensureWorkspaceReady, reportError],
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

  /** Deletes the ENTIRE active project (workspace folder + DB record). */
  async function confirmDeleteProject() {
    const activeProjectId = projectIdRef.current
    const name = workspace.name
    if (!activeProjectId) return
    try {
      await dispatch(deleteWorkspaceProject({ projectId: activeProjectId })).unwrap()
      dispatch(showToast({ message: `Deleted project ${name}.`, type: 'success' }))
    } catch (error) {
      reportError(`Could not delete the project: ${error.message}`)
    } finally {
      dispatch(closeDeleteProjectModal())
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Explorer</span>
        <div className="sidebar-header-actions">
          <Tooltip label="New File" side="bottom">
            <button
              type="button"
              className="icon-btn-sm"
              aria-label="New file"
              disabled={isPreparing}
              onClick={() => startCreating('file')}
            >
              <FilePlus size={16} />
            </button>
          </Tooltip>
          <Tooltip label="New Folder" side="bottom">
            <button
              type="button"
              className="icon-btn-sm"
              aria-label="New folder"
              disabled={isPreparing}
              onClick={() => startCreating('folder')}
            >
              <FolderPlus size={16} />
            </button>
          </Tooltip>
          <Tooltip label="Collapse All" side="bottom">
            <button
              type="button"
              className="icon-btn-sm"
              aria-label="Collapse all folders"
              disabled={!hasProject}
              onClick={() => dispatch(collapseAll())}
            >
              <ChevronsUp size={16} />
            </button>
          </Tooltip>
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
          onRequestCreate={stableRequestCreate}
          onCut={handleCut}
          onCopy={handleCopy}
          onPaste={stablePaste}
          onCopyPath={handleCopyPath}
          onPreview={stablePreview}
          canDeleteProject={canDeleteProject}
          onDeleteProject={requestDeleteProject}
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

      {isDeleteProjectOpen && canDeleteProject && (
        <ConfirmModal
          title={`Delete project '${workspace.name}'?`}
          message="This will delete all files in this project permanently and cannot be undone."
          confirmLabel="Delete project"
          confirmPhrase={workspace.name}
          onConfirm={confirmDeleteProject}
          onCancel={() => dispatch(closeDeleteProjectModal())}
        />
      )}
    </aside>
  )
}
