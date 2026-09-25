import { ROOT_ID } from '../services/fileSystemAccess'

/**
 * Cloud workspaces are keyed by their relative path rather than a random id:
 * the path is exactly what the API expects, so no id -> path lookup is needed.
 * The workspace root keeps the existing ROOT_ID so the Sidebar's "locked row"
 * behaviour is unchanged.
 */

export function toReduxTree(serverNode, previousTree = null) {
  const id = serverNode.path === '' ? ROOT_ID : serverNode.path
  const previous = previousTree ? findNodeByPath(previousTree, serverNode.path) : null

  const node = {
    id,
    name: serverNode.name,
    type: serverNode.type,
    path: serverNode.path,
    // Folder open/closed state survives a refresh.
    isOpen: serverNode.path === '' ? true : (previous?.isOpen ?? false),
  }

  if (serverNode.type === 'folder') {
    node.children = (serverNode.children ?? []).map((child) =>
      toReduxTree(child, previousTree),
    )
  }

  return node
}

export function findNodeByPath(nodes, path) {
  for (const node of nodes) {
    if (node.path === path) return node
    if (node.children) {
      const found = findNodeByPath(node.children, path)
      if (found) return found
    }
  }
  return null
}

/** Redux node ids (== paths) of every file in a Redux subtree. */
export function collectFilePathIds(node, ids = []) {
  if (!node) return ids
  if (node.type === 'file') {
    ids.push(node.id)
    return ids
  }
  for (const child of node.children ?? []) collectFilePathIds(child, ids)
  return ids
}

/** Relative paths of every file in a raw server tree (used by sync/export). */
export function collectFilePaths(serverNode, paths = []) {
  if (!serverNode) return paths
  if (serverNode.type === 'file') {
    paths.push(serverNode.path)
    return paths
  }
  for (const child of serverNode.children ?? []) collectFilePaths(child, paths)
  return paths
}

/** Rewrites an id/path when its ancestor (or itself) was renamed. */
export function remapId(oldPath, newPath, id) {
  if (typeof id !== 'string') return id
  if (id === oldPath) return newPath
  if (id.startsWith(`${oldPath}/`)) return `${newPath}${id.slice(oldPath.length)}`
  return id
}

/** Applies remapId() to every id and path in a Redux tree after a rename/move. */
export function remapTreeIds(nodes, oldPath, newPath) {
  return nodes.map((node) => {
    const next = {
      ...node,
      id: remapId(oldPath, newPath, node.id),
      path: remapId(oldPath, newPath, node.path),
    }
    if (node.children) next.children = remapTreeIds(node.children, oldPath, newPath)
    return next
  })
}

export function parentPathOf(path = '') {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

export function joinPath(parentPath, name) {
  return parentPath ? `${parentPath}/${name}` : name
}
