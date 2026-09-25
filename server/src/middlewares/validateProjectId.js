import ApiError from '../utils/ApiError.js'
import { isValidProjectId } from '../utils/workspaceManager.js'

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
