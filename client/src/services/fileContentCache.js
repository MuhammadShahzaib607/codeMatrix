import { workspaceApi } from './api'

const cache = new Map()

export function clearFileContentCache() {
  cache.clear()
}

export function setCachedFileContent(path, content) {
  if (!path) return
  cache.set(path, content)
}

export async function getFileContent(path) {
  if (cache.has(path)) return cache.get(path)

  const data = await workspaceApi.getContainerFile(path)
  cache.set(path, data.content)
  return data.content
}
