import { CONTAINER_ID, ROOT_ID } from '../services/fileSystemAccess'
import { findNode, findParentId } from './tree'

/**
 * Where a new file / folder goes, from the current selection:
 *
 *   - a FOLDER row is selected (the project ROOT row counts) -> inside it;
 *   - a FILE row is selected                               -> its parent folder;
 *   - NOTHING is selected                                  -> the TOP LEVEL, a
 *     sibling of the project folder inside the user's container.
 *
 * With no workspace at all the target stays ROOT_ID, so the existing
 * "first create bootstraps a scratch workspace" flow is untouched.
 */
export function resolveCreateTargetId({ selectedId = null, tree = [], hasProject = false } = {}) {
  const fallback = hasProject ? CONTAINER_ID : ROOT_ID
  if (!selectedId) return fallback
  const selected = findNode(tree, selectedId)
  if (!selected) return fallback
  if (selected.type === 'folder') return selected.id
  const parentId = findParentId(tree, selectedId)
  if (parentId === undefined || parentId === null) return ROOT_ID
  return parentId
}

/**
 * The container entries that are SIBLINGS of the active project. The active
 * project's own folder is excluded: it is rendered as the project tree itself
 * (or, while the workspace is still an anonymous scratch, as its promoted
 * children), so it must never appear twice.
 */
export function containerSiblings(entries = [], activeProjectId = null) {
  if (!Array.isArray(entries)) return []
  return entries.filter((entry) => !activeProjectId || entry?.projectId !== activeProjectId)
}

export function isContainerTarget(parentId) {
  return parentId === CONTAINER_ID
}
