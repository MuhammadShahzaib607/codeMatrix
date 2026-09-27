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
      const data = await workspaceApi.getTree(projectId)
      const tree = [toReduxTree(data.tree)]
      const resolvedName = data.name ?? name ?? 'Project'
      if (data.isScratch) {
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

const projectsSlice = createSlice({
  name: 'projects',
  initialState,
  reducers: {
    removeRecentProjectItem(state, action) {
      state.items = state.items.filter((item) => item.id !== action.payload)
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
  },
})

export const {
  removeRecentProjectItem,
  markRecentMissing,
  dismissRecentMissing,
  requestDeleteRecent,
  cancelDeleteRecent,
} = projectsSlice.actions

export default projectsSlice.reducer
