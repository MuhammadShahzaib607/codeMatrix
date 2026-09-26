import archiver from 'archiver'
import { findProject, touchProject, upsertProject } from '../models/project.repository.js'
import ApiError from '../utils/ApiError.js'
import asyncHandler from '../utils/asyncHandler.js'
import { suppressWatcher } from '../utils/fileWatcher.js'
import {
  copyPathInWorkspace,
  createFolderInWorkspace,
  createWorkspaceFolder,
  deleteFromWorkspace,
  getWorkspacePath,
  getWorkspaceTree,
  readFileFromWorkspace,
  renamePathInWorkspace,
  writeFileToWorkspace,
} from '../utils/workspaceManager.js'

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
    tree,
  })
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

export const __testables = { normalizeImportBody, sanitizeFileName }
