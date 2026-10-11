import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from '../config/env.js'
import { pauseWatching, resumeWatching } from './fileWatcher.js'
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

// fs.promises is used for any operation that can touch a LARGE tree (recursive
// copy, tree walk). The synchronous fs API blocks the whole event loop, which is
// what made the server unresponsive while pasting a folder with many files.
const fsp = fs.promises

// After this many copied files the recursive copy yields to the event loop, so
// terminal output and other API calls keep flowing during a big paste.
const COPY_YIELD_BATCH = 250

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve))
}

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

/** Same, but guarantees the folder exists — it is the Explorer's top level. */
export function ensureOwnerContainer(ownerId) {
  const containerPath = getOwnerContainerPath(ownerId)
  fs.mkdirSync(containerPath, { recursive: true })
  return containerPath
}

/**
 * Reverse registry lookup: which project owns this folder inside this container?
 * Used by the Explorer's container listing to turn a top-level folder row back
 * into the project it represents.
 */
export function findProjectIdForFolder(container, folderName) {
  const registry = loadRegistry()
  for (const [projectId, record] of Object.entries(registry)) {
    if (record?.container === container && record?.folderName === folderName) return projectId
  }
  return null
}

const CONTAINER_FILE_NAME_PATTERN = /^[^/\\:*?"<>|\u0000-\u001F]+$/

export function sanitizeContainerFileName(displayName) {
  const raw = String(displayName ?? '').trim()
  if (!raw || !CONTAINER_FILE_NAME_PATTERN.test(raw)) {
    throw new ApiError(
      400,
      'A file name cannot be empty or contain \\ / : * ? " < > | characters.',
      'INVALID_NAME',
    )
  }
  const name = raw.replace(/[.\s]+$/, '').slice(0, FOLDER_NAME_MAX_LENGTH)
  if (!name || name === '.' || name === '..') {
    throw new ApiError(400, 'That file name is not usable.', 'INVALID_NAME')
  }
  if (WINDOWS_RESERVED_NAMES.test(name)) {
    throw new ApiError(400, 'That file name is reserved by the operating system.', 'INVALID_NAME')
  }
  return name
}

/**
 * The Explorer's TOP LEVEL: every entry of the user's container, with the
 * project each top-level folder belongs to. A folder created outside the app
 * (terminal, or an older version) gets registered as a project on first sight,
 * so it can be opened like any other instead of being an unopenable stray row.
 */
export async function listContainerEntries(ownerId, { limit = 200 } = {}) {
  const container = workspaceOwnerKey(ownerId)
  const containerPath = ensureOwnerContainer(ownerId)
  let dirents = []
  try {
    dirents = await fsp.readdir(containerPath, { withFileTypes: true })
  } catch {
    return { container, entries: [] }
  }

  const entries = []
  const claimed = new Set()
  for (const dirent of dirents.slice(0, limit)) {
    const name = String(dirent.name ?? '')
    if (!name || name.startsWith('.')) continue
    if (dirent.isDirectory()) {
      let projectId = findProjectIdForFolder(container, name)
      if (!projectId) {
        if (isScratchFolderName(name)) continue
        projectId = crypto.randomUUID()
        try {
          setWorkspaceRecord(projectId, { container, folderName: name })
        } catch {
          projectId = null
        }
      } else if (isScratchProjectId(projectId) && isScratchFolderName(name)) {
        continue
      }
      if (projectId) claimed.add(projectId)
      entries.push({ name, type: 'folder', projectId })
    } else {
      entries.push({ name, type: 'file', projectId: null })
    }
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return { container, entries }
}

/**
 * A top-level FILE lives beside the projects, inside the container.
 */
export async function createContainerFile(ownerId, displayName, content = '') {
  const containerPath = ensureOwnerContainer(ownerId)
  const name = sanitizeContainerFileName(displayName)
  const absolute = path.join(containerPath, name)
  if (fs.existsSync(absolute)) {
    throw new ApiError(409, `"${name}" already exists at the top level.`, 'ALREADY_EXISTS')
  }
  await fsp.writeFile(absolute, typeof content === 'string' ? content : '', 'utf8')
  return { name, path: absolute }
}

/** Stats for one path inside a project, using the same traversal guard. */
export async function statWorkspaceEntry(projectId, relativePath) {
  const { absolute, relative } = resolveInsideWorkspace(projectId, relativePath)
  const stats = await fsp.stat(absolute).catch(() => null)
  return { absolute, relative, stats }
}

/**
 * Copies ONE file from a project into the user's container, beside the project
 * folders. Name clashes get a " (2)" suffix instead of overwriting anything.
 */
export async function copyFileIntoContainer(ownerId, absoluteSource, displayName) {
  const containerPath = ensureOwnerContainer(ownerId)
  const base = sanitizeContainerFileName(displayName)
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const extension = dot > 0 ? base.slice(dot) : ''
  let name = base
  for (let counter = 2; counter <= 50; counter += 1) {
    if (!fs.existsSync(path.join(containerPath, name))) break
    name = `${stem} (${counter})${extension}`
  }
  const destination = path.join(containerPath, name)
  if (fs.existsSync(destination)) {
    throw new ApiError(409, 'Too many copies of that file at the top level.', 'ALREADY_EXISTS')
  }
  await fsp.copyFile(absoluteSource, destination)
  return { name }
}

/**
 * A top-level FOLDER is a PROJECT: it gets a project id, a registry record and a
 * MongoDB metadata document (never file contents), exactly like an import.
 */
export async function createContainerProject(ownerId, displayName, projectId = null) {
  const container = workspaceOwnerKey(ownerId)
  const id = projectId ?? crypto.randomUUID()
  const folder = registerWorkspaceFolder(id, { ownerId, displayName, container })
  return { projectId: id, name: folder.folderName, container, path: folder.path }
}

/**
 * The full Explorer tree of a user's container: every project folder and every
 * top-level file, with CONTAINER-RELATIVE paths ("frontend/src/index.js"). This
 * is the single tree the client renders, so the Explorer's top level is the real
 * container instead of one active project.
 */
export async function getContainerTree(ownerId, options = {}) {
  const container = workspaceOwnerKey(ownerId)
  const containerPath = ensureOwnerContainer(ownerId)
  const rootName = options.name || container
  return walkDirectory(containerPath, rootName, '')
}

function cleanContainerRelative(value) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
}

/**
 * Resolves a CONTAINER-RELATIVE path to its absolute location on disk, with the
 * same traversal guard as every other path builder. Returns the first path
 * segment (`top`), the rest (`inner`), the absolute path and the normalized
 * relative path.
 */
export function resolveContainerOwnerPath(ownerId, relativePath) {
  const containerPath = ensureOwnerContainer(ownerId)
  const cleaned = cleanContainerRelative(relativePath)
  const segments = cleaned.split('/').filter(Boolean)
  if (segments.length === 0) {
    throw new ApiError(400, 'A path is required.', 'INVALID_PATH')
  }

  const top = segments[0]
  const inner = segments.slice(1).join('/')
  const absolute = path.resolve(containerPath, ...segments)
  const relative = path.relative(containerPath, absolute)

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ApiError(400, `Path "${relativePath}" is outside of your workspace.`, 'INVALID_PATH')
  }

  return {
    containerPath,
    top,
    inner,
    absolute,
    relative: relative.split(path.sep).join('/'),
  }
}

