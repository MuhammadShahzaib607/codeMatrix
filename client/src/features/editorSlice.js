import { createSlice } from '@reduxjs/toolkit'
import { remapId } from '../utils/cloudTree'
import { remapPaths, setCloudWorkspace } from './fileSystemSlice'

const initialState = {
  contentByFileId: {},
  unsavedFileIds: [],
  // Files the agent (or the terminal) changed on disk while the buffer had
  // unsaved user edits: the buffer is kept and the tab shows a marker instead of
  // silently discarding what the user typed.
  changedOnDiskFileIds: [],
  // Files with an in-flight write (manual Ctrl+S or the auto-save debounce).
  // Drives the small spinner on the tab and is cleared by markSaved / a failed
  // save, never persisted.
  savingFileIds: [],
}

const editorSlice = createSlice({
  name: 'editor',
  initialState,
  reducers: {
    setContent(state, action) {
      const { fileId, content } = action.payload
      state.contentByFileId[fileId] = content
      state.changedOnDiskFileIds = state.changedOnDiskFileIds.filter((id) => id !== fileId)
    },

    markChangedOnDisk(state, action) {
      if (!state.changedOnDiskFileIds.includes(action.payload)) {
        state.changedOnDiskFileIds.push(action.payload)
      }
    },

    updateContent(state, action) {
      const { fileId, content } = action.payload
      state.contentByFileId[fileId] = content
      if (!state.unsavedFileIds.includes(fileId)) state.unsavedFileIds.push(fileId)
    },

    /** Marks a file as having a write in flight (shows the tab spinner). */
    markSaving(state, action) {
      if (!state.savingFileIds.includes(action.payload)) state.savingFileIds.push(action.payload)
    },

    /** Clears the in-flight flag without touching the unsaved flag (save failed). */
    clearSaving(state, action) {
      state.savingFileIds = state.savingFileIds.filter((fileId) => fileId !== action.payload)
    },

    markSaved(state, action) {
      state.unsavedFileIds = state.unsavedFileIds.filter((fileId) => fileId !== action.payload)
      state.savingFileIds = state.savingFileIds.filter((fileId) => fileId !== action.payload)
      state.changedOnDiskFileIds = state.changedOnDiskFileIds.filter(
        (fileId) => fileId !== action.payload,
      )
    },

    removeContent(state, action) {
      for (const fileId of action.payload ?? []) {
        delete state.contentByFileId[fileId]
        state.unsavedFileIds = state.unsavedFileIds.filter((id) => id !== fileId)
        state.savingFileIds = state.savingFileIds.filter((id) => id !== fileId)
        state.changedOnDiskFileIds = state.changedOnDiskFileIds.filter((id) => id !== fileId)
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(setCloudWorkspace, (state) => {
        state.contentByFileId = {}
        state.unsavedFileIds = []
        state.savingFileIds = []
        state.changedOnDiskFileIds = []
      })
      .addCase(remapPaths, (state, action) => {
        const { oldPath, newPath } = action.payload
        const next = {}
        for (const [fileId, content] of Object.entries(state.contentByFileId)) {
          next[remapId(oldPath, newPath, fileId)] = content
        }
        state.contentByFileId = next
        state.unsavedFileIds = state.unsavedFileIds.map((id) => remapId(oldPath, newPath, id))
        state.savingFileIds = state.savingFileIds.map((id) => remapId(oldPath, newPath, id))
      })
  },
})

export const {
  setContent,
  updateContent,
  markChangedOnDisk,
  markSaving,
  clearSaving,
  markSaved,
  removeContent,
} = editorSlice.actions

export default editorSlice.reducer
