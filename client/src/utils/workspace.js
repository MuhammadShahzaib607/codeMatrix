/**
 * There are two kinds of server-side workspace and they share one API:
 *
 *   source 'cloud'    -> a real imported project (registered in MongoDB)
 *   source 'scratch'  -> the per-user scratch workspace used before anything is
 *                        imported (server/workspaces/scratch-<userId>/)
 *
 * The scratch workspace is the SAME folder the terminal uses as its cwd, so
 * files created in the Explorer show up in the terminal and vice versa.
 */

/**
 * The scratch workspace id for a user. Keep this as the single source of truth —
 * the Explorer and the terminal must resolve to the exact same folder.
 */
export function scratchProjectIdFor(userId) {
  return userId ? `scratch-${userId}` : 'scratch-guest'
}

export function isCloudWorkspace(workspace) {
  return workspace?.source === 'cloud' && Boolean(workspace.projectId)
}

export function isScratchWorkspace(workspace) {
  return workspace?.source === 'scratch' && Boolean(workspace.projectId)
}

/** Cloud OR scratch: anything with real files behind the workspace API. */
export function hasActiveWorkspace(workspace) {
  return isCloudWorkspace(workspace) || isScratchWorkspace(workspace)
}

// The on-disk folder of an anonymous scratch is called "Scratch" (or
// "Scratch-2", …). That name is an implementation detail: it must never be
// shown to the user, neither as an Explorer root row nor in the topbar chip.
const ANONYMOUS_SCRATCH_NAME = /^scratch(-\d+)?$/i

/** True while the workspace is still an unnamed throwaway scratch folder. */
export function isAnonymousScratchWorkspace(workspace) {
  if (!isScratchWorkspace(workspace)) return false
  const name = String(workspace.name ?? '').trim()
  return !name || ANONYMOUS_SCRATCH_NAME.test(name)
}

/** Human label for the topbar chip / welcome screen. */
export function workspaceLabel(workspace) {
  if (isCloudWorkspace(workspace)) return workspace.name
  if (isScratchWorkspace(workspace)) return 'Untitled workspace'
  return null
}