/**
 * The project a top-level container folder belongs to. A folder that appeared
 * outside the app (terminal) is registered on first sight, exactly like the
 * container listing does, so a path into it is still usable.
 */
export function findContainerProjectId(ownerId, topName) {
  const container = workspaceOwnerKey(ownerId)
  const existing = findProjectIdForFolder(container, topName)
  if (existing) return existing

  if (isScratchFolderName(topName)) return null
  const folderPath = path.join(ensureOwnerContainer(ownerId), topName)
  if (!fs.existsSync(folderPath)) return null
  try {
    if (!fs.statSync(folderPath).isDirectory()) return null
  } catch {
    return null
  }

  const projectId = crypto.randomUUID()
  setWorkspaceRecord(projectId, { container, folderName: topName })
  return projectId
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

const RENAME_RETRY_DELAYS_MS = [100, 200, 400, 600, 800]
const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function renameFolderWithRetry(fromAbsolute, toAbsolute, renameImpl = null) {
  const rename =
    typeof renameImpl === 'function'
      ? renameImpl
      : (from, to) => fsp.rename(from, to)

  let lastError = null
  for (let attempt = 0; attempt < RENAME_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await rename(fromAbsolute, toAbsolute)
      return true
    } catch (error) {
      lastError = error
      if (error?.code === 'EXDEV') break
      if (!RENAME_RETRY_CODES.has(error?.code)) throw error
      if (attempt < RENAME_RETRY_DELAYS_MS.length - 1) {
        await sleep(RENAME_RETRY_DELAYS_MS[attempt])
      }
    }
  }

  try {
    await copyDirectoryRecursive(fromAbsolute, toAbsolute, { copied: 0 })
    await fsp.rm(fromAbsolute, { recursive: true, force: true })
    return true
  } catch (fallbackError) {
    await fsp.rm(toAbsolute, { recursive: true, force: true }).catch(() => {})
    throw lastError ?? fallbackError
  }
}

