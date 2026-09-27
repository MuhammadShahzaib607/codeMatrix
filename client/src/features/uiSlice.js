import { createSlice, nanoid } from '@reduxjs/toolkit'

export const SIDEBAR_DEFAULT_WIDTH = 250
export const SIDEBAR_MIN_WIDTH = 180
export const SIDEBAR_MAX_WIDTH = 500

// The right-hand AI panel resizes by dragging its LEFT edge (same pattern as
// the sidebar, mirrored), clamped 280–600px and persisted to localStorage.
export const AI_PANEL_DEFAULT_WIDTH = 360
export const AI_PANEL_MIN_WIDTH = 280
export const AI_PANEL_MAX_WIDTH = 600

const SIDEBAR_WIDTH_KEY = 'code-matrix:sidebarWidth'
const AI_PANEL_WIDTH_KEY = 'code-matrix:aiPanelWidth'

function readStoredSidebarWidth() {
  try {
    const value = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
    if (value >= SIDEBAR_MIN_WIDTH && value <= SIDEBAR_MAX_WIDTH) return value
  } catch {}
  return SIDEBAR_DEFAULT_WIDTH
}

function readStoredAiPanelWidth() {
  try {
    const value = Number(localStorage.getItem(AI_PANEL_WIDTH_KEY))
    if (value >= AI_PANEL_MIN_WIDTH && value <= AI_PANEL_MAX_WIDTH) return value
  } catch {}
  return AI_PANEL_DEFAULT_WIDTH
}

const initialState = {
  isSidebarOpen: true,
  isAIPanelOpen: true,
  toast: null,
  isStorageNoticeDismissed: false,
  activeSidebarView: 'explorer',
  sidebarWidth: readStoredSidebarWidth(),
  aiPanelWidth: readStoredAiPanelWidth(),
  revealedNode: null,
  revealLine: null,
  authModal: { isOpen: false, mode: 'signin', message: null },
  // Opened from the Explorer root context menu or Settings > General. The
  // Sidebar owns the modal + the actual deletion so both entry points share one
  // code path.
  isDeleteProjectModalOpen: false,
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

    /**
     * Re-shows the temporary-storage warning. The dismissal is intentionally
     * NOT persisted to localStorage, and this is dispatched on every auth change
     * (sign in / sign out), so the banner returns each session instead of being
     * silenced forever after one click.
     */
    resetStorageNotice(state) {
      state.isStorageNoticeDismissed = false
    },

    setActiveSidebarView(state, action) {
      state.activeSidebarView = action.payload
      state.isSidebarOpen = true
    },

    setSidebarWidth(state, action) {
      const value = Math.round(Number(action.payload) || 0)
      state.sidebarWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value))
    },

    setAiPanelWidth(state, action) {
      const value = Math.round(Number(action.payload) || 0)
      state.aiPanelWidth = Math.min(AI_PANEL_MAX_WIDTH, Math.max(AI_PANEL_MIN_WIDTH, value))
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

    openDeleteProjectModal(state) {
      state.isDeleteProjectModalOpen = true
    },

    closeDeleteProjectModal(state) {
      state.isDeleteProjectModalOpen = false
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
  resetStorageNotice,
  setActiveSidebarView,
  setSidebarWidth,
  setAiPanelWidth,
  revealTreeNode,
  revealLineInEditor,
  openAuthModal,
  closeAuthModal,
  setAuthModalMode,
  openDeleteProjectModal,
  closeDeleteProjectModal,
} = uiSlice.actions

export { SIDEBAR_WIDTH_KEY, AI_PANEL_WIDTH_KEY }
export default uiSlice.reducer
