import { createAsyncThunk } from '@reduxjs/toolkit'
import { isWorkspaceMissingError, workspaceApi } from '../services/api'
import { setCachedFileContent } from '../services/fileContentCache'
import { toReduxTree } from '../utils/cloudTree'
import {
  TS_CONFIG_FILENAMES,
  extractCompilerOptions,
  parseTsconfigJson,
} from '../utils/monacoTsconfig'
import { markSaved, removeContent, setContent } from './editorSlice'
import { clearTsConfig, setTsConfig } from './tsconfigSlice'
import {
  addTab,
  markWorkspaceMissing,
  refreshTree,
  remapPaths,
  setCloudWorkspace,
  setScratchWorkspace,
} from './fileSystemSlice'

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

function vanishedFileIds(previous, next) {
  const keep = new Set(collectFileIds(next))
  return collectFileIds(previous).filter((id) => !keep.has(id))
}

export const refreshWorkspaceTree = createAsyncThunk(
  'workspace/refreshTree',
  async ({ projectId, name }, { dispatch, getState }) => {
    try {
      const data = await workspaceApi.getTree(projectId)
      const previous = getState().fileSystem.tree
      const tree = [toReduxTree(data.tree, previous)]
      const removed = vanishedFileIds(previous, tree)

      dispatch(refreshTree({ tree, name: data.name ?? name }))
      if (removed.length) dispatch(removeContent(removed))
      return data
    } catch (error) {
      throw handleFailure(error, dispatch)
    }
  },
)

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

/**
 * Boots (or re-opens) the per-user scratch workspace and makes it the active
 * workspace. The server creates the folder on demand, so a plain tree read is
 * enough — and it also returns any files created earlier, which is how the
 * scratch workspace is reused across sessions.
 */
export const openScratchWorkspace = createAsyncThunk(
  'workspace/openScratch',
  async ({ projectId, name = 'Scratch' }, { dispatch }) => {
    try {
      const data = await workspaceApi.getTree(projectId)
      dispatch(
        setScratchWorkspace({
          projectId,
          name,
          tree: [toReduxTree(data.tree)],
        }),
      )
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
      return await workspaceApi.importProject(projectId, { name, files })
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
      dispatch(remapPaths({ oldPath, newPath }))
      await dispatch(refreshWorkspaceTree({ projectId })).unwrap()
      return { oldPath, newPath }
    } catch (error) {
      throw handleFailure(error, dispatch)
    }
  },
)

export const duplicateWorkspaceEntry = createAsyncThunk(
  'workspace/duplicateEntry',
  async ({ projectId, sourcePath, targetFolderPath }, { dispatch }) => {
    try {
      // NO manual tree refetch here, on purpose. The chokidar watcher sees the
      // files the copy just created and emits workspace:treeChanged, which the
      // client debounces and turns into exactly ONE tree fetch. Refreshing here
      // as well made every paste fetch the (potentially huge) tree twice.
      return await workspaceApi.duplicateEntry(
        projectId,
        sourcePath,
        targetFolderPath ?? '',
      )
    } catch (error) {
      throw handleFailure(error, dispatch)
    }
  },
)

/**
 * Reads the project's tsconfig.json / jsconfig.json (the first one that exists)
 * and stores its compiler options so Monaco can resolve "@/…" style aliases and
 * type-check JSX. A project without either file simply clears the config and
 * falls back to Monaco's modern React defaults.
 */
export const loadWorkspaceTsConfig = createAsyncThunk(
  'workspace/loadTsConfig',
  async ({ projectId }, { dispatch }) => {
    for (const fileName of TS_CONFIG_FILENAMES) {
      try {
        const data = await workspaceApi.getFile(projectId, fileName)
        const parsed = parseTsconfigJson(data?.content)
        dispatch(
          setTsConfig({ fileName, compilerOptions: extractCompilerOptions(parsed) }),
        )
        return { fileName }
      } catch (error) {
        // 404 just means this project uses the other config name (or none);
        // anything else (workspace gone, network) is handled elsewhere and must
        // not block the editor, so keep trying the next candidate.
        if (error?.status === 404) continue
      }
    }
    dispatch(clearTsConfig())
    return null
  },
)

export const saveWorkspaceFile = createAsyncThunk(
  'workspace/saveFile',
  async ({ projectId, path, content }, { dispatch }) => {
    try {
      const result = await workspaceApi.saveFile(projectId, path, content)
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
