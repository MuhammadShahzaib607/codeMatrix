import { createAsyncThunk } from '@reduxjs/toolkit'
import { isWorkspaceMissingError, projectApi, workspaceApi } from '../services/api'
import { clearFileContentCache, setCachedFileContent } from '../services/fileContentCache'
import { clearWorkspaceRef, saveWorkspaceRef } from '../services/workspaceStorage'
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
  applyAgentProject,
  clearWorkspace,
  markWorkspaceMissing,
  refreshTree,
  remapPaths,
  removeNode,
  setContainer,
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

/**
 * Boots (or REUSES) the user's single scratch workspace and makes it active.
 *
 * The server decides which workspace this is: an existing scratch the user
 * already has is reused (so reopening the app never spawns a duplicate
 * "Scratch"), and only a
 * genuinely free slot creates a new one. Once the workspace has been adopted as
 * a named project, a later call opens a fresh scratch instead.
 *
 * Pass `{ task }` when the caller is starting an agent run: the server then
 * names the workspace from the task BEFORE the folder is created, so the
 * agent's first file-write already lands in the real project folder instead of
 * a generic "Scratch" container.
 */
export const openScratchWorkspace = createAsyncThunk(
  'workspace/openScratch',
  async (arg, { dispatch }) => {
    const task = typeof arg === 'object' && arg ? arg.task : undefined
    try {
      const data = await workspaceApi.openScratch(task)
      const name = data?.name ?? 'Scratch'
      const projectId = data.projectId
      dispatch(
        setScratchWorkspace({
          projectId,
          name,
          tree: [toReduxTree(data.tree)],
        }),
      )
      // A workspace opened with its final project name is a REAL project from
      // the start (isScratch: false): flip the source and the root label right
      // away instead of waiting for a mid-run adoption to do it at the end.
      if (data.isScratch === false) {
        dispatch(applyAgentProject({ projectId, name }))
      }
      saveWorkspaceRef({ projectId, name })
      return data
    } catch (error) {
      throw handleFailure(error, dispatch)
    }
  },
)

/**
 * The Explorer's TOP LEVEL: the per-user container folder that holds every
 * project as a sibling entry. Loaded whenever the active workspace changes, and
 * after any top-level create/paste. A signed-out call simply returns null (the
 * Explorer keeps its project-only view).
 */
export const loadContainer = createAsyncThunk(
  'workspace/loadContainer',
  async (_, { dispatch }) => {
    try {
      const data = await workspaceApi.listContainer()
      dispatch(
        setContainer({ name: data?.container ?? '', entries: data?.entries ?? [] }),
      )
      return data
    } catch {
      return null
    }
  },
)

/**
 * Creates an item at the TOP LEVEL, beside the project folder:
 *   - a folder becomes a NEW PROJECT (registry record + MongoDB metadata);
 *   - a file is stored in the container next to the projects.
 */
export const createContainerEntry = createAsyncThunk(
  'workspace/createContainerEntry',
  async ({ name, type }, { dispatch }) => {
    const data = await workspaceApi.createContainerEntry(name, type)
    await dispatch(loadContainer())
    return data
  },
)

/** Copies a project FILE next to the project folders (top level). */
export const pasteIntoContainer = createAsyncThunk(
  'workspace/pasteIntoContainer',
  async ({ projectId, sourcePath }, { dispatch }) => {
    const data = await workspaceApi.pasteToContainer(projectId, sourcePath)
    await dispatch(loadContainer())
    return data
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
      // Optimistic UI removal: the node is dropped from Redux the instant the
      // DELETE API confirms, so the Explorer reflects the deletion immediately
      // — it does NOT wait on a full GET /tree re-walk first. Deleting a folder
      // with node_modules used to take 10-15s end to end because the UI only
      // updated after that expensive refetch finished.
      dispatch(removeNode(path))
      // Direct post-action refetch, fired in the BACKGROUND (not awaited): the
      // Explorer is already correct, this just reconciles any drift. The chokidar
      // watcher remains a second, debounced safety net.
      dispatch(refreshWorkspaceTree({ projectId }))
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
      const result = await workspaceApi.duplicateEntry(
        projectId,
        sourcePath,
        targetFolderPath ?? '',
      )
      // Explicit, direct refresh: the Explorer must update the moment the paste
      // resolves, never depending on the chokidar watcher. Watchers can miss
      // changes written by the very same process, which is exactly what made
      // paste appear only after a manual reload. The watcher still sees these
      // same files and schedules its own refresh; that extra fetch is
      // debounced/coalesced and harmless.
      await dispatch(refreshWorkspaceTree({ projectId })).unwrap()
      return result
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

/**
 * Deletes the whole active project: the server removes the workspace folder
 * (recursive) and the MongoDB record, then the client drops every trace of it —
 * the remembered workspace ref, the editor buffers/content cache and finally the
 * workspace itself, which returns the Explorer to its "No project imported"
 * empty state.
 */
export const deleteWorkspaceProject = createAsyncThunk(
  'workspace/deleteProject',
  async ({ projectId }, { dispatch }) => {
    await projectApi.remove(projectId)
    clearWorkspaceRef()
    clearFileContentCache()
    dispatch(clearWorkspace())
    return { projectId }
  },
)
