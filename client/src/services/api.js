/**
 * Thin fetch wrapper around the API. Every call automatically attaches the
 * `Authorization: Bearer <token>` header when a session token is stored.
 *
 * The client no longer reads or writes the user's laptop during editing — every
 * file operation goes through these endpoints, because the project "lives" in a
 * server-side workspace folder once it has been imported.
 */

export const API_BASE_URL = (
  import.meta.env.VITE_API_URL ?? 'http://localhost:4000'
).replace(/\/+$/, '')

/** Auth token lives in localStorage so a reload keeps the session. */
const TOKEN_KEY = 'code-matrix:token'

export function getAuthToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setAuthToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Storage can be unavailable (private mode); the session is just not kept.
  }
}

export function clearAuthToken() {
  setAuthToken(null)
}

/** Authorization header for the current session, if any. */
function authHeaders() {
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Error shape shared by every call, with the server's machine-readable code. */
export class ApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    // The free-tier disk can reset at any time; the UI special-cases this.
    this.isWorkspaceMissing = code === 'WORKSPACE_MISSING'
  }
}

/** True when an error means the on-disk workspace vanished (server restart). */
export function isWorkspaceMissingError(error) {
  return error?.isWorkspaceMissing === true || error?.code === 'WORKSPACE_MISSING'
}

async function readError(response) {
  let body = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  return new ApiError(
    body?.error?.message ?? `Request failed with status ${response.status}.`,
    { status: response.status, code: body?.error?.code },
  )
}

async function request(path, options = {}) {
  const { headers, ...rest } = options
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json', ...authHeaders(), ...headers },
      ...rest,
    })
  } catch {
    throw new ApiError(`Could not reach the server at ${API_BASE_URL}. Is it running?`, {
      status: 0,
      code: 'NETWORK_ERROR',
    })
  }

  if (!response.ok) throw await readError(response)

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return null
  return response.json()
}

function workspacePath(projectId, suffix) {
  return `/api/workspace/${encodeURIComponent(projectId)}${suffix}`
}

export const workspaceApi = {
  baseUrl: API_BASE_URL,

  /** POST /api/workspace/:projectId/import */
  importProject(projectId, payload) {
    return request(workspacePath(projectId, '/import'), {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  /** GET /api/workspace/:projectId/tree */
  getTree(projectId) {
    return request(workspacePath(projectId, '/tree'))
  },

  /** GET /api/workspace/:projectId/file?path=... */
  getFile(projectId, filePath) {
    return request(`${workspacePath(projectId, '/file')}?path=${encodeURIComponent(filePath)}`)
  },

  /** PUT /api/workspace/:projectId/file */
  saveFile(projectId, filePath, content) {
    return request(workspacePath(projectId, '/file'), {
      method: 'PUT',
      body: JSON.stringify({ path: filePath, content }),
    })
  },

  /** POST /api/workspace/:projectId/create */
  createEntry(projectId, path, type) {
    return request(workspacePath(projectId, '/create'), {
      method: 'POST',
      body: JSON.stringify({ path, type }),
    })
  },

  /** DELETE /api/workspace/:projectId/delete */
  deleteEntry(projectId, path) {
    return request(workspacePath(projectId, '/delete'), {
      method: 'DELETE',
      body: JSON.stringify({ path }),
    })
  },

  /** PATCH /api/workspace/:projectId/rename */
  renameEntry(projectId, oldPath, newPath) {
    return request(workspacePath(projectId, '/rename'), {
      method: 'PATCH',
      body: JSON.stringify({ oldPath, newPath }),
    })
  },

  /** GET /api/workspace/:projectId/export — streams back a .zip */
  async exportProject(projectId) {
    let response
    try {
      response = await fetch(workspacePath(projectId, '/export'), { headers: authHeaders() })
    } catch {
      throw new ApiError(`Could not reach the server at ${API_BASE_URL}. Is it running?`, {
        status: 0,
        code: 'NETWORK_ERROR',
      })
    }

    if (!response.ok) throw await readError(response)

    const disposition = response.headers.get('content-disposition') ?? ''
    const match = /filename="?([^";]+)"?/i.exec(disposition)

    return {
      blob: await response.blob(),
      filename: match?.[1] ?? `${projectId}.zip`,
    }
  },
}

export const authApi = {
  /** POST /api/auth/register */
  register(payload) {
    return request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  /** POST /api/auth/login */
  login(payload) {
    return request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  /** GET /api/auth/me */
  me() {
    return request('/api/auth/me')
  },
}
