import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from '../config/env.js'
import ApiError from './ApiError.js'

const here = path.dirname(fileURLToPath(import.meta.url))

export const SERVER_ROOT = path.resolve(here, '..', '..')

export const WORKSPACES_ROOT = env.workspacesRoot
  ? path.resolve(env.workspacesRoot)
  : path.join(SERVER_ROOT, 'workspaces')

const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

// Scratch workspaces ("scratch-<userId>") are throwaway folders used as the
// cwd for terminals opened without an imported project. They are created
// on demand and never registered in MongoDB.
const SCRATCH_ID_PATTERN = /^scratch-[A-Za-z0-9_-]{1,100}$/

// ---------------------------------------------------------------------------
// On-disk workspace registry
// ---------------------------------------------------------------------------
// A project's folder on disk is named after its DISPLAY name (sanitized, plus a
// short unique suffix) instead of its internal projectId, so the folder is
// something a user can actually `cd` into from the terminal. The mapping
//
//     projectId -> { container, folderName }
//
// is kept in a small JSON file next to the folders, so every path builder below
// can resolve the real folder from a projectId alone. MongoDB's `diskFolderName`
// is the durable copy of the same value. Every path here is built with path.join
// / path.resolve — never string concatenation — so it behaves identically on
// Linux (production) and Windows (dev).
const REGISTRY_FILE_NAME = '.workspaces.json'
const FOLDER_NAME_MAX_LENGTH = 48
const OWNER_CONTAINER_PREFIX = 'u-'

let registryCache = null

function registryFilePath() {
  return path.join(WORKSPACES_ROOT, REGISTRY_FILE_NAME)
}

function loadRegistry() {
  if (registryCache) return registryCache
  try {
    const parsed = JSON.parse(fs.readFileSync(registryFilePath(), 'utf8'))
    registryCache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    // A missing or unreadable registry just means "nothing registered yet".
    registryCache = {}
  }
  return registryCache
}

function saveRegistry(registry) {
  registryCache = registry
  try {
    fs.mkdirSync(WORKSPACES_ROOT, { recursive: true })
    fs.writeFileSync(registryFilePath(), JSON.stringify(registry, null, 2), 'utf8')
  } catch (error) {
    console.warn(`[workspace] could not persist the workspace registry: ${error.message}`)
  }
}

// Only these characters are genuinely unsafe in a folder name (illegal on
// Windows, awkward elsewhere). Everything else — dots, spaces, case, unicode —
// is KEPT, so the on-disk folder stays as close as possible to the name the
// Explorer shows. That is what makes `cd shahzaib.art` just work.
const UNSAFE_FOLDER_CHARS = /[/\\:*?"<>|\u0000-\u001F]/g
// Windows reserves these device names (with or without an extension).
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

/** Turns a human display name into a filesystem-safe folder name. */
export function sanitizeFolderName(displayName) {
  let name = String(displayName ?? '')
    .replace(UNSAFE_FOLDER_CHARS, '-')
    .replace(/\s+/g, ' ')
    .trim()

  // Windows cannot store a name that starts or ends with a dot or a space.
  name = name.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '')

  if (name.length > FOLDER_NAME_MAX_LENGTH) {
    name = name.slice(0, FOLDER_NAME_MAX_LENGTH).replace(/[.\s]+$/, '')
  }

  if (!name) name = 'project'
  if (WINDOWS_RESERVED_NAMES.test(name)) name = `${name}-project`
  return name
}

