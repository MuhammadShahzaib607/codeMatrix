import { createSlice } from '@reduxjs/toolkit'
import { remapId } from '../utils/cloudTree'
import { remapPaths, setCloudWorkspace } from './fileSystemSlice'

const initialState = {
  contentByFileId: {},
  unsavedFileIds: [],
}

const editorSlice = createSlice({
  name: 'editor',
  initialState,
  reducers: {
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

    removeContent(state, action) {
      for (const fileId of action.payload ?? []) {
        delete state.contentByFileId[fileId]
        state.unsavedFileIds = state.unsavedFileIds.filter((id) => id !== fileId)
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(setCloudWorkspace, (state) => {
        state.contentByFileId = {}
        state.unsavedFileIds = []
      })
      .addCase(remapPaths, (state, action) => {
        const { oldPath, newPath } = action.payload
        const next = {}
        for (const [fileId, content] of Object.entries(state.contentByFileId)) {
          next[remapId(oldPath, newPath, fileId)] = content
        }
        state.contentByFileId = next
        state.unsavedFileIds = state.unsavedFileIds.map((id) => remapId(oldPath, newPath, id))
      })
  },
})

export const { setContent, updateContent, markSaved, removeContent } = editorSlice.actions

export default editorSlice.reducer
