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

// Live preview reloads are debounced separately and much more tightly than the
// tree refresh: a save should show up in the open preview tab within ~a second,
// and a burst of writes must collapse into one reload (not a reload storm).
// Crucially, this timer is NOT gated by suppressWatcher — a save made through
// our own API is exactly the change a preview must reflect, even though the
// Explorer already refreshed itself and does not need a treeChanged event.
const PREVIEW_DEBOUNCE_MS = 350

// A UI-driven mutation (delete/copy/paste/create/save) makes the client refresh
// the tree itself. The fs events that mutation produces must NOT schedule a
// second, redundant full-tree walk. The controller marks a suppression window
// around its own operation (see suppressWatcher); any debounced notify that
// fires inside the window is dropped.
const SUPPRESS_MS = 1600

// Hard cap on how deep chokidar descends. Nothing in this app cares about a
// change 12 levels down, and an unbounded walk of a deep dependency tree is a
// real cost on every attach.
const MAX_WATCH_DEPTH = 12

// We watch for the TOP-LEVEL appearance/disappearance of these directories but
// never descend into them: node_modules alone can hold tens of thousands of
// files, and watching all of them would swamp the process for no benefit.
// dist/build/.next/out/.cache are the same class of regenerable, file-heavy
// build output.
//
// IMPORTANT: this only limits how deep the WATCHER reports changes — it must
// never be read as a tree filter. The Explorer tree itself comes from
// workspaceManager.getWorkspaceTree, which has NO exclusions and shows every
// folder that exists on disk, node_modules, .git and dist included. Creating an
// excluded folder still fires addDir here, so the tree still refreshes.
const NEVER_DESCEND_INTO = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.cache',
])

// projectId -> { watcher, refs, timer, eventCount, suppressUntil, notify,
//                previewTimer, previewNotify }
const watchers = new Map()

/**
 * Drops watcher notifications caused by the SERVER'S OWN API mutation for a
 * short window, so a delete/copy/paste/create/save yields exactly ONE tree
 * refresh (the client's direct post-action fetch). External changes (terminal,
 * git, npm install) never call this, so they still notify normally.
 */
export function suppressWatcher(projectId, ms = SUPPRESS_MS) {
  const entry = watchers.get(projectId)
  if (!entry) return
  entry.suppressUntil = Math.max(entry.suppressUntil ?? 0, Date.now() + ms)
}

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

function schedulePreviewReload(projectId) {
  const entry = watchers.get(projectId)
  if (!entry || typeof entry.previewNotify !== 'function') return
  if (entry.previewTimer) clearTimeout(entry.previewTimer)
  entry.previewTimer = setTimeout(() => {
    entry.previewTimer = null
    try {
      entry.previewNotify(projectId)
    } catch (error) {
      console.warn(`[watcher] preview reload ${projectId} failed: ${error?.message ?? error}`)
    }
  }, PREVIEW_DEBOUNCE_MS)
}

function scheduleNotify(projectId) {
  const entry = watchers.get(projectId)
  if (!entry) return
  entry.eventCount += 1
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => {
    entry.timer = null
    const coalesced = entry.eventCount
    entry.eventCount = 0
    // Self-induced change: the client already refreshed directly, so do not
    // trigger a second full-tree walk.
    if (entry.suppressUntil && Date.now() < entry.suppressUntil) {
      console.log(`[watcher] ${projectId}: ${coalesced} fs event(s) suppressed (own API change)`)
      return
    }
    const startedAt = Date.now()
    try {
      entry.notify(projectId)
      // TEMP DIAGNOSTIC (safe to remove): proves a bulk operation collapses to a
      // single auto-refresh. A 50-file paste should read "~50 fs event(s) -> 1".
      console.log(
        `[watcher] ${projectId}: ${coalesced} fs event(s) -> 1 treeChanged ` +
          `(${Date.now() - startedAt}ms)`,
      )
    } catch (error) {
      console.warn(`[watcher] notify ${projectId} failed: ${error?.message ?? error}`)
    }
  }, DEBOUNCE_MS)
}

/**
 * Starts (or joins) the watcher for a project. Returns false when the project id
 * is invalid or its folder does not exist (e.g. the workspace was wiped).
 */
export function startWatchingProject(projectId, notify, previewNotify) {
  if (!isValidProjectId(projectId)) return false

  const existing = watchers.get(projectId)
  if (existing) {
    existing.refs += 1
    if (typeof notify === 'function') existing.notify = notify
    if (typeof previewNotify === 'function') existing.previewNotify = previewNotify
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
      depth: MAX_WATCH_DEPTH,
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

  watchers.set(projectId, {
    watcher,
    refs: 1,
    timer: null,
    eventCount: 0,
    suppressUntil: 0,
    notify,
    previewTimer: null,
    previewNotify: typeof previewNotify === 'function' ? previewNotify : null,
  })

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
      // Independent of the tree refresh: any real change reloads the preview.
      schedulePreviewReload(projectId)
    })
  }
  watcher.on('error', (error) => {
    console.warn(`[watcher] ${projectId}: ${error?.message ?? error}`)
  })

  return true
}

/**
 * Re-points an EXISTING watcher at the project's current folder path.
 *
 * The workspace folder can be renamed while a watcher is attached — that is
 * exactly what the agent does when it adopts a scratch workspace (Scratch ->
 * todo-app) or honours the model's PROJECT_NAME suggestion mid-run. From that
 * moment chokidar is watching a path that no longer exists, so every later
 * write is invisible: the Explorer silently stops auto-refreshing and the live
 * preview stops reloading for the rest of the run.
 *
 * Called by every rename. Keeps the reference count and both notifiers exactly
 * as they were — only the underlying watch moves to the new path.
 */
export function restartWatching(projectId) {
  const entry = watchers.get(projectId)
  if (!entry) return false

  const { refs, notify, previewNotify, suppressUntil } = entry
  watchers.delete(projectId)
  if (entry.timer) clearTimeout(entry.timer)
  if (entry.previewTimer) clearTimeout(entry.previewTimer)
  Promise.resolve(entry.watcher.close()).catch(() => {})

  const started = startWatchingProject(projectId, notify, previewNotify)
  const next = watchers.get(projectId)
  if (started && next) {
    next.refs = refs
    next.suppressUntil = suppressUntil ?? 0
  }
  return started
}

/** Releases one reference; closes the watcher when the last one is gone. */
export function stopWatchingProject(projectId) {
  const entry = watchers.get(projectId)
  if (!entry) return false
  entry.refs -= 1
  if (entry.refs > 0) return true

  watchers.delete(projectId)
  if (entry.timer) clearTimeout(entry.timer)
  if (entry.previewTimer) clearTimeout(entry.previewTimer)
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
      if (entry.previewTimer) clearTimeout(entry.previewTimer)
      try {
        await entry.watcher.close()
      } catch {}
    }),
  )
}
