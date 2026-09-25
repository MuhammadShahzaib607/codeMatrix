import { createSlice, nanoid } from '@reduxjs/toolkit'

export const SIDEBAR_DEFAULT_WIDTH = 250
export const SIDEBAR_MIN_WIDTH = 180
export const SIDEBAR_MAX_WIDTH = 500

const SIDEBAR_WIDTH_KEY = 'code-matrix:sidebarWidth'

function readStoredSidebarWidth() {
  try {
    const value = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
    if (value >= SIDEBAR_MIN_WIDTH && value <= SIDEBAR_MAX_WIDTH) return value
  } catch {}
  return SIDEBAR_DEFAULT_WIDTH
}

const initialState = {
  isSidebarOpen: true,
  isAIPanelOpen: true,
  toast: null,
  isStorageNoticeDismissed: false,
  activeSidebarView: 'explorer',
  sidebarWidth: readStoredSidebarWidth(),
  revealedNode: null,
  revealLine: null,
  authModal: { isOpen: false, mode: 'signin', message: null },
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

    setActiveSidebarView(state, action) {
      state.activeSidebarView = action.payload
      state.isSidebarOpen = true
    },

    setSidebarWidth(state, action) {
      const value = Math.round(Number(action.payload) || 0)
      state.sidebarWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value))
    },

    revealTreeNode: {
      reducer(state, action) {
        state.revealedNode = action.payload
      },
      prepare(id) {
        return { payload: { id, nonce: nanoid() } }
      },
    },

    revealLineInEditor: {
      reducer(state, action) {
        state.revealLine = action.payload
      },
      prepare({ fileId, line }) {
        return { payload: { fileId, line, nonce: nanoid() } }
      },
    },

    openAuthModal(state, action) {
      const { mode = 'signin', message = null } = action.payload ?? {}
      state.authModal = { isOpen: true, mode, message }
    },

    closeAuthModal(state) {
      state.authModal = { isOpen: false, mode: 'signin', message: null }
    },

    setAuthModalMode(state, action) {
      state.authModal = { ...state.authModal, mode: action.payload, message: null }
    },
  },
})

export const {
  toggleSidebar,
  toggleAIPanel,
  showToast,
  hideToast,
  dismissStorageNotice,
  setActiveSidebarView,
  setSidebarWidth,
  revealTreeNode,
  revealLineInEditor,
  openAuthModal,
  closeAuthModal,
  setAuthModalMode,
} = uiSlice.actions

export { SIDEBAR_WIDTH_KEY }
export default uiSlice.reducer
