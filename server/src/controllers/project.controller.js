import crypto from 'node:crypto'
import { isDatabaseConnected } from '../config/db.js'
import {
  createProject,
  deleteProject,
  findProject,
  listProjectsByOwner,
} from '../models/project.repository.js'
import { suppressWatcher } from '../utils/fileWatcher.js'
import ApiError from '../utils/ApiError.js'
import asyncHandler from '../utils/asyncHandler.js'
import { createWorkspaceFolder, deleteWorkspaceFolder } from '../utils/workspaceManager.js'

function toPublicProject(project) {
  return {
    id: project.projectId,
    name: project.name,
    diskPath: project.diskPath,
    diskFolderName: project.diskFolderName || null,
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
  res.json({ projects: projects.map(toPublicProject) })
})

/**
 * Deletes an ENTIRE project: its workspace folder on disk (recursive) and its
 * Project record in MongoDB. Ownership is enforced through the project record —
 * a missing record is a 404, so a user can never delete (or discover) another
 * user's project by guessing an id.
 */
export const deleteProjectHandler = asyncHandler(async (req, res) => {
  if (!isDatabaseConnected()) {
    throw new ApiError(
      503,
      'Projects are unavailable because the server has no database configured.',
      'PROJECTS_UNAVAILABLE',
    )
  }

  const { projectId } = req.params
  const project = await findProject(projectId)
  if (!project) {
    throw new ApiError(404, 'Project not found.', 'PROJECT_NOT_FOUND')
  }
  if (String(project.owner) !== String(req.user.id)) {
    throw new ApiError(403, 'You do not have access to this project.', 'FORBIDDEN')
  }

  // Drop filesystem events caused by our own delete, so the already-connected
  // client does not schedule a redundant tree refresh for a workspace it is
  // about to clear.
  suppressWatcher(projectId)
  await deleteWorkspaceFolder(projectId)
  await deleteProject(projectId)

  res.json({ deleted: true, projectId })
})
