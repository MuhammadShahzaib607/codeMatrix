import archiver from 'archiver'
import fs from 'node:fs'
import path from 'node:path'
import { isDatabaseConnected } from '../config/db.js'
import {
  deleteProject,
  findProject,
  findScratchProjectForOwner,
  touchProject,
  updateProjectDiskInfo,
  upsertProject,
} from '../models/project.repository.js'
import { fallbackProjectName } from '../services/agentFrameworks.js'
import { slugifyProjectName } from '../services/agentService.js'
import ApiError from '../utils/ApiError.js'
import asyncHandler from '../utils/asyncHandler.js'
import { suppressContainerWatcher, suppressWatcher } from '../utils/fileWatcher.js'
import {
  copyDirectoryRecursive,
  copyFileIntoContainer,
  copyPathInWorkspace,
  createContainerFile,
  createContainerProject,
  createFolderInWorkspace,
  createWorkspaceFolder,
  deleteFromWorkspace,
  deleteWorkspaceFolder,
  ensureOwnerContainer,
  ensureScratchWorkspace,
  findContainerProjectId,
  findProjectIdForFolder,
  getContainerTree,
  getOwnerContainerPath,
  isScratchFolderName,
  listContainerEntries,
  resolveContainerOwnerPath,
  statWorkspaceEntry,
  findScratchWorkspaceId,
  getWorkspacePath,
  getWorkspaceRecord,
  getWorkspaceTree,
  isScratchProjectId,
  nextScratchProjectId,
  readFileFromWorkspace,
  registerWorkspaceFromDiskPath,
  renamePathInWorkspace,
  renameWorkspaceFolder,
  uniqueNameInFolder,
  workspaceFolderPath,
  writeFileToWorkspace,
} from '../utils/workspaceManager.js'

const fsp = fs.promises

const MAX_IMPORT_FILES = 5000

function normalizeImportBody(body) {
  if (Array.isArray(body)) return { files: body, name: undefined }
  const source = body ?? {}
  const files = Array.isArray(source.files)
    ? source.files
    : Array.isArray(source.entries)
      ? source.entries
      : null
  return {
    files,
    name: typeof source.name === 'string' ? source.name : undefined,
  }
}

function requirePath(value, label = 'path') {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, `"${label}" is required.`, 'INVALID_PATH')
  }
  return value.trim()
}

export const importProject = asyncHandler(async (req, res) => {
  const { projectId } = req.params
  const { files, name } = normalizeImportBody(req.body)

  if (!files || files.length === 0) {
    throw new ApiError(
      400,
      'No files were provided. Send { files: [{ relativePath, content }] }.',
      'NO_FILES',
    )
  }
  if (files.length > MAX_IMPORT_FILES) {
    throw new ApiError(
      413,
      `Too many files (${files.length}). The limit is ${MAX_IMPORT_FILES} per import.`,
      'TOO_MANY_FILES',
    )
  }

  // The client re-opens the workspace with a direct GET /tree after import, so
  // the fs events this writes must not schedule a second tree walk.
  suppressWatcher(projectId)

  const projectName = name?.trim() || projectId
  // The folder on disk is named from the DISPLAY name (sanitized + a short
  // suffix), inside the owner's container, so a terminal can `cd` into the
  // folder that the Explorer shows as the project root.
  const { path: diskPath, folderName } = createWorkspaceFolder(projectId, {
    ownerId: req.user.id,
    displayName: projectName,
  })

  const failed = []
  let fileCount = 0

  for (const file of files) {
    const relativePath =
      typeof file?.relativePath === 'string' ? file.relativePath.trim().replace(/\\/g, '/') : ''
    if (!relativePath) {
      failed.push({ path: null, message: 'Missing relativePath.' })
      continue
    }
    try {
      writeFileToWorkspace(
        projectId,
        relativePath,
        typeof file.content === 'string' ? file.content : '',
      )
      fileCount += 1
    } catch (error) {
      failed.push({ path: relativePath, message: error.message })
    }
  }

  const project = await upsertProject({
    projectId,
    name: projectName,
    owner: req.user.id,
    diskPath,
    diskFolderName: folderName,
  })

  const tree = await getWorkspaceTree(projectId, { name: project?.name || projectName })

  res.status(201).json({
    projectId,
    name: project?.name || projectName,
    fileCount,
    failedCount: failed.length,
    failed: failed.slice(0, 50),
    tree,
  })
})

