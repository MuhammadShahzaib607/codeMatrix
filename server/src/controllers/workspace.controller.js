import archiver from 'archiver'
import { env } from '../config/env.js'
import { findProject, touchProject, upsertProject } from '../models/project.repository.js'
import ApiError from '../utils/ApiError.js'
import asyncHandler from '../utils/asyncHandler.js'
import {
  createFolderInWorkspace,
  createWorkspaceFolder,
  deleteFromWorkspace,
  getWorkspacePath,
  getWorkspaceTree,
  readFileFromWorkspace,
  renamePathInWorkspace,
  writeFileToWorkspace,
} from '../utils/workspaceManager.js'

// Refuses absurd imports that would fill the (ephemeral) disk or time out.
const MAX_IMPORT_FILES = 5000

function resolveOwnerId(req, body) {
  return (
    (typeof body?.ownerId === 'string' && body.ownerId.trim()) ||
    req.get('x-user-id') ||
    env.defaultOwnerId
  )
}

/** Accepts either a bare array or `{ name, files: [...] }`. */
function normalizeImportBody(body) {
  if (Array.isArray(body)) return { files: body, name: undefined, ownerId: undefined }
  const source = body ?? {}
  const files = Array.isArray(source.files)
    ? source.files
    : Array.isArray(source.entries)
      ? source.entries
      : null
  return {
    files,
    name: typeof source.name === 'string' ? source.name : undefined,
    ownerId: typeof source.ownerId === 'string' ? source.ownerId : undefined,
  }
}

function requirePath(value, label = 'path') {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, `"${label}" is required.`, 'INVALID_PATH')
  }
  return value.trim()
}

/* ------------------------------------------------------------------ *
 * POST /api/workspace/:projectId/import
 * ------------------------------------------------------------------ */

export const importProject = asyncHandler(async (req, res) => {
  const { projectId } = req.params
  const { files, name, ownerId } = normalizeImportBody(req.body)

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

  // The workspace is created here, before any file is written.
  const diskPath = createWorkspaceFolder(projectId)

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

  const projectName = name?.trim() || projectId
  const project = await upsertProject({
    projectId,
    name: projectName,
    ownerId: resolveOwnerId(req, req.body),
    diskPath,
  })

  const tree = getWorkspaceTree(projectId, { name: project?.name || projectName })

  res.status(201).json({
    projectId,
    name: project?.name || projectName,
    fileCount,
    failedCount: failed.length,
    failed: failed.slice(0, 50),
    tree,
  })
})

/* ------------------------------------------------------------------ *
 * GET /api/workspace/:projectId/tree
 * ------------------------------------------------------------------ */

export const getTree = asyncHandler(async (req, res) => {
  const { projectId } = req.params
  const project = await findProject(projectId)

  const tree = getWorkspaceTree(projectId, { name: project?.name })
  await touchProject(projectId)

  res.json({
    projectId,
    name: project?.name || tree.name,
    tree,
  })
})

/* ------------------------------------------------------------------ *
 * GET /api/workspace/:projectId/file?path=...
 * ------------------------------------------------------------------ */

export const getFile = asyncHandler(async (req, res) => {
  const { projectId } = req.params
  const filePath = requirePath(req.query.path)

  const content = readFileFromWorkspace(projectId, filePath)
  await touchProject(projectId)

  res.json({ path: filePath, content })
})

/* ------------------------------------------------------------------ *
 * PUT /api/workspace/:projectId/file   { path, content }
 * ------------------------------------------------------------------ */

export const saveFile = asyncHandler(async (req, res) => {
  const { projectId } = req.params
  const filePath = requirePath(req.body?.path)
  const content = typeof req.body?.content === 'string' ? req.body.content : ''

  const savedPath = writeFileToWorkspace(projectId, filePath, content)
  await touchProject(projectId)

  res.json({ path: savedPath, saved: true, bytes: Buffer.byteLength(content, 'utf8') })
})

/* ------------------------------------------------------------------ *
 * POST /api/workspace/:projectId/create   { path, type }
 * ------------------------------------------------------------------ */

export const createEntry = asyncHandler(async (req, res) => {
  const { projectId } = req.params
  const targetPath = requirePath(req.body?.path)
  const type = req.body?.type

  if (type !== 'file' && type !== 'folder') {
    throw new ApiError(400, '"type" must be either "file" or "folder".', 'INVALID_TYPE')
  }

  if (type === 'folder') {
    createFolderInWorkspace(projectId, targetPath)
  } else {
    writeFileToWorkspace(projectId, targetPath, '')
  }

  await touchProject(projectId)
  res.status(201).json({ path: targetPath, type })
})

/* ------------------------------------------------------------------ *
 * DELETE /api/workspace/:projectId/delete   { path }
 * ------------------------------------------------------------------ */

export const deleteEntry = asyncHandler(async (req, res) => {
  const { projectId } = req.params
  const targetPath = requirePath(req.body?.path)

  const deleted = deleteFromWorkspace(projectId, targetPath)
  await touchProject(projectId)

  res.json({ path: deleted, deleted: true })
})

/* ------------------------------------------------------------------ *
 * PATCH /api/workspace/:projectId/rename   { oldPath, newPath }
 * ------------------------------------------------------------------ */

export const renameEntry = asyncHandler(async (req, res) => {
  const { projectId } = req.params
  const oldPath = requirePath(req.body?.oldPath, 'oldPath')
  const newPath = requirePath(req.body?.newPath, 'newPath')

  const result = renamePathInWorkspace(projectId, oldPath, newPath)
  await touchProject(projectId)

  res.json({ ...result, renamed: true })
})

/* ------------------------------------------------------------------ *
 * GET /api/workspace/:projectId/export
 * ------------------------------------------------------------------ */

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
    // Headers are usually already sent by the time a zlib error surfaces, so we
    // can only tear the response down.
    if (!res.headersSent) next(error)
    else res.destroy(error)
  })

  archive.pipe(res)
  // `false` keeps the archive relative to the workspace root (no extra top folder).
  archive.directory(workspacePath, false)
  await archive.finalize()
})

export const __testables = { normalizeImportBody, sanitizeFileName }