/** Deterministic per-user container folder, e.g. "u-507f1f77bcf86cd799439011". */
export function workspaceOwnerKey(ownerId) {
  const cleaned = String(ownerId ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
  return cleaned
    ? `${OWNER_CONTAINER_PREFIX}${cleaned.slice(0, 24)}`
    : `${OWNER_CONTAINER_PREFIX}guest`
}

/** Absolute path of the per-user container that holds a user's projects. */
export function getOwnerContainerPath(ownerId) {
  return path.join(WORKSPACES_ROOT, workspaceOwnerKey(ownerId))
}

function folderPathFor(container, folderName) {
  return container
    ? path.join(WORKSPACES_ROOT, container, folderName)
    : path.join(WORKSPACES_ROOT, folderName)
}

/** Absolute path of a folder inside a container (or at the workspaces root). */
export function workspaceFolderPath(container, folderName) {
  return folderPathFor(container, folderName)
}

/**
 * Picks the folder name for a project: the sanitized DISPLAY NAME itself when it
 * is free (e.g. "shahzaib.art"), and only a "-2", "-3", … suffix when that name
 * is genuinely already taken in the same container. A name is taken when the
 * registry maps it to a different project, or a folder of that name already
 * exists on disk and is not this project's own current folder.
 */
function availableFolderName(registry, projectId, container, base, ownCurrent = null) {
  const isOwnCurrent = (candidate) =>
    ownCurrent != null &&
    ownCurrent.container === container &&
    ownCurrent.folderName === candidate

  const taken = (candidate) => {
    if (
      Object.entries(registry).some(
        ([id, record]) =>
          id !== projectId && record?.container === container && record?.folderName === candidate,
      )
    ) {
      return true
    }
    if (isOwnCurrent(candidate)) return false
    return fs.existsSync(folderPathFor(container, candidate))
  }

  if (!taken(base)) return base
  let counter = 2
  while (taken(`${base}-${counter}`)) counter += 1
  return `${base}-${counter}`
}

/** The registered disk location for a workspace, or null when unknown. */
export function getWorkspaceRecord(projectId) {
  if (typeof projectId !== 'string') return null
  const record = loadRegistry()[projectId]
  if (!record || typeof record !== 'object') return null
  if (typeof record.folderName !== 'string' || !record.folderName) return null
  return {
    container: typeof record.container === 'string' ? record.container : '',
    folderName: record.folderName,
  }
}

/**
 * Creates (or re-uses) the on-disk folder for a workspace and records its name.
 * Idempotent: calling it again for the same projectId keeps the existing folder.
 * Returns { container, folderName, path }.
 */
export function registerWorkspaceFolder(projectId, options = {}) {
  const {
    ownerId = null,
    displayName = null,
    container: explicitContainer = null,
    folderName: explicitFolderName = null,
  } = options
  const registry = loadRegistry()

  const existing = getWorkspaceRecord(projectId)
  if (existing) {
    const existingPath = folderPathFor(existing.container, existing.folderName)
    fs.mkdirSync(existingPath, { recursive: true })
    return { ...existing, path: existingPath }
  }

  const container = explicitContainer ?? (ownerId ? workspaceOwnerKey(ownerId) : '')
  const folderName =
    explicitFolderName ??
    availableFolderName(registry, projectId, container, sanitizeFolderName(displayName))
  const folderPath = folderPathFor(container, folderName)
  fs.mkdirSync(folderPath, { recursive: true })

  registry[projectId] = { container, folderName }
  saveRegistry(registry)

  return { container, folderName, path: folderPath }
}

/**
 * Writes (or rewrites) a registry entry without going through the naming logic.
 * Used by the startup migration, which has already chosen the final name.
 */
export function setWorkspaceRecord(projectId, { container = '', folderName, ensure = true } = {}) {
  if (!folderName) return null
  const registry = loadRegistry()
  registry[projectId] = { container, folderName }
  saveRegistry(registry)
  if (ensure) fs.mkdirSync(folderPathFor(container, folderName), { recursive: true })
  return { container, folderName }
}

/**
 * The workspace folder that actually exists for a project right now, whether it
 * is registry-based or a legacy folder named after the projectId. Returns
 * { container, folderName, path } or null.
 */
export function resolveExistingWorkspaceFolder(projectId) {
  if (typeof projectId !== 'string') return null

  const record = getWorkspaceRecord(projectId)
  if (record) {
    const recordPath = folderPathFor(record.container, record.folderName)
    if (fs.existsSync(recordPath)) return { ...record, path: recordPath }
  }

  const legacyPath = path.join(WORKSPACES_ROOT, projectId)
  if (fs.existsSync(legacyPath)) {
    return { container: '', folderName: projectId, path: legacyPath }
  }

  return null
}

/**
 * Rebuilds a registry entry from the absolute `diskPath` stored in MongoDB. This
 * is the safety net for the case where the registry file is missing/cleared but
 * the folder (and its Project document) survived — without it, `diskFolderName`
 * in MongoDB would be write-only metadata.
 */
export function registerWorkspaceFromDiskPath(projectId, diskPath) {
  const existing = getWorkspaceRecord(projectId)
  if (existing) return existing
  if (typeof diskPath !== 'string' || !diskPath.trim()) return null

  const relative = path.relative(WORKSPACES_ROOT, path.resolve(diskPath))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null

  const segments = relative.split(path.sep).filter(Boolean)
  // Either "<folderName>" (legacy) or "<container>/<folderName>".
  if (segments.length === 0 || segments.length > 2) return null

  const container = segments.length === 2 ? segments[0] : ''
  const folderName = segments[segments.length - 1]
  return setWorkspaceRecord(projectId, { container, folderName })
}

export const WORKSPACE_MISSING_MESSAGE =
  'This workspace is no longer on the server. It was most likely cleared when the ' +
  'server restarted (free tier). Re-import your project from a local backup.'

export function isValidProjectId(projectId) {
  return typeof projectId === 'string' && PROJECT_ID_PATTERN.test(projectId)
}

export function isScratchProjectId(projectId) {
  return typeof projectId === 'string' && SCRATCH_ID_PATTERN.test(projectId)
}

export function ensureScratchWorkspace(projectId) {
  if (!isScratchProjectId(projectId)) {
    throw new ApiError(400, 'Not a scratch workspace id.', 'INVALID_PROJECT_ID')
  }

  const existing = getWorkspaceRecord(projectId)
  if (existing) {
    const folderPath = folderPathFor(existing.container, existing.folderName)
    fs.mkdirSync(folderPath, { recursive: true })
    return folderPath
  }

  // "scratch-<userId>" lives in the SAME per-user container a real project of
  // that user would use, so the terminal (which starts at the container) shows
  // both side by side as enterable subfolders.
  const ownerId = projectId.replace(/^scratch-/, '')
  return registerWorkspaceFolder(projectId, { ownerId, displayName: 'Scratch' }).path
}

export function assertValidProjectId(projectId) {
  if (!isValidProjectId(projectId)) {
    throw new ApiError(
      400,
      'Invalid project id. Use letters, numbers, dashes or underscores (max 128 characters).',
      'INVALID_PROJECT_ID',
    )
  }
}

function resolveInsideWorkspace(projectId, relativePath = '') {
  const root = getWorkspacePath(projectId)
  const cleaned = String(relativePath ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
  const absolute = path.resolve(root, cleaned)
  const relative = path.relative(root, absolute)

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ApiError(400, `Path "${relativePath}" is outside of the workspace.`, 'INVALID_PATH')
  }

  return { root, absolute, relative: relative.split(path.sep).join('/') }
}

export function getWorkspacePath(projectId) {
  assertValidProjectId(projectId)
  const record = getWorkspaceRecord(projectId)
  if (record) return folderPathFor(record.container, record.folderName)
  // Legacy / unregistered workspace: the folder is named after the projectId.
  return path.join(WORKSPACES_ROOT, projectId)
}

/**
 * Where a terminal for this workspace starts: ONE LEVEL ABOVE the project
 * folder, so the project shows up as a real, enterable subfolder of the
 * terminal's start directory (matching the Explorer's root node). For a
 * registered workspace that is the per-user container; for an unregistered or
 * legacy workspace it is the workspaces root.
 */
export function getTerminalRootPath(projectId) {
  assertValidProjectId(projectId)
  const record = getWorkspaceRecord(projectId)
  const root = record?.container
    ? path.join(WORKSPACES_ROOT, record.container)
    : WORKSPACES_ROOT
  fs.mkdirSync(root, { recursive: true })
  return root
}

export function workspaceExists(projectId) {
  if (!isValidProjectId(projectId)) return false
  try {
    return fs.statSync(getWorkspacePath(projectId)).isDirectory()
  } catch {
    return false
  }
}

export function assertWorkspaceExists(projectId) {
  assertValidProjectId(projectId)
  if (!workspaceExists(projectId)) {
    throw new ApiError(404, WORKSPACE_MISSING_MESSAGE, 'WORKSPACE_MISSING')
  }
}

/**
 * Creates the project's on-disk folder, named after its display name. Pass
 * { ownerId, displayName } so the folder can be named and placed in the owner's
 * container. Returns { container, folderName, path }.
 */
export function createWorkspaceFolder(projectId, options = {}) {
  assertValidProjectId(projectId)
  return registerWorkspaceFolder(projectId, options)
}

export function deleteWorkspaceFolder(projectId) {
  assertValidProjectId(projectId)
  const directory = getWorkspacePath(projectId)
  if (!fs.existsSync(directory)) return false
  fs.rmSync(directory, { recursive: true, force: true })
  // Drop the registry entry too, so a later re-create gets a clean mapping.
  const registry = loadRegistry()
  if (registry[projectId]) {
    delete registry[projectId]
    saveRegistry(registry)
  }
  return true
}

export function writeFileToWorkspace(projectId, relativeFilePath, content = '') {
  assertWorkspaceExists(projectId)
  const { absolute, relative } = resolveInsideWorkspace(projectId, relativeFilePath)
  if (!relative) throw new ApiError(400, 'A file path is required.', 'INVALID_PATH')

  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, typeof content === 'string' ? content : String(content ?? ''), 'utf8')
  return relative
}

