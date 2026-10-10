import { AlertTriangle, Clock, FolderOpen, Loader2, Trash2 } from 'lucide-react'
import { useDispatch, useSelector } from 'react-redux'
import {
  cancelDeleteRecent,
  dismissRecentMissing,
  openRecentProject,
  removeRecentProject,
  requestDeleteRecent,
} from '../../features/projectsSlice'
import { showToast } from '../../features/uiSlice'
import { deleteWorkspaceProject } from '../../features/workspaceThunks'
import { formatRelativeTime } from '../../utils/time'
import ConfirmModal from '../Common/ConfirmModal'
import './RecentProjects.css'

/**
 * The user's existing projects, so closing and reopening the browser shows real
 * workspaces instead of silently starting a fresh scratch. Rendering the SAME
 * component in the editor's empty state (variant="full") and in the Explorer
 * (variant="compact") keeps them in step.
 *
 * Each row opens the project (loads its real tree from disk) and has a trash
 * icon that deletes it with the exact same logic as the Explorer's root delete.
 * A row whose files were lost to a server restart offers to remove itself.
 */
export default function RecentProjects({ variant = 'full' }) {
  const dispatch = useDispatch()
  const { items, status, error, missing, pendingDelete } = useSelector(
    (state) => state.projects,
  )
  const activeProjectId = useSelector((state) => state.fileSystem.workspace.projectId)

  function handleOpen(item) {
    dispatch(openRecentProject({ projectId: item.id, name: item.name }))
  }

  function handleDelete(item) {
    dispatch(cancelDeleteRecent())
    dispatch(deleteWorkspaceProject({ projectId: item.id, name: item.name }))
      .unwrap()
      .then(() => {
        dispatch(showToast({ message: `Deleted project ${item.name}.`, type: 'success' }))
      })
      .catch((deleteError) => {
        dispatch(
          showToast({
            message: `Could not delete ${item.name}: ${deleteError?.message ?? deleteError}`,
            type: 'error',
          }),
        )
      })
  }

  return (
    <div className={`recent-projects is-${variant}`}>
      {missing && (
        <div className="recent-missing" role="alert">
          <AlertTriangle size={15} />
          <span>
            “{missing.name || missing.projectId}” files were lost due to a server restart
            (temporary storage limitation). Remove it from your recent list?
          </span>
          <button
            type="button"
            className="recent-missing-remove"
            onClick={() => dispatch(removeRecentProject({ projectId: missing.projectId }))}
          >
            Remove
          </button>
          <button
            type="button"
            className="recent-missing-keep"
            onClick={() => dispatch(dismissRecentMissing())}
          >
            Keep
          </button>
        </div>
      )}

      <div className="recent-header">
        <span className="recent-title">Recent Projects</span>
        {status === 'loading' && <Loader2 size={13} className="spin" />}
      </div>

      <p className="recent-caveat">
        Projects live in temporary cloud storage and can be lost if the server restarts — export
        important work regularly.
      </p>

      {error && <p className="recent-empty is-error">{error}</p>}

      {status !== 'loading' && items.length === 0 && (
        <p className="recent-empty">
          No projects yet — import a folder, or create a new file to start a scratch workspace.
        </p>
      )}

      <div className="recent-list">
        {items.map((item) => (
          <div
            key={item.id}
            className={`recent-item ${item.id === activeProjectId ? 'is-active' : ''}`}
          >
            <button
              type="button"
              className="recent-item-main"
              title={item.name}
              onClick={() => handleOpen(item)}
            >
              <FolderOpen size={15} className="recent-item-icon" />
              <span className="recent-item-text">
                <span className="recent-item-name">
                  {item.name}
                  {item.isScratch ? ' · scratch' : ''}
                </span>
                <span className="recent-item-time">
                  <Clock size={11} />
                  {formatRelativeTime(item.lastAccessedAt)}
                </span>
              </span>
            </button>
            <button
              type="button"
              className="recent-item-delete"
              title={`Delete project ${item.name}`}
              aria-label={`Delete project ${item.name}`}
              onClick={() => dispatch(requestDeleteRecent(item))}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      {pendingDelete && (
        <ConfirmModal
          title={`Delete project '${pendingDelete.name}'?`}
          message="This deletes every file in this project permanently and cannot be undone."
          confirmLabel="Delete project"
          confirmPhrase={pendingDelete.name}
          onConfirm={() => handleDelete(pendingDelete)}
          onCancel={() => dispatch(cancelDeleteRecent())}
        />
      )}
    </div>
  )
}
