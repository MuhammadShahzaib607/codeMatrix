import { createSlice } from '@reduxjs/toolkit'

/**
 * UI state for the docked terminal panel. One xterm.js instance (and one
 * server-side pty process) exists per entry in `terminals`.
 */

export const TERMINAL_MIN_HEIGHT = 100
export const TERMINAL_MAX_HEIGHT_RATIO = 0.7
export const TERMINAL_DEFAULT_HEIGHT = 260
// Height of the panel when minimized: just the tab bar.
export const TERMINAL_COLLAPSED_HEIGHT = 36

const initialState = {
  terminals: [], // [{ id, title }]
  activeTerminalId: null,
  isTerminalPanelOpen: false,
  isMinimized: false,
  panelHeight: TERMINAL_DEFAULT_HEIGHT,
  // Remembered so the minimize button can restore the previous height.
  lastExpandedHeight: TERMINAL_DEFAULT_HEIGHT,
}

const terminalSlice = createSlice({
  name: 'terminal',
  initialState,
  reducers: {
    addTerminal(state, action) {
      state.terminals.push(action.payload)
      state.activeTerminalId = action.payload.id
    },

    removeTerminal(state, action) {
      const terminalId = action.payload
      const index = state.terminals.findIndex((terminal) => terminal.id === terminalId)
      if (index === -1) return
      state.terminals.splice(index, 1)
      if (state.activeTerminalId === terminalId) {
        state.activeTerminalId =
          state.terminals[index]?.id ?? state.terminals[index - 1]?.id ?? null
      }
    },

    setActiveTerminal(state, action) {
      state.activeTerminalId = action.payload
    },

    togglePanel(state) {
      state.isTerminalPanelOpen = !state.isTerminalPanelOpen
    },

    setTerminalPanelOpen(state, action) {
      state.isTerminalPanelOpen = Boolean(action.payload)
    },

    // Clamped here as well as in the drag handler so no caller can break layout.
    setPanelHeight(state, action) {
      const next = Math.max(TERMINAL_MIN_HEIGHT, Math.round(Number(action.payload) || 0))
      state.panelHeight = next
      if (!state.isMinimized) state.lastExpandedHeight = next
    },

    toggleMinimize(state) {
      if (state.isMinimized) {
        state.isMinimized = false
        state.panelHeight = state.lastExpandedHeight
      } else {
        state.lastExpandedHeight = state.panelHeight
        state.isMinimized = true
      }
    },

    // Called when the cloud project changes or is cleared.
    resetTerminals(state) {
      state.terminals = []
      state.activeTerminalId = null
      state.isMinimized = false
    },
  },
})

export const {
  addTerminal,
  removeTerminal,
  setActiveTerminal,
  togglePanel,
  setTerminalPanelOpen,
  setPanelHeight,
  toggleMinimize,
  resetTerminals,
} = terminalSlice.actions

export default terminalSlice.reducer
