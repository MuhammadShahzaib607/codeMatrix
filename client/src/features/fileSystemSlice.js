import { createSlice } from '@reduxjs/toolkit'
import { baseNameOf, parentPathOf, remapTreeIds } from '../utils/cloudTree'
import { ROOT_ID } from '../services/fileSystemAccess'
import { findNode, insertNode, mapTree, removeNode as dropNodeFrom, updateNode } from '../utils/tree'

export const EMPTY_WORKSPACE = { name: null, source: 'none', projectId: null }

const initialState = {
  workspace: EMPTY_WORKSPACE,
  workspaceMissing: false,
  tree: [],
  activeFileId: null,
  openTabs: [],
  fileProjects: {},
  focusedProjectId: null,
  // The Explorer's top level: every entry of the user's container folder, with
  // the project each top-level folder belongs to. The active project is one of
  // these entries (rendered as the project tree); the rest are siblings.
  container: { name: '', entries: [] },
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
  for (const fileId of Object.keys(state.fileProjects)) {
    if (!state.openTabs.includes(fileId)) delete state.fileProjects[fileId]
  }
}

function collectPaths(node, set) {
  set.add(node.id)
  for (const child of node.children ?? []) collectPaths(child, set)
}

function ancestorPathsOf(path) {
  const ancestors = []
  let cursor = parentPathOf(path)
  while (cursor) {
    ancestors.push(cursor)
    cursor = parentPathOf(cursor)
  }
  return ancestors
}

/**
 * One node out of an agent fs-change record. Folder paths are created OPEN, so
 * a folder the agent just made shows its files as they arrive.
 */
function nodeForChange(path, type) {
  const isFolder = type === 'addDir'
  const node = {
    id: path,
    name: baseNameOf(path),
    type: isFolder ? 'folder' : 'file',
    path,
  }
  if (isFolder) {
    node.isOpen = true
    node.children = []
  }
  return node
}