export const getTree = asyncHandler(async (req, res) => {
  const { projectId } = req.params
  const project = await findProject(projectId)

  // TEMP DIAGNOSTIC (safe to remove): measures how long the on-disk walk takes.
  const walkStartedAt = Date.now()
  const tree = await getWorkspaceTree(projectId, { name: project?.name })
  console.log(`[tree] ${projectId} walked in ${Date.now() - walkStartedAt}ms`)
  await touchProject(projectId)

  res.json({
    projectId,
    name: project?.name || tree.name,
    // Lets the client restore the workspace with the right source (scratch vs a
    // real project) without guessing from the id — an ADOPTED scratch keeps its
    // scratch-<id> id but becomes a real project.
    isScratch: project ? Boolean(project.isScratch) : isScratchProjectId(projectId),
    tree,
  })
})

/**
 * POST /api/workspace/scratch -> the user's ONE reusable scratch workspace.
 *
 * Resolution order (fix for duplicate/conflicting scratch folders):
 *   1. an existing scratch Project record (isScratch: true)  -> reuse it;
 *   2. otherwise an on-disk registry entry still named "Scratch*" -> reuse it;
 *   3. only when neither exists -> create a FRESH scratch in the free slot.
 *
 * Once a scratch is adopted (renamed by the agent, or otherwise turned into a
 * real named project), `findScratch*` no longer matches it, so the NEXT call
 * creates a new scratch — a user never accumulates two anonymous scratch
 * workspaces.
 *
 * OPTIONAL `{ task }` BODY — the agent's fresh-task flow. When the caller passes
 * the task text, the workspace is named from it (backend-derived slug) BEFORE
 * any folder is created or any file is written:
 *   - a FRESH workspace is created directly under its final name (no generic
 *     "Scratch" container ever exists);
 *   - an anonymous scratch being reused is renamed in place — a true top-level
 *     fs rename of the folder itself, so every file inside keeps its relative
 *     path and nothing is copied into a nested subfolder.
 * The response then carries that real name with `isScratch: false`, because a
 * workspace named after a task IS a real project from that moment on.
 */
export const openScratchWorkspaceHandler = asyncHandler(async (req, res) => {
  const ownerId = req.user.id

  const task = typeof req.body?.task === 'string' ? req.body.task.trim() : ''
  const taskName = task ? slugifyProjectName(task) || fallbackProjectName(null) : null
  const isAnonymous = !taskName
  const displayName = taskName ?? 'Scratch'

  let projectId = null
  let created = false

  const recorded = await findScratchProjectForOwner(ownerId)
  if (recorded) {
    // Rebuild the folder mapping from MongoDB if the registry was lost.
    registerWorkspaceFromDiskPath(recorded.projectId, recorded.diskPath)
    ensureScratchWorkspace(recorded.projectId)
    projectId = recorded.projectId
  } else {
    const fromRegistry = findScratchWorkspaceId(ownerId)
    if (fromRegistry) {
      ensureScratchWorkspace(fromRegistry)
      projectId = fromRegistry
    } else {
      projectId = nextScratchProjectId(ownerId)
      // Born with its final name: the agent's first file-write already lands in
      // the real project folder.
      createWorkspaceFolder(projectId, { ownerId, displayName })
      created = true
    }
  }

  // An anonymous scratch being (re)used for a TASK gets its real name now — a
  // folder rename, not a copy, so contents stay exactly where they are.
  if (taskName) {
    await renameWorkspaceFolder(projectId, { displayName: taskName })
  }

  const record = getWorkspaceRecord(projectId)
  const name = record?.folderName ?? displayName

  // One upsert: keeps lastAccessedAt/Recent Projects fresh, and flags a
  // task-named workspace as a REAL project (isScratch: false) so the next
  // scratch request starts from a genuinely fresh workspace.
  if (isDatabaseConnected() && record) {
    await upsertProject({
      projectId,
      name,
      owner: ownerId,
      diskPath: workspaceFolderPath(record.container, record.folderName),
      diskFolderName: record.folderName,
      isScratch: isAnonymous,
    })
  }

  const tree = await getWorkspaceTree(projectId, { name })
  res.json({ projectId, name, isScratch: isAnonymous, created, tree })
})

