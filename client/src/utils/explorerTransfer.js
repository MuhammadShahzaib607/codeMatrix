import { ROOT_ID } from '../services/fileSystemAccess'
import { parentPathOf } from './cloudTree'
import { findNode } from './tree'

export function rootFolderNode(tree = []) {
  return tree.find((node) => node.id === ROOT_ID) ?? tree[0] ?? null
}

export function folderNodeForPath(tree = [], folderPath = '') {
  return folderPath ? findNode(tree, folderPath) : rootFolderNode(tree)
}

export function transferTargetFolderPath(targetNode) {
  if (!targetNode) return ''
  if (targetNode.type === 'folder') return targetNode.id
  return parentPathOf(targetNode.id)
}

export function isTopLevelFolder(node) {
  return Boolean(node) && node.type === 'folder' && !String(node.id).includes('/')
}

export function isInvalidTransferTarget(sourceNode, folderPath) {
  if (!sourceNode) return true
  const target = folderPath ?? ''
  if (isTopLevelFolder(sourceNode)) return target !== ''
  if (sourceNode.type === 'folder') {
    if (target === sourceNode.id) return true
    if (target.startsWith(`${sourceNode.id}/`)) return true
  }
  return false
}

export function uniqueChildName(targetFolderNode, name) {
  const children = targetFolderNode?.children ?? []
  const taken = (candidate) => children.some((child) => child.name === candidate)
  if (!taken(name)) return name

  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''

  let counter = 1
  let candidate = `${base} (copy)${extension}`
  while (taken(candidate)) {
    counter += 1
    candidate = `${base} (copy ${counter})${extension}`
  }
  return candidate
}