export async function movePathWithFallback(fromAbsolute, toAbsolute, isDirectory) {
  if (isDirectory) return renameFolderWithRetry(fromAbsolute, toAbsolute)

  try {
    await fsp.rename(fromAbsolute, toAbsolute)
    return true
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error
  }

  await fsp.copyFile(fromAbsolute, toAbsolute)
  await fsp.rm(fromAbsolute, { force: true })
  return true
}

/**
 * Renames a workspace's on-disk folder to match a new DISPLAY name, using the
 * same sanitizing + collision handling as a fresh import (name free -> use it,
 * otherwise "-2", "-3", …). The registry mapping is updated in place; the
 * projectId is unchanged, so every path builder keeps resolving correctly.
 *
 * Used by the agent to turn an anonymous "Scratch" folder into a real project
 * named after the task. Returns { container, folderName, path } or null when the
 * workspace has no registry record (nothing to rename).
 */
export async function renameWorkspaceFolder(projectId, { displayName = null } = {}) {
  const record = getWorkspaceRecord(projectId)
  if (!record) return null

  const registry = loadRegistry()
  const nextName = availableFolderName(
    registry,
    projectId,
    record.container,
    sanitizeFolderName(displayName),
    record,
  )
  const nextPath = folderPathFor(record.container, nextName)

  if (nextName !== record.folderName) {
    const currentPath = folderPathFor(record.container, record.folderName)
    if (fs.existsSync(currentPath)) {
      fs.mkdirSync(path.dirname(nextPath), { recursive: true })
      await pauseWatching(projectId)
      try {
        await renameFolderWithRetry(currentPath, nextPath)
      } catch (error) {
        await resumeWatching(projectId)
        throw error
      }
      registry[projectId] = { container: record.container, folderName: nextName }
      saveRegistry(registry)
      await resumeWatching(projectId)
    } else {
      fs.mkdirSync(nextPath, { recursive: true })
      registry[projectId] = { container: record.container, folderName: nextName }
      saveRegistry(registry)
    }
  } else {
    fs.mkdirSync(nextPath, { recursive: true })
  }

  return { container: record.container, folderName: nextName, path: nextPath }
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

// A scratch workspace's on-disk folder is "Scratch" (or "Scratch-2" on a name
// clash). Once a project is adopted it is renamed, so a folder matching this
// pattern is by definition still an anonymous scratch.
const SCRATCH_FOLDER_PATTERN = /^scratch(?:-\d+)?$/i

export function isScratchFolderName(folderName) {
  return SCRATCH_FOLDER_PATTERN.test(String(folderName ?? '').trim())
}

/**
 * The OWNER a scratch id belongs to. Scratch ids are "scratch-<ownerId>" or,
 * once the original id has been adopted as a real project,
 * "scratch-<ownerId>-<shortSuffix>". Owner ids (Mongo ObjectIds) never contain a
 * dash, so the first segment after the prefix is always the owner.
 */
export function scratchOwnerIdFromProjectId(projectId) {
  const rest = String(projectId ?? '').replace(/^scratch-/, '')
  const [owner] = rest.split('-')
  return owner || 'guest'
}

/**
 * The user's existing UNNAMED scratch workspace, or null. Detected from the
 * on-disk registry (not from MongoDB), so it works even if the DB is down:
 * a registry entry in the owner's container whose folder name still matches
 * "Scratch*" AND whose folder actually exists.
 */
export function findScratchWorkspaceId(ownerId) {
  const container = workspaceOwnerKey(ownerId)
  const registry = loadRegistry()
  let best = null

  for (const [projectId, record] of Object.entries(registry)) {
    if (!isScratchProjectId(projectId)) continue
    if (!record || record.container !== container) continue
    if (!isScratchFolderName(record.folderName)) continue
    const folderPath = folderPathFor(record.container, record.folderName)
    if (!fs.existsSync(folderPath)) continue
    const mtime = fs.statSync(folderPath).mtimeMs
    if (!best || mtime > best.mtime) best = { projectId, mtime }
  }

  return best?.projectId ?? null
}

/**
 * A fresh, unused scratch id for the user: "scratch-<ownerId>" when that slot is
 * still free, otherwise "scratch-<ownerId>-<hex>". The owner is still derivable
 * from the suffixed form (see scratchOwnerIdFromProjectId).
 */
export function nextScratchProjectId(ownerId) {
  const base = `scratch-${ownerId || 'guest'}`
  const registry = loadRegistry()
  if (!registry[base]) return base
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = `${base}-${crypto.randomBytes(3).toString('hex')}`
    if (!registry[candidate]) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
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

  // A scratch workspace lives in the SAME per-user container a real project of
  // that user would use, so the terminal (which starts at the container) shows
  // both side by side as enterable subfolders.
  const ownerId = scratchOwnerIdFromProjectId(projectId)
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

export async function deleteWorkspaceFolder(projectId) {
  assertValidProjectId(projectId)
  const directory = getWorkspacePath(projectId)
  if (!fs.existsSync(directory)) return false
  // Retrying recursive remove: on Windows a folder that something still holds
  // answers EBUSY/EPERM on the first try, so every attempt gets a bounded
  // retry ladder before the caller reports a failure.
  await removePathWithRetry(directory)
  // Drop the registry entry too, so a later re-create gets a clean mapping.
  const registry = loadRegistry()
  if (registry[projectId]) {
    delete registry[projectId]
    saveRegistry(registry)
  }
  return true
}

const DELETE_RETRY_DELAYS_MS = [80, 160, 320, 640, 1000]
const DELETE_RETRY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY', 'EMFILE', 'ENFILE'])
const READ_ONLY_RETRY_CODES = new Set(['EPERM', 'EACCES'])
const WINDOWS_LONG_PATH_LIMIT = 248

function windowsLongPath(absolute) {
  if (process.platform !== 'win32') return absolute
  const native = path.resolve(absolute)
  if (native.startsWith('\\\\?\\')) return native
  if (native.length < WINDOWS_LONG_PATH_LIMIT) return native
  if (native.startsWith('\\\\')) return `\\\\?\\UNC\\${native.slice(2)}`
  return `\\\\?\\${native}`
}

async function clearReadOnlyAttributes(absolute) {
  if (process.platform !== 'win32') return
  const stack = [path.resolve(absolute)]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries = null
    try {
      entries = await fsp.readdir(current, { withFileTypes: true })
    } catch {
      try {
        await fsp.chmod(current, 0o777)
      } catch {}
      continue
    }
    try {
      await fsp.chmod(current, 0o777)
    } catch {}
    for (const entry of entries) {
      const child = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(child)
        continue
      }
      try {
        await fsp.chmod(child, 0o666)
      } catch {}
    }
  }
}

