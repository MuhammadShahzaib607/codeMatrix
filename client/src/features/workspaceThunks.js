import { createAsyncThunk } from '@reduxjs/toolkit'
import { getAuthToken, isWorkspaceMissingError, projectApi, workspaceApi } from '../services/api'
import { clearFileContentCache, setCachedFileContent } from '../services/fileContentCache'
import { getSocket } from '../services/socket'
import { clearWorkspaceRefIfMatches, saveWorkspaceRef } from '../services/workspaceStorage'
import { toReduxTree } from '../utils/cloudTree'
import {
  TS_CONFIG_FILENAMES,
  extractCompilerOptions,
  parseTsconfigJson,
} from '../utils/monacoTsconfig'
import { markSaved, removeContent, setContent } from './editorSlice'
import { fetchRecentProjects, removeRecentProjectItem } from './projectsSlice'
import { clearTsConfig, setTsConfig } from './tsconfigSlice'
import { folderNodeForPath, uniqueChildName } from '../utils/explorerTransfer'
import { findNode } from '../utils/tree'
import {
  addTab,
  applyAgentProject,
  copyNode,
  focusContainerProject,
  markWorkspaceMissing,
  moveNode,
  refreshTree,
  remapPaths,
  removeNode,
  removeProject,
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
  async (_arg, { dispatch, getState }) => {
    try {
      const data = await workspaceApi.getContainerTree()
      const previous = getState().fileSystem.tree
      const tree = [toReduxTree(data.tree, previous)]
      const removed = vanishedFileIds(previous, tree)

      dispatch(refreshTree({ tree }))
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
      const container = await workspaceApi.getContainerTree()
      dispatch(
        setScratchWorkspace({
          projectId,
          name,
          tree: [toReduxTree(container.tree)],
        }),
      )
      // A workspace opened with its final project name is a REAL project from
      // the start (isScratch: false): flip the source and the root label right
      // away instead of waiting for a mid-workspace adoption to do it at the end.
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
  async ({ path, type }, { dispatch }) => {
    try {
      const result = await workspaceApi.createContainerPath(path, type)
      await dispatch(refreshWorkspaceTree({})).unwrap()
      if (type === 'file') dispatch(addTab(path))
      return { path, type, projectId: result?.projectId ?? null }
    } catch (error) {
      throw handleFailure(error, dispatch)
    }
  },
)

export const deleteWorkspaceEntry = createAsyncThunk(
  'workspace/deleteEntry',
  async ({ path, closeTerminals }, { dispatch }) => {
    try {
      await workspaceApi.deleteContainerPath(path, { closeTerminals })
      // Optimistic UI removal: the node is dropped from Redux the instant the
      // DELETE API confirms, so the Explorer reflects the deletion immediately
      // — it does NOT wait on a full tree re-walk first. Deleting a folder
      // with node_modules used to take 10-15s end to end because the UI only
      // updated after that expensive refetch finished.
      dispatch(removeNode(path))
      // Direct post-action refetch, fired in the BACKGROUND (not awaited): the
      // Explorer is already correct, this just reconciles any drift. The chokidar
      // watcher remains a second, debounced safety net.
      dispatch(refreshWorkspaceTree({}))
      return { path }
    } catch (error) {
      throw handleFailure(error, dispatch)
    }
  },
)

export const renameWorkspaceEntry = createAsyncThunk(
  'workspace/renameEntry',
  async ({ oldPath, newPath }, { dispatch }) => {
    try {
      const result = await workspaceApi.renameContainerPath(oldPath, newPath)
      const resolvedNewPath = result?.newPath ?? newPath
      dispatch(remapPaths({ oldPath, newPath: resolvedNewPath }))
      await dispatch(refreshWorkspaceTree({})).unwrap()
      return { oldPath, newPath: resolvedNewPath }
    } catch (error) {
      throw handleFailure(error, dispatch)
    }
  },
)

export const duplicateWorkspaceEntry = createAsyncThunk(
  'workspace/duplicateEntry',
  async ({ sourcePath, targetFolderPath }, { dispatch }) => {
    try {
      const result = await workspaceApi.duplicateContainerPath(
        sourcePath,
        targetFolderPath ?? '',
      )
      // Explicit, direct refresh: the Explorer must update the moment the paste
      // resolves, never depending on the chokidar watcher. Watchers can miss
      // changes written by the very same process, which is exactly what made
      // paste appear only after a manual reload. The watcher still sees these
      // same files and schedules its own refresh; that extra fetch is
      // debounced/coalesced and harmless.
      await dispatch(refreshWorkspaceTree({})).unwrap()
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
export const transferWorkspaceEntry = createAsyncThunk(
  'workspace/transferEntry',
  async ({ sourcePath, targetFolderPath, mode }, { dispatch, getState }) => {
    const isCopy = mode === 'copy'
    const folderPath = targetFolderPath ?? ''
    const tree = getState().fileSystem.tree
    const sourceNode = findNode(tree, sourcePath)
    if (!sourceNode) throw new Error('The selected item no longer exists.')

    const targetNode = folderNodeForPath(tree, folderPath)
    const name = uniqueChildName(targetNode, sourceNode.name)
    const optimisticPath = folderPath ? `${folderPath}/${name}` : name

    if (isCopy) {
      dispatch(copyNode({ sourcePath, newPath: optimisticPath }))
    } else {
      dispatch(moveNode({ oldPath: sourcePath, newPath: optimisticPath }))
      dispatch(remapPaths({ oldPath: sourcePath, newPath: optimisticPath }))
    }

    try {
      const result = isCopy
        ? await workspaceApi.duplicateContainerPath(sourcePath, folderPath)
        : await workspaceApi.moveContainerPath(sourcePath, folderPath)
      const resolvedPath = result?.newPath ?? optimisticPath

      if (resolvedPath !== optimisticPath) {
        if (isCopy) {
          dispatch(removeNode(optimisticPath))
          dispatch(copyNode({ sourcePath, newPath: resolvedPath }))
        } else {
          dispatch(moveNode({ oldPath: optimisticPath, newPath: resolvedPath }))
          dispatch(remapPaths({ oldPath: optimisticPath, newPath: resolvedPath }))
        }
      }

      dispatch(refreshWorkspaceTree({}))
      return {
        sourcePath,
        targetFolderPath: folderPath,
        mode: isCopy ? 'copy' : 'move',
        newPath: resolvedPath,
      }
    } catch (error) {
      if (!isCopy) dispatch(remapPaths({ oldPath: optimisticPath, newPath: sourcePath }))
      dispatch(refreshWorkspaceTree({}))
      throw handleFailure(error, dispatch)
    }
  },
)

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
  async ({ path, content }, { dispatch }) => {
    try {
      const result = await workspaceApi.saveContainerFile(path, content)
      setCachedFileContent(path, content)
      dispatch(markSaved(path))
      return result
    } catch (error) {
      throw handleFailure(error, dispatch)
    }
  },
)

export const readWorkspaceFile = createAsyncThunk(
  'workspace/readFile',
  async ({ path, fileId }, { dispatch }) => {
    try {
      const data = await workspaceApi.getContainerFile(path)
      dispatch(setContent({ fileId: fileId ?? path, content: data.content }))
      return data
    } catch (error) {
      throw handleFailure(error, dispatch)
    }
  },
)

function projectNodeInTree(tree, projectId, path) {
  const topLevel = tree[0]?.children ?? tree
  return (
    topLevel.find(
      (node) =>
        node?.type === 'folder' &&
        ((projectId && node.projectId === projectId) || (path && node.id === path)),
    ) ?? null
  )
}

export function forgetDeletedProject({ projectId, path = null }) {
  return (dispatch, getState) => {
    const before = getState()
    const wasActive = before.fileSystem.workspace.projectId === projectId
    const agentRunning = Boolean(before.ai?.running)
    const node = projectNodeInTree(before.fileSystem.tree, projectId, path)
    const fileIds = node ? collectFileIds([node]) : []

    dispatch(removeRecentProjectItem(projectId))
    dispatch(removeProject({ projectId, path }))
    if (fileIds.length) dispatch(removeContent(fileIds))
    clearWorkspaceRefIfMatches(projectId)

    if (agentRunning && wasActive) {
      try {
        getSocket().emit('agent:stop', { token: getAuthToken() })
      } catch {}
    }
  }
}

/**
 * Deletes the whole active project: the server removes the workspace folder
 * (recursive) and the MongoDB record, then the client drops every trace of it —
 * the remembered workspace ref, the editor buffers/content cache and finally the
 * workspace itself, which returns the Explorer to its "No project imported"
 * empty state.
 */
export const deleteWorkspaceProject = createAsyncThunk(
  'workspace/deleteProject',
  async ({ projectId, name = null, path = null }, { dispatch, getState }) => {
    const source = String(projectId).startsWith('scratch-') ? 'scratch' : 'cloud'
    const wasActive = getState().fileSystem.workspace.projectId === projectId

    dispatch(forgetDeletedProject({ projectId, path }))

    try {
      await projectApi.remove(projectId)
    } catch (error) {
      await dispatch(fetchRecentProjects()).catch(() => {})
      await dispatch(refreshWorkspaceTree({})).catch(() => {})
      const stillListed = getState().projects.items.some((item) => item.id === projectId)
      if (wasActive && stillListed && name) {
        dispatch(focusContainerProject({ projectId, name, source }))
        saveWorkspaceRef({ projectId, name })
      }
      throw handleFailure(error, dispatch)
    }

    if (wasActive) clearFileContentCache()
    dispatch(fetchRecentProjects())
    dispatch(refreshWorkspaceTree({}))
    return { projectId, name }
  },
)
