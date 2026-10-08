export function topSegmentOf(path) {
  const value = String(path ?? '')
  const index = value.indexOf('/')
  return index === -1 ? value : value.slice(0, index)
}

function rootChildrenOf(nodes) {
  if (Array.isArray(nodes) && nodes[0]?.id === 'root') return nodes[0].children ?? []
  return Array.isArray(nodes) ? nodes : []
}

export function projectIdForPath(path, nodes = []) {
  const top = topSegmentOf(path)
  if (!top) return null
  for (const node of rootChildrenOf(nodes)) {
    if (node.name === top && node.type === 'folder') return node.projectId ?? null
  }
  return null
}

export function isProjectPath(path, nodes = []) {
  return Boolean(projectIdForPath(path, nodes))
}

export function projectFolderNameForId(projectId, nodes = []) {
  if (!projectId) return null
  for (const node of rootChildrenOf(nodes)) {
    if (node.projectId === projectId && node.type === 'folder') return node.name
  }
  return null
}

export function projectNameForPath(path, nodes = []) {
  const top = topSegmentOf(path)
  if (!top) return null
  for (const node of rootChildrenOf(nodes)) {
    if (node.name === top && node.type === 'folder') return node.name
  }
  return null
}

export function previewTargetForPath(path, nodes = []) {
  const projectId = projectIdForPath(path, nodes)
  if (!projectId) return null
  const value = String(path ?? '')
  const top = topSegmentOf(value)
  return { projectId, innerPath: value.slice(top.length).replace(/^\/+/, '') }
}
