import { createAsyncThunk } from '@reduxjs/toolkit'
import { workspaceApi } from '../services/api'
import { recordExplorerAction, shiftRedoToUndo, shiftUndoToRedo } from './explorerHistorySlice'
import {
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  duplicateWorkspaceEntry,
  refreshWorkspaceTree,
  renameWorkspaceEntry,
} from './workspaceThunks'

/**
 * Captures everything needed to recreate a deleted file/folder: every folder
 * path in the subtree and every file's content. The workspace is text-only, so
 * a plain string per file is a lossless snapshot.
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

  const capturedFiles = []
  for (const filePath of files) {
    let content = ''
    try {
      const data = await workspaceApi.getFile(projectId, filePath)
      content = data?.content ?? ''
    } catch {
      // A file we cannot read is restored empty rather than failing the undo.
    }
    capturedFiles.push({ path: filePath, content })
  }

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
