import { isDatabaseConnected } from '../config/db.js'
import { findProject } from '../models/project.repository.js'
import ApiError from '../utils/ApiError.js'

export default async function authorizeProject(req, res, next) {
  try {
    if (!isDatabaseConnected()) return next()

    const project = await findProject(req.params.projectId)
    if (project && String(project.owner) !== String(req.user?.id)) {
      return next(new ApiError(403, 'You do not have access to this project.', 'FORBIDDEN'))
    }

    req.project = project ?? null
    return next()
  } catch (error) {
    return next(error)
  }
}