// ---------------------------------------------------------------------------
// The Explorer's TOP LEVEL: the per-user container.
//
// Every project folder of a user lives inside ONE container folder
// (server/workspaces/u-<owner>), which is also the directory the terminal starts
// in. These routes expose that folder as the Explorer's root level:
//   GET  /api/workspace/container        -> the top-level entries beside projects
//   POST /api/workspace/container/entry  -> new top-level file, or a new PROJECT
//   POST /api/workspace/container/paste  -> copy a project file next to the project
// A top-level FOLDER is a real project (registry + MongoDB metadata, never file
// contents), so opening it makes it the active workspace for the terminal,
// preview, export, search and the agent.
// ---------------------------------------------------------------------------
export const listContainer = asyncHandler(async (req, res) => {
  const { container, entries } = await listContainerEntries(req.user.id)
  res.json({ container, entries })
})

export const createContainerEntry = asyncHandler(async (req, res) => {
  const type = req.body?.type
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''

  if (type === 'folder') {
    const created = await createContainerProject(req.user.id, name)
    await upsertProject({
      projectId: created.projectId,
      name: created.name,
      owner: req.user.id,
      diskPath: created.path,
      diskFolderName: created.name,
      isScratch: false,
    })
    return res.status(201).json({ type: 'folder', name: created.name, projectId: created.projectId })
  }

  if (type === 'file') {
    const created = await createContainerFile(req.user.id, name)
    return res.status(201).json({ type: 'file', name: created.name, projectId: null })
  }

  throw new ApiError(400, '"type" must be either "file" or "folder".', 'INVALID_TYPE')
})

export const pasteToContainer = asyncHandler(async (req, res) => {
  const sourceProjectId = requirePath(req.body?.projectId, 'projectId')
  const sourcePath = requirePath(req.body?.sourcePath, 'sourcePath')

  if (!isScratchProjectId(sourceProjectId)) {
    const project = isDatabaseConnected() ? await findProject(sourceProjectId) : null
    if (project && String(project.owner) !== String(req.user.id)) {
      throw new ApiError(403, 'You do not have access to this project.', 'FORBIDDEN')
    }
  }

  const { absolute, relative, stats } = await statWorkspaceEntry(sourceProjectId, sourcePath)
  if (!stats) {
    throw new ApiError(404, `"${relative}" was not found in this workspace.`, 'FILE_MISSING')
  }
  if (stats.isDirectory()) {
    throw new ApiError(
      400,
      'Only FILES can be pasted at the top level (a top-level folder is a project). Open the target folder instead.',
      'NOT_A_FILE',
    )
  }

  const base = relative.split('/').pop() || relative
  const { name } = await copyFileIntoContainer(req.user.id, absolute, base)
  res.status(201).json({ type: 'file', name, projectId: null })
})

// ---------------------------------------------------------------------------
// The container as a whole: every project folder plus every top-level file in
// ONE tree, with container-relative paths. This is the Explorer's single tree,
// so the user works in every top-level folder at once instead of one "active"
// project. A path whose first segment names a project folder is delegated to
// that project's existing helpers; a top-level file is read/written directly.
// The container is always derived from the JWT, never from the request body.
// ---------------------------------------------------------------------------

function suppressContainerFor(ownerId, resolved) {
  suppressContainerWatcher(getOwnerContainerPath(ownerId))
  if (resolved?.inner) {
    const projectId = findContainerProjectId(ownerId, resolved.top)
    if (projectId) suppressWatcher(projectId)
  }
}

export const getContainerTreeHandler = asyncHandler(async (req, res) => {
  const tree = await getContainerTree(req.user.id)
  const children = []
  for (const child of tree.children ?? []) {
    // An anonymous scratch folder is an implementation detail and is never a
    // project row (it is still the terminal's cwd).
    if (child.type === 'folder' && isScratchFolderName(child.name)) continue
    // Tag each top-level folder with the project it represents, so the client
    // can resolve a container path's project (terminal/preview/export/agent
    // scope) without a second request.
    if (child.type === 'folder') {
      child.projectId = findContainerProjectId(req.user.id, child.name)
    }
    children.push(child)
  }
  tree.children = children
  res.json({ name: tree.name, tree })
})

