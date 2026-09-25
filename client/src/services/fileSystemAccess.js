/**
 * Thin wrapper around the browser's File System Access API.
 *
 * FileSystemHandle objects are NOT serializable, so they never go into Redux.
 * They live in the module-level `registry` Map (node id -> handle) while Redux
 * only ever stores plain data: id, name, type, children and the folder
 * open/closed flag.
 *
 * Requires a Chromium browser (Chrome / Edge / Brave) on https or localhost.
 */

export const ROOT_ID = 'root'

// Walking these would freeze the tab and produce an unusable tree.
const SKIP_DIRECTORIES = new Set(['node_modules', '.git'])

/** id -> { handle, parentId, name, type } */
const registry = new Map()

let rootHandle = null

export function isFileSystemAccessSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

/* ------------------------------------------------------------------ *
 * Handle registry
 * ------------------------------------------------------------------ */

export function getHandleById(id) {
  return registry.get(id)?.handle ?? null
}

export function getRegistryEntry(id) {
  return registry.get(id) ?? null
}

export function getParentHandle(id) {
  const entry = registry.get(id)
  if (!entry || entry.parentId === null) return null
  return registry.get(entry.parentId)?.handle ?? null
}

/**
 * Stores a handle under `id` (or a fresh uuid) and returns the plain node that
 * Redux should hold. Passing an existing `id` rebinds that slot, which is how a
 * rename keeps its open tab and unsaved buffer.
 */
export function registerHandle(handle, { id, parentId, name, type }) {
  const nodeId = id ?? crypto.randomUUID()
  registry.set(nodeId, { handle, parentId, name, type })
  return type === 'folder'
    ? { id: nodeId, name, type, isOpen: true, children: [] }
    : { id: nodeId, name, type }
}

export function forgetHandles(ids) {
  for (const id of ids) registry.delete(id)
}

/* ------------------------------------------------------------------ *
 * Permissions
 * ------------------------------------------------------------------ */

/**
 * File System Access permissions are dropped on every page load, so this is
 * checked before each write. Must be called from a user gesture for the
 * browser to show its prompt.
 */
