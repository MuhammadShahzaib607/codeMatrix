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

const SKIP_DIRECTORIES = new Set(['node_modules', '.git'])

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
  const directory = path.join(WORKSPACES_ROOT, projectId)
  fs.mkdirSync(directory, { recursive: true })
  return directory
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

export function createWorkspaceFolder(projectId) {
  assertValidProjectId(projectId)
  const directory = getWorkspacePath(projectId)
  fs.mkdirSync(directory, { recursive: true })
  return directory
}

export function deleteWorkspaceFolder(projectId) {
  assertValidProjectId(projectId)
  const directory = getWorkspacePath(projectId)
  if (!fs.existsSync(directory)) return false
  fs.rmSync(directory, { recursive: true, force: true })
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
  if (fs.existsSync(to.absolute)) {
    throw new ApiError(409, `"${to.relative}" already exists.`, 'ALREADY_EXISTS')
  }

  fs.mkdirSync(path.dirname(to.absolute), { recursive: true })
  fs.renameSync(from.absolute, to.absolute)
  return { oldPath: from.relative, newPath: to.relative }
}

function sortChildren(children) {
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return children
}

function walkDirectory(directory, rootName, relativePath) {
  const children = []

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const childRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue
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
