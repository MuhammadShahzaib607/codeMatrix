import { isDatabaseConnected } from '../config/db.js'
import { findProject } from '../models/project.repository.js'
import ApiError from '../utils/ApiError.js'

/**
 * Confirms the signed-in user owns the project in the URL. Must run after
 * `protect`, so `req.user.id` exists.
 *
 * Behaviour:
 *   - project found and owner differs -> 403 Forbidden
 *   - project found and owner matches -> continue (req.project is attached)
 *   - project not found              -> continue, because `import` legitimately
 *     targets a projectId that has no metadata yet. Disk access is still guarded
 *     by ensureWorkspace, which answers 404 WORKSPACE_MISSING.
 *
 * When the server runs without a database there is no ownership data to check,
 * so the check is skipped (local/dev only) rather than locking everyone out.
 */
export default async function authorizeProject(req, res, next) {
  try {
    if (!isDatabaseConnected()) return next()

    const project = await findProject(req.params.projectId)
    if (project && String(project.owner) !== String(req.user?.id)) {
      return next(
        new ApiError(403, 'You do not have access to this project.', 'FORBIDDEN'),
      )
    }

    req.project = project ?? null
    return next()
  } catch (error) {
    return next(error)
  }
}