export const readContainerFile = asyncHandler(async (req, res) => {
  const filePath = requirePath(req.query.path)
  const resolved = resolveContainerOwnerPath(req.user.id, filePath)

  const stats = await fsp.stat(resolved.absolute).catch(() => null)
  if (!stats) {
    throw new ApiError(404, `"${resolved.relative}" was not found in this workspace.`, 'FILE_MISSING')
  }
  if (stats.isDirectory()) {
    throw new ApiError(400, `"${resolved.relative}" is a folder, not a file.`, 'NOT_A_FILE')
  }

  const content = await fsp.readFile(resolved.absolute, 'utf8')
  if (resolved.inner) {
    const projectId = findContainerProjectId(req.user.id, resolved.top)
    if (projectId) await touchProject(projectId)
  }
  res.json({ path: resolved.relative, content })
})

export const saveContainerFile = asyncHandler(async (req, res) => {
  const filePath = requirePath(req.body?.path)
  const content = typeof req.body?.content === 'string' ? req.body.content : ''
  const resolved = resolveContainerOwnerPath(req.user.id, filePath)

  const stats = await fsp.stat(resolved.absolute).catch(() => null)
  if (stats?.isDirectory()) {
    throw new ApiError(400, `"${resolved.relative}" is a folder, not a file.`, 'NOT_A_FILE')
  }

  suppressContainerFor(req.user.id, resolved)
  await fsp.mkdir(path.dirname(resolved.absolute), { recursive: true })
  await fsp.writeFile(resolved.absolute, content, 'utf8')

  if (resolved.inner) {
    const projectId = findContainerProjectId(req.user.id, resolved.top)
    if (projectId) await touchProject(projectId)
  }
  res.json({ path: resolved.relative, saved: true, bytes: Buffer.byteLength(content, 'utf8') })
})

export const createContainerEntryAt = asyncHandler(async (req, res) => {
  const targetPath = requirePath(req.body?.path)
  const type = req.body?.type
  if (type !== 'file' && type !== 'folder') {
    throw new ApiError(400, '"type" must be either "file" or "folder".', 'INVALID_TYPE')
  }

  const resolved = resolveContainerOwnerPath(req.user.id, targetPath)

  // A TOP-LEVEL folder is a new project (registry + MongoDB metadata).
  if (!resolved.inner && type === 'folder') {
    suppressContainerWatcher(getOwnerContainerPath(req.user.id))
    const created = await createContainerProject(req.user.id, resolved.top)
    await upsertProject({
      projectId: created.projectId,
      name: created.name,
      owner: req.user.id,
      diskPath: created.path,
      diskFolderName: created.name,
      isScratch: false,
    })
    return res.status(201).json({ path: created.name, type: 'folder', projectId: created.projectId })
  }

  const exists = await fsp.stat(resolved.absolute).catch(() => null)
  if (exists) {
    throw new ApiError(409, `"${resolved.relative}" already exists.`, 'ALREADY_EXISTS')
  }

  suppressContainerFor(req.user.id, resolved)
  if (type === 'folder') {
    await fsp.mkdir(resolved.absolute, { recursive: true })
  } else {
    await fsp.mkdir(path.dirname(resolved.absolute), { recursive: true })
    await fsp.writeFile(resolved.absolute, '', 'utf8')
  }

  if (resolved.inner) {
    const projectId = findContainerProjectId(req.user.id, resolved.top)
    if (projectId) await touchProject(projectId)
  }
  res.status(201).json({ path: resolved.relative, type })
})

export const deleteContainerEntryAt = asyncHandler(async (req, res) => {
  const targetPath = requirePath(req.body?.path)
  const resolved = resolveContainerOwnerPath(req.user.id, targetPath)

  const stats = await fsp.stat(resolved.absolute).catch(() => null)
  if (!stats) {
    throw new ApiError(404, `"${resolved.relative}" was not found in this workspace.`, 'FILE_MISSING')
  }

  // Deleting a TOP-LEVEL folder removes the whole project (folder + record).
  if (!resolved.inner && stats.isDirectory()) {
    const projectId = findContainerProjectId(req.user.id, resolved.top)
    if (projectId) {
      suppressWatcher(projectId)
      suppressContainerWatcher(getOwnerContainerPath(req.user.id))
      await deleteWorkspaceFolder(projectId)
      await deleteProject(projectId)
      return res.json({ path: resolved.relative, deleted: true })
    }
  }

  suppressContainerFor(req.user.id, resolved)
  await fsp.rm(resolved.absolute, { recursive: true, force: true })

  if (resolved.inner) {
    const projectId = findContainerProjectId(req.user.id, resolved.top)
    if (projectId) await touchProject(projectId)
  }
  res.json({ path: resolved.relative, deleted: true })
})

