/**
 * Remembers which cloud project the tab is editing, so a page reload can try to
 * reopen it. Only the id and name are stored — when the server's ephemeral disk
 * has been reset, the tree request answers 404 and the UI shows the recovery
 * notice instead.
 */

const STORAGE_KEY = 'code-matrix:workspace'

export function saveWorkspaceRef({ projectId, name }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ projectId, name }))
  } catch {
    // Storage can be unavailable (private mode); the app works without it.
  }
}

export function getWorkspaceRef() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.projectId ? parsed : null
  } catch {
    return null
  }
}

export function clearWorkspaceRef() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore.
  }
}
