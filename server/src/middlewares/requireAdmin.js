import { isDatabaseConnected } from '../config/db.js'
import User from '../models/User.model.js'
import ApiError from '../utils/ApiError.js'

export const ADMIN_REQUIRED_MESSAGE =
  'The AI agent is available to administrators only. Your account does not have access.'

/**
 * Loads the caller's role straight from the database for THIS request. The JWT
 * only proves who the user is; it is never trusted for authorization, because a
 * token issued before a role change would still carry the old claim.
 *
 * Every failure mode — no database, unknown account, any role other than
 * "admin" — answers 403, so a non-admin can never reach the agent.
 */
export async function isAdminUser(userId) {
  if (!userId) return false
  if (!isDatabaseConnected()) return false
  try {
    const user = await User.findById(userId).select('role').lean()
    return user?.role === 'admin'
  } catch {
    return false
  }
}

export default async function requireAdmin(req, res, next) {
  try {
    const allowed = await isAdminUser(req.user?.id)
    if (!allowed) {
      return next(new ApiError(403, ADMIN_REQUIRED_MESSAGE, 'FORBIDDEN'))
    }
    req.userRole = 'admin'
    return next()
  } catch (error) {
    return next(error)
  }
}
