import { getAuthToken } from './api'

const TERMINAL_GROUPS_KEY = 'code-matrix:terminalGroups'
const SIDEBAR_TERMINAL_KEY = 'code-matrix:sidebarTerminal'

function authSessionMatches(stored) {
  return stored?.hasToken === Boolean(getAuthToken())
}

function readStored(key) {
  try {
    const raw = window.sessionStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeStored(key, value) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

function removeStored(key) {
  try {
    window.sessionStorage.removeItem(key)
  } catch {}
}

function isTerminalId(value) {
  return typeof value === 'string' && value.length > 0
}

function validPane(pane) {
  return Boolean(pane) && isTerminalId(pane.terminalId)
}

export function readStoredTerminalGroups() {
  const stored = readStored(TERMINAL_GROUPS_KEY)
  if (!Array.isArray(stored?.groups)) return null
  if (!authSessionMatches(stored)) return null

  const groups = stored.groups
    .filter(
      (group) =>
        Boolean(group) &&
        isTerminalId(group.groupId) &&
        Array.isArray(group.panes) &&
        group.panes.length > 0 &&
        group.panes.every(validPane),
    )
    .map((group) => ({
      groupId: group.groupId,
      sizes:
        Array.isArray(group.sizes) && group.sizes.length === group.panes.length
          ? group.sizes
          : group.panes.map(() => 1),
      panes: group.panes.map((pane) => ({
        terminalId: pane.terminalId,
        title: typeof pane.title === 'string' && pane.title ? pane.title : 'shell',
        shell: typeof pane.shell === 'string' && pane.shell ? pane.shell : null,
      })),
    }))

  if (groups.length === 0) return null

  const activeGroupId = groups.some((group) => group.groupId === stored.activeGroupId)
    ? stored.activeGroupId
    : groups[0].groupId
  const activeGroup = groups.find((group) => group.groupId === activeGroupId) ?? groups[0]
  const activePaneId = activeGroup.panes.some((pane) => pane.terminalId === stored.activePaneId)
    ? stored.activePaneId
    : activeGroup.panes[0].terminalId

  return {
    groups,
    activeGroupId,
    activePaneId,
    isTerminalPanelOpen: stored.isTerminalPanelOpen === true,
  }
}

export function writeStoredTerminalGroups(state) {
  if (!state || !Array.isArray(state.groups) || state.groups.length === 0) {
    removeStored(TERMINAL_GROUPS_KEY)
    return
  }
  writeStored(TERMINAL_GROUPS_KEY, {
    groups: state.groups,
    activeGroupId: state.activeGroupId ?? null,
    activePaneId: state.activePaneId ?? null,
    isTerminalPanelOpen: state.isTerminalPanelOpen === true,
    hasToken: Boolean(getAuthToken()),
  })
}

export function clearStoredTerminalGroups() {
  removeStored(TERMINAL_GROUPS_KEY)
}

export function readStoredSidebarTerminal() {
  const stored = readStored(SIDEBAR_TERMINAL_KEY)
  if (!stored || !isTerminalId(stored.terminalId)) return null
  if (!authSessionMatches(stored)) return null
  return {
    terminalId: stored.terminalId,
    shell: typeof stored.shell === 'string' && stored.shell ? stored.shell : null,
  }
}

export function writeStoredSidebarTerminal(state) {
  if (!state || !isTerminalId(state.terminalId)) {
    removeStored(SIDEBAR_TERMINAL_KEY)
    return
  }
  writeStored(SIDEBAR_TERMINAL_KEY, {
    terminalId: state.terminalId,
    shell: typeof state.shell === 'string' && state.shell ? state.shell : null,
    hasToken: Boolean(getAuthToken()),
  })
}

export function clearStoredSidebarTerminal() {
  removeStored(SIDEBAR_TERMINAL_KEY)
}
