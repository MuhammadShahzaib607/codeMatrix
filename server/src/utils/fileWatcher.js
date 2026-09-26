import fs from 'node:fs'
import path from 'node:path'
import chokidar from 'chokidar'
import { WORKSPACES_ROOT, getWorkspacePath, isValidProjectId } from './workspaceManager.js'

/**
 * Live file watching for a project's workspace folder.
 *
 * The Explorer should follow the terminal: when a command creates, removes or
 * edits files (npm install, git checkout, a build step …) the tree has to update
 * without the user clicking anything. This module owns one chokidar watcher per
 * ACTIVE project and calls a `notify(projectId)` callback — debounced, so a burst
 * of thousands of events (e.g. npm install) collapses into a single refresh.
 *
 * Watchers are reference-counted: every client that asks to watch a project
 * increments its count, every unwatch/disconnect decrements it, and the watcher
 * is closed only when the last one leaves.
 */

const DEBOUNCE_MS = 750

// We watch for the TOP-LEVEL appearance/disappearance of these directories but
// never descend into them: node_modules alone can hold tens of thousands of
// files, and watching all of them would swamp the process for no benefit.
//
// IMPORTANT: this only limits how deep the WATCHER reports changes — it must
// never be read as a tree filter. The Explorer tree itself comes from
// workspaceManager.getWorkspaceTree, which has NO exclusions and shows every
// folder that exists on disk, node_modules and .git included. Creating
// node_modules still fires addDir here, so the tree refreshes and shows it.
const NEVER_DESCEND_INTO = new Set(['node_modules', '.git'])

// projectId -> { watcher, refs, timer, notify }
const watchers = new Map()

/**
 * True when `target` lives strictly INSIDE a directory we refuse to descend
 * into. The directory itself (e.g. `<root>/node_modules`) is NOT ignored, so its
 * own addDir/unlinkDir event still fires.
 */
function shouldIgnore(root, target) {
  const relative = path.relative(root, target)
  if (!relative) return false
  const segments = relative.split(path.sep)
  const ancestors = segments.slice(0, -1)
  return ancestors.some((segment) => NEVER_DESCEND_INTO.has(segment))
}

/**
 * Chooses what to hand chokidar. Normally that is the project folder itself. If
 * the folder does not exist yet (a freshly bootstrapped scratch workspace, or an
 * import in progress) we watch its parent container instead and scope events
 * back to the project path, so the watcher still starts reporting as soon as the
 * folder is created.
 */
function resolveWatchRoot(projectRoot) {
  if (fs.existsSync(projectRoot)) return { watchRoot: projectRoot, scopedTo: null }

  const container = path.dirname(projectRoot)
  if (container && container !== projectRoot && fs.existsSync(container)) {
    return { watchRoot: container, scopedTo: projectRoot }
  }

  return { watchRoot: WORKSPACES_ROOT, scopedTo: projectRoot }
}

function scheduleNotify(projectId) {
  const entry = watchers.get(projectId)
  if (!entry) return
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => {
    entry.timer = null
    try {
      entry.notify(projectId)
    } catch (error) {
      console.warn(`[watcher] notify ${projectId} failed: ${error?.message ?? error}`)
    }
  }, DEBOUNCE_MS)
}

/**
 * Starts (or joins) the watcher for a project. Returns false when the project id
 * is invalid or its folder does not exist (e.g. the workspace was wiped).
 */
export function startWatchingProject(projectId, notify) {
  if (!isValidProjectId(projectId)) return false

  const existing = watchers.get(projectId)
  if (existing) {
    existing.refs += 1
    if (typeof notify === 'function') existing.notify = notify
    return true
  }

  const projectRoot = getWorkspacePath(projectId)
  const { watchRoot, scopedTo } = resolveWatchRoot(projectRoot)
  if (!fs.existsSync(watchRoot)) return false

  const resolvedWatchRoot = path.resolve(watchRoot)

  const isInsideScope = (candidate) => {
    if (!scopedTo) return true
    const relative = path.relative(scopedTo, candidate)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }

  let watcher
  try {
    watcher = chokidar.watch(watchRoot, {
      ignoreInitial: true,
      persistent: true,
      followSymlinks: false,
      ignored: (target) => {
        // NEVER ignore the watched root itself — chokidar calls `ignored` for it
        // and returning true would silently watch nothing at all.
        if (path.resolve(target) === resolvedWatchRoot) return false
        return !isInsideScope(target) || shouldIgnore(watchRoot, target)
      },
    })
  } catch (error) {
    console.warn(`[watcher] could not watch ${projectId}: ${error?.message ?? error}`)
    return false
  }

  watchers.set(projectId, { watcher, refs: 1, timer: null, notify })

  // Structural + content events all funnel into one debounced refresh. The
  // ignore rules are re-applied here as well as passed to chokidar: a directory
  // that is created AFTER the watcher starts (npm install creating node_modules)
  // can otherwise leak events for its children, so we filter every event by the
  // same rules before it can schedule a refresh.
  const isRelevant = (target) =>
    typeof target === 'string' &&
    isInsideScope(target) &&
    !shouldIgnore(watchRoot, target)

  for (const event of ['add', 'addDir', 'unlink', 'unlinkDir', 'change']) {
    watcher.on(event, (target) => {
      if (!isRelevant(target)) return
      scheduleNotify(projectId)
    })
  }
  watcher.on('error', (error) => {
    console.warn(`[watcher] ${projectId}: ${error?.message ?? error}`)
  })

  return true
}

/** Releases one reference; closes the watcher when the last one is gone. */
export function stopWatchingProject(projectId) {
  const entry = watchers.get(projectId)
  if (!entry) return false
  entry.refs -= 1
  if (entry.refs > 0) return true

  watchers.delete(projectId)
  if (entry.timer) clearTimeout(entry.timer)
  Promise.resolve(entry.watcher.close()).catch(() => {})
  return true
}

export function getWatchedProjectIds() {
  return [...watchers.keys()]
}

export async function closeAllWatchers() {
  const entries = [...watchers.values()]
  watchers.clear()
  await Promise.all(
    entries.map(async (entry) => {
      if (entry.timer) clearTimeout(entry.timer)
      try {
        await entry.watcher.close()
      } catch {}
    }),
  )
}
