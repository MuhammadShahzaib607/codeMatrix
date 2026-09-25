import { AlertTriangle, ChevronsUp, FilePlus, FolderPlus, Info } from 'lucide-react'
import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  addNode,
  collapseAll,
  deleteNode,
  renameNode,
  replaceSubtree,
  setFolderOpen,
} from '../../features/fileSystemSlice'
import { showToast } from '../../features/uiSlice'
import { UNSUPPORTED_MESSAGE } from '../../hooks/useOpenFolder'
import {
  ROOT_ID,
  createNewFile,
  createNewFolder,
  deleteEntry,
  forgetHandles,
  getHandleById,
  getParentHandle,
  getRegistryEntry,
  isFileSystemAccessSupported,
  reindexDirectory,
  registerHandle,
  renameEntry,
} from '../../services/fileSystemAccess'
import {
  collectAllIds,
  collectFileIds,
  findNode,
  findParentId,
  newNodeFileIds,
} from '../../utils/tree'
import FileTree from './FileTree'
import './Sidebar.css'

export default function Sidebar() {
  const dispatch = useDispatch()
  const tree = useSelector((state) => state.fileSystem.tree)
  const workspace = useSelector((state) => state.fileSystem.workspace)

  const isLocal = workspace.source === 'local'
  const isSupported = isFileSystemAccessSupported()

  // The row the user last clicked drives where new nodes get created.
  const [selectedId, setSelectedId] = useState(null)
  const [creating, setCreating] = useState(null) // { parentId, type }

  function reportError(message) {
    dispatch(showToast({ message, type: 'error' }))
  }

  // New nodes land in the selected folder, in the selected file's folder, or at
  // the workspace root when nothing is selected.
  function resolveTargetParentId() {
    const rootId = isLocal ? ROOT_ID : null
    if (!selectedId) return rootId
    const selected = findNode(tree, selectedId)
    if (!selected) return rootId
    if (selected.type === 'folder') return selected.id
    const parentId = findParentId(tree, selectedId)
    return parentId === undefined ? rootId : parentId
  }

  function startCreating(type) {
    const parentId = resolveTargetParentId()
    setCreating({ parentId, type })
    if (parentId) dispatch(setFolderOpen({ id: parentId, isOpen: true }))
  }

  async function submitCreate(rawName) {
    const { parentId, type } = creating
    setCreating(null)

    const name = rawName.trim()
    if (!name) return

    // Demo workspace has no handles — keep the change in Redux only.
    if (!isLocal) {
      dispatch(
        addNode({
          parentId,
          node:
            type === 'folder'
              ? { id: crypto.randomUUID(), name, type, isOpen: true, children: [] }
              : { id: crypto.randomUUID(), name, type },
        }),
      )
      return
    }

    const parentHandle = getHandleById(parentId)
    if (!parentHandle) {
      reportError('That folder is no longer available. Reopen the folder to continue.')
      return
    }

    try {
      const handle =
        type === 'folder'
          ? await createNewFolder(parentHandle, name)
          : await createNewFile(parentHandle, name)
      dispatch(addNode({ parentId, node: registerHandle(handle, { parentId, name, type }) }))
    } catch (error) {
      reportError(`Could not create ${name}: ${error.message}`)
    }
  }

  async function handleRename(node, nextName) {
    if (!isLocal || node.id === ROOT_ID) {
      dispatch(renameNode({ id: node.id, name: nextName }))
      return
    }

    const entry = getRegistryEntry(node.id)
    const parentHandle = getParentHandle(node.id)
    if (!entry || !parentHandle) {
      reportError(`Lost access to ${node.name}. Reopen the folder to continue.`)
      return
    }

    try {
      const renamedHandle = await renameEntry(parentHandle, node.name, nextName, node.type)

      if (node.type === 'file') {
        // Same node id means the open tab and its buffer survive the rename.
        registerHandle(renamedHandle, {
          id: node.id,
          parentId: entry.parentId,
          name: nextName,
          type: 'file',
        })
        dispatch(renameNode({ id: node.id, name: nextName }))
        return
      }

      // Folders are copy + delete on disk, so re-read the new folder and keep
      // the ids of every entry that came across.
      const nextSubtree = await reindexDirectory(renamedHandle, node)
      dispatch(
        replaceSubtree({
          id: node.id,
          name: nextSubtree.name,
          children: nextSubtree.children,
          removedFileIds: newNodeFileIds(node, nextSubtree),
        }),
      )
    } catch (error) {
      reportError(`Could not rename ${node.name}: ${error.message}`)
    }
  }

  async function handleDelete(node) {
    if (!isLocal || node.id === ROOT_ID) {
      dispatch(deleteNode({ id: node.id, removedFileIds: collectFileIds(node) }))
      return
    }

    const parentHandle = getParentHandle(node.id)
    if (!parentHandle) {
      reportError(`Lost access to ${node.name}. Reopen the folder to continue.`)
      return
    }

    try {
      await deleteEntry(parentHandle, node.name, node.type)
      dispatch(deleteNode({ id: node.id, removedFileIds: collectFileIds(node) }))
      forgetHandles(collectAllIds(node))
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
            onClick={() => startCreating('file')}
          >
            <FilePlus size={16} />
          </button>
          <button
            type="button"
            className="icon-btn-sm"
            title="New Folder"
            aria-label="New folder"
            onClick={() => startCreating('folder')}
          >
            <FolderPlus size={16} />
          </button>
          <button
            type="button"
            className="icon-btn-sm"
            title="Collapse All"
            aria-label="Collapse all folders"
            onClick={() => dispatch(collapseAll())}
          >
            <ChevronsUp size={16} />
          </button>
        </div>
      </div>

      {!isSupported && (
        <div className="sidebar-notice is-warning">
          <AlertTriangle size={14} />
          <span>{UNSUPPORTED_MESSAGE}</span>
        </div>
      )}

      {isSupported && !isLocal && (
        <div className="sidebar-notice">
          <Info size={14} />
          <span>
            No folder opened — click <strong>Open Folder</strong> to get started. Showing demo
            files for now.
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
          onCancelCreate={() => setCreating(null)}
          onRename={handleRename}
          onDelete={handleDelete}
          lockedId={isLocal ? ROOT_ID : null}
        />
      </div>
    </aside>
  )
}
