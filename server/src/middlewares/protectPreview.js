import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import ApiError from '../utils/ApiError.js'

/**
 * Auth for the live-preview static file server.
 *
 * A preview is opened as a PLAIN browser tab (window.open), so it cannot attach
 * an Authorization header the way every fetch in the app does. The token is
 * therefore read from the `token` query parameter (…/index.html?token=<jwt>)
 * and, as a convenience for programmatic/API callers, also from the usual
 * `Authorization: Bearer <jwt>` header.
 *
 * The verified payload is the exact same JWT the REST API uses, so
 * `authorizeProject` and `ensureWorkspace` can run afterwards unchanged.
 */
export default function protectPreview(req, res, next) {
  const header = req.get('authorization') || ''
  const [scheme, headerToken] = header.split(' ')
  const queryToken = typeof req.query?.token === 'string' ? req.query.token : ''
  const token = queryToken || (scheme?.toLowerCase() === 'bearer' ? headerToken : '')

  if (!token) {
    return next(
      new ApiError(
        401,
        'A live preview needs a valid token. Open it from CodeMatrix.',
        'UNAUTHORIZED',
      ),
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
      new ApiError(401, 'Your preview session has expired. Reopen the preview from CodeMatrix.', 'INVALID_TOKEN'),
    )
  }
}
