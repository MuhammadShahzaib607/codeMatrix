import { ChevronsUp, FilePlus, FolderPlus, Info } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { collapseAll, setFolderOpen } from '../../features/fileSystemSlice'
import { showToast } from '../../features/uiSlice'
import {
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  openScratchWorkspace,
  renameWorkspaceEntry,
} from '../../features/workspaceThunks'
import useAuthGuard from '../../hooks/useAuthGuard'
import { ROOT_ID } from '../../services/fileSystemAccess'
import { joinPath, parentPathOf } from '../../utils/cloudTree'
import { findNode, findParentId } from '../../utils/tree'
import { hasActiveWorkspace, scratchProjectIdFor } from '../../utils/workspace'
import FileTree from './FileTree'
import './Sidebar.css'

export default function Sidebar() {
  const dispatch = useDispatch()
  const guard = useAuthGuard()
  const tree = useSelector((state) => state.fileSystem.tree)
  const workspace = useSelector((state) => state.fileSystem.workspace)
  const userId = useSelector((state) => state.auth.user?.id)
  // A scratch workspace counts as an active workspace: everything below treats
  // it exactly like an imported project.
  const hasProject = hasActiveWorkspace(workspace)

  const [selectedId, setSelectedId] = useState(null)
  const [creating, setCreating] = useState(null)
  const [isPreparing, setIsPreparing] = useState(false)

  // The active project id can change asynchronously (scratch workspace
  // bootstrap) while submit handlers from an older render are still mounted, so
  // the mutations read it from a ref that always holds the latest value.
  const projectIdRef = useRef(workspace.projectId)
  useEffect(() => {
    projectIdRef.current = workspace.projectId
  }, [workspace.projectId])

  function reportError(message) {
    dispatch(showToast({ message, type: 'error' }))
  }

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

  async function beginCreating(type) {
    const ready = await ensureWorkspaceReady()
    if (!ready) return

    const parentId = resolveTargetParentId()
    setCreating({ parentId, type })
    if (parentId) dispatch(setFolderOpen({ id: parentId, isOpen: true }))
  }

  // Creating a file is a server-side operation, so sign-in comes first — the
  // same guard the Import/Export/Save buttons use.
  function startCreating(type) {
    guard(() => beginCreating(type), 'Please sign in to create files')
  }

  async function submitCreate(rawName) {
    const { parentId, type } = creating
    setCreating(null)

    const name = rawName.trim()
    const activeProjectId = projectIdRef.current
    if (!name || !activeProjectId) return

    const parentPath = parentId === ROOT_ID ? '' : parentId
    try {
      await dispatch(
        createWorkspaceEntry({
          projectId: activeProjectId,
          path: joinPath(parentPath, name),
          type,
        }),
      ).unwrap()
    } catch (error) {
      reportError(`Could not create ${name}: ${error.message}`)
    }
  }

  async function handleRename(node, nextName) {
    const activeProjectId = projectIdRef.current
    if (!activeProjectId || node.id === ROOT_ID) return

    try {
      await dispatch(
        renameWorkspaceEntry({
          projectId: activeProjectId,
          oldPath: node.id,
          newPath: joinPath(parentPathOf(node.id), nextName),
        }),
      ).unwrap()
    } catch (error) {
      reportError(`Could not rename ${node.name}: ${error.message}`)
    }
  }

  async function handleDelete(node) {
    const activeProjectId = projectIdRef.current
    if (!activeProjectId || node.id === ROOT_ID) return

    try {
      await dispatch(
        deleteWorkspaceEntry({ projectId: activeProjectId, path: node.id }),
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
          onCancelCreate={() => setCreating(null)}
          onRename={handleRename}
          onDelete={handleDelete}
          lockedId={ROOT_ID}
        />
      </div>
    </aside>
  )
}
