import { createSlice } from '@reduxjs/toolkit'

/** How many Explorer operations are remembered for undo. */
export const EXPLORER_HISTORY_LIMIT = 20

/**
 * Undo/redo history for STRUCTURAL Explorer operations only — create, delete,
 * rename, move (cut+paste) and duplicate (copy+paste). Monaco keeps its own
 * per-file text undo, so this never touches text edits.
 *
 * Each entry records just enough to run the operation backwards:
 *   { kind: 'create',    path, type }
 *   { kind: 'delete',    path, type, name, snapshot }   // snapshot = deleted content
 *   { kind: 'rename',    oldPath, newPath }
 *   { kind: 'move',      oldPath, newPath }
 *   { kind: 'duplicate', sourcePath, targetFolderPath, newPath }
 *
 * The actual reversing (calling the backend) lives in explorerHistoryThunks.js;
 * this slice is pure, serializable bookkeeping.
 */
const initialState = {
  undoStack: [],
  redoStack: [],
}

const explorerHistorySlice = createSlice({
  name: 'explorerHistory',
  initialState,
  reducers: {
    /** Push a freshly performed operation, capping the stack and clearing redo. */
    recordExplorerAction(state, action) {
      const entry = action.payload
      if (!entry?.kind) return
      state.undoStack.push(entry)
      if (state.undoStack.length > EXPLORER_HISTORY_LIMIT) state.undoStack.shift()
      // Any new action invalidates the redo branch.
      state.redoStack = []
    },

    /** Move the top undo entry onto the redo stack (called after a successful undo). */
    shiftUndoToRedo(state) {
      const entry = state.undoStack.pop()
      if (entry) state.redoStack.push(entry)
    },

    /** Move the top redo entry back onto the undo stack (after a successful redo). */
    shiftRedoToUndo(state) {
      const entry = state.redoStack.pop()
      if (entry) state.undoStack.push(entry)
    },

    clearExplorerHistory(state) {
      state.undoStack = []
      state.redoStack = []
    },
  },
})

export const {
  recordExplorerAction,
  shiftUndoToRedo,
  shiftRedoToUndo,
  clearExplorerHistory,
} = explorerHistorySlice.actions

export default explorerHistorySlice.reducer
