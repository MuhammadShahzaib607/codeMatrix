import fs from 'node:fs'
import path from 'node:path'
import ApiError from '../utils/ApiError.js'
import asyncHandler from '../utils/asyncHandler.js'
import {
  WORKSPACES_ROOT,
  findContainerProjectId,
  getWorkspaceRecord,
  isValidProjectId,
  resolveContainerOwnerPath,
  resolveWorkspaceFile,
} from '../utils/workspaceManager.js'

// A deliberately small, self-contained MIME lookup — no extra dependency. The
// keys are lower-cased extensions including the leading dot. Anything unknown
// falls back to application/octet-stream, which makes the browser download it
// rather than trying to render it.
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.jsx': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
}

export function contentTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

function isHtmlFile(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return ext === '.html' || ext === '.htm'
}

/**
 * The tiny client injected into every served .html file. It loads the
 * Socket.IO client from the SAME origin that served the page (Socket.IO serves
 * /socket.io/socket.io.js itself), joins the project's preview room and
 * reloads on `preview:reload` — the event the chokidar watcher emits whenever
 * anything inside that project's workspace changes on disk.
 *
 * The `projectId` is JSON-encoded into the script so its exact value is used;
 * project ids are validated to [A-Za-z0-9_-] before we ever get here anyway.
 */
function reloadScript(projectId) {
  const idLiteral = JSON.stringify(projectId)
  return `<!-- CodeMatrix live preview (injected, not written to disk) -->
<script>
(function () {
  var PROJECT_ID = ${idLiteral};
  function connect() {
    if (typeof window.io !== 'function') return;
    var socket = window.io({ transports: ['websocket', 'polling'] });
    socket.on('connect', function () {
      socket.emit('preview:watch', { projectId: PROJECT_ID });
    });
    socket.on('preview:reload', function (payload) {
      if (!payload || payload.projectId === PROJECT_ID) window.location.reload();
    });
  }
  var script = document.createElement('script');
  script.src = '/socket.io/socket.io.js';
  script.async = true;
  script.onload = connect;
  document.body.appendChild(script);
})();
</script>`
}

export function injectReloadScript(html, projectId) {
  const script = reloadScript(projectId)
  const closingBody = /<\/body\s*>/i
  if (closingBody.test(html)) {
    // Preserve the original </body> tag and slot the script immediately before it.
    return html.replace(closingBody, (match) => `${script}\n${match}`)
  }
  // Malformed / fragment HTML with no closing body: append at the end.
  return `${html}\n${script}\n`
}

/**
 * GET /preview/:projectId/* — serves a file from that project's workspace as a
 * real static asset. Directories (and the empty path) resolve to their
 * index.html, exactly like a static site server.
 *
 * Security: mounted behind protectPreview (JWT from ?token= or the
 * Authorization header), validateProjectId, authorizeProject (ownership) and
 * ensureWorkspace (folder exists). Path resolution goes through
 * resolveWorkspaceFile, whose traversal guard rejects anything outside the
 * workspace folder.
 */
/**
 * Resolves one preview path against the RIGHT root:
 *   - a project id (registered, or a legacy folder named after the id) resolves
 *     inside that project's workspace folder;
 *   - anything else is the NAME of a top-level folder in the REQUESTER's own
 *     container, which is how "../sibling/logo.png" from a previewed page
 *     loads. The container is always derived from the verified JWT, so this
 *     can never reach another user's files, and resolveContainerOwnerPath
 *     applies the same traversal guard every other container path uses.
 *
 * Returns { absolute, inner } where `inner` is relative to that root.
 */
function resolvePreviewTarget(ownerId, segment, target) {
  const isProjectRoot =
    isValidProjectId(segment) &&
    (Boolean(getWorkspaceRecord(segment)) || fs.existsSync(path.join(WORKSPACES_ROOT, segment)))

  if (isProjectRoot) {
    const resolved = resolveWorkspaceFile(segment, target)
    return { absolute: resolved.absolute, inner: resolved.relative, projectId: segment }
  }

  const joined = target ? `${segment}/${target}` : segment
  const resolved = resolveContainerOwnerPath(ownerId, joined)
  return {
    absolute: resolved.absolute,
    inner: resolved.inner,
    projectId: findContainerProjectId(ownerId, resolved.top) ?? segment,
  }
}

export const servePreviewFile = asyncHandler(async (req, res) => {
  const segment = String(req.params.projectId ?? '')
  const requested = typeof req.params[0] === 'string' ? req.params[0] : ''

  let target = requested.replace(/^\/+/, '')
  if (!target) target = 'index.html'

  let resolved = resolvePreviewTarget(req.user.id, segment, target)
  let stats = await fs.promises.stat(resolved.absolute).catch(() => null)

  // Directory request (e.g. /preview/:id/ or /preview/:id/sub/) -> index.html.
  if (stats?.isDirectory()) {
    target = resolved.inner ? `${resolved.inner}/index.html` : 'index.html'
    resolved = resolvePreviewTarget(req.user.id, segment, target)
    stats = await fs.promises.stat(resolved.absolute).catch(() => null)
  }

  if (!stats || !stats.isFile()) {
    throw new ApiError(404, `"${resolved.inner || target}" was not found.`, 'FILE_MISSING')
  }

  // Never cache preview responses: a reload must always show the bytes that are
  // on disk right now, not a stale entry the browser kept from a previous edit.
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  res.setHeader('X-Content-Type-Options', 'nosniff')

  if (isHtmlFile(resolved.absolute)) {
    const html = await fs.promises.readFile(resolved.absolute, 'utf8')
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(injectReloadScript(html, resolved.projectId))
    return
  }

  // Binary-safe: read the raw bytes and hand them over with the mapped MIME type.
  const contents = await fs.promises.readFile(resolved.absolute)
  res.setHeader('Content-Type', contentTypeFor(resolved.absolute))
  res.send(contents)
})

export const __testables = { contentTypeFor, injectReloadScript, isHtmlFile }
