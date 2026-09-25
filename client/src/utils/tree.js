// Pure helpers for operating on the nested file tree.
// All of them return new arrays/objects so they are safe to use with Immer.

export function findNode(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.children) {
      const found = findNode(node.children, id)
      if (found) return found
    }
  }
  return null
}

// Returns undefined when the id is not in the tree, null when it sits at the root.
export function findParentId(nodes, id, parentId = null) {
  for (const node of nodes) {
    if (node.id === id) return parentId
    if (node.children) {
      const found = findParentId(node.children, id, node.id)
      if (found !== undefined) return found
    }
  }
  return undefined
}

export function collectFileIds(node) {
  if (!node) return []
  if (node.type === 'file') return [node.id]
  return (node.children ?? []).flatMap(collectFileIds)
}

// Every id in the subtree, files and folders alike (used to drop stale handles).
export function collectAllIds(node) {
  if (!node) return []
  return [node.id, ...(node.children ?? []).flatMap(collectAllIds)]
}

// File ids that disappeared between two versions of the same subtree.
export function newNodeFileIds(previous, next) {
  const nextIds = new Set(collectFileIds(next))
  return collectFileIds(previous).filter((id) => !nextIds.has(id))
}

export function updateNode(nodes, id, updater) {
  return nodes.map((node) => {
    if (node.id === id) return updater(node)
    if (node.children) return { ...node, children: updateNode(node.children, id, updater) }
    return node
  })
}

export function removeNode(nodes, id) {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) => (node.children ? { ...node, children: removeNode(node.children, id) } : node))
}

// parentId === null appends the node at the root of the tree.
export function insertNode(nodes, parentId, newNode) {
  if (parentId === null) return [...nodes, newNode]
  return nodes.map((node) => {
    if (node.id === parentId) return { ...node, children: [...(node.children ?? []), newNode] }
    if (node.children) return { ...node, children: insertNode(node.children, parentId, newNode) }
    return node
  })
}

export function mapTree(nodes, fn) {
  return nodes.map((node) => {
    const mapped = node.children ? { ...node, children: mapTree(node.children, fn) } : node
    return fn(mapped)
  })
}

/**
 * Flattens a tree into [{ id, name, type, path, depth }] in display order.
 * `path` is the relative path used for display and for search results; cloud
 * nodes already carry it, demo nodes get one built from their names.
 */
export function flattenTreeNodes(nodes, parentPath = '', depth = 0, out = []) {
  for (const node of nodes) {
    const path = node.path ?? (parentPath ? `${parentPath}/${node.name}` : node.name)
    out.push({ id: node.id, name: node.name, type: node.type, path, depth })
    if (node.children) flattenTreeNodes(node.children, path, depth + 1, out)
  }
  return out
}

/**
 * Folder ids from the root down to (but not including) the node with `id`.
 * Returns [] for a top-level node and null when the id is not in the tree.
 */
export function collectAncestorFolderIds(nodes, id, trail = []) {
  for (const node of nodes) {
    if (node.id === id) return trail
    if (node.children) {
      const found = collectAncestorFolderIds(node.children, id, [...trail, node.id])
      if (found) return found
    }
  }
  return null
}

// Seeds the editor's content map so files open with their dummy content.
export function buildContentMap(nodes, map = {}) {
  for (const node of nodes) {
    if (node.type === 'file') map[node.id] = node.content ?? ''
    else if (node.children) buildContentMap(node.children, map)
  }
  return map
}
