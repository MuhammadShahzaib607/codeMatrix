import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import ApiError from '../utils/ApiError.js'

export default function protect(req, res, next) {
  const header = req.get('authorization') || ''
  const [scheme, token] = header.split(' ')

  if (!token || scheme.toLowerCase() !== 'bearer') {
    return next(
      new ApiError(401, 'Authentication required. Please sign in to continue.', 'UNAUTHORIZED'),
    )
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret)
    if (!payload?.id) {
      return next(new ApiError(401, 'Invalid session token.', 'INVALID_TOKEN'))
    }
    req.user = { id: payload.id }
    return next()
  } catch {
    return next(
      new ApiError(401, 'Your session has expired. Please sign in again.', 'INVALID_TOKEN'),
    )
  }
}
