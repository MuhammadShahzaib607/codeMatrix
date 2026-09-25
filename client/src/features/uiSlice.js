import { createSlice, nanoid } from '@reduxjs/toolkit'

const initialState = {
  isSidebarOpen: true,
  isAIPanelOpen: true,
  toast: null, // { id, message, type: 'success' | 'error' | 'info' }
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
  },
})

export const { toggleSidebar, toggleAIPanel, showToast, hideToast } = uiSlice.actions

export default uiSlice.reducer