/**
 * Recursive removal that survives Windows' transient lock errors: every attempt
 * lets fs.rm do its own short retry pass (maxRetries/retryDelay), and the outer
 * ladder backs off between attempts (80ms -> 1s) before giving up. The last
 * error is rethrown so the caller can classify it.
 */
export async function removePathWithRetry(absolute) {
  let lastError = null
  for (let attempt = 0; attempt < DELETE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await fsp.rm(windowsLongPath(absolute), {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 60,
      })
      return true
    } catch (error) {
      lastError = error
      if (!DELETE_RETRY_CODES.has(error?.code)) throw error
      if (READ_ONLY_RETRY_CODES.has(error?.code)) {
        await clearReadOnlyAttributes(absolute)
      }
      if (attempt < DELETE_RETRY_DELAYS_MS.length - 1) {
        await sleep(DELETE_RETRY_DELAYS_MS[attempt])
      }
    }
  }
  throw lastError
}

function writeFileAtomicSync(absolute, content) {
  const data = typeof content === 'string' ? content : String(content ?? '')
  const temp = `${absolute}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`
  try {
    fs.writeFileSync(temp, data, 'utf8')
    fs.renameSync(temp, absolute)
  } catch (error) {
    try {
      fs.rmSync(temp, { force: true })
    } catch {}
    throw error
  }
}

export function writeFileToWorkspace(projectId, relativeFilePath, content = '') {
  assertWorkspaceExists(projectId)
  const { absolute, relative } = resolveInsideWorkspace(projectId, relativeFilePath)
  if (!relative) throw new ApiError(400, 'A file path is required.', 'INVALID_PATH')

  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileAtomicSync(absolute, content)
  return relative
}

