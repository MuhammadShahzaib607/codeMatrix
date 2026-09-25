import { createSlice } from '@reduxjs/toolkit'
import { dummyFileTree } from '../data/dummyFileTree'
import { buildContentMap } from '../utils/tree'
import { addNode, deleteNode, loadWorkspace, replaceSubtree } from './fileSystemSlice'

/**
 * contentByFileId is the editor buffer for each open file. Real files are added
 * lazily by the editor when they are first opened; a file that is present here
 * is considered loaded.
 */
const initialState = {
  contentByFileId: buildContentMap(dummyFileTree),
  unsavedFileIds: [],
}

const editorSlice = createSlice({
  name: 'editor',
  initialState,
  reducers: {
    // Content read from disk — not an edit, so it stays out of unsavedFileIds.
    setContent(state, action) {
      const { fileId, content } = action.payload
      state.contentByFileId[fileId] = content
    },

    updateContent(state, action) {
      const { fileId, content } = action.payload
      state.contentByFileId[fileId] = content
      if (!state.unsavedFileIds.includes(fileId)) state.unsavedFileIds.push(fileId)
    },

    markSaved(state, action) {
      state.unsavedFileIds = state.unsavedFileIds.filter((fileId) => fileId !== action.payload)
    },
  },
  extraReducers: (builder) => {
    builder
      // A newly created file starts out empty.
      .addCase(addNode, (state, action) => {
        const node = action.payload.node
        if (node.type === 'file') state.contentByFileId[node.id] = node.content ?? ''
      })
      // Drop the buffered content of every file inside the deleted subtree.
      .addCase(deleteNode, (state, action) => {
        for (const fileId of action.payload.removedFileIds ?? []) {
          delete state.contentByFileId[fileId]
          state.unsavedFileIds = state.unsavedFileIds.filter((id) => id !== fileId)
        }
      })
      .addCase(replaceSubtree, (state, action) => {
        for (const fileId of action.payload.removedFileIds ?? []) {
          delete state.contentByFileId[fileId]
          state.unsavedFileIds = state.unsavedFileIds.filter((id) => id !== fileId)
        }
      })
      // Opening a real folder invalidates every demo buffer.
      .addCase(loadWorkspace, (state) => {
        state.contentByFileId = {}
        state.unsavedFileIds = []
      })
  },
})

export const { setContent, updateContent, markSaved } = editorSlice.actions

export default editorSlice.reducer
