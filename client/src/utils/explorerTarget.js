import { CONTAINER_ID, ROOT_ID } from '../services/fileSystemAccess'
import { findNode, findParentId } from './tree'
import { isAnonymousScratchName } from './workspace'

/**
 * Where a new file / folder goes, from the current selection:
 *
 *   - a FOLDER row is selected (the project ROOT row counts) -> inside it;
 *   - a FILE row is selected                               -> its parent folder;
 *   - NOTHING is selected                                  -> the TOP LEVEL, a
 *     sibling of the project folder inside the user's container.
 *
 * The top level is the target even with no workspace open, so the first
 * create NEVER bootstraps a hidden scratch folder behind the user's back.
 */
export function resolveCreateTargetId({ selectedId = null, tree = [] } = {}) {
  if (!selectedId) return CONTAINER_ID
  const selected = findNode(tree, selectedId)
  if (!selected) return CONTAINER_ID
  if (selected.type === 'folder') return selected.id
  const parentId = findParentId(tree, selectedId)
  if (parentId === undefined || parentId === null) return ROOT_ID
  return parentId
}

function isHiddenSystemScratch(entry) {
  if (entry?.type !== 'folder') return false
  if (!isAnonymousScratchName(entry?.name)) return false
  const projectId = String(entry?.projectId ?? '')
  return projectId.startsWith('scratch-') || !projectId
}

export function containerSiblings(entries = []) {
  if (!Array.isArray(entries)) return []
  return entries.filter((entry) => !isHiddenSystemScratch(entry))
}

export function isContainerTarget(parentId) {
  return parentId === CONTAINER_ID
}
