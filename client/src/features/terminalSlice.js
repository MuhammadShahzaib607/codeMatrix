import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { terminalApi } from '../services/api'

export const TERMINAL_MIN_HEIGHT = 120
export const TERMINAL_MAX_HEIGHT_RATIO = 0.75
export const TERMINAL_DEFAULT_HEIGHT = 260
export const TERMINAL_COLLAPSED_HEIGHT = 36

// A pane in a split can never be squeezed smaller than this share of the
// combined weight it shares with its neighbour, so a divider can't hide a pane.
export const TERMINAL_PANE_MIN_SHARE = 0.15

/**
 * Terminal state is a list of tab GROUPS, not a flat list of terminals.
 *
 *   groups: [
 *     { groupId, sizes: [1], panes: [{ terminalId, title, shell, seq }] }
 *   ]
 *
 * A group with one pane is a normal, full-width terminal. A group with two or
 * more panes is a side-by-side split: every pane is its own terminalId, its own
 * xterm instance and its own server-side pty, and `sizes` holds the relative
 * flex weight of each pane (used by the draggable vertical divider).
 *
 * `shell` is the REQUESTED shell id at first and is corrected with the shell
 * the server actually spawned when terminal:ready arrives (see
 * setTerminalShell), so a tab never claims to be bash while running PowerShell.
 */
const initialState = {
  groups: [],
  activeGroupId: null,
  activePaneId: null,
  isTerminalPanelOpen: false,
  isMinimized: false,
  panelHeight: TERMINAL_DEFAULT_HEIGHT,
  lastExpandedHeight: TERMINAL_DEFAULT_HEIGHT,
  // Populated from GET /api/terminal/shells — depends on the SERVER's OS.
  availableShells: [],
  defaultShell: null,
  // 'idle' -> never asked, 'loading', 'ready', 'failed' (retried when the panel
  // is (re)opened, so a server that started after page load still fills in).
  shellStatus: 'idle',
}

function findGroupOfPane(state, terminalId) {
  return (
    state.groups.find((group) =>
      group.panes.some((pane) => pane.terminalId === terminalId),
    ) ?? null
  )
}

function clampSizes(sizes) {
  return sizes.map((size) => (Number.isFinite(size) && size > 0 ? size : 1))
}

/**
 * Lowest positive integer not used by another OPEN pane of the same shell.
 * The component uses the same rule when creating a terminal; this copy exists
 * so a pane whose shell gets corrected by the server (requested -> really
 * spawned) can be renumbered instead of colliding with an existing title.
 */
function lowestFreeSeq(groups, shell, excludeTerminalId = null) {
  const used = new Set()
  for (const group of groups) {
    for (const pane of group.panes) {
      if (pane.terminalId === excludeTerminalId) continue
      if (pane.shell === shell && Number.isInteger(pane.seq)) used.add(pane.seq)
    }
  }
  let seq = 1
  while (used.has(seq)) seq += 1
  return seq
}

export const fetchAvailableShells = createAsyncThunk(
  'terminal/fetchAvailableShells',
  async () => {
    const data = await terminalApi.getShells()
    return {
      shells: Array.isArray(data?.shells) ? data.shells : [],
      default: typeof data?.default === 'string' ? data.default : null,
    }
  },
)

