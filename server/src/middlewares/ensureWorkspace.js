import ApiError from '../utils/ApiError.js'
import { getWorkspacePath, workspaceExists } from '../utils/workspaceManager.js'

export const WORKSPACE_MISSING_MESSAGE =
  'This workspace is no longer on the server. It was most likely cleared when the ' +
  'server restarted (free tier). Re-import your project from a local backup.'

/**
 * Every workspace operation except `import` must confirm the folder still exists
 * before running. This is what surfaces the ephemeral-disk problem to the client
 * as a clear 404 with code WORKSPACE_MISSING.
 */
export default function ensureWorkspace(req, res, next) {
  const { projectId } = req.params
  if (!workspaceExists(projectId)) {
    return next(new ApiError(404, WORKSPACE_MISSING_MESSAGE, 'WORKSPACE_MISSING'))
  }
  req.workspacePath = getWorkspacePath(projectId)
  return next()
}
