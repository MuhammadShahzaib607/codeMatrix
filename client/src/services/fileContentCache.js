import { workspaceApi } from './api'

/**
 * Session cache of workspace file contents, keyed by `projectId:path`.
 *
 * Search-in-files walks every file in the project; without this, each search
 * keystroke would re-download the entire project. The cache is dropped whenever
 * the active project changes (see App.jsx).
 */
const cache = new Map()

function keyOf(projectId, path) {
  return `${projectId}:${path}`
}

export function clearFileContentCache() {
  cache.clear()
}

export function setCachedFileContent(projectId, path, content) {
  if (!projectId || !path) return
  cache.set(keyOf(projectId, path), content)
}

export async function getFileContent(projectId, path) {
  const key = keyOf(projectId, path)
  if (cache.has(key)) return cache.get(key)

  const data = await workspaceApi.getFile(projectId, path)
  cache.set(key, data.content)
  return data.content
}
