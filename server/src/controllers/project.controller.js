import crypto from 'node:crypto'
import { isDatabaseConnected } from '../config/db.js'
import { createProject, listProjectsByOwner } from '../models/project.repository.js'
import ApiError from '../utils/ApiError.js'
import asyncHandler from '../utils/asyncHandler.js'
import { createWorkspaceFolder } from '../utils/workspaceManager.js'

function toPublicProject(project) {
  return {
    id: project.projectId,
    name: project.name,
    diskPath: project.diskPath,
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
  const diskPath = createWorkspaceFolder(projectId)

  const project = await createProject({
    projectId,
    name: requestedName,
    owner: req.user.id,
    diskPath,
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
