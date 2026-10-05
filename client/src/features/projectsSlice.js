import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { isWorkspaceMissingError, projectApi, workspaceApi } from '../services/api'
import { saveWorkspaceRef } from '../services/workspaceStorage'
import { toReduxTree } from '../utils/cloudTree'
import { setCloudWorkspace, setScratchWorkspace } from './fileSystemSlice'

/**
 * "Recent Projects" — the user's existing workspaces, fetched from MongoDB so
 * closing and reopening the browser shows real projects instead of silently
 * starting a fresh scratch workspace. A scratch workspace (isScratch) appears
 * here too, and is deleted the same way as any other project.
 */
const initialState = {
  items: [],
  status: 'idle', // idle | loading | ready | error
  error: null,
  // Set when a listed project's files are gone from disk (free-tier restart).
  missing: null,
  // A project awaiting delete confirmation from the list view.
  pendingDelete: null,
  // projectId -> Redux tree of that project, fetched on demand so the Explorer
  // can show a sibling project's files WITHOUT making it the active workspace.
  // Clicking one of those files is what activates the project, so there is no
  // separate "select project" step anywhere.
  trees: {},
  treeStates: {},
}

export const fetchRecentProjects = createAsyncThunk(
  'projects/fetchRecent',
  async (_, { rejectWithValue }) => {
    try {
      const data = await projectApi.list()
      return data?.projects ?? []
    } catch (error) {
      return rejectWithValue(error.message)
    }
  },
)

/**
 * Loads a project's real tree from disk and makes it active — exactly like
 * importing, except the files are already there. Sets the right workspace source
 * from the server's `isScratch` flag (an ADOPTED scratch keeps its id but is a
 * real project). A 404 marks the entry as lost so the UI can offer to remove it.
 */
export const openRecentProject = createAsyncThunk(
  'projects/openRecent',
  async ({ projectId, name }, { dispatch, rejectWithValue }) => {
    try {
      // The Explorer always renders the WHOLE container, so opening a project
      // means focusing it (terminal/preview/export/agent follow it) while the
      // tree stays container-wide. A lost project answers 404 WORKSPACE_MISSING
      // from the container tree's ownership-guarded route.
      const container = await workspaceApi.getContainerTree()
      const entry = (container.tree?.children ?? []).find(
        (child) => child.projectId === projectId,
      )
      const resolvedName = entry?.name ?? name ?? 'Project'
      const isScratch = String(projectId).startsWith('scratch-')
      const tree = [toReduxTree(container.tree)]
      if (isScratch) {
        dispatch(setScratchWorkspace({ projectId, name: resolvedName, tree }))
      } else {
        dispatch(setCloudWorkspace({ projectId, name: resolvedName, tree }))
      }
      saveWorkspaceRef({ projectId, name: resolvedName })
      return { projectId, name: resolvedName }
    } catch (error) {
      if (isWorkspaceMissingError(error)) {
        dispatch(markRecentMissing({ projectId, name: name ?? null }))
      }
      return rejectWithValue(error.message)
    }
  },
)

/**
 * Removes a project from the list AND deletes its files/record on the server.
 * Used when the entry is already known to be unusable (its files were lost), so
 * a server-side 404 is not treated as a failure.
 */
export const removeRecentProject = createAsyncThunk(
  'projects/removeRecent',
  async ({ projectId }, { dispatch }) => {
    try {
      await projectApi.remove(projectId)
    } catch {
      // The record may already be gone (or the workspace was never recorded).
      // The point is to drop it from the list, so swallow the error.
    }
    dispatch(removeRecentProjectItem(projectId))
    dispatch(dismissRecentMissing())
    return { projectId }
  },
)

/**
 * Reads a project's tree for the Explorer's top level, purely for BROWSING.
 * It never touches the active workspace: the active project is decided by which
 * file (or project row) the user actually clicks. A tree already in the cache
 * is returned as-is, so expanding a project repeatedly costs one request in
 * total for the session.
 */
export const fetchProjectTree = createAsyncThunk(
  'projects/fetchTree',
  async ({ projectId }, { getState, rejectWithValue }) => {
    if (!projectId) return rejectWithValue('A project id is required.')
    const cached = getState().projects.trees[projectId]
    if (cached) return { projectId, tree: cached, cached: true }
    try {
      const data = await workspaceApi.getTree(projectId)
      return {
        projectId,
        tree: toReduxTree(data.tree),
        name: data.name ?? null,
        cached: false,
      }
    } catch (error) {
      return rejectWithValue(error.message)
    }
  },
)

const projectsSlice = createSlice({
  name: 'projects',
  initialState,
  reducers: {
    removeRecentProjectItem(state, action) {
      state.items = state.items.filter((item) => item.id !== action.payload)
      delete state.trees[action.payload]
      delete state.treeStates[action.payload]
    },
    /** Drops every cached sibling tree (sign-out, project deleted). */
    clearProjectTrees(state, action = {}) {
      const keep = action.payload?.keep ?? null
      if (!keep) {
        state.trees = {}
        state.treeStates = {}
        return
      }
      for (const projectId of Object.keys(state.trees)) {
        if (projectId !== keep) {
          delete state.trees[projectId]
          delete state.treeStates[projectId]
        }
      }
    },
    markRecentMissing(state, action) {
      state.missing = action.payload
    },
    dismissRecentMissing(state) {
      state.missing = null
    },
    requestDeleteRecent(state, action) {
      state.pendingDelete = action.payload
    },
    cancelDeleteRecent(state) {
      state.pendingDelete = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchRecentProjects.pending, (state) => {
        state.status = 'loading'
        state.error = null
      })
      .addCase(fetchRecentProjects.fulfilled, (state, action) => {
        state.items = action.payload
        state.status = 'ready'
        state.error = null
      })
      .addCase(fetchRecentProjects.rejected, (state, action) => {
        state.status = 'error'
        state.error = action.payload ?? 'Could not load your projects.'
      })
      .addCase(fetchProjectTree.pending, (state, action) => {
        const projectId = action.meta.arg?.projectId
        if (projectId) state.treeStates[projectId] = { status: 'loading' }
      })
      .addCase(fetchProjectTree.fulfilled, (state, action) => {
        const { projectId, tree } = action.payload ?? {}
        if (!projectId) return
        if (tree) state.trees[projectId] = tree
        state.treeStates[projectId] = { status: 'ready' }
      })
      .addCase(fetchProjectTree.rejected, (state, action) => {
        const projectId = action.meta.arg?.projectId
        if (!projectId) return
        state.treeStates[projectId] = {
          status: 'error',
          error: action.payload ?? 'Could not load this project.',
        }
      })
  },
})

export const {
  removeRecentProjectItem,
  clearProjectTrees,
  markRecentMissing,
  dismissRecentMissing,
  requestDeleteRecent,
  cancelDeleteRecent,
} = projectsSlice.actions

export default projectsSlice.reducer
