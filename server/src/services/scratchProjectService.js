import crypto from 'node:crypto'
import { isDatabaseConnected } from '../config/db.js'
import { findProject, upsertProject } from '../models/project.repository.js'
import { deriveProjectName, slugifyProjectName } from './agentService.js'
import {
  ensureScratchWorkspace,
  getWorkspaceRecord,
  isScratchFolderName,
  isScratchProjectId,
  renameWorkspaceFolder,
} from '../utils/workspaceManager.js'

/**
 * Turning an anonymous scratch workspace into a real, NAMED project.
 *
 * The name is chosen as: the MODEL's suggested name when it provided a usable
 * one, otherwise a deterministic name derived from the user's ORIGINAL TASK
 * text. Both go through slugifyProjectName, so a model answering with junk
 * ("PROJECT_NAME: project") silently falls back instead of producing a bad
 * folder name. The result is that a workspace an agent has worked in is never
 * left called "Scratch"/"scratch-<id>".
 */

/** The name to give an adopted workspace: model suggestion first, task second. */
export function chooseScratchProjectName({ modelSuggestedName, task }) {
  return slugifyProjectName(modelSuggestedName) || deriveProjectName(task)
}

/**
 * Renames the scratch folder on disk and records it as a real project.
 *
 * Idempotent: once the workspace has a real name (folder no longer "Scratch*",
 * or its Project record's isScratch flag is false) this returns immediately and
 * does not rename again. Call it with the model's suggestion as soon as the
 * agent's first message arrives, and again with no suggestion as a safety net
 * when a run fails before the model speaks.
 *
 * The projectId is deliberately UNCHANGED: every path the agent's tools resolve
 * goes through the registry, so a mid-run rename does not move the files'
 * logical location.
 */
export async function adoptScratchProject({
  projectId,
  task,
  userId,
  emit = null,
  modelSuggestedName = null,
}) {
  if (!isScratchProjectId(projectId)) return null

  const record = getWorkspaceRecord(projectId)
  const project = isDatabaseConnected() ? await findProject(projectId) : null
  const alreadyNamed =
    (project && project.isScratch === false) ||
    (record && !isScratchFolderName(record.folderName))

  if (alreadyNamed) {
    return {
      projectId,
      name: project?.name || record?.folderName || 'Project',
      adopted: false,
    }
  }

  const name = chooseScratchProjectName({ modelSuggestedName, task })

  // A scratch opened before this logic existed may only have a legacy on-disk
  // folder, with no registry entry — make sure one exists before renaming.
  if (!record) ensureScratchWorkspace(projectId)

  const folder = renameWorkspaceFolder(projectId, { displayName: name })
  if (!folder) return null

  if (isDatabaseConnected()) {
    await upsertProject({
      projectId,
      name,
      owner: userId,
      diskPath: folder.path,
      diskFolderName: folder.folderName,
      isScratch: false,
    })
  }

  if (typeof emit === 'function') {
    emit({
      type: 'project',
      description: modelSuggestedName
        ? `Named this project “${name}” from the agent's suggestion.`
        : `Named this workspace “${name}” from your task.`,
      details: { status: 'done', projectId, name, tool: 'project', renamed: true },
      actionId: crypto.randomUUID(),
      at: Date.now(),
    })
  }

  return { projectId, name, adopted: true }
}