const fileSystemSlice = createSlice({
  name: 'fileSystem',
  initialState,
  reducers: {
    setContainer(state, action) {
      const { name, entries } = action.payload ?? {}
      state.container = {
        name: typeof name === 'string' ? name : '',
        entries: Array.isArray(entries) ? entries : [],
      }
    },

    setCloudWorkspace(state, action) {
      const { projectId, name, tree } = action.payload
      state.workspace = { name, source: 'cloud', projectId }
      state.workspaceMissing = false
      state.tree = tree
      state.activeFileId = null
      state.openTabs = []
      state.fileProjects = {}
      state.focusedProjectId = projectId
    },

    /**
     * Makes the per-user scratch workspace active. It behaves exactly like an
     * imported project from here on (same reducers, same thunks, same routes),
     * but `source` stays 'scratch' so Import/Export/Sync and the terminal-reset
     * logic can tell the two apart. Open tabs are intentionally kept.
     */
    setScratchWorkspace(state, action) {
      const { projectId, name, tree } = action.payload
      state.workspace = { name, source: 'scratch', projectId }
      state.workspaceMissing = false
      state.tree = tree
      state.fileProjects = {}
      state.focusedProjectId = projectId
    },

    refreshTree(state, action) {
      const { tree, name } = action.payload
      state.tree = tree
      if (name) state.workspace = { ...state.workspace, name }
      pruneTabs(state)
    },

    /**
     * The agent adopted a scratch workspace as a real, named project mid-run:
     * the SAME projectId now has a proper name and a MongoDB Project record. We
     * keep the tree/tabs (the files did not move in Redux terms) but flip the
     * source to 'cloud' so Export/Sync/Delete become available, and rename the
     * root node so the Explorer label matches the new project name.
     */
    applyAgentProject(state, action) {
      const { projectId, name } = action.payload ?? {}
      if (!projectId || !name) return
      if (state.workspace.projectId && state.workspace.projectId !== projectId) return
      state.workspace = { ...state.workspace, projectId, name, source: 'cloud' }
      state.tree = state.tree.map((node) =>
        node.type === 'folder' ? { ...node, name } : node,
      )
    },

    /**
     * Optimistic removal of ONE node (by id) right after the delete API
     * succeeded. This is what makes a delete feel instant: the row disappears
     * without waiting for a full GET /tree walk, and the background refetch /
     * chokidar event simply reconciles any drift afterwards.
     */
    removeNode(state, action) {
      state.tree = dropNodeFrom(state.tree, action.payload)
      pruneTabs(state)
    },

    markWorkspaceMissing(state) {
      state.workspaceMissing = true
    },

    clearWorkspaceMissing(state) {
      state.workspaceMissing = false
    },

    /**
     * INCREMENTAL tree update driven by the agent's own file operations
     * (workspace:fsChanged). Each file appears in the right folder the moment
     * the tool call that wrote it returns, with no full-tree walk; the throttled
     * background refetch started by the same socket event reconciles ordering
     * and anything this missed.
     */
    applyFsChanges(state, action) {
      const changes = Array.isArray(action.payload?.changes) ? action.payload.changes : []
      if (changes.length === 0) return
      const ordered = [...changes]
        .map((change) => ({ path: String(change?.path ?? '').replace(/^\/+/, ''), type: change?.type }))
        .filter((change) => change.path && change.type)
        .sort((a, b) => Number(b.type === 'addDir') - Number(a.type === 'addDir'))

      for (const change of ordered) {
        if (change.type === 'unlink' || change.type === 'unlinkDir') {
          state.tree = dropNodeFrom(state.tree, change.path)
          continue
        }
        if (change.type !== 'add' && change.type !== 'addDir') continue
        if (findNode(state.tree, change.path)) continue

        // Attach to the closest ancestor that is already in the tree, so a file
        // whose folder has not been rendered yet still lands inside the project
        // instead of at the top level.
        const chain = ancestorPathsOf(change.path)
        const folderParent = chain.find((id) => findNode(state.tree, id))
        const parentId = folderParent ?? (findNode(state.tree, ROOT_ID) ? ROOT_ID : null)
        state.tree = insertNode(state.tree, parentId, nodeForChange(change.path, change.type))

        for (const ancestor of chain) {
          if (ancestor) state.tree = updateNode(state.tree, ancestor, (node) => ({ ...node, isOpen: true }))
        }
      }

      pruneTabs(state)
    },

    clearWorkspace(state) {
      state.workspace = EMPTY_WORKSPACE
      state.workspaceMissing = false
      state.container = { name: '', entries: [] }
      state.tree = []
      state.activeFileId = null
      state.openTabs = []
      state.fileProjects = {}
      state.focusedProjectId = null
    },

    remapPaths(state, action) {
      const { oldPath, newPath } = action.payload
      state.tree = remapTreeIds(state.tree, oldPath, newPath)
      state.openTabs = state.openTabs.map((id) => remapPath(oldPath, newPath, id))
      state.activeFileId = remapPath(oldPath, newPath, state.activeFileId)
      const remappedProjects = {}
      for (const [fileId, projectId] of Object.entries(state.fileProjects)) {
        remappedProjects[remapPath(oldPath, newPath, fileId)] = projectId
      }
      state.fileProjects = remappedProjects
    },

    setFocusedContainerProject(state, action) {
      state.focusedProjectId = action.payload ?? null
    },

    setActiveFile(state, action) {
      state.activeFileId = action.payload
    },

    addTab(state, action) {
      const payload = action.payload
      const fileId = typeof payload === 'object' && payload ? payload.fileId : payload
      if (!fileId) return
      const projectId =
        (typeof payload === 'object' && payload ? payload.projectId : null) ??
        state.workspace.projectId
      if (!state.openTabs.includes(fileId)) state.openTabs.push(fileId)
      if (projectId) state.fileProjects[fileId] = projectId
      state.activeFileId = fileId
    },

    closeTab(state, action) {
      const fileId = action.payload
      const index = state.openTabs.indexOf(fileId)
      if (index === -1) return
      state.openTabs.splice(index, 1)
      delete state.fileProjects[fileId]
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
  setContainer,
  setCloudWorkspace,
  setScratchWorkspace,
  refreshTree,
  applyFsChanges,
  applyAgentProject,
  removeNode,
  markWorkspaceMissing,
  clearWorkspaceMissing,
  clearWorkspace,
  remapPaths,
  setFocusedContainerProject,
  setActiveFile,
  addTab,
  closeTab,
  toggleFolder,
  setFolderOpen,
  collapseAll,
} = fileSystemSlice.actions

export function selectContextProjectId(state) {
  const { activeFileId, fileProjects, focusedProjectId, workspace } = state.fileSystem
  if (activeFileId && fileProjects[activeFileId]) return fileProjects[activeFileId]
  if (focusedProjectId) return focusedProjectId
  return workspace.projectId ?? null
}

export function selectActiveFileProjectId(state) {
  const { activeFileId, fileProjects, workspace } = state.fileSystem
  if (activeFileId && fileProjects[activeFileId]) return fileProjects[activeFileId]
  return workspace.projectId ?? null
}

export default fileSystemSlice.reducer
