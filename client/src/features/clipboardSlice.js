import { createSlice } from '@reduxjs/toolkit'

/**
 * Explorer Cut/Copy clipboard. Holds a reference only — never file content —
 * so a move is just a rename on the server and a copy is a server-side
 * duplicate.
 *
 *   { path: 'src/index.js', type: 'file' | 'folder', mode: 'cut' | 'copy' }
 */
const initialState = {
  path: null,
  type: null,
  mode: null,
}

const clipboardSlice = createSlice({
  name: 'clipboard',
  initialState,
  reducers: {
    setClipboard(state, action) {
      const { path, type, mode } = action.payload ?? {}
      state.path = path ?? null
      state.type = type ?? null
      state.mode = mode ?? null
    },

    clearClipboard(state) {
      state.path = null
      state.type = null
      state.mode = null
    },
  },
})

export const { setClipboard, clearClipboard } = clipboardSlice.actions

export default clipboardSlice.reducer