export const renameContainerEntryAt = asyncHandler(async (req, res) => {
  const oldPath = requirePath(req.body?.oldPath, 'oldPath')
  const newPath = requirePath(req.body?.newPath, 'newPath')
  const from = resolveContainerOwnerPath(req.user.id, oldPath)
  const to = resolveContainerOwnerPath(req.user.id, newPath)

  if (from.relative === to.relative) {
    return res.json({ oldPath: from.relative, newPath: to.relative, renamed: true })
  }

  const fromStats = await fsp.stat(from.absolute).catch(() => null)
  if (!fromStats) {
    throw new ApiError(404, `"${from.relative}" was not found in this workspace.`, 'FILE_MISSING')
  }

  // Renaming a TOP-LEVEL project folder renames the project itself, so the
  // registry and MongoDB keep pointing at the right folder.
  if (!from.inner && fromStats.isDirectory()) {
    if (to.inner) {
      throw new ApiError(400, 'A project folder can only be renamed, not moved inside another folder.', 'INVALID_PATH')
    }
    const projectId = findContainerProjectId(req.user.id, from.top)
    if (!projectId) {
      throw new ApiError(404, `"${from.relative}" is not a project.`, 'FILE_MISSING')
    }
    await renameWorkspaceFolder(projectId, { displayName: to.top })
    const record = getWorkspaceRecord(projectId)
    if (record) {
      await updateProjectDiskInfo(projectId, {
        diskPath: workspaceFolderPath(record.container, record.folderName),
        diskFolderName: record.folderName,
      })
    }
    return res.json({
      oldPath: from.relative,
      newPath: record?.folderName ?? to.top,
      renamed: true,
    })
  }

  if (
    fromStats.isDirectory() &&
    (to.relative === from.relative || to.relative.startsWith(`${from.relative}/`))
  ) {
    throw new ApiError(
      400,
      `Cannot move "${from.relative}" into itself or one of its own folders.`,
      'INVALID_PATH',
    )
  }

  const toExists = await fsp.stat(to.absolute).then(
    () => true,
    () => false,
  )
  if (toExists) {
    throw new ApiError(409, `"${to.relative}" already exists.`, 'ALREADY_EXISTS')
  }

  suppressContainerFor(req.user.id, from)
  suppressContainerFor(req.user.id, to)
  await fsp.mkdir(path.dirname(to.absolute), { recursive: true })
  await fsp.rename(from.absolute, to.absolute)
  res.json({ oldPath: from.relative, newPath: to.relative, renamed: true })
})

export const duplicateContainerEntryAt = asyncHandler(async (req, res) => {
  const sourcePath = requirePath(req.body?.sourcePath, 'sourcePath')
  const targetFolderPath =
    typeof req.body?.targetFolderPath === 'string' ? req.body.targetFolderPath : ''
  const source = resolveContainerOwnerPath(req.user.id, sourcePath)

  const sourceStats = await fsp.stat(source.absolute).catch(() => null)
  if (!sourceStats) {
    throw new ApiError(404, `"${source.relative}" was not found in this workspace.`, 'FILE_MISSING')
  }
  if (!source.inner && sourceStats.isDirectory()) {
    throw new ApiError(
      400,
      'A top-level folder is a project and cannot be copied — create a new folder instead.',
      'NOT_A_FILE',
    )
  }

  const targetFolder = targetFolderPath
    ? resolveContainerOwnerPath(req.user.id, targetFolderPath).absolute
    : ensureOwnerContainer(req.user.id)
  const targetStats = await fsp.stat(targetFolder).catch(() => null)
  if (targetStats && !targetStats.isDirectory()) {
    throw new ApiError(400, 'The paste target is not a folder.', 'NOT_A_FOLDER')
  }

  await fsp.mkdir(targetFolder, { recursive: true })
  const name = await uniqueNameInFolder(targetFolder, path.basename(source.absolute))
  const destination = path.join(targetFolder, name)

  suppressContainerFor(req.user.id, source)
  suppressContainerWatcher(getOwnerContainerPath(req.user.id))
  if (sourceStats.isDirectory()) {
    await copyDirectoryRecursive(source.absolute, destination, { copied: 0 })
  } else {
    await fsp.copyFile(source.absolute, destination)
  }

  const newPath = path
    .relative(ensureOwnerContainer(req.user.id), destination)
    .split(path.sep)
    .join('/')
  res.status(201).json({ sourcePath: source.relative, newPath, duplicated: true })
})