const terminalSlice = createSlice({
  name: 'terminal',
  initialState,
  reducers: {
    /** Opens a new top-level tab group holding a single terminal pane. */
    addTerminal(state, action) {
      const { id, title, shell, seq } = action.payload
      state.groups.push({
        groupId: id,
        sizes: [1],
        panes: [{ terminalId: id, title, shell, seq }],
      })
      state.activeGroupId = id
      state.activePaneId = id
    },

    /** Adds another pane to an existing group (the "Split Terminal" action). */
    splitActiveGroup(state, action) {
      const { terminalId, title, shell, seq } = action.payload
      const groupId = action.payload.groupId ?? state.activeGroupId
      const group = state.groups.find((candidate) => candidate.groupId === groupId)
      if (!group) return
      group.panes.push({ terminalId, title, shell, seq })
      group.sizes.push(group.sizes[group.sizes.length - 1] ?? 1)
      state.activeGroupId = group.groupId
      state.activePaneId = terminalId
    },

    /**
     * Records the shell the SERVER actually spawned (from terminal:ready) and
     * retitles the tab/pane from it. This is the source of truth: the requested
     * shell can differ from the spawned one (fallback for an unavailable shell,
     * or the server's platform default when the client had no shell list yet).
     */
    setTerminalShell(state, action) {
      const { terminalId, shellId, label } = action.payload ?? {}
      const group = findGroupOfPane(state, terminalId)
      const pane = group?.panes.find((candidate) => candidate.terminalId === terminalId)
      if (!pane) return

      // The number was allocated against the REQUESTED shell. If the server
      // reports a different one (a fallback, or the client had no shell list
      // yet), re-allocate inside the real shell's numbering so two panes can
      // never share a label like "PowerShell 1".
      if (shellId && shellId !== pane.shell) {
        pane.shell = shellId
        pane.seq = lowestFreeSeq(state.groups, shellId, terminalId)
      } else if (shellId) {
        pane.shell = shellId
      }

      if (label) pane.title = pane.seq ? `${label} ${pane.seq}` : label
    },

    /**
     * Closes one pane (its own little X, or the group's tab X). A group left
     * with a single pane collapses back to a full-width terminal; an empty
     * group is removed entirely.
     */
    removeTerminal(state, action) {
      const terminalId = action.payload
      const groupIndex = state.groups.findIndex((group) =>
        group.panes.some((pane) => pane.terminalId === terminalId),
      )
      if (groupIndex === -1) return
      const group = state.groups[groupIndex]
      const paneIndex = group.panes.findIndex((pane) => pane.terminalId === terminalId)
      group.panes.splice(paneIndex, 1)
      group.sizes.splice(paneIndex, 1)
      if (group.panes.length === 0) {
        state.groups.splice(groupIndex, 1)
      } else if (group.panes.length === 1) {
        group.sizes = [1]
      }

      if (!state.groups.some((candidate) => candidate.groupId === state.activeGroupId)) {
        state.activeGroupId =
          state.groups[groupIndex]?.groupId ?? state.groups[groupIndex - 1]?.groupId ?? null
      }
      const activeGroup = state.groups.find(
        (candidate) => candidate.groupId === state.activeGroupId,
      )
      if (!activeGroup?.panes.some((pane) => pane.terminalId === state.activePaneId)) {
        state.activePaneId = activeGroup?.panes[0]?.terminalId ?? null
      }
    },

    setActiveGroup(state, action) {
      const group = state.groups.find((candidate) => candidate.groupId === action.payload)
      if (!group) return
      state.activeGroupId = group.groupId
      if (!group.panes.some((pane) => pane.terminalId === state.activePaneId)) {
        state.activePaneId = group.panes[0]?.terminalId ?? null
      }
    },

    setActivePane(state, action) {
      const group = findGroupOfPane(state, action.payload)
      if (!group) return
      state.activeGroupId = group.groupId
      state.activePaneId = action.payload
    },

    setSplitSizes(state, action) {
      const { groupId, sizes } = action.payload ?? {}
      const group = state.groups.find((candidate) => candidate.groupId === groupId)
      if (!group || !Array.isArray(sizes) || sizes.length !== group.panes.length) return
      group.sizes = clampSizes(sizes)
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
      state.groups = []
      state.activeGroupId = null
      state.activePaneId = null
      state.isMinimized = false
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAvailableShells.pending, (state) => {
        state.shellStatus = 'loading'
      })
      .addCase(fetchAvailableShells.fulfilled, (state, action) => {
        const { shells, default: preferred } = action.payload
        state.shellStatus = 'ready'
        state.availableShells = shells
        const exists = shells.some((shell) => shell.id === state.defaultShell)
        if (!exists) {
          state.defaultShell =
            (preferred && shells.some((shell) => shell.id === preferred) && preferred) ||
            shells[0]?.id ||
            null
        }
      })
      .addCase(fetchAvailableShells.rejected, (state) => {
        state.shellStatus = 'failed'
      })
  },
})

export const {
  addTerminal,
  splitActiveGroup,
  setTerminalShell,
  removeTerminal,
  setActiveGroup,
  setActivePane,
  setSplitSizes,
  togglePanel,
  setTerminalPanelOpen,
  setPanelHeight,
  toggleMinimize,
  resetTerminals,
} = terminalSlice.actions

export default terminalSlice.reducer
