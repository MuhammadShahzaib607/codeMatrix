const STORAGE_KEY = 'code-matrix:workspace'

export function saveWorkspaceRef({ projectId, name }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ projectId, name }))
  } catch {}
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
  } catch {}
}
