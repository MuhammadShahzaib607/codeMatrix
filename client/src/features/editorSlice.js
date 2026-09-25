import { createSlice } from '@reduxjs/toolkit'
import { dummyFileTree } from '../data/dummyFileTree'
import { remapId } from '../utils/cloudTree'
import { buildContentMap } from '../utils/tree'
import {
  addNode,
  deleteNode,
  remapPaths,
  replaceSubtree,
  setCloudWorkspace,
} from './fileSystemSlice'

/**
 * contentByFileId is the editor buffer for each open file. For a cloud
 * workspace the key is the file's relative path (which is also its tree id).
 * A file present here is considered loaded; otherwise the editor fetches it.
 *
 * Cloud buffers are only pruned when a file disappears. A plain tree refresh
 * keeps buffers, so an unsaved edit survives a background reload — the thunk
 * dispatches removeContent() for the files that actually vanished.
 */
const initialState = {
  contentByFileId: buildContentMap(dummyFileTree),
  unsavedFileIds: [],
}

const editorSlice = createSlice({
  name: 'editor',
  initialState,
  reducers: {
    // Content read from the server — not an edit, so it stays out of unsavedFileIds.
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

    // Drops buffers for files that no longer exist on the server.
    removeContent(state, action) {
      for (const fileId of action.payload ?? []) {
        delete state.contentByFileId[fileId]
        state.unsavedFileIds = state.unsavedFileIds.filter((id) => id !== fileId)
      }
    },
  },
  extraReducers: (builder) => {
    builder
      // A newly created demo file starts out empty.
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
      // A fresh import invalidates every previous buffer.
      .addCase(setCloudWorkspace, (state) => {
        state.contentByFileId = {}
        state.unsavedFileIds = []
      })
      // Renaming/moving a file or folder moves its buffer with it.
      .addCase(remapPaths, (state, action) => {
        const { oldPath, newPath } = action.payload
        const next = {}
        for (const [fileId, content] of Object.entries(state.contentByFileId)) {
          next[remapId(oldPath, newPath, fileId)] = content
        }
        state.contentByFileId = next
        state.unsavedFileIds = state.unsavedFileIds.map((id) =>
          remapId(oldPath, newPath, id),
        )
      })
  },
})

export const { setContent, updateContent, markSaved, removeContent } = editorSlice.actions

export default editorSlice.reducer
