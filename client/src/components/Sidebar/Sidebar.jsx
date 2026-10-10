import { ChevronsUp, FilePlus, FolderPlus, Info, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { clearClipboard, setClipboard } from '../../features/clipboardSlice'
import { recordExplorerAction } from '../../features/explorerHistorySlice'
import { deleteExplorerEntry } from '../../features/explorerHistoryThunks'
import {
  addTab,
  collapseAll,
  focusContainerProject,
  setActiveFile,
  setFolderOpen,
} from '../../features/fileSystemSlice'
import { closeDeleteProjectModal, showToast } from '../../features/uiSlice'
import { setAskBeforeMovingFolders } from '../../features/settingsSlice'
import {
  createWorkspaceEntry,
  deleteWorkspaceProject,
  duplicateWorkspaceEntry,
  refreshWorkspaceTree,
  renameWorkspaceEntry,
  transferWorkspaceEntry,
} from '../../features/workspaceThunks'
import useAuthGuard from '../../hooks/useAuthGuard'
import useUploadFiles from '../../hooks/useUploadFiles'
import ConfirmModal from '../Common/ConfirmModal'
import MoveFolderModal from '../Common/MoveFolderModal'
import RecentProjects from '../Projects/RecentProjects'
import Tooltip from '../Common/Tooltip'
import { CONTAINER_ID, ROOT_ID } from '../../services/fileSystemAccess'
import { baseNameOf, joinPath, parentPathOf } from '../../utils/cloudTree'
import {
  previewTargetForPath,
  projectIdForPath,
  projectNameForPath,
  topSegmentOf,
} from '../../utils/containerPaths'
import { hasDroppedFolder, isFileDrag } from '../../utils/dropFiles'
import { resolveCreateTargetId } from '../../utils/explorerTarget'
import { extensionOf } from '../../utils/fileTypes'
import { copyTextToClipboard } from '../../utils/clipboard'
import { openPreviewTab } from '../../utils/preview'
import { hasActiveWorkspace, isCloudWorkspace } from '../../utils/workspace'
import FileTree from './FileTree'
import './Sidebar.css'
import './UploadDrop.css'

function relativeToProject(path, tree) {
  if (!path) return ''
  if (!projectIdForPath(path, tree)) return path
  const top = topSegmentOf(path)
  const rest = path.slice(top.length + 1)
  return rest || '.'
}

function relativePathFrom(fromDir, targetPath) {
  const fromParts = fromDir ? fromDir.split('/').filter(Boolean) : []
  const toParts = String(targetPath ?? '').split('/').filter(Boolean)
  let shared = 0
  while (
    shared < fromParts.length &&
    shared < toParts.length &&
    fromParts[shared] === toParts[shared]
  ) {
    shared += 1
  }
  const parts = [
    ...Array.from({ length: fromParts.length - shared }, () => '..'),
    ...toParts.slice(shared),
  ]
  return parts.join('/') || '.'
}

export default function Sidebar() {
  const dispatch = useDispatch()
  const guard = useAuthGuard()
  const tree = useSelector((state) => state.fileSystem.tree)
  const workspace = useSelector((state) => state.fileSystem.workspace)
  const clipboard = useSelector((state) => state.clipboard)
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)
  const activeFileId = useSelector((state) => state.fileSystem.activeFileId)
  const askBeforeMovingFolders = useSelector((state) => state.settings.askBeforeMovingFolders)
  const isDeleteProjectModalOpen = useSelector((state) => state.ui.isDeleteProjectModalOpen)
  const hasProject = hasActiveWorkspace(workspace)

  const [selectedId, setSelectedId] = useState(null)
  const [creating, setCreating] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [terminalBlockedDelete, setTerminalBlockedDelete] = useState(null)
  const [pendingMove, setPendingMove] = useState(null)
  const [isRootDragOver, setIsRootDragOver] = useState(false)
  const pickerInputRef = useRef(null)
  const pickerTargetRef = useRef('')
  const { uploadFiles, isUploading, progress } = useUploadFiles()

  // The Explorer's root is the user's CONTAINER; its own row is hidden and its
  // children (every project folder and top-level file) are promoted to the top
  // level, so each project is a normal, fully usable branch.
  const rootNode = tree.find((node) => node.id === ROOT_ID) ?? tree[0] ?? null
  const treeNodes = rootNode?.children ?? []

  // Load the container tree whenever the user is signed in (and after a
  // reconnect). The tree is container-wide, so this does not depend on which
  // project is focused.
  useEffect(() => {
    if (!isAuthenticated) return
    dispatch(refreshWorkspaceTree({}))
  }, [isAuthenticated, dispatch])

  const reportError = useCallback(
    (message) => {
      dispatch(showToast({ message, type: 'error' }))
    },
    [dispatch],
  )

  const handleCancelCreate = useCallback(() => setCreating(null), [])

  const clearSelection = useCallback(() => setSelectedId(null), [])

  /** Makes `path`'s project the focused one (terminal/preview/export/agent). */
  const focusForPath = useCallback(
    (path) => {
      const projectId = projectIdForPath(path, tree)
      if (!projectId) return
      dispatch(
        focusContainerProject({
          projectId,
          name: projectNameForPath(path, tree),
          source: String(projectId).startsWith('scratch-') ? 'scratch' : 'cloud',
        }),
      )
    },
    [dispatch, tree],
  )

  function resolveTargetParentId() {
    return resolveCreateTargetId({ selectedId, tree })
  }

  function beginCreatingIn(rawParentId, type) {
    // ROOT_ID and CONTAINER_ID both mean "the top level" now.
    const parentId = !rawParentId || rawParentId === ROOT_ID ? CONTAINER_ID : rawParentId
    setCreating({ parentId, type })
    if (parentId !== CONTAINER_ID) {
      dispatch(setFolderOpen({ id: parentId, isOpen: true }))
    }
  }

  function startCreating(type) {
    guard(() => beginCreatingIn(resolveTargetParentId(), type), 'Please sign in to create files')
  }

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

  async function performPasteMove(sourcePath, targetFolderPath) {
    const name = baseNameOf(sourcePath)
    const newPath = joinPath(targetFolderPath, name)
    try {
      await dispatch(renameWorkspaceEntry({ oldPath: sourcePath, newPath })).unwrap()
      dispatch(recordExplorerAction({ kind: 'move', oldPath: sourcePath, newPath }))
      dispatch(clearClipboard())
      dispatch(showToast({ message: `Moved ${name}`, type: 'success' }))
    } catch (error) {
      reportError(`Could not move ${name}: ${error.message}`)
    }
  }

  /**
   * Copy / Cut -> Paste, by CONTAINER-relative path. A cut is a server-side
   * move, a copy a server-side duplicate; only the path travels through Redux.
   */
  async function handlePaste(folderNode) {
    const sourcePath = clipboard.path
    if (!sourcePath) return

    const isTopLevel = !folderNode || folderNode.id === CONTAINER_ID || folderNode.id === ROOT_ID
    const targetFolderPath = isTopLevel ? '' : folderNode.id

    if (isTopLevel && clipboard.type === 'folder') {
      dispatch(
        showToast({
          message: 'A top-level folder is a project — use New Folder to create one.',
          type: 'info',
        }),
      )
      return
    }

    const name = baseNameOf(sourcePath)

    if (clipboard.mode === 'cut') {
      const currentParent = parentPathOf(sourcePath)
      if (currentParent === targetFolderPath) {
        dispatch(showToast({ message: `${name} is already in that folder.`, type: 'info' }))
        dispatch(clearClipboard())
        return
      }
      if (askBeforeMovingFolders) {
        setPendingMove({
          kind: 'paste',
          sourcePath,
          targetFolderPath,
          items: [{ name, type: clipboard.type }],
        })
        return
      }
      await performPasteMove(sourcePath, targetFolderPath)
      return
    }

    try {
      const result = await dispatch(
        duplicateWorkspaceEntry({ sourcePath, targetFolderPath }),
      ).unwrap()
      dispatch(
        recordExplorerAction({
          kind: 'duplicate',
          sourcePath,
          targetFolderPath,
          newPath: result.newPath,
        }),
      )
      dispatch(showToast({ message: `Copied ${name} → ${result.newPath}`, type: 'success' }))
    } catch (error) {
      reportError(`Could not copy ${name}: ${error.message}`)
    }
  }

  const runDragTransfer = useCallback(
    async (sourceNode, folderPath, { copy } = {}) => {
      const sourcePath = sourceNode?.path ?? sourceNode?.id
      if (!sourcePath) return

      const label = baseNameOf(sourcePath)
      try {
        const result = await dispatch(
          transferWorkspaceEntry({ sourcePath, targetFolderPath: folderPath, mode: copy ? 'copy' : 'move' }),
        ).unwrap()
        dispatch(
          recordExplorerAction(
            copy
              ? { kind: 'duplicate', sourcePath, targetFolderPath: folderPath, newPath: result.newPath }
              : { kind: 'move', oldPath: sourcePath, newPath: result.newPath },
          ),
        )
        dispatch(
          showToast({
            message: copy
              ? `Copied ${label} → ${result.newPath}`
              : `Moved ${label} → ${result.newPath}`,
            type: 'success',
          }),
        )
      } catch (error) {
        reportError(`Could not ${copy ? 'copy' : 'move'} ${label}: ${error.message}`)
      }
    },
    [dispatch, reportError],
  )

  const handleTransferEntry = useCallback(
    (sourceNode, targetFolderPath, options = {}) => {
      const sourcePath = sourceNode?.path ?? sourceNode?.id
      if (!sourcePath) return
      const folderPath = targetFolderPath ?? ''
      if (folderPath === parentPathOf(sourcePath)) return
      if (!options.copy && askBeforeMovingFolders) {
        setPendingMove({
          kind: 'drag',
          source: sourceNode,
          targetFolderPath: folderPath,
          items: [{ name: sourceNode.name, type: sourceNode.type }],
        })
        return
      }
      runDragTransfer(sourceNode, folderPath, options)
    },
    [runDragTransfer, askBeforeMovingFolders],
  )

  async function confirmPendingMove(dontAskAgain) {
    const pending = pendingMove
    setPendingMove(null)
    if (!pending) return
    if (dontAskAgain) dispatch(setAskBeforeMovingFolders(false))
    if (pending.kind === 'paste') {
      await performPasteMove(pending.sourcePath, pending.targetFolderPath)
      return
    }
    runDragTransfer(pending.source, pending.targetFolderPath, { copy: false })
  }

  /** Opens a file from ANY project folder. Focus follows the file's project. */
  const handleOpenFile = useCallback(
    (node) => {
      if (!node) return
      const filePath = node.path ?? node.id
      if (!filePath) return
      focusForPath(filePath)
      setSelectedId(filePath)
      dispatch(addTab(filePath))
      dispatch(setActiveFile(filePath))
    },
    [dispatch, focusForPath],
  )

  const handlePreview = useCallback(
    (node) => {
      const target = previewTargetForPath(node.id, tree)
      if (!target) return
      guard(
        () => openPreviewTab(target.projectId, target.innerPath),
        'Please sign in to open a live preview',
      )
    },
    [guard, tree],
  )

  const handleCopyPath = useCallback(
    async (node) => {
      const relativePath = node.id === ROOT_ID ? '' : node.id
      const copied = await copyTextToClipboard(relativePath)
      dispatch(
        showToast({
          message: copied
            ? `Copied path: ${relativePath || '/'}`
            : 'Could not access the clipboard.',
          type: copied ? 'success' : 'error',
        }),
      )
    },
    [dispatch],
  )

  const handleCopyRelativePath = useCallback(
    async (node) => {
      const path = node.id === ROOT_ID ? '' : node.id
      const value = relativeToProject(path, tree)
      const copied = await copyTextToClipboard(value)
      dispatch(
        showToast({
          message: copied ? `Copied path: ${value || '/'}` : 'Could not access the clipboard.',
          type: copied ? 'success' : 'error',
        }),
      )
    },
    [dispatch, tree],
  )

  const handleCopyPathRelativeToFile = useCallback(
    async (node) => {
      if (!activeFileId) return
      const path = node.id === ROOT_ID ? '' : node.id
      const value = relativePathFrom(parentPathOf(activeFileId), path)
      const copied = await copyTextToClipboard(value)
      dispatch(
        showToast({
          message: copied ? `Copied path: ${value}` : 'Could not access the clipboard.',
          type: copied ? 'success' : 'error',
        }),
      )
    },
    [dispatch, activeFileId],
  )

  const handleUploadFiles = useCallback(
    (node) => {
      guard(() => {
        pickerTargetRef.current =
          !node || node.id === CONTAINER_ID || node.id === ROOT_ID ? '' : node.id
        pickerInputRef.current?.click()
      }, 'Please sign in to upload files')
    },
    [guard],
  )

  const handleDropFiles = useCallback(
    (node, fileList, options) => {
      let files = Array.from(fileList ?? [])
      if (options?.hasDirectory) {
        dispatch(
          showToast({
            message:
              'Folders cannot be dropped here — use Import Folder to add a folder from your computer.',
            type: 'info',
          }),
        )
        files = files.filter((file) => extensionOf(file.name) !== '')
      }
      if (files.length === 0) return

      if (!node || node.id === CONTAINER_ID || node.id === ROOT_ID) {
        uploadFiles('', files)
        return
      }
      if (node.type === 'folder') {
        uploadFiles(node.id, files)
        return
      }
      uploadFiles(parentPathOf(node.id), files)
    },
    [uploadFiles, dispatch],
  )

  function handleRootDragOver(event) {
    if (!isFileDrag(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setIsRootDragOver(true)
  }

  function handleRootDragLeave(event) {
    if (event.currentTarget.contains(event.relatedTarget)) return
    setIsRootDragOver(false)
  }

  function handleRootDrop(event) {
    if (!isFileDrag(event)) return
    event.preventDefault()
    setIsRootDragOver(false)
    handleDropFiles(null, event.dataTransfer.files, { hasDirectory: hasDroppedFolder(event) })
  }

  function handlePickerChange(event) {
    const files = Array.from(event.target.files ?? [])
    const target = pickerTargetRef.current
    event.target.value = ''
    if (files.length > 0) uploadFiles(target, files)
  }

  const handleRefreshTree = useCallback(() => {
    dispatch(refreshWorkspaceTree({}))
  }, [dispatch])

  const handleCollapseAll = useCallback(() => {
    dispatch(collapseAll())
  }, [dispatch])

  const submitCreate = useCallback(
    async (rawName) => {
      const { parentId, type } = creating ?? {}
      setCreating(null)

      const name = String(rawName ?? '').trim()
      if (!name) return

      const atTopLevel = !parentId || parentId === CONTAINER_ID || parentId === ROOT_ID
      const newPath = atTopLevel ? name : joinPath(parentId, name)

      try {
        const result = await dispatch(createWorkspaceEntry({ path: newPath, type })).unwrap()
        dispatch(recordExplorerAction({ kind: 'create', path: newPath, type }))
        const projectId = result?.projectId ?? projectIdForPath(newPath, tree)
        if (projectId) {
          dispatch(
            focusContainerProject({
              projectId,
              name: projectNameForPath(newPath, tree) ?? name,
              source: String(projectId).startsWith('scratch-') ? 'scratch' : 'cloud',
            }),
          )
        }
        dispatch(
          showToast({
            message:
              type === 'folder'
                ? `Created folder “${name}”`
                : `Created ${name}`,
            type: 'success',
          }),
        )
      } catch (error) {
        reportError(`Could not create ${name}: ${error.message}`)
      }
    },
    [creating, dispatch, reportError, tree],
  )

  const handleRename = useCallback(
    async (node, nextName) => {
      if (node.id === ROOT_ID) return
      const newPath = joinPath(parentPathOf(node.id), nextName)
      try {
        await dispatch(renameWorkspaceEntry({ oldPath: node.id, newPath })).unwrap()
        dispatch(recordExplorerAction({ kind: 'rename', oldPath: node.id, newPath }))
      } catch (error) {
        reportError(`Could not rename ${node.name}: ${error.message}`)
      }
    },
    [dispatch, reportError],
  )

  const requestDelete = useCallback((node) => {
    if (node.id === ROOT_ID) return
    setPendingDelete(node)
  }, [])

  async function confirmDelete() {
    const node = pendingDelete
    setPendingDelete(null)
    if (!node || node.id === ROOT_ID) return
    try {
      await dispatch(deleteExplorerEntry({ node })).unwrap()
    } catch (error) {
      if (error?.code === 'TERMINALS_IN_USE') {
        setTerminalBlockedDelete(node)
        return
      }
      reportError(`Could not delete ${node.name}: ${error.message}`)
    }
  }

  async function confirmCloseTerminalsAndDelete() {
    const node = terminalBlockedDelete
    setTerminalBlockedDelete(null)
    if (!node) return
    try {
      await dispatch(deleteExplorerEntry({ node, closeTerminals: true })).unwrap()
    } catch (error) {
      reportError(`Could not delete ${node.name}: ${error.message}`)
    }
  }

  const showEmptyState = treeNodes.length === 0
  const uploadPercent = progress?.total
    ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
    : 0

  return (
    <aside
      className={`sidebar ${isRootDragOver ? 'is-root-drop-target' : ''}`}
      onDragOver={handleRootDragOver}
      onDragLeave={handleRootDragLeave}
      onDrop={handleRootDrop}
    >
      <div className="sidebar-header">
        <span className="sidebar-title">Explorer</span>
        <div className="sidebar-header-actions">
          <Tooltip label="New File" side="bottom">
            <button
              type="button"
              className="icon-btn-sm"
              aria-label="New file"
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
              onClick={() => startCreating('folder')}
            >
              <FolderPlus size={16} />
            </button>
          </Tooltip>
          <Tooltip label="Upload files" side="bottom">
            <button
              type="button"
              className="icon-btn-sm"
              aria-label="Upload files"
              onClick={() => handleUploadFiles({ id: resolveCreateTargetId() })}
            >
              <Upload size={16} />
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

      {isUploading && progress?.total > 0 && (
        <div className="sidebar-upload-progress">
          <div className="sidebar-upload-progress-track">
            <span className="sidebar-upload-progress-fill" style={{ width: `${uploadPercent}%` }} />
          </div>
          <span className="sidebar-upload-progress-label">Uploading… {uploadPercent}%</span>
        </div>
      )}

      {showEmptyState && (
        <div className="sidebar-notice">
          <Info size={14} />
          <span>
            No files yet — <strong>New Folder</strong> creates a project folder, or click{' '}
            <strong>Import Folder</strong> to import a folder from your device.
          </span>
        </div>
      )}

      {showEmptyState && (
        <div className="sidebar-recent">
          <RecentProjects variant="compact" />
        </div>
      )}

      <div className="sidebar-body">
        <FileTree
          nodes={treeNodes}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onClearSelection={clearSelection}
          creating={creating}
          onSubmitCreate={submitCreate}
          onCancelCreate={handleCancelCreate}
          onRename={handleRename}
          onDelete={requestDelete}
          lockedId={null}
          onRequestCreate={handleRequestCreate}
          onCut={handleCut}
          onCopy={handleCopy}
          onPaste={handlePaste}
          onCopyPath={handleCopyPath}
          onPreview={handlePreview}
          onRefresh={handleRefreshTree}
          onCollapseAll={handleCollapseAll}
          onOpenFile={handleOpenFile}
          onUploadFiles={handleUploadFiles}
          onDropFiles={handleDropFiles}
          onTransfer={handleTransferEntry}
          onCopyRelativePath={handleCopyRelativePath}
          onCopyPathRelativeToFile={handleCopyPathRelativeToFile}
        />
      </div>

      <input
        ref={pickerInputRef}
        type="file"
        multiple
        className="sidebar-upload-input"
        aria-label="Upload files"
        onChange={handlePickerChange}
      />

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

      {isDeleteProjectModalOpen && isCloudWorkspace(workspace) && (
        <ConfirmModal
          title={`Delete project '${workspace.name}'?`}
          message="This deletes every file in this project permanently and cannot be undone."
          confirmLabel="Delete project"
          confirmPhrase={workspace.name}
          onConfirm={() => {
            const projectId = workspace.projectId
            const name = workspace.name
            dispatch(closeDeleteProjectModal())
            dispatch(deleteWorkspaceProject({ projectId, name }))
              .unwrap()
              .then(() => {
                dispatch(showToast({ message: `Deleted project ${name}.`, type: 'success' }))
              })
              .catch((error) => {
                dispatch(
                  showToast({
                    message: `Could not delete ${name}: ${error?.message ?? error}`,
                    type: 'error',
                  }),
                )
              })
          }}
          onCancel={() => dispatch(closeDeleteProjectModal())}
        />
      )}

      {terminalBlockedDelete && (
        <ConfirmModal
          title={`Close terminals and delete '${terminalBlockedDelete.name}'?`}
          message="A terminal is open inside this folder. Deleting will end the terminal sessions whose working directory is inside it."
          confirmLabel="Close terminals and delete"
          onConfirm={confirmCloseTerminalsAndDelete}
          onCancel={() => setTerminalBlockedDelete(null)}
        />
      )}

      {pendingMove && (
        <MoveFolderModal
          items={pendingMove.items}
          destinationName={
            pendingMove.targetFolderPath ? baseNameOf(pendingMove.targetFolderPath) : null
          }
          onConfirm={confirmPendingMove}
          onCancel={() => setPendingMove(null)}
        />
      )}
    </aside>
  )
}