export function readFileFromWorkspace(projectId, relativeFilePath) {
  assertWorkspaceExists(projectId)
  const { absolute, relative } = resolveInsideWorkspace(projectId, relativeFilePath)
  if (!relative) throw new ApiError(400, 'A file path is required.', 'INVALID_PATH')

  if (!fs.existsSync(absolute)) {
    throw new ApiError(404, `"${relative}" was not found in this workspace.`, 'FILE_MISSING')
  }
  if (fs.statSync(absolute).isDirectory()) {
    throw new ApiError(400, `"${relative}" is a folder, not a file.`, 'NOT_A_FILE')
  }

  return fs.readFileSync(absolute, 'utf8')
}

export function createFolderInWorkspace(projectId, relativeFolderPath) {
  assertWorkspaceExists(projectId)
  const { absolute, relative } = resolveInsideWorkspace(projectId, relativeFolderPath)
  if (!relative) throw new ApiError(400, 'A folder path is required.', 'INVALID_PATH')
  if (fs.existsSync(absolute)) {
    throw new ApiError(409, `"${relative}" already exists.`, 'ALREADY_EXISTS')
  }
  fs.mkdirSync(absolute, { recursive: true })
  return relative
}

export function deleteFromWorkspace(projectId, relativeFilePath) {
  assertWorkspaceExists(projectId)
  const { absolute, relative } = resolveInsideWorkspace(projectId, relativeFilePath)
  if (!relative) throw new ApiError(400, 'The workspace root cannot be deleted.', 'INVALID_PATH')

  if (!fs.existsSync(absolute)) {
    throw new ApiError(404, `"${relative}" was not found in this workspace.`, 'FILE_MISSING')
  }

  if (fs.statSync(absolute).isDirectory()) {
    fs.rmSync(absolute, { recursive: true, force: true })
  } else {
    fs.unlinkSync(absolute)
  }
  return relative
}

