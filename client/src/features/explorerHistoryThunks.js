import { createAsyncThunk } from '@reduxjs/toolkit'
import { workspaceApi } from '../services/api'
import { showToast } from './uiSlice'
import { recordExplorerAction, shiftRedoToUndo, shiftUndoToRedo } from './explorerHistorySlice'
import {
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  duplicateWorkspaceEntry,
  refreshWorkspaceTree,
  renameWorkspaceEntry,
} from './workspaceThunks'

/**
 * Snapshot cap. Capturing undo content costs ONE HTTP round-trip per file, and
 * it runs BEFORE the DELETE request. When it was unbounded and sequential, a
 * folder containing node_modules (thousands of files) fired thousands of
 * requests one after another — that alone was the 10-15s delete: the delete did
 * not even start until the last snapshot read returned. Above this many files
 * the delete proceeds WITHOUT a restorable snapshot (undo then says so instead
 * of silently doing nothing).
 */
const SNAPSHOT_MAX_FILES = 200

// Files are fetched this-many at a time instead of one-by-one, so a snapshot of
// a moderately sized folder costs a handful of round trips, not hundreds.
const SNAPSHOT_CONCURRENCY = 12

/** Runs `worker(item, index)` over items with at most `limit` in flight. */
async function mapWithConcurrency(items, limit, worker) {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      await worker(items[index], index)
    }
  })
  await Promise.all(runners)
}

/**
 * Captures everything needed to recreate a deleted file/folder: every folder
 * path in the subtree and every file's content. The workspace is text-only, so
 * a plain string per file is a lossless snapshot.
 *
 * Returns null when the subtree holds more than SNAPSHOT_MAX_FILES files — the
 * caller still deletes, it just records the undo entry without a snapshot.
 */
async function captureSnapshot(projectId, node) {
  const folders = []
  const files = []

  function walk(current) {
    if (current.type === 'folder') {
      folders.push(current.id)
      for (const child of current.children ?? []) walk(child)
    } else {
      files.push(current.id)
    }
  }
  walk(node)

  if (files.length > SNAPSHOT_MAX_FILES) return null

  const capturedFiles = new Array(files.length)
  await mapWithConcurrency(files, SNAPSHOT_CONCURRENCY, async (filePath, index) => {
    let content = ''
    try {
      const data = await workspaceApi.getFile(projectId, filePath)
      content = data?.content ?? ''
    } catch {
      // A file we cannot read is restored empty rather than failing the undo.
    }
    capturedFiles[index] = { path: filePath, content }
  })

  return { rootPath: node.id, type: node.type, folders, files: capturedFiles }
}

/** Re-creates a deleted subtree: folders shallow-first, then every file. */
async function restoreSnapshot(projectId, snapshot) {
  if (!snapshot) return
  const folders = [...(snapshot.folders ?? [])].sort(
    (a, b) => a.split('/').length - b.split('/').length,
  )
  for (const folderPath of folders) {
    try {
      await workspaceApi.createEntry(projectId, folderPath, 'folder')
    } catch (error) {
      // 409 = the folder already exists (a parent was recreated first). Harmless.
      if (error?.status !== 409) throw error
    }
  }
  for (const file of snapshot.files ?? []) {
    await workspaceApi.saveFile(projectId, file.path, file.content ?? '')
  }
}

/**
 * Delete an Explorer entry, recording a restorable snapshot on the undo stack
 * first. Used by both the hover trash button and the context menu.
 */
export const deleteExplorerEntry = createAsyncThunk(
  'explorerHistory/delete',
  async ({ projectId, node }, { dispatch }) => {
    // Snapshot first (bounded — see SNAPSHOT_MAX_FILES), then delete. The delete
    // thunk itself updates the Explorer optimistically, so the row disappears
    // the moment the DELETE API responds.
    const snapshot = await captureSnapshot(projectId, node)
    await dispatch(deleteWorkspaceEntry({ projectId, path: node.id })).unwrap()
    dispatch(
      recordExplorerAction({
        kind: 'delete',
        path: node.id,
        type: node.type,
        name: node.name,
        snapshot,
      }),
    )
    return { path: node.id }
  },
)

