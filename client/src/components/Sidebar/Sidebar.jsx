import { AlertTriangle, ChevronsUp, FilePlus, FolderPlus, Info } from 'lucide-react'
import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  addNode,
  collapseAll,
  deleteNode,
  renameNode,
  setFolderOpen,
} from '../../features/fileSystemSlice'
import { showToast } from '../../features/uiSlice'
import {
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  renameWorkspaceEntry,
} from '../../features/workspaceThunks'
import { UNSUPPORTED_MESSAGE } from '../../hooks/useOpenFolder'
import { ROOT_ID, isFileSystemAccessSupported } from '../../services/fileSystemAccess'
import { joinPath, parentPathOf } from '../../utils/cloudTree'
import { collectFileIds, findNode, findParentId } from '../../utils/tree'
import FileTree from './FileTree'
import './Sidebar.css'

export default function Sidebar() {
  const dispatch = useDispatch()
  const tree = useSelector((state) => state.fileSystem.tree)
  const workspace = useSelector((state) => state.fileSystem.workspace)

  const isCloud = workspace.source === 'cloud'
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
    const rootId = isCloud ? ROOT_ID : null
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

    // Demo workspace: keep the change in Redux only.
    if (!isCloud) {
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

    // Cloud node ids are relative paths; the root's id is ROOT_ID, i.e. path ''.
    const parentPath = parentId === ROOT_ID ? '' : parentId
    try {
      await dispatch(
        createWorkspaceEntry({
          projectId: workspace.projectId,
          path: joinPath(parentPath, name),
          type,
        }),
      ).unwrap()
    } catch (error) {
      reportError(`Could not create ${name}: ${error.message}`)
    }
  }

  async function handleRename(node, nextName) {
    // Demo tree, or the immutable workspace root: Redux only.
    if (!isCloud || node.id === ROOT_ID) {
      dispatch(renameNode({ id: node.id, name: nextName }))
      return
    }

    try {
      await dispatch(
        renameWorkspaceEntry({
          projectId: workspace.projectId,
          oldPath: node.id,
          newPath: joinPath(parentPathOf(node.id), nextName),
        }),
      ).unwrap()
    } catch (error) {
      reportError(`Could not rename ${node.name}: ${error.message}`)
    }
  }

  async function handleDelete(node) {
    if (!isCloud || node.id === ROOT_ID) {
      dispatch(deleteNode({ id: node.id, removedFileIds: collectFileIds(node) }))
      return
    }

    try {
      await dispatch(
        deleteWorkspaceEntry({ projectId: workspace.projectId, path: node.id }),
      ).unwrap()
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

      {isSupported && !isCloud && (
        <div className="sidebar-notice">
          <Info size={14} />
          <span>
            No project imported — click <strong>Open Folder</strong> to import one. Showing demo
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
          lockedId={isCloud ? ROOT_ID : null}
        />
      </div>
    </aside>
  )
}