export function renamePathInWorkspace(projectId, oldRelativePath, newRelativePath) {
  assertWorkspaceExists(projectId)
  const from = resolveInsideWorkspace(projectId, oldRelativePath)
  const to = resolveInsideWorkspace(projectId, newRelativePath)

  if (!from.relative || !to.relative) {
    throw new ApiError(400, 'Both the source and destination paths are required.', 'INVALID_PATH')
  }
  if (!fs.existsSync(from.absolute)) {
    throw new ApiError(404, `"${from.relative}" was not found in this workspace.`, 'FILE_MISSING')
  }
  // Moving a folder into itself (or into one of its own descendants) would make
  // fs.renameSync fail with an opaque EINVAL, so reject it up front. This is the
  // cut -> paste-into-itself case.
  if (
    fs.statSync(from.absolute).isDirectory() &&
    (to.relative === from.relative || to.relative.startsWith(`${from.relative}/`))
  ) {
    throw new ApiError(
      400,
      `Cannot move "${from.relative}" into itself or one of its own folders.`,
      'INVALID_PATH',
    )
  }
  if (fs.existsSync(to.absolute)) {
    throw new ApiError(409, `"${to.relative}" already exists.`, 'ALREADY_EXISTS')
  }

  fs.mkdirSync(path.dirname(to.absolute), { recursive: true })
  fs.renameSync(from.absolute, to.absolute)
  return { oldPath: from.relative, newPath: to.relative }
}

function copyDirectoryRecursive(fromAbsolute, toAbsolute) {
  fs.mkdirSync(toAbsolute, { recursive: true })
  for (const entry of fs.readdirSync(fromAbsolute, { withFileTypes: true })) {
    const childFrom = path.join(fromAbsolute, entry.name)
    const childTo = path.join(toAbsolute, entry.name)
    if (entry.isDirectory()) copyDirectoryRecursive(childFrom, childTo)
    else if (entry.isFile()) fs.copyFileSync(childFrom, childTo)
  }
}

