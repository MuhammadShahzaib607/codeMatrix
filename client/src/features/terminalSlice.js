import { createSlice } from '@reduxjs/toolkit'

export const TERMINAL_MIN_HEIGHT = 100
export const TERMINAL_MAX_HEIGHT_RATIO = 0.7
export const TERMINAL_DEFAULT_HEIGHT = 260
export const TERMINAL_COLLAPSED_HEIGHT = 36

const initialState = {
  terminals: [],
  activeTerminalId: null,
  isTerminalPanelOpen: false,
  isMinimized: false,
  panelHeight: TERMINAL_DEFAULT_HEIGHT,
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
