import fs from 'node:fs'
import path from 'node:path'
import { listAllProjects, updateProjectDiskInfo } from '../models/project.repository.js'
import {
  resolveExistingWorkspaceFolder,
  sanitizeFolderName,
  setWorkspaceRecord,
  workspaceFolderPath,
  workspaceOwnerKey,
} from './workspaceManager.js'

/**
 * One-time, idempotent folder migration for workspaces created before project
 * folders were named after the project's DISPLAY name.
 *
 * Older workspaces live at server/workspaces/<projectId> (a raw UUID). This
 * walks every Project record, works out the folder name it SHOULD have
 * ("shahzaib.art", or "shahzaib.art-2" only on a genuine same-container clash),
 * renames the folder on disk with fs.renameSync and updates both the on-disk
 * registry and the MongoDB record (diskPath + diskFolderName).
 *
 * It is safe to run on every boot: projects already at the right path are left
 * alone (their registry/DB rows are simply made consistent) and projects whose
 * folder is gone (ephemeral free-tier disk) are skipped.
 */
export async function migrateWorkspaceFolders() {
  const projects = await listAllProjects()
  if (projects.length === 0) return { migrated: 0, checked: 0 }

  // Most-recently-used first, so when several projects share a display name the
  // one the user is actually working in keeps the plain name and the duplicates
  // get "-2", "-3", ….
  const ordered = [...projects].sort((a, b) => {
    const at = new Date(a.lastAccessedAt || a.createdAt || 0).getTime()
    const bt = new Date(b.lastAccessedAt || b.createdAt || 0).getTime()
    if (at !== bt) return bt - at
    return String(a.projectId).localeCompare(String(b.projectId))
  })

  const reserved = new Set()
  const plans = []

  for (const project of ordered) {
    const projectId = project.projectId
    const current = resolveExistingWorkspaceFolder(projectId)
    // Nothing on disk -> nothing to rename (the free tier wipes workspaces).
    if (!current) continue

    const container = workspaceOwnerKey(project.owner)
    const base = sanitizeFolderName(project.name)
    const key = (candidate) => `${container}\u0000${candidate.toLowerCase()}`

    const isFree = (candidate) => {
      if (reserved.has(key(candidate))) return false
      const candidatePath = workspaceFolderPath(container, candidate)
      if (!fs.existsSync(candidatePath)) return true
      // An existing folder of that name is fine only when it is this project's
      // own current folder.
      return path.resolve(candidatePath) === path.resolve(current.path)
    }

    let name = base
    let counter = 2
    while (!isFree(name)) {
      name = `${base}-${counter}`
      counter += 1
    }
    reserved.add(key(name))

    plans.push({ projectId, container, name, current })
  }

  let migrated = 0

  for (const plan of plans) {
    const desiredPath = workspaceFolderPath(plan.container, plan.name)

    if (path.resolve(desiredPath) === path.resolve(plan.current.path)) {
      // Already correct — just keep the registry and DB in step.
      setWorkspaceRecord(plan.projectId, { container: plan.container, folderName: plan.name })
      await updateProjectDiskInfo(plan.projectId, {
        diskPath: desiredPath,
        diskFolderName: plan.name,
      })
      continue
    }

    try {
      fs.mkdirSync(path.dirname(desiredPath), { recursive: true })
      if (fs.existsSync(desiredPath)) {
        // Planning should have prevented this; never clobber an existing folder.
        console.warn(
          `[workspace] migration skipped ${plan.projectId}: ${desiredPath} already exists`,
        )
        continue
      }

      fs.renameSync(plan.current.path, desiredPath)
      setWorkspaceRecord(plan.projectId, {
        container: plan.container,
        folderName: plan.name,
        ensure: false,
      })
      await updateProjectDiskInfo(plan.projectId, {
        diskPath: desiredPath,
        diskFolderName: plan.name,
      })

      migrated += 1
      const from = plan.current.container
        ? `${plan.current.container}/${plan.current.folderName}`
        : plan.current.folderName
      console.log(`[workspace] renamed ${from} -> ${plan.container}/${plan.name}`)
    } catch (error) {
      console.warn(`[workspace] could not migrate ${plan.projectId}: ${error.message}`)
    }
  }

  return { migrated, checked: plans.length }
}
