import { createSlice } from '@reduxjs/toolkit'
import { dummyFileTree } from '../data/dummyFileTree'
import { insertNode, mapTree, removeNode, updateNode } from '../utils/tree'

/**
 * `tree` only ever holds serializable data (id, name, type, children, isOpen).
 * The matching FileSystemHandle for each id lives in the in-memory registry in
 * services/fileSystemAccess.js.
 *
 * source: 'demo' until the user opens a real folder, 'local' afterwards.
 */
const initialState = {
  workspace: { name: 'Demo Project', source: 'demo' },
  tree: dummyFileTree,
  activeFileId: null,
  openTabs: [],
}

function pruneTabs(state, removedFileIds) {
  if (!removedFileIds.length) return
  const removed = new Set(removedFileIds)
  state.openTabs = state.openTabs.filter((fileId) => !removed.has(fileId))
  if (removed.has(state.activeFileId)) {
    state.activeFileId = state.openTabs[state.openTabs.length - 1] ?? null
  }
}

const fileSystemSlice = createSlice({
  name: 'fileSystem',
  initialState,
  reducers: {
    // Swaps the whole workspace for a folder read off the user's disk.
    loadWorkspace(state, action) {
      const { tree, name } = action.payload
      state.workspace = { name, source: 'local' }
      state.tree = tree
      state.activeFileId = null
      state.openTabs = []
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

    // The node is built by services/fileSystemAccess.js, which owns id creation
    // and the handle registry.
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
      pruneTabs(state, removedFileIds)
    },

    renameNode(state, action) {
      const { id, name } = action.payload
      state.tree = updateNode(state.tree, id, (node) => ({ ...node, name }))
    },

    // Used after a folder rename: the folder keeps its id, its children are
    // replaced with the re-read subtree.
    replaceSubtree(state, action) {
      const { id, name, children, removedFileIds = [] } = action.payload
      state.tree = updateNode(state.tree, id, (node) => ({ ...node, name, children }))
      pruneTabs(state, removedFileIds)
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
  loadWorkspace,
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