export const getFile = asyncHandler(async (req, res) => {
  const { projectId } = req.params
  const filePath = requirePath(req.query.path)

  const content = readFileFromWorkspace(projectId, filePath)
  await touchProject(projectId)

  res.json({ path: filePath, content })
})

export const saveFile = asyncHandler(async (req, res) => {
  const { projectId } = req.params
  const filePath = requirePath(req.body?.path)
  const content = typeof req.body?.content === 'string' ? req.body.content : ''

  // A save does not change the tree shape; suppress the 'change' event so it
  // cannot trigger a pointless full-tree walk.
  suppressWatcher(projectId)
  const savedPath = writeFileToWorkspace(projectId, filePath, content)
  await touchProject(projectId)

  res.json({ path: savedPath, saved: true, bytes: Buffer.byteLength(content, 'utf8') })
})

export const createEntry = asyncHandler(async (req, res) => {
  const { projectId } = req.params
  const targetPath = requirePath(req.body?.path)
  const type = req.body?.type

  if (type !== 'file' && type !== 'folder') {
    throw new ApiError(400, '"type" must be either "file" or "folder".', 'INVALID_TYPE')
  }

  // The client refreshes the tree directly after this resolves.
  suppressWatcher(projectId)
  if (type === 'folder') {
    createFolderInWorkspace(projectId, targetPath)
  } else {
    writeFileToWorkspace(projectId, targetPath, '')
  }

  await touchProject(projectId)
  res.status(201).json({ path: targetPath, type })
})

export const deleteEntry = asyncHandler(async (req, res) => {
  const { projectId } = req.params
  const targetPath = requirePath(req.body?.path)

  suppressWatcher(projectId)
  const deleted = await deleteFromWorkspace(projectId, targetPath)
  await touchProject(projectId)

  res.json({ path: deleted, deleted: true })
})

export const renameEntry = asyncHandler(async (req, res) => {
  const { projectId } = req.params
  const oldPath = requirePath(req.body?.oldPath, 'oldPath')
  const newPath = requirePath(req.body?.newPath, 'newPath')

  suppressWatcher(projectId)
  const result = await renamePathInWorkspace(projectId, oldPath, newPath)
  await touchProject(projectId)

  res.json({ ...result, renamed: true })
})

export const duplicateEntry = asyncHandler(async (req, res) => {
  const { projectId } = req.params
  const sourcePath = requirePath(req.body?.sourcePath, 'sourcePath')
  const targetFolderPath =
    typeof req.body?.targetFolderPath === 'string' ? req.body.targetFolderPath : ''

  suppressWatcher(projectId)
  // TEMP DIAGNOSTIC (safe to remove): the paste latency and whether it blocks
  // the event loop can be read straight off this line.
  const startedAt = Date.now()
  const result = await copyPathInWorkspace(projectId, sourcePath, targetFolderPath)
  const copyMs = Date.now() - startedAt
  console.log(
    `[duplicate] ${projectId} ${sourcePath} -> ${result.newPath} copied in ${copyMs}ms`,
  )
  await touchProject(projectId)

  res.status(201).json({ ...result, duplicated: true })
})

function sanitizeFileName(name) {
  return (
    name
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'project'
  )
}

export const exportWorkspace = asyncHandler(async (req, res, next) => {
  const { projectId } = req.params
  const project = await findProject(projectId)
  const workspacePath = getWorkspacePath(projectId)
  const fileName = `${sanitizeFileName(project?.name || projectId)}.zip`

  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)

  const archive = archiver('zip', { zlib: { level: 9 } })

  archive.on('warning', (error) => {
    if (error.code !== 'ENOENT') console.warn(`[export] ${error.message}`)
  })

  archive.on('error', (error) => {
    if (!res.headersSent) next(error)
    else res.destroy(error)
  })

  archive.pipe(res)
  archive.directory(workspacePath, false)
  await archive.finalize()
})

export const __testables = {
  normalizeImportBody,
  sanitizeFileName,
  findProjectIdForFolder,
  listContainerEntries,
}
