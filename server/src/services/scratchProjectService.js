import crypto from 'node:crypto'
import fs from 'node:fs'
import { isDatabaseConnected } from '../config/db.js'
import { findProject, upsertProject } from '../models/project.repository.js'
import { slugifyProjectName } from './agentService.js'
import { fallbackProjectName } from './agentFrameworks.js'
import {
  ensureScratchWorkspace,
  getWorkspaceRecord,
  isScratchFolderName,
  isScratchProjectId,
  renameWorkspaceFolder,
  workspaceFolderPath,
} from '../utils/workspaceManager.js'

const fsp = fs.promises

/**
 * Turning an anonymous scratch workspace into a real, NAMED project.
 *
 * The name is chosen as: the MODEL's suggested name when it provided a usable
 * one, otherwise the name the folder ALREADY carries (a run that opened the
 * workspace with its final name — see POST /api/workspace/scratch?task=),
 * otherwise a deterministic slug derived from the user's ORIGINAL TASK text.
 * Both name sources go through slugifyProjectName, so a model answering with
 * junk ("PROJECT_NAME: project") silently falls back instead of producing a bad
 * folder name. The result is that a workspace an agent has worked in is never
 * left called "Scratch"/"scratch-<id>".
 */

async function folderIsEmpty(folderPath) {
  try {
    const entries = await fsp.readdir(folderPath)
    return entries.length === 0
  } catch {
    return false
  }
}

/**
 * The name to give an adopted workspace: an AI-generated suggestion when there
 * is one, otherwise a safe name based on the selected framework. Prompt words
 * are NEVER used as a project name.
 */
export function chooseScratchProjectName({ modelSuggestedName, framework = null }) {
  return slugifyProjectName(modelSuggestedName) || fallbackProjectName(framework)
}

/**
 * Gives the workspace its real name and records it as a real project.
 *
 * Idempotent: when the folder is already named AND the model did not propose a
 * DIFFERENT name AND the Project record already says isScratch: false, nothing
 * is renamed, nothing is written and nothing is emitted — the call is a no-op
 * returning { adopted: false }. That is what makes it safe to call it before
 * the run, on the model's first message, and again as a safety net.
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
  framework = null,
  fresh = true,
}) {
  if (!isScratchProjectId(projectId)) return null

  // A scratch opened before this logic existed may only have a legacy on-disk
  // folder, with no registry entry — make sure one exists before renaming.
  if (!getWorkspaceRecord(projectId)) ensureScratchWorkspace(projectId)
  const record = getWorkspaceRecord(projectId)
  if (!record) return null

  const project = isDatabaseConnected() ? await findProject(projectId) : null
  const anonymous = isScratchFolderName(record.folderName)
  const suggested = slugifyProjectName(modelSuggestedName)
  const currentPath = workspaceFolderPath(record.container, record.folderName)

  const recordStale = (name) =>
    Boolean(project && (project.isScratch || project.name !== name || project.diskFolderName !== name))

  const empty = await folderIsEmpty(currentPath)
  const mayRename = empty && (fresh || anonymous)

  if (!mayRename) {
    if (recordStale(record.folderName) && isDatabaseConnected()) {
      await upsertProject({
        projectId,
        name: record.folderName,
        owner: userId,
        diskPath: currentPath,
        diskFolderName: record.folderName,
        isScratch: anonymous,
      })
      if (typeof emit === 'function') {
        emit({
          type: 'project',
          description: anonymous
            ? `Working in scratch workspace “${record.folderName}”.`
            : `Working in project “${record.folderName}”.`,
          details: {
            status: 'done',
            projectId,
            name: record.folderName,
            tool: 'project',
            renamed: false,
          },
          actionId: crypto.randomUUID(),
          at: Date.now(),
        })
      }
    }
    return { projectId, name: record.folderName, adopted: !anonymous, renamed: false }
  }

  const name =
    suggested ??
    (anonymous ? chooseScratchProjectName({ modelSuggestedName: null, framework }) : record.folderName)

  let folder = { container: record.container, folderName: record.folderName, path: currentPath }
  let renamed = false
  try {
    const moved = await renameWorkspaceFolder(projectId, { displayName: name })
    if (moved) {
      folder = moved
      renamed = folder.folderName !== record.folderName
    }
  } catch (error) {
    console.warn(
      `[agent] workspace rename failed for ${projectId}: ${error?.code ? `${error.code} ` : ''}` +
        `${error?.message ?? error} — keeping folder "${record.folderName}"`,
    )
    return { projectId, name: record.folderName, adopted: false, renamed: false }
  }

  const finalName = folder.folderName
  const needsRecord = anonymous || renamed || recordStale(finalName)
  const adopted = anonymous || renamed || Boolean(project && project.isScratch)

  if (needsRecord && isDatabaseConnected()) {
    await upsertProject({
      projectId,
      name: finalName,
      owner: userId,
      diskPath: folder.path,
      diskFolderName: finalName,
      isScratch: false,
    })
  }

  if (adopted && typeof emit === 'function') {
    const fromModel = Boolean(suggested) && renamed
    emit({
      type: 'project',
      description: renamed
        ? fromModel
          ? `Named this project “${finalName}” from the agent's suggestion.`
          : `Named this workspace “${finalName}” from your task.`
        : `Working in project “${finalName}”.`,
      details: { status: 'done', projectId, name: finalName, tool: 'project', renamed },
      actionId: crypto.randomUUID(),
      at: Date.now(),
    })
  }

  return { projectId, name: finalName, adopted, renamed }
}
