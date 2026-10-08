import { createSlice } from '@reduxjs/toolkit'

/**
 * The right sidebar shows either the AI agent or ONE terminal. That terminal is
 * deliberately kept in its own slice, separate from the docked/floating
 * terminal panel's `terminal` slice: the two are independent pty sessions, so
 * they can never attach to the same terminalId and duplicate input/output.
 *
 * `terminalId` is null until the terminal is first shown (the pty is created
 * lazily). Once it exists the view stays mounted even while the agent tab is
 * selected, so switching tabs never kills the running shell. `restart` mints a
 * new id, which is how the shell selector and the "new terminal" button reuse
 * the same session slot.
 */
const initialState = {
  terminalId: null,
  shell: null,
}

const sidebarTerminalSlice = createSlice({
  name: 'sidebarTerminal',
  initialState,
  reducers: {
    /** Creates the terminal only if there is not one yet. */
    openSidebarTerminal: {
      reducer(state, action) {
        if (state.terminalId) return
        state.terminalId = action.payload.terminalId
        if (action.payload.shell) state.shell = action.payload.shell
      },
      prepare({ shell = null } = {}) {
        return { payload: { terminalId: crypto.randomUUID(), shell } }
      },
    },

    /** Replaces the terminal with a fresh one (shell change / restart). */
    restartSidebarTerminal: {
      reducer(state, action) {
        state.terminalId = action.payload.terminalId
        if (action.payload.shell) state.shell = action.payload.shell
      },
      prepare({ shell = null } = {}) {
        return { payload: { terminalId: crypto.randomUUID(), shell } }
      },
    },

    setSidebarTerminalShell(state, action) {
      if (action.payload) state.shell = action.payload
    },

    resetSidebarTerminal(state) {
      state.terminalId = null
      state.shell = null
    },
  },
})

export const {
  openSidebarTerminal,
  restartSidebarTerminal,
  setSidebarTerminalShell,
  resetSidebarTerminal,
} = sidebarTerminalSlice.actions

export default sidebarTerminalSlice.reducer