/**
 * Picks a name inside `folderAbsolute` that does not collide with an existing
 * entry: the original name if free, else "<base> (copy)<ext>", then
 * "<base> (copy 2)<ext>", "<base> (copy 3)<ext>", … A copy therefore never
 * overwrites and never fails — duplicating an item into a folder that already
 * has one of that name just produces "a (copy).txt".
 */
function uniqueNameInFolder(folderAbsolute, name) {
  if (!fs.existsSync(path.join(folderAbsolute, name))) return name
  const { name: base, ext } = path.parse(name)
  let counter = 1
  let candidate = `${base} (copy)${ext}`
  while (fs.existsSync(path.join(folderAbsolute, candidate))) {
    counter += 1
    candidate = `${base} (copy ${counter})${ext}`
  }
  return candidate
}

/**
 * Duplicates a file or folder into `targetFolderRelativePath` ('' = workspace
 * root), keeping the original name. Used by the Explorer's context-menu Copy ->
 * Paste. Folders are copied recursively.
 *
 * If the target folder already holds an item of that name, the copy is given a
 * de-duplicated " (copy)" name rather than failing with a conflict.
 */
export function copyPathInWorkspace(projectId, sourceRelativePath, targetFolderRelativePath = '') {
  assertWorkspaceExists(projectId)
  const source = resolveInsideWorkspace(projectId, sourceRelativePath)
  const targetFolder = resolveInsideWorkspace(projectId, targetFolderRelativePath)

  if (!source.relative) {
    throw new ApiError(400, 'A source path is required.', 'INVALID_PATH')
  }
  if (!fs.existsSync(source.absolute)) {
    throw new ApiError(404, `"${source.relative}" was not found in this workspace.`, 'FILE_MISSING')
  }

  const sourceIsDirectory = fs.statSync(source.absolute).isDirectory()
  if (
    sourceIsDirectory &&
    (targetFolder.relative === source.relative ||
      targetFolder.relative.startsWith(`${source.relative}/`))
  ) {
    throw new ApiError(
      400,
      `Cannot copy "${source.relative}" into itself or one of its own folders.`,
      'INVALID_PATH',
    )
  }

  if (fs.existsSync(targetFolder.absolute) && !fs.statSync(targetFolder.absolute).isDirectory()) {
    throw new ApiError(
      400,
      `"${targetFolder.relative}" is not a folder.`,
      'NOT_A_FOLDER',
    )
  }

  const name = uniqueNameInFolder(targetFolder.absolute, path.basename(source.absolute))
  const destinationAbsolute = path.join(targetFolder.absolute, name)

  fs.mkdirSync(targetFolder.absolute, { recursive: true })
  if (sourceIsDirectory) copyDirectoryRecursive(source.absolute, destinationAbsolute)
  else fs.copyFileSync(source.absolute, destinationAbsolute)

  const newPath = path
    .relative(getWorkspacePath(projectId), destinationAbsolute)
    .split(path.sep)
    .join('/')
  return { sourcePath: source.relative, newPath }
}

function sortChildren(children) {
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return children
}

/**
 * Walks a workspace folder for the Explorer tree. This is a DISPLAY concern and
 * therefore has ZERO filtering: every file and folder that exists on disk
 * (node_modules, .git, dist, build, …) is returned exactly as it is. Import-time
 * exclusion is a separate concern that lives ONLY in the client's
 * services/fileSystemAccess.js (SKIP_DIRECTORIES), so folders created later by
 * the terminal are never hidden here.
 */
function walkDirectory(directory, rootName, relativePath) {
  const children = []

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const childRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      children.push(walkDirectory(path.join(directory, entry.name), rootName, childRelative))
    } else if (entry.isFile()) {
      children.push({ name: entry.name, type: 'file', path: childRelative })
    }
  }

  return {
    name: relativePath ? path.basename(directory) : rootName,
    type: 'folder',
    path: relativePath,
    children: sortChildren(children),
  }
}

export function getWorkspaceTree(projectId, options = {}) {
  assertWorkspaceExists(projectId)
  const root = getWorkspacePath(projectId)
  const rootName = options.name || path.basename(root)
  return walkDirectory(root, rootName, '')
}

export function flattenTree(node, files = []) {
  if (!node) return files
  if (node.type === 'file') {
    files.push({ name: node.name, path: node.path })
    return files
  }
  for (const child of node.children ?? []) flattenTree(child, files)
  return files
}