export async function requirePermission(handle, mode = 'readwrite') {
  if (typeof handle?.queryPermission !== 'function') return
  const options = { mode }
  if ((await handle.queryPermission(options)) === 'granted') return
  if ((await handle.requestPermission(options)) === 'granted') return
  throw new Error('Permission to write to this folder was denied.')
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

export async function openFolder() {
  const handle = await window.showDirectoryPicker({ id: 'code-matrix' })
  rootHandle = handle
  return handle
}

export function getRootHandle() {
  return rootHandle
}

/**
 * Reads a directory into a plain Redux tree node. When `previous` is supplied,
 * entries that still exist keep their old ids, so open tabs and unsaved buffers
 * survive a rename or a refresh.
 */
async function walkDirectory(directoryHandle, { id, parentId, previous = null, isOpen }) {
  const node = {
    id,
    name: directoryHandle.name,
    type: 'folder',
    isOpen: isOpen ?? previous?.isOpen ?? false,
    children: [],
  }
  registry.set(id, { handle: directoryHandle, parentId, name: node.name, type: 'folder' })

  const previousByKey = new Map()
  for (const child of previous?.children ?? []) {
    previousByKey.set(`${child.type}:${child.name}`, child)
  }

  const entries = []
  for await (const [name, handle] of directoryHandle.entries()) {
    if (handle.kind === 'directory' && SKIP_DIRECTORIES.has(name)) continue
    entries.push([name, handle])
  }
  // Folders first, then files, each alphabetically — same convention as most editors.
  entries.sort(([nameA, handleA], [nameB, handleB]) => {
    const folderA = handleA.kind === 'directory'
    const folderB = handleB.kind === 'directory'
    if (folderA !== folderB) return folderA ? -1 : 1
    return nameA.localeCompare(nameB)
  })

  for (const [name, handle] of entries) {
    if (handle.kind === 'directory') {
      const prior = previousByKey.get(`folder:${name}`)
      node.children.push(
        await walkDirectory(handle, {
          id: prior?.id ?? crypto.randomUUID(),
          parentId: id,
          previous: prior ?? null,
        }),
      )
    } else {
      const prior = previousByKey.get(`file:${name}`)
      const fileId = prior?.id ?? crypto.randomUUID()
      registry.set(fileId, { handle, parentId: id, name, type: 'file' })
      node.children.push({ id: fileId, name, type: 'file' })
    }
  }

  return node
}

/**
 * Full read of a freshly picked folder. Resets the handle registry. The root is
 * left expanded so the user immediately sees the files they just opened.
 */
export async function readDirectoryTree(directoryHandle) {
  registry.clear()
  rootHandle = directoryHandle
  return walkDirectory(directoryHandle, { id: ROOT_ID, parentId: null, isOpen: true })
}

/**
 * Re-reads a directory that was just renamed, reusing the ids of entries that
 * still exist so nothing has to be reloaded in the editor.
 */
export async function reindexDirectory(directoryHandle, previousNode) {
  return walkDirectory(directoryHandle, {
    id: previousNode.id,
    parentId: registry.get(previousNode.id)?.parentId ?? null,
    previous: previousNode,
  })
}

export async function readFileContent(fileHandle) {
  const file = await fileHandle.getFile()
  return file.text()
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

export async function writeFileContent(fileHandle, content) {
  await requirePermission(fileHandle)
  const writable = await fileHandle.createWritable()
  try {
    await writable.write(content)
  } finally {
    await writable.close()
  }
}

export async function createNewFile(parentDirectoryHandle, fileName) {
  await requirePermission(parentDirectoryHandle)
  return parentDirectoryHandle.getFileHandle(fileName, { create: true })
}

export async function createNewFolder(parentDirectoryHandle, folderName) {
  await requirePermission(parentDirectoryHandle)
  return parentDirectoryHandle.getDirectoryHandle(folderName, { create: true })
}

export async function deleteEntry(parentDirectoryHandle, name, type = 'file') {
  await requirePermission(parentDirectoryHandle)
  await parentDirectoryHandle.removeEntry(name, { recursive: type === 'folder' })
}

/* ------------------------------------------------------------------ *
 * Rename — the API has no atomic rename, so it is copy + delete.
 * ------------------------------------------------------------------ */

// Writing the File blob (not text) keeps binary files intact.
async function copyFileContents(sourceHandle, targetHandle) {
  const file = await sourceHandle.getFile()
  const writable = await targetHandle.createWritable()
  try {
    await writable.write(file)
  } finally {
    await writable.close()
  }
}

async function copyDirectory(sourceHandle, targetHandle) {
  for await (const [name, handle] of sourceHandle.entries()) {
    if (handle.kind === 'directory') {
      await copyDirectory(handle, await targetHandle.getDirectoryHandle(name, { create: true }))
    } else {
      await copyFileContents(handle, await targetHandle.getFileHandle(name, { create: true }))
    }
  }
}

/**
 * No native rename exists in the File System Access API. Files are copied into
 * a new entry and the old one removed; folders are copied recursively first.
 * Returns the handle of the new entry.
 */
export async function renameEntry(parentDirectoryHandle, oldName, newName, type) {
  await requirePermission(parentDirectoryHandle)

  if (type === 'folder') {
    const sourceDirectory = await parentDirectoryHandle.getDirectoryHandle(oldName)
    const targetDirectory = await parentDirectoryHandle.getDirectoryHandle(newName, { create: true })
    await copyDirectory(sourceDirectory, targetDirectory)
    await parentDirectoryHandle.removeEntry(oldName, { recursive: true })
    return targetDirectory
  }

  const sourceFile = await parentDirectoryHandle.getFileHandle(oldName)
  const targetFile = await parentDirectoryHandle.getFileHandle(newName, { create: true })
  await copyFileContents(sourceFile, targetFile)
  await parentDirectoryHandle.removeEntry(oldName)
  return targetFile
}
