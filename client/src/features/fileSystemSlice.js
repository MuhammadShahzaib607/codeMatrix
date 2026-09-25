import { createSlice } from '@reduxjs/toolkit'
import { dummyFileTree } from '../data/dummyFileTree'
import { remapTreeIds } from '../utils/cloudTree'
import { insertNode, mapTree, removeNode, updateNode } from '../utils/tree'

/**
 * The tree holds two kinds of workspace:
 *
 *   source: 'demo'  — the static dummy tree, edits live in Redux only.
 *   source: 'cloud' — a real project imported to the server, living on disk in
 *                     server/workspaces/<projectId>. Every node id IS its
 *                     relative path, which is exactly what the API expects.
 *
 * The laptop's File System Access handles are only used to import a folder and
 * to sync it back; they never appear here because they are not serializable.
 */
const initialState = {
  workspace: { name: 'Demo Project', source: 'demo', projectId: null },
  // True when a cloud workspace disappeared (server restart on the free tier).
  workspaceMissing: false,
  tree: dummyFileTree,
  activeFileId: null,
  openTabs: [],
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
    // A fresh import: replaces everything and resets tabs/buffers.
    setCloudWorkspace(state, action) {
      const { projectId, name, tree } = action.payload
      state.workspace = { name, source: 'cloud', projectId }
      state.workspaceMissing = false
      state.tree = tree
      state.activeFileId = null
      state.openTabs = []
    },

    // Reloads the tree from the server, keeping each folder's open/closed state
    // (handled by toReduxTree) and dropping tabs whose file no longer exists.
    refreshTree(state, action) {
      const { tree, name } = action.payload
      state.tree = tree
      if (name) state.workspace.name = name
      pruneTabs(state)
    },

    // The on-disk workspace is gone — surface the recovery UI.
    markWorkspaceMissing(state) {
      state.workspaceMissing = true
    },

    clearWorkspaceMissing(state) {
      state.workspaceMissing = false
    },

    // Falls back to the demo workspace (e.g. after a lost cloud project).
    resetToDemo(state) {
      state.workspace = { name: 'Demo Project', source: 'demo', projectId: null }
      state.workspaceMissing = false
      state.tree = dummyFileTree
      state.activeFileId = null
      state.openTabs = []
    },

    // A rename/move changes every id (path) under the old path.
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
      // Focus a neighbour tab, like VS Code does.
      if (state.activeFileId === fileId) {
        state.activeFileId = state.openTabs[index] ?? state.openTabs[index - 1] ?? null
      }
    },

    // Demo-only: adds a node built in Redux (cloud nodes are re-fetched).
    addNode(state, action) {
      const { parentId, node } = action.payload
      state.tree = insertNode(state.tree, parentId, node)
      if (node.type === 'file') {
        state.openTabs.push(node.id)
        state.activeFileId = node.id
      }
    },

    deleteNode(state, action) {
      const { id, removedFileIds = [] } = action.payload
      state.tree = removeNode(state.tree, id)
      pruneTabsByIds(state, removedFileIds)
    },

    renameNode(state, action) {
      const { id, name } = action.payload
      state.tree = updateNode(state.tree, id, (node) => ({ ...node, name }))
    },

    replaceSubtree(state, action) {
      const { id, name, children, removedFileIds = [] } = action.payload
      state.tree = updateNode(state.tree, id, (node) => ({ ...node, name, children }))
      pruneTabsByIds(state, removedFileIds)
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

function pruneTabsByIds(state, removedFileIds) {
  if (!removedFileIds.length) return
  const removed = new Set(removedFileIds)
  state.openTabs = state.openTabs.filter((fileId) => !removed.has(fileId))
  if (removed.has(state.activeFileId)) {
    state.activeFileId = state.openTabs[state.openTabs.length - 1] ?? null
  }
}

// Same prefix rule as cloudTree.remapId, kept local to the slice.
function remapPath(oldPath, newPath, id) {
  if (typeof id !== 'string') return id
  if (id === oldPath) return newPath
  if (id.startsWith(`${oldPath}/`)) return `${newPath}${id.slice(oldPath.length)}`
  return id
}

export const {
  setCloudWorkspace,
  refreshTree,
  markWorkspaceMissing,
  clearWorkspaceMissing,
  resetToDemo,
  remapPaths,
  setActiveFile,
  addTab,
  closeTab,
  addNode,
  deleteNode,
  renameNode,
  replaceSubtree,
  toggleFolder,
  setFolderOpen,
  collapseAll,
} = fileSystemSlice.actions

export default fileSystemSlice.reducer
