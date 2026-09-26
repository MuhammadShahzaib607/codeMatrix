// Local preferences for the AI agent: which stack the selector last used in
// EACH project, and which saved Groq key the session should use. Pure
// localStorage helpers (same pattern as settingsStorage / workspaceStorage).

const FRAMEWORKS_KEY = 'code-matrix:aiFrameworks'
const KEY_ID_KEY = 'code-matrix:aiKeyId'

const DEFAULT_FRAMEWORK = 'react'

function readFrameworks() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FRAMEWORKS_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** The framework last chosen for this project (falls back to React). */
export function frameworkFor(projectId) {
  if (!projectId) return DEFAULT_FRAMEWORK
  return readFrameworks()[projectId] ?? DEFAULT_FRAMEWORK
}

/** Remembers the selection per project, so it survives reloads and switches. */
export function saveFrameworkFor(projectId, framework) {
  if (!projectId || !framework) return
  try {
    const map = readFrameworks()
    map[projectId] = framework
    localStorage.setItem(FRAMEWORKS_KEY, JSON.stringify(map))
  } catch {}
}

/** Which saved key the agent should use; null = the most recently added. */
export function loadSelectedKeyId() {
  try {
    return localStorage.getItem(KEY_ID_KEY) || null
  } catch {
    return null
  }
}

export function saveSelectedKeyId(keyId) {
  try {
    if (keyId) localStorage.setItem(KEY_ID_KEY, keyId)
    else localStorage.removeItem(KEY_ID_KEY)
  } catch {}
}
