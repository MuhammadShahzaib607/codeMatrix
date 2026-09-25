import { createAsyncThunk } from '@reduxjs/toolkit'
import { isWorkspaceMissingError, workspaceApi } from '../services/api'
import { setCachedFileContent } from '../services/fileContentCache'
import { toReduxTree } from '../utils/cloudTree'
import { markSaved, removeContent, setContent } from './editorSlice'
import {
  addTab,
  markWorkspaceMissing,
  refreshTree,
  remapPaths,
  setCloudWorkspace,
} from './fileSystemSlice'

/**
 * Every file operation against a cloud workspace goes through these thunks, so
 * the "server first, then Redux" rule is enforced in one place and a lost
 * workspace always flips the UI into its recovery state.
 */

function handleFailure(error, dispatch) {
  if (isWorkspaceMissingError(error)) dispatch(markWorkspaceMissing())
  return error
}

function collectFileIds(nodes, ids = []) {
  for (const node of nodes) {
    if (node.type === 'file') ids.push(node.id)
    else collectFileIds(node.children ?? [], ids)
  }
  return ids
}

/** File paths present in `previous` but gone from `next`. */
function vanishedFileIds(previous, next) {
  const keep = new Set(collectFileIds(next))
  return collectFileIds(previous).filter((id) => !keep.has(id))
}

/** Reloads the tree, preserving each folder's open/closed state. */
export const refreshWorkspaceTree = createAsyncThunk(
  'workspace/refreshTree',
  async ({ projectId, name }, { dispatch, getState }) => {
    try {
      const data = await workspaceApi.getTree(projectId)
      const previous = getState().fileSystem.tree
      const tree = [toReduxTree(data.tree, previous)]
      const removed = vanishedFileIds(previous, tree)

      dispatch(refreshTree({ tree, name: data.name ?? name }))
      // Tab pruning happens inside refreshTree; the editor's buffers do not know
      // about the tree, so the vanished files are removed explicitly.
      if (removed.length) dispatch(removeContent(removed))
      return data
    } catch (error) {
      throw handleFailure(error, dispatch)
    }
  },
)

/**
 * Reopens the workspace remembered in localStorage after a reload. A 404 here is
 * the expected outcome on the free tier once the server has slept — it marks the
 * workspace missing so the recovery notice is shown.
 */
export const reopenWorkspace = createAsyncThunk(
  'workspace/reopen',
  async ({ projectId, name }, { dispatch }) => {
    try {
      const data = await workspaceApi.getTree(projectId)
      dispatch(
        setCloudWorkspace({
          projectId,
          name: data.name ?? name,
          tree: [toReduxTree(data.tree)],
        }),
      )
      return data
    } catch (error) {
      throw handleFailure(error, dispatch)
    }
  },
)

export const createWorkspaceEntry = createAsyncThunk(
  'workspace/createEntry',
  async ({ projectId, path, type }, { dispatch }) => {
    try {
      await workspaceApi.createEntry(projectId, path, type)
      await dispatch(refreshWorkspaceTree({ projectId })).unwrap()
      // A brand new file opens straight away, like in a desktop editor.
      if (type === 'file') dispatch(addTab(path))
      return { path, type }
    } catch (error) {
      throw handleFailure(error, dispatch)
    }
  },
)

export const deleteWorkspaceEntry = createAsyncThunk(
  'workspace/deleteEntry',
  async ({ projectId, path }, { dispatch }) => {
    try {
      await workspaceApi.deleteEntry(projectId, path)
      // refreshWorkspaceTree prunes any open tab / buffer whose path no longer exists.
      await dispatch(refreshWorkspaceTree({ projectId })).unwrap()
      return { path }
    } catch (error) {
      throw handleFailure(error, dispatch)
    }
  },
)

export const renameWorkspaceEntry = createAsyncThunk(
  'workspace/renameEntry',
  async ({ projectId, oldPath, newPath }, { dispatch }) => {
    try {
      await workspaceApi.renameEntry(projectId, oldPath, newPath)
      // Open tabs and buffers are keyed by path, so they follow the rename.
      dispatch(remapPaths({ oldPath, newPath }))
      await dispatch(refreshWorkspaceTree({ projectId })).unwrap()
      return { oldPath, newPath }
    } catch (error) {
      throw handleFailure(error, dispatch)
    }
  },
)

export const saveWorkspaceFile = createAsyncThunk(
  'workspace/saveFile',
  async ({ projectId, path, content }, { dispatch }) => {
    try {
      const result = await workspaceApi.saveFile(projectId, path, content)
      // Keep the search cache in step with what is now on the server.
      setCachedFileContent(projectId, path, content)
      dispatch(markSaved(path))
      return result
    } catch (error) {
      throw handleFailure(error, dispatch)
    }
  },
)

export const readWorkspaceFile = createAsyncThunk(
  'workspace/readFile',
  async ({ projectId, path, fileId }, { dispatch }) => {
    try {
      const data = await workspaceApi.getFile(projectId, path)
      dispatch(setContent({ fileId: fileId ?? path, content: data.content }))
      return data
    } catch (error) {
      throw handleFailure(error, dispatch)
    }
  },
)

export const importWorkspace = createAsyncThunk(
  'workspace/import',
  async ({ projectId, name, files }, { dispatch }) => {
    try {
      const result = await workspaceApi.importProject(projectId, { name, files })
      dispatch(
        // Replaced wholesale: a fresh import starts with no open tabs.
        setCloudWorkspace({
          projectId,
          name: result.name,
          tree: [toReduxTree(result.tree)],
        }),
      )
      return result
    } catch (error) {
      throw handleFailure(error, dispatch)
    }
  },
)
