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

export function flattenTreeNodes(nodes, parentPath = '', depth = 0, out = []) {
  for (const node of nodes) {
    const path = node.path ?? (parentPath ? `${parentPath}/${node.name}` : node.name)
    out.push({ id: node.id, name: node.name, type: node.type, path, depth })
    if (node.children) flattenTreeNodes(node.children, path, depth + 1, out)
  }
  return out
}

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
