import { ChevronsUp, FilePlus, FolderPlus, Info } from 'lucide-react'
import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { collapseAll, setFolderOpen } from '../../features/fileSystemSlice'
import { showToast } from '../../features/uiSlice'
import {
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  renameWorkspaceEntry,
} from '../../features/workspaceThunks'
import { ROOT_ID } from '../../services/fileSystemAccess'
import { joinPath, parentPathOf } from '../../utils/cloudTree'
import { findNode, findParentId } from '../../utils/tree'
import FileTree from './FileTree'
import './Sidebar.css'

export default function Sidebar() {
  const dispatch = useDispatch()
  const tree = useSelector((state) => state.fileSystem.tree)
  const workspace = useSelector((state) => state.fileSystem.workspace)
  const hasProject = workspace.source === 'cloud' && Boolean(workspace.projectId)

  const [selectedId, setSelectedId] = useState(null)
  const [creating, setCreating] = useState(null)

  function reportError(message) {
    dispatch(showToast({ message, type: 'error' }))
  }

  function resolveTargetParentId() {
    if (!selectedId) return ROOT_ID
    const selected = findNode(tree, selectedId)
    if (!selected) return ROOT_ID
    if (selected.type === 'folder') return selected.id
    const parentId = findParentId(tree, selectedId)
    return parentId === undefined ? ROOT_ID : parentId
  }

  function startCreating(type) {
    if (!hasProject) return
    const parentId = resolveTargetParentId()
    setCreating({ parentId, type })
    if (parentId) dispatch(setFolderOpen({ id: parentId, isOpen: true }))
  }

  async function submitCreate(rawName) {
    const { parentId, type } = creating
    setCreating(null)

    const name = rawName.trim()
    if (!name || !hasProject) return

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
    if (!hasProject || node.id === ROOT_ID) return

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
    if (!hasProject || node.id === ROOT_ID) return

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
        <div className={`sidebar-header-actions ${hasProject ? '' : 'is-disabled'}`}>
          <button
            type="button"
            className="icon-btn-sm"
            title="New File"
            aria-label="New file"
            disabled={!hasProject}
            onClick={() => startCreating('file')}
          >
            <FilePlus size={16} />
          </button>
          <button
            type="button"
            className="icon-btn-sm"
            title="New Folder"
            aria-label="New folder"
            disabled={!hasProject}
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
            No project imported — click <strong>Import Folder</strong> in the top bar to import
            one.
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
          lockedId={ROOT_ID}
        />
      </div>
    </aside>
  )
}
