import { API_BASE_URL, getAuthToken } from '../services/api'

/**
 * Live preview ("Live Server" style) helpers.
 *
 * A preview is a real static page served by the API server at
 * /preview/:projectId/<path>?token=<jwt>. It is opened in a NEW browser tab, so
 * the auth token has to travel as a query parameter — a plain tab cannot send
 * the Authorization header every fetch in this app uses.
 */

export function isHtmlPath(filePath) {
  if (typeof filePath !== 'string') return false
  const lower = filePath.toLowerCase()
  return lower.endsWith('.html') || lower.endsWith('.htm')
}

/** Every .html/.htm file anywhere in the tree, in tree order. */
export function collectHtmlFiles(nodes, out = []) {
  for (const node of nodes ?? []) {
    if (node.type === 'folder') {
      collectHtmlFiles(node.children, out)
    } else {
      const path = node.path ?? node.id ?? node.name
      if (isHtmlPath(path)) out.push({ id: node.id, name: node.name, path })
    }
  }
  return out
}

/** The workspace-root index.html, if one exists (case-insensitive match). */
export function findRootIndexHtml(nodes) {
  return collectHtmlFiles(nodes).find((file) => file.path.toLowerCase() === 'index.html') ?? null
}

/**
 * Builds the absolute preview URL for a file. API_BASE_URL is the API origin
 * (the server that owns /preview and the Socket.IO connection), so the tab must
 * point there — not at the Vite dev origin.
 */
export function buildPreviewUrl(projectId, filePath) {
  const cleanPath = String(filePath ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
  const encodedPath = cleanPath.split('/').map(encodeURIComponent).join('/')
  const base = `${API_BASE_URL}/preview/${encodeURIComponent(projectId)}/${encodedPath}`
  const token = getAuthToken()
  return token ? `${base}?token=${encodeURIComponent(token)}` : base
}

/** Opens a preview in a new browser tab. Returns the URL that was opened. */
export function openPreviewTab(projectId, filePath) {
  const url = buildPreviewUrl(projectId, filePath)
  window.open(url, '_blank', 'noopener,noreferrer')
  return url
}
