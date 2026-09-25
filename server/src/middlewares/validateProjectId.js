import ApiError from '../utils/ApiError.js'
import { isValidProjectId } from '../utils/workspaceManager.js'

/**
 * The projectId comes straight from the URL and is used as a directory name, so
 * it must be validated before anything touches the filesystem.
 */
export default function validateProjectId(req, res, next) {
  const { projectId } = req.params
  if (!isValidProjectId(projectId)) {
    return next(
      new ApiError(
        400,
        'Invalid project id. Use letters, numbers, dashes or underscores (max 128 characters).',
        'INVALID_PROJECT_ID',
      ),
    )
  }
  return next()
}
