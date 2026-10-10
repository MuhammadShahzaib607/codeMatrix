import crypto from 'node:crypto'
import { isDatabaseConnected } from '../config/db.js'
import {
  createProject,
  deleteProject,
  findProject,
  listProjectsByOwner,
} from '../models/project.repository.js'
import { closeWatching, suppressWatcher } from '../utils/fileWatcher.js'
import ApiError from '../utils/ApiError.js'
import asyncHandler from '../utils/asyncHandler.js'
import { runDeletion } from '../utils/safeDelete.js'
import {
  createWorkspaceFolder,
  deleteWorkspaceFolder,
  getWorkspacePath,
  isScratchProjectId,
  scratchOwnerIdFromProjectId,
} from '../utils/workspaceManager.js'

function toPublicProject(project) {
  return {
    id: project.projectId,
    name: project.name,
    diskPath: project.diskPath,
    diskFolderName: project.diskFolderName || null,
    isScratch: Boolean(project.isScratch),
    createdAt: project.createdAt,
    lastAccessedAt: project.lastAccessedAt,
  }
}

export const createProjectHandler = asyncHandler(async (req, res) => {
  if (!isDatabaseConnected()) {
    throw new ApiError(
      503,
      'Projects are unavailable because the server has no database configured.',
      'PROJECTS_UNAVAILABLE',
    )
  }

  const requestedName =
    typeof req.body?.name === 'string' && req.body.name.trim()
      ? req.body.name.trim().slice(0, 120)
      : 'Untitled Project'

  const projectId = crypto.randomUUID()
  // The on-disk folder is named from the DISPLAY name (sanitized + a short
  // suffix) so the terminal's `cd <folder>` matches what the Explorer shows.
  const { path: diskPath, folderName } = createWorkspaceFolder(projectId, {
    ownerId: req.user.id,
    displayName: requestedName,
  })

  const project = await createProject({
    projectId,
    name: requestedName,
    owner: req.user.id,
    diskPath,
    diskFolderName: folderName,
  })

  if (!project) {
    throw new ApiError(500, 'Could not create the project.', 'PROJECT_CREATE_FAILED')
  }

  res.status(201).json({ project: toPublicProject(project) })
})

export const listProjectsHandler = asyncHandler(async (req, res) => {
  const projects = await listProjectsByOwner(req.user.id)
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  res.set('Pragma', 'no-cache')
  res.json({ projects: projects.map(toPublicProject) })
})

/**
 * Deletes an ENTIRE project: its workspace folder on disk (recursive) and its
 * Project record in MongoDB.
 *
 * This works for EVERY workspace type:
 *   - a real project  -> ownership is enforced through its Project record;
 *   - a scratch workspace that has no record yet -> allowed for its OWNER only,
 *     detected from the `scratch-<ownerId>` id (so a scratch is deletable exactly
 *     like any other project, which the Explorer and the Recent Projects list
 *     both rely on).
 * A real project whose record is missing (or when the DB is down) is still a
 * 404/503 — a record is required to prove ownership.
 */
export const deleteProjectHandler = asyncHandler(async (req, res) => {
  const { projectId } = req.params
  const project = isDatabaseConnected() ? await findProject(projectId) : null

  if (project) {
    if (String(project.owner) !== String(req.user.id)) {
      throw new ApiError(403, 'You do not have access to this project.', 'FORBIDDEN')
    }
    suppressWatcher(projectId)
    await closeWatching(projectId)
    await runDeletion(
      () => deleteWorkspaceFolder(projectId),
      getWorkspacePath(projectId),
      project.name,
    )
    await deleteProject(projectId)
    return res.json({ deleted: true, projectId })
  }

  // No record. Only a scratch workspace the caller owns may be deleted this way.
  const ownsScratch =
    isScratchProjectId(projectId) &&
    scratchOwnerIdFromProjectId(projectId) === String(req.user.id)

  if (ownsScratch) {
    suppressWatcher(projectId)
    await closeWatching(projectId)
    await runDeletion(() => deleteWorkspaceFolder(projectId), getWorkspacePath(projectId), 'Scratch')
    return res.json({ deleted: true, projectId })
  }

  if (!isDatabaseConnected()) {
    throw new ApiError(
      503,
      'Projects are unavailable because the server has no database configured.',
      'PROJECTS_UNAVAILABLE',
    )
  }
  throw new ApiError(404, 'Project not found.', 'PROJECT_NOT_FOUND')
})
