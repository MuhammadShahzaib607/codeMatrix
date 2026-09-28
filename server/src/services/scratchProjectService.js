import crypto from 'node:crypto'
import { isDatabaseConnected } from '../config/db.js'
import { findProject, upsertProject } from '../models/project.repository.js'
import { restartWatching } from '../utils/fileWatcher.js'
import { slugifyProjectName } from './agentService.js'
import { fallbackProjectName } from './agentFrameworks.js'
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
 * one, otherwise the name the folder ALREADY carries (a run that opened the
 * workspace with its final name — see POST /api/workspace/scratch?task=),
 * otherwise a deterministic slug derived from the user's ORIGINAL TASK text.
 * Both name sources go through slugifyProjectName, so a model answering with
 * junk ("PROJECT_NAME: project") silently falls back instead of producing a bad
 * folder name. The result is that a workspace an agent has worked in is never
 * left called "Scratch"/"scratch-<id>".
 *
 * The rename itself is a TRUE top-level folder rename (fs.renameSync inside
 * renameWorkspaceFolder): the folder keeps every file's relative position, so
 * nothing is copied into a nested subfolder and no path becomes stale.
 */

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

  // Target name: the model's suggestion when usable, else the name already on
  // disk, else a safe framework-based name.
  const name =
    suggested ??
    (anonymous ? chooseScratchProjectName({ modelSuggestedName: null, framework }) : record.folderName)

  // A real rename happens only when the folder is still anonymous, or when the
  // model explicitly proposed a name that differs from the one on disk.
  const folder = renameWorkspaceFolder(projectId, { displayName: name })
  if (!folder) return null

  const renamed = folder.folderName !== record.folderName
  const finalName = folder.folderName

  // The watcher may already be attached to the OLD folder name (the client
  // subscribes as soon as the workspace opens): move it, or the Explorer's
  // auto-refresh and the preview's live reload would go silent for the rest of
  // the run.
  if (renamed) restartWatching(projectId)

  // Transition the Project record only when it is actually out of date — an
  // already-adopted workspace short-circuits here, which is what keeps repeated
  // calls (first message + finally) from re-emitting feed rows.
  const needsRecord = anonymous || renamed || Boolean(project && (project.isScratch || project.name !== finalName))
  const adopted = anonymous || renamed || Boolean(project && project.isScratch)

  if (needsRecord && isDatabaseConnected()) {
    await upsertProject({
      projectId,
      name: finalName,
      owner: userId,
      diskPath: folder.path,
      diskFolderName: folder.folderName,
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

  return { projectId, name: finalName, adopted }
}