/**
 * Resolves a workspace-relative path to its absolute location ON DISK without
 * reading it, using the same traversal guard as every other path builder. The
 * live-preview static file server needs the raw bytes (images, fonts, …), so
 * `readFileFromWorkspace`'s UTF-8 decode is not appropriate there.
 *
 * Returns { root, absolute, relative }. Never throws for a missing file — the
 * caller stats `absolute` itself so it can also detect a directory.
 */
export function resolveWorkspaceFile(projectId, relativePath = '') {
  assertWorkspaceExists(projectId)
  return resolveInsideWorkspace(projectId, relativePath)
}

export function appendFileToWorkspace(projectId, relativeFilePath, content = '') {
  assertWorkspaceExists(projectId)
  const { absolute, relative } = resolveInsideWorkspace(projectId, relativeFilePath)
  if (!relative) throw new ApiError(400, 'A file path is required.', 'INVALID_PATH')

  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  const addition = typeof content === 'string' ? content : String(content ?? '')
  let existing = ''
  try {
    existing = fs.readFileSync(absolute, 'utf8')
  } catch {
    existing = ''
  }
  writeFileAtomicSync(absolute, existing + addition)
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

export async function deleteFromWorkspace(projectId, relativeFilePath) {
  assertWorkspaceExists(projectId)
  const { absolute, relative } = resolveInsideWorkspace(projectId, relativeFilePath)
  if (!relative) throw new ApiError(400, 'The workspace root cannot be deleted.', 'INVALID_PATH')

  const stats = await fsp.stat(absolute).catch(() => null)
  if (!stats) {
    throw new ApiError(404, `"${relative}" was not found in this workspace.`, 'FILE_MISSING')
  }

  // Retrying recursive remove (see removePathWithRetry). A synchronous
  // fs.rmSync of a folder containing node_modules used to freeze the entire
  // server — terminal included — for the whole deletion.
  await removePathWithRetry(absolute)
  return relative
}

/**
 * True when a path exists inside the workspace (file or folder). Used by the
 * AI agent's edit_file to distinguish "overwrite existing" from "create new".
 * Same traversal guard as every other path builder here.
 */
export function existsInWorkspace(projectId, relativePath) {
  const { absolute } = resolveInsideWorkspace(projectId, relativePath)
  return fs.existsSync(absolute)
}

/**
 * Listing for the AI agent's list_directory: the entries of one folder with
 * their type, folders first then alphabetically (same order as the Explorer).
 * Throws 404 when the folder does not exist and 400 when it is a file.
 */
export async function listDirectoryInWorkspace(projectId, relativeFolderPath = '') {
  assertWorkspaceExists(projectId)
  const { absolute, relative } = resolveInsideWorkspace(projectId, relativeFolderPath)

  const stats = await fsp.stat(absolute).catch(() => null)
  if (!stats) {
    throw new ApiError(404, `"${relative || '/'}" was not found in this workspace.`, 'FILE_MISSING')
  }
  if (!stats.isDirectory()) {
    throw new ApiError(400, `"${relative}" is a file, not a folder.`, 'NOT_A_FOLDER')
  }

  const entries = await fsp.readdir(absolute, { withFileTypes: true })
  return entries
    .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'folder' : 'file' }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

export async function renamePathInWorkspace(projectId, oldRelativePath, newRelativePath) {
  assertWorkspaceExists(projectId)
  const from = resolveInsideWorkspace(projectId, oldRelativePath)
  const to = resolveInsideWorkspace(projectId, newRelativePath)

  if (!from.relative || !to.relative) {
    throw new ApiError(400, 'Both the source and destination paths are required.', 'INVALID_PATH')
  }
  const fromStats = await fsp.stat(from.absolute).catch(() => null)
  if (!fromStats) {
    throw new ApiError(404, `"${from.relative}" was not found in this workspace.`, 'FILE_MISSING')
  }
  // Moving a folder into itself (or into one of its own descendants) would make
  // rename fail with an opaque EINVAL, so reject it up front. This is the
  // cut -> paste-into-itself case.
  if (
    fromStats.isDirectory() &&
    (to.relative === from.relative || to.relative.startsWith(`${from.relative}/`))
  ) {
    throw new ApiError(
      400,
      `Cannot move "${from.relative}" into itself or one of its own folders.`,
      'INVALID_PATH',
    )
  }
  const toExists = await fsp.access(to.absolute).then(
    () => true,
    () => false,
  )
  if (toExists) {
    throw new ApiError(409, `"${to.relative}" already exists.`, 'ALREADY_EXISTS')
  }

  await fsp.mkdir(path.dirname(to.absolute), { recursive: true })
  await fsp.rename(from.absolute, to.absolute)
  return { oldPath: from.relative, newPath: to.relative }
}

/**
 * Recursively copies a directory using ASYNC fs calls (fs.promises), yielding
 * back to the event loop every COPY_YIELD_BATCH files. A synchronous copy of a
 * large folder (e.g. one containing a node_modules-like tree) froze the entire
 * server — including the terminal — until it finished.
 */
export async function copyDirectoryRecursive(fromAbsolute, toAbsolute, progress) {
  await fsp.mkdir(toAbsolute, { recursive: true })
  const entries = await fsp.readdir(fromAbsolute, { withFileTypes: true })

  for (const entry of entries) {
    const childFrom = path.join(fromAbsolute, entry.name)
    const childTo = path.join(toAbsolute, entry.name)
    if (entry.isDirectory()) {
      await copyDirectoryRecursive(childFrom, childTo, progress)
    } else if (entry.isFile()) {
      await fsp.copyFile(childFrom, childTo)
      progress.copied += 1
      if (progress.copied % COPY_YIELD_BATCH === 0) await yieldToEventLoop()
    }
  }
}

/**
 * Picks a name inside `folderAbsolute` that does not collide with an existing
 * entry: the original name if free, else "<base> (copy)<ext>", then
 * "<base> (copy 2)<ext>", "<base> (copy 3)<ext>", … A copy therefore never
 * overwrites and never fails — duplicating an item into a folder that already
 * has one of that name just produces "a (copy).txt".
 */
export async function uniqueNameInFolder(folderAbsolute, name) {
  const exists = (candidate) =>
    fsp.access(path.join(folderAbsolute, candidate)).then(
      () => true,
      () => false,
    )
  if (!(await exists(name))) return name
  const { name: base, ext } = path.parse(name)
  let counter = 1
  let candidate = `${base} (copy)${ext}`
  while (await exists(candidate)) {
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
export async function copyPathInWorkspace(projectId, sourceRelativePath, targetFolderRelativePath = '') {
  assertWorkspaceExists(projectId)
  const source = resolveInsideWorkspace(projectId, sourceRelativePath)
  const targetFolder = resolveInsideWorkspace(projectId, targetFolderRelativePath)

  if (!source.relative) {
    throw new ApiError(400, 'A source path is required.', 'INVALID_PATH')
  }
  const sourceExists = await fsp.access(source.absolute).then(
    () => true,
    () => false,
  )
  if (!sourceExists) {
    throw new ApiError(404, `"${source.relative}" was not found in this workspace.`, 'FILE_MISSING')
  }

  const sourceIsDirectory = (await fsp.stat(source.absolute)).isDirectory()
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

  const targetStats = await fsp.stat(targetFolder.absolute).catch(() => null)
  if (targetStats && !targetStats.isDirectory()) {
    throw new ApiError(
      400,
      `"${targetFolder.relative}" is not a folder.`,
      'NOT_A_FOLDER',
    )
  }

  const name = await uniqueNameInFolder(targetFolder.absolute, path.basename(source.absolute))
  const destinationAbsolute = path.join(targetFolder.absolute, name)

  await fsp.mkdir(targetFolder.absolute, { recursive: true })
  if (sourceIsDirectory) {
    await copyDirectoryRecursive(source.absolute, destinationAbsolute, { copied: 0 })
  } else {
    await fsp.copyFile(source.absolute, destinationAbsolute)
  }

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
 * (node_modules, .git, dist, build, out, .next, .cache, …) is returned exactly
 * as it is. Import-time exclusion is a separate concern that lives ONLY in the
 * client's services/fileSystemAccess.js (IMPORT_SKIP_DIRECTORIES), so folders
 * created later by the terminal are never hidden here.
 */
async function walkDirectory(directory, rootName, relativePath) {
  const children = []

  // ASYNC readdir: each level awaits, which yields to the event loop between
  // directories. A fully synchronous recursive walk of a workspace that now
  // includes node_modules (thousands of entries) blocked the server for the
  // whole scan on every auto-refresh.
  const entries = await fsp.readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const childRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      children.push(await walkDirectory(path.join(directory, entry.name), rootName, childRelative))
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

export async function getWorkspaceTree(projectId, options = {}) {
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
