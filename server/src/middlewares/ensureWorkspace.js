import ApiError from '../utils/ApiError.js'
import {
  ensureScratchWorkspace,
  getWorkspacePath,
  isScratchProjectId,
  registerWorkspaceFromDiskPath,
  workspaceExists,
} from '../utils/workspaceManager.js'

export const WORKSPACE_MISSING_MESSAGE =
  'This workspace is no longer on the server. It was most likely cleared when the ' +
  'server restarted (free tier). Re-import your project from a local backup.'

/**
 * Guarantees the workspace folder for :projectId exists before the route runs.
 *
 * An imported project that vanished is an error (404 WORKSPACE_MISSING) — but a
 * scratch workspace ("scratch-<userId>") is throwaway and may not exist yet, so
 * it is created on demand. That is what lets the Explorer create/open/save
 * files before anything has been imported, in exactly the same folder the
 * terminal uses as its cwd.
 */
export default function ensureWorkspace(req, res, next) {
  const { projectId } = req.params
  try {
    if (isScratchProjectId(projectId)) {
      ensureScratchWorkspace(projectId)
    } else {
      // If the on-disk registry was lost but the Project document survived,
      // rebuild the folder mapping from its stored diskPath before giving up.
      if (req.project?.diskPath) {
        registerWorkspaceFromDiskPath(projectId, req.project.diskPath)
      }
      if (!workspaceExists(projectId)) {
        return next(new ApiError(404, WORKSPACE_MISSING_MESSAGE, 'WORKSPACE_MISSING'))
      }
    }
    req.workspacePath = getWorkspacePath(projectId)
    return next()
  } catch (error) {
    return next(error)
  }
}
