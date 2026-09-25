import { createSlice } from '@reduxjs/toolkit'
import { remapTreeIds } from '../utils/cloudTree'
import { mapTree, updateNode } from '../utils/tree'

export const EMPTY_WORKSPACE = { name: null, source: 'none', projectId: null }

const initialState = {
  workspace: EMPTY_WORKSPACE,
  workspaceMissing: false,
  tree: [],
  activeFileId: null,
  openTabs: [],
}

function remapPath(oldPath, newPath, id) {
  if (typeof id !== 'string') return id
  if (id === oldPath) return newPath
  if (id.startsWith(`${oldPath}/`)) return `${newPath}${id.slice(oldPath.length)}`
  return id
}

function pruneTabs(state) {
  const valid = new Set()
  for (const node of state.tree) collectPaths(node, valid)
  state.openTabs = state.openTabs.filter((fileId) => valid.has(fileId))
  if (state.activeFileId && !valid.has(state.activeFileId)) {
    state.activeFileId = state.openTabs[state.openTabs.length - 1] ?? null
  }
}

function collectPaths(node, set) {
  set.add(node.id)
  for (const child of node.children ?? []) collectPaths(child, set)
}

const fileSystemSlice = createSlice({
  name: 'fileSystem',
  initialState,
  reducers: {
    setCloudWorkspace(state, action) {
      const { projectId, name, tree } = action.payload
      state.workspace = { name, source: 'cloud', projectId }
      state.workspaceMissing = false
      state.tree = tree
      state.activeFileId = null
      state.openTabs = []
    },

    refreshTree(state, action) {
      const { tree, name } = action.payload
      state.tree = tree
      if (name) state.workspace = { ...state.workspace, name }
      pruneTabs(state)
    },

    markWorkspaceMissing(state) {
      state.workspaceMissing = true
    },

    clearWorkspaceMissing(state) {
      state.workspaceMissing = false
    },

    clearWorkspace(state) {
      state.workspace = EMPTY_WORKSPACE
      state.workspaceMissing = false
      state.tree = []
      state.activeFileId = null
      state.openTabs = []
    },

    remapPaths(state, action) {
      const { oldPath, newPath } = action.payload
      state.tree = remapTreeIds(state.tree, oldPath, newPath)
      state.openTabs = state.openTabs.map((id) => remapPath(oldPath, newPath, id))
      state.activeFileId = remapPath(oldPath, newPath, state.activeFileId)
    },

    setActiveFile(state, action) {
      state.activeFileId = action.payload
    },

    addTab(state, action) {
      const fileId = action.payload
      if (!state.openTabs.includes(fileId)) state.openTabs.push(fileId)
      state.activeFileId = fileId
    },

    closeTab(state, action) {
      const fileId = action.payload
      const index = state.openTabs.indexOf(fileId)
      if (index === -1) return
      state.openTabs.splice(index, 1)
      if (state.activeFileId === fileId) {
        state.activeFileId = state.openTabs[index] ?? state.openTabs[index - 1] ?? null
      }
    },

    toggleFolder(state, action) {
      const id = action.payload
      state.tree = updateNode(state.tree, id, (node) => ({ ...node, isOpen: !node.isOpen }))
    },

    setFolderOpen(state, action) {
      const { id, isOpen } = action.payload
      state.tree = updateNode(state.tree, id, (node) => ({ ...node, isOpen }))
    },

    collapseAll(state) {
      state.tree = mapTree(state.tree, (node) =>
        node.type === 'folder' ? { ...node, isOpen: false } : node,
      )
    },
  },
})

export const {
  setCloudWorkspace,
  refreshTree,
  markWorkspaceMissing,
  clearWorkspaceMissing,
  clearWorkspace,
  remapPaths,
  setActiveFile,
  addTab,
  closeTab,
  toggleFolder,
  setFolderOpen,
  collapseAll,
} = fileSystemSlice.actions

export default fileSystemSlice.reducer
