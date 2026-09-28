// Single source of truth for the API base URL.
// Read ONLY from VITE_API_BASE_URL (client/.env, see client/.env.example).
// Every API call in the app goes through this module — do not build API URLs
// anywhere else.
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '')

if (!API_BASE_URL) {
  console.error(
    '[api] VITE_API_BASE_URL is not set. Copy client/.env.example to client/.env, set VITE_API_BASE_URL to the API origin (the PORT in server/.env), and restart the dev server.',
  )
}

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
  } catch {}
}

export function clearAuthToken() {
  setAuthToken(null)
}

function authHeaders() {
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export class ApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.isWorkspaceMissing = code === 'WORKSPACE_MISSING'
  }
}

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
  return new ApiError(body?.error?.message ?? `Request failed with status ${response.status}.`, {
    status: response.status,
    code: body?.error?.code,
  })
}

async function request(path, options = {}) {
  if (!API_BASE_URL) {
    throw new ApiError(
      'VITE_API_BASE_URL is not set in client/.env — cannot reach the API. See client/.env.example.',
      { status: 0, code: 'MISSING_API_BASE_URL' },
    )
  }

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

export const authApi = {
  register(payload) {
    return request('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) })
  },

  login(payload) {
    return request('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) })
  },

  me() {
    return request('/api/auth/me')
  },
}

export const terminalApi = {
  // The set of shells the SERVER can spawn depends on the server's OS, so the
  // dropdown is populated from the server instead of being hardcoded.
  getShells() {
    return request('/api/terminal/shells')
  },
}

export const projectApi = {
  create(payload) {
    return request('/api/projects', { method: 'POST', body: JSON.stringify(payload) })
  },

  list() {
    return request('/api/projects')
  },

  // Permanently deletes a project: its workspace folder on disk plus its record.
  remove(projectId) {
    return request(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' })
  },
}

// User-provided Groq API keys (Settings -> AI). The server only ever returns
// MASKED keys — the full key is encrypted server-side and used solely inside an
// agent run.
export const agentKeysApi = {
  list() {
    return request('/api/keys')
  },

  // The LATEST captured Groq rate-limit numbers for each saved key. Does not
  // call Groq itself — the server returns what the most recent agent request
  // observed, so it can be slightly stale until the next request refreshes it.
  usage() {
    return request('/api/keys/usage')
  },

  providers() {
    return request('/api/keys/providers')
  },

  create(provider, key, label) {
    return request('/api/keys', {
      method: 'POST',
      body: JSON.stringify({ provider, key, label }),
    })
  },

  remove(keyId) {
    return request(`/api/keys/${encodeURIComponent(keyId)}`, { method: 'DELETE' })
  },

  // The ONLY calls that return a decrypted key. Both require the account
  // password (re-verified server-side against the login password hash).
  reveal(keyId, password) {
    return request(`/api/keys/${encodeURIComponent(keyId)}/reveal`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    })
  },

  // Updates the label and/or replaces the key value. `key` is optional — omit
  // it to change only the label.
  update(keyId, { password, label, key }) {
    return request(`/api/keys/${encodeURIComponent(keyId)}`, {
      method: 'PUT',
      body: JSON.stringify({ password, label, key }),
    })
  },
}

export const workspaceApi = {
  baseUrl: API_BASE_URL,

  // The user's ONE reusable scratch workspace (created on demand server-side).
  openScratch(task) {
    // `task` (optional) names the workspace from the task text BEFORE the
    // folder exists, so a fresh agent run never writes into a "Scratch"
    // container — see openScratchWorkspaceHandler on the server.
    return request('/api/workspace/scratch', {
      method: 'POST',
      body: task ? JSON.stringify({ task }) : undefined,
    })
  },

  importProject(projectId, payload) {
    return request(workspacePath(projectId, '/import'), {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  getTree(projectId) {
    return request(workspacePath(projectId, '/tree'))
  },

  getFile(projectId, filePath) {
    return request(`${workspacePath(projectId, '/file')}?path=${encodeURIComponent(filePath)}`)
  },

  saveFile(projectId, filePath, content) {
    return request(workspacePath(projectId, '/file'), {
      method: 'PUT',
      body: JSON.stringify({ path: filePath, content }),
    })
  },

  createEntry(projectId, path, type) {
    return request(workspacePath(projectId, '/create'), {
      method: 'POST',
      body: JSON.stringify({ path, type }),
    })
  },

  deleteEntry(projectId, path) {
    return request(workspacePath(projectId, '/delete'), {
      method: 'DELETE',
      body: JSON.stringify({ path }),
    })
  },

  renameEntry(projectId, oldPath, newPath) {
    return request(workspacePath(projectId, '/rename'), {
      method: 'PATCH',
      body: JSON.stringify({ oldPath, newPath }),
    })
  },

  // Copy -> Paste in the Explorer context menu. Folders are copied recursively
  // server-side.
  duplicateEntry(projectId, sourcePath, targetFolderPath) {
    return request(workspacePath(projectId, '/duplicate'), {
      method: 'POST',
      body: JSON.stringify({ sourcePath, targetFolderPath }),
    })
  },

  async exportProject(projectId) {
    if (!API_BASE_URL) {
      throw new ApiError(
        'VITE_API_BASE_URL is not set in client/.env — cannot reach the API. See client/.env.example.',
        { status: 0, code: 'MISSING_API_BASE_URL' },
      )
    }

    let response
    try {
      response = await fetch(`${API_BASE_URL}${workspacePath(projectId, '/export')}`, {
        headers: authHeaders(),
      })
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
