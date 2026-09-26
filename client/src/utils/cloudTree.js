import { ROOT_ID } from '../services/fileSystemAccess'

export function toReduxTree(serverNode, previousTree = null) {
  const id = serverNode.path === '' ? ROOT_ID : serverNode.path
  const previous = previousTree ? findNodeByPath(previousTree, serverNode.path) : null

  const node = {
    id,
    name: serverNode.name,
    type: serverNode.type,
    path: serverNode.path,
    isOpen: serverNode.path === '' ? true : (previous?.isOpen ?? false),
  }

  if (serverNode.type === 'folder') {
    node.children = (serverNode.children ?? []).map((child) => toReduxTree(child, previousTree))
  }

  // STRUCTURAL SHARING: a node that is unchanged (same name/type/path/open state
  // AND the same child object references) is returned as the PREVIOUS object.
  // Because children are reused first, reference equality is enough to prove a
  // whole subtree is unchanged. Combined with memo() on the tree row, an
  // auto-refresh only re-renders the branches that actually changed instead of
  // the entire Explorer — which matters now that the tree may contain thousands
  // of node_modules entries.
  if (previous && areSameNode(previous, node)) return previous
  return node
}

function areSameNode(a, b) {
  if (a.name !== b.name || a.type !== b.type || a.path !== b.path || a.isOpen !== b.isOpen) {
    return false
  }
  const aChildren = a.children ?? []
  const bChildren = b.children ?? []
  if (aChildren.length !== bChildren.length) return false
  for (let i = 0; i < aChildren.length; i += 1) {
    if (aChildren[i] !== bChildren[i]) return false
  }
  return true
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

export function collectFilePaths(serverNode, paths = []) {
  if (!serverNode) return paths
  if (serverNode.type === 'file') {
    paths.push(serverNode.path)
    return paths
  }
  for (const child of serverNode.children ?? []) collectFilePaths(child, paths)
  return paths
}

export function remapId(oldPath, newPath, id) {
  if (typeof id !== 'string') return id
  if (id === oldPath) return newPath
  if (id.startsWith(`${oldPath}/`)) return `${newPath}${id.slice(oldPath.length)}`
  return id
}

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

export function baseNameOf(path = '') {
  const index = path.lastIndexOf('/')
  return index === -1 ? path : path.slice(index + 1)
}

export function joinPath(parentPath, name) {
  return parentPath ? `${parentPath}/${name}` : name
}
