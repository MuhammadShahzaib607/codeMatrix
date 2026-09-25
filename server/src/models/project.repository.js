import { isDatabaseConnected } from '../config/db.js'
import Project from './Project.model.js'

export async function upsertProject({ projectId, name, owner, diskPath, diskFolderName }) {
  if (!isDatabaseConnected()) return null
  try {
    return await Project.findOneAndUpdate(
      { projectId },
      {
        $set: {
          name: name || 'Untitled Project',
          owner,
          diskPath,
          ...(diskFolderName ? { diskFolderName } : {}),
          lastAccessedAt: new Date(),
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean()
  } catch (error) {
    console.warn(`[project] could not upsert ${projectId}: ${error.message}`)
    return null
  }
}

export async function createProject({ projectId, name, owner, diskPath, diskFolderName }) {
  if (!isDatabaseConnected()) return null
  try {
    const project = await Project.create({
      projectId,
      name: name || 'Untitled Project',
      owner,
      diskPath,
      diskFolderName: diskFolderName || '',
      lastAccessedAt: new Date(),
    })
    return project.toObject()
  } catch (error) {
    console.warn(`[project] could not create ${projectId}: ${error.message}`)
    return null
  }
}

export async function findProject(projectId) {
  if (!isDatabaseConnected()) return null
  try {
    return await Project.findOne({ projectId }).lean()
  } catch (error) {
    console.warn(`[project] could not load ${projectId}: ${error.message}`)
    return null
  }
}

export async function listProjectsByOwner(owner) {
  if (!isDatabaseConnected()) return []
  try {
    return await Project.find({ owner }).sort({ lastAccessedAt: -1 }).lean()
  } catch (error) {
    console.warn(`[project] could not list projects: ${error.message}`)
    return []
  }
}

export async function touchProject(projectId) {
  if (!isDatabaseConnected()) return null
  try {
    return await Project.findOneAndUpdate(
      { projectId },
      { $set: { lastAccessedAt: new Date() } },
      { new: true },
    ).lean()
  } catch (error) {
    console.warn(`[project] could not touch ${projectId}: ${error.message}`)
    return null
  }
}
