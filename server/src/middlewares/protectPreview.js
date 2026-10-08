import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import ApiError from '../utils/ApiError.js'

/**
 * Auth for the live-preview static file server.
 *
 * A preview is opened as a PLAIN browser tab (window.open), so it cannot attach
 * an Authorization header the way every fetch in the app does. The token is
 * therefore read from the `token` query parameter (…/index.html?token=<jwt>).
 *
 * RELATIVE ASSETS NEED THE COOKIE. A browser resolves `<link rel="stylesheet"
 * href="style.css">` inside /preview/<id>/index.html?token=… to
 * /preview/<id>/style.css — the query string is DROPPED. Without a second
 * credential every stylesheet and script of a generated site would 401 and the
 * preview would render unstyled and dead (that is exactly the "file linking"
 * bug). So whenever a token arrives by query/header (i.e. on the document that
 * opens the preview), it is mirrored into a per-project, path-scoped cookie:
 *
 *     cm_preview_<projectId>=<jwt>; Path=/preview/<projectId>; HttpOnly; SameSite=Lax
 *
 * Every later sub-resource request under that path carries the cookie
 * automatically, and the cookie can never be sent to another project's preview
 * (different path) or read by page script (HttpOnly).
 *
 * As a convenience for programmatic/API callers, the usual
 * `Authorization: Bearer <jwt>` header is still accepted too.
 *
 * The verified payload is the exact same JWT the REST API uses, so
 * `authorizeProject` and `ensureWorkspace` can run afterwards unchanged.
 */

const COOKIE_PREFIX = 'cm_preview_'
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

/** Cookie name scoped to one project's preview paths. */
export function previewCookieName(projectId) {
  return `${COOKIE_PREFIX}${projectId}`
}

// The GENERIC preview cookie covers the whole /preview tree. A relative
// reference to a sibling folder ("../sibling/logo.png") resolves to
// /preview/sibling/logo.png — a path no per-project cookie is scoped to — so
// the document must also carry a cookie that is sent for every preview path.
// It stays HttpOnly + SameSite=Lax and is only ever sent to /preview/*, and
// every request still runs the ownership + traversal checks afterwards.
export const GENERIC_PREVIEW_COOKIE = `${COOKIE_PREFIX}all`

/** Reads ONE cookie value out of the raw Cookie header (no cookie-parser dep). */
function readCookie(req, name) {
  const raw = req.headers?.cookie
  if (!raw) return null
  for (const part of String(raw).split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    if (part.slice(0, separator).trim() !== name) continue
    const value = part.slice(separator + 1).trim()
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }
  return null
}

export default function protectPreview(req, res, next) {
  const header = req.get('authorization') || ''
  const [scheme, headerToken] = header.split(' ')
  const queryToken = typeof req.query?.token === 'string' ? req.query.token : ''
  const headerBearer = scheme?.toLowerCase() === 'bearer' ? headerToken : ''
  const projectId = String(req.params?.projectId ?? '')

  // Query/header first (the document that opens the preview), then the cookie
  // that document set for the assets it is about to request.
  const legacyCookie = PROJECT_ID_PATTERN.test(projectId)
    ? readCookie(req, previewCookieName(projectId))
    : null
  const cookieToken = readCookie(req, GENERIC_PREVIEW_COOKIE) ?? legacyCookie

  const token = queryToken || headerBearer || cookieToken

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

    // Mirror a presented query/header token into the path-scoped cookie so the
    // page's relative <link>/<script>/url() requests can authenticate.
    if (queryToken || headerBearer) {
      const cookies = [
        `${GENERIC_PREVIEW_COOKIE}=${encodeURIComponent(token)}; ` +
          `Path=/preview; HttpOnly; SameSite=Lax`,
      ]
      if (PROJECT_ID_PATTERN.test(projectId)) {
        cookies.push(
          `${previewCookieName(projectId)}=${encodeURIComponent(token)}; ` +
            `Path=/preview/${projectId}; HttpOnly; SameSite=Lax`,
        )
      }
      res.setHeader('Set-Cookie', cookies)
    }
    return next()
  } catch {
    return next(
      new ApiError(401, 'Your preview session has expired. Reopen the preview from CodeMatrix.', 'INVALID_TOKEN'),
    )
  }
}
