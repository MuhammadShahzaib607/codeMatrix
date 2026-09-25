import { createSlice, nanoid } from '@reduxjs/toolkit'

const initialState = {
  isSidebarOpen: true,
  isAIPanelOpen: true,
  toast: null, // { id, message, type: 'success' | 'error' | 'info' }
  // In-memory only: the temporary-storage warning comes back on every reload,
  // i.e. once per session, even after the user dismisses it.
  isStorageNoticeDismissed: false,
}

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    toggleSidebar(state) {
      state.isSidebarOpen = !state.isSidebarOpen
    },
    toggleAIPanel(state) {
      state.isAIPanelOpen = !state.isAIPanelOpen
    },
    showToast: {
      reducer(state, action) {
        state.toast = action.payload
      },
      prepare({ message, type = 'info' }) {
        return { payload: { id: nanoid(), message, type } }
      },
    },
    hideToast(state) {
      state.toast = null
    },
    dismissStorageNotice(state) {
      state.isStorageNoticeDismissed = true
    },
  },
})

export const {
  toggleSidebar,
  toggleAIPanel,
  showToast,
  hideToast,
  dismissStorageNotice,
} = uiSlice.actions

export default uiSlice.reducer