/** Runs a recorded operation BACKWARDS (Ctrl+Z). */
const revertExplorerEntry = createAsyncThunk(
  'explorerHistory/revert',
  async ({ projectId, entry }, { dispatch }) => {
    switch (entry.kind) {
      case 'create':
        await dispatch(deleteWorkspaceEntry({ projectId, path: entry.path })).unwrap()
        break
      case 'delete':
        if (!entry.snapshot) {
          // The subtree was larger than SNAPSHOT_MAX_FILES, so nothing was kept
          // to restore. Tell the user instead of pretending undo worked.
          dispatch(
            showToast({
              message: `Nothing restored — “${entry.name}” was too large to keep an undo copy.`,
              type: 'info',
            }),
          )
          break
        }
        await restoreSnapshot(projectId, entry.snapshot)
        // restoreSnapshot writes files with raw API calls (no thunk), so it is
        // the one branch that must refresh the tree itself. Every other branch
        // below goes through a workspace thunk that already refetches.
        await dispatch(refreshWorkspaceTree({ projectId })).unwrap()
        break
      case 'rename':
      case 'move':
        await dispatch(
          renameWorkspaceEntry({
            projectId,
            oldPath: entry.newPath,
            newPath: entry.oldPath,
          }),
        ).unwrap()
        break
      case 'duplicate':
        await dispatch(deleteWorkspaceEntry({ projectId, path: entry.newPath })).unwrap()
        break
      default:
        break
    }
    return entry
  },
)

/** Runs a recorded operation FORWARDS again (Ctrl+Y). */
const applyExplorerEntry = createAsyncThunk(
  'explorerHistory/apply',
  async ({ projectId, entry }, { dispatch }) => {
    switch (entry.kind) {
      case 'create':
        await dispatch(
          createWorkspaceEntry({ projectId, path: entry.path, type: entry.type }),
        ).unwrap()
        break
      case 'delete':
        await dispatch(deleteWorkspaceEntry({ projectId, path: entry.path })).unwrap()
        break
      case 'rename':
      case 'move':
        await dispatch(
          renameWorkspaceEntry({
            projectId,
            oldPath: entry.oldPath,
            newPath: entry.newPath,
          }),
        ).unwrap()
        break
      case 'duplicate':
        await dispatch(
          duplicateWorkspaceEntry({
            projectId,
            sourcePath: entry.sourcePath,
            targetFolderPath: entry.targetFolderPath,
          }),
        ).unwrap()
        break
      default:
        break
    }
    return entry
  },
)

/** Undo the most recent Explorer operation. Returns the entry, or null if none. */
export const undoLastExplorerAction = createAsyncThunk(
  'explorerHistory/undo',
  async (_, { dispatch, getState }) => {
    const { explorerHistory, fileSystem } = getState()
    const entry = explorerHistory.undoStack[explorerHistory.undoStack.length - 1]
    const projectId = fileSystem.workspace.projectId
    if (!entry || !projectId) return null

    // revertExplorerEntry refreshes the tree itself (its thunks do, and the
    // snapshot branch refreshes explicitly), so there is no second fetch here.
    await dispatch(revertExplorerEntry({ projectId, entry })).unwrap()
    dispatch(shiftUndoToRedo())
    return entry
  },
)

/** Redo the most recently undone Explorer operation. */
export const redoLastExplorerAction = createAsyncThunk(
  'explorerHistory/redo',
  async (_, { dispatch, getState }) => {
    const { explorerHistory, fileSystem } = getState()
    const entry = explorerHistory.redoStack[explorerHistory.redoStack.length - 1]
    const projectId = fileSystem.workspace.projectId
    if (!entry || !projectId) return null

    // applyExplorerEntry runs through workspace thunks that each refresh the
    // tree, so redo needs no extra fetch of its own.
    await dispatch(applyExplorerEntry({ projectId, entry })).unwrap()
    dispatch(shiftRedoToUndo())
    return entry
  },
)
