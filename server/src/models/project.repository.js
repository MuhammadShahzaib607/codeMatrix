import { isDatabaseConnected } from '../config/db.js'
import Project from './Project.model.js'

/**
 * Metadata helpers. Every one of them degrades to a no-op when MongoDB is not
 * configured, so a database outage never breaks file operations.
 */

export async function upsertProject({ projectId, name, owner, diskPath }) {
  if (!isDatabaseConnected()) return null
  try {
    return await Project.findOneAndUpdate(
      { projectId },
      {
        $set: {
          name: name || 'Untitled Project',
          owner,
          diskPath,
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

export async function findProject(projectId) {
  if (!isDatabaseConnected()) return null
  try {
    return await Project.findOne({ projectId }).lean()
  } catch (error) {
    console.warn(`[project] could not load ${projectId}: ${error.message}`)
    return null
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
