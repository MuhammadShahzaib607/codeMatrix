export const ROOT_ID = 'root'

// The Explorer's TOP LEVEL: the user's container folder (server/workspaces/
// u-<owner>/), which holds the project folder as one entry among siblings. It
// is the same directory the terminal starts in. Selecting nothing means
// "create here", at the top level, outside the project root.
export const CONTAINER_ID = 'container'

export function containerEntryId(name) {
  return `container:${name}`
}

export function isContainerId(id) {
  return typeof id === 'string' && id.startsWith('container:')
}

// IMPORT-TIME EXCLUSION ONLY — this filter applies solely while reading a
// folder from the user's LOCAL LAPTOP for upload (readAllFilesFromDirectory).
// Dependencies, VCS metadata and build output are huge, regenerable, and would
// blow the API body limit. Checked by folder NAME at every depth.
//
// This is deliberately independent of the workspace tree shown in the Explorer:
// the server walks the workspace folder on disk with NO exclusions, so a
// node_modules/.git/dist created by the terminal still appears in the tree.
export const IMPORT_SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.cache',
])

// "Export to Folder" reuses the exact same exclusion list as import, so the
// round-trip (import → work → export) never tries to write regenerable folders.
export const EXPORT_SKIP_DIRECTORIES = IMPORT_SKIP_DIRECTORIES

// Files above this size are skipped entirely (content is never read).
export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024 // 2MB

let rootHandle = null

export function isFileSystemAccessSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}


export async function openFolder() {
  const handle = await window.showDirectoryPicker({ id: 'code-matrix' })
  rootHandle = handle
  return handle
}

/**
 * Picks a directory WITHOUT touching the remembered import handle. Used by
 * "Export to Folder", which must not repoint Sync-to-Laptop at the export
 * destination.
 */
export async function pickDirectory() {
  return window.showDirectoryPicker({ id: 'code-matrix-export' })
}

export function getRootHandle() {
  return rootHandle
}

export async function requirePermission(handle, mode = 'readwrite') {
  if (typeof handle?.queryPermission !== 'function') return
  const options = { mode }
  if ((await handle.queryPermission(options)) === 'granted') return
  if ((await handle.requestPermission(options)) === 'granted') return
  throw new Error('Permission to write to this folder was denied.')
}

/**
 * Recursively reads every file under `directoryHandle` for import.
 * Skipped folders (node_modules, .git, dist, build, out, .next, .cache) are
 * never descended into, and files larger than MAX_IMPORT_FILE_BYTES are never
 * read. These folders are still shown in the Explorer whenever they exist on the
 * server's disk — this list only affects the one-off local-folder upload.
 *
 * @returns {{ files: {relativePath: string, content: string}[],
 *            skipped: { directories: number, oversizedFiles: number } }}
 */
export async function readAllFilesFromDirectory(directoryHandle, basePath = '') {
  const files = []
  const skipped = { directories: 0, oversizedFiles: 0 }

  for await (const [name, handle] of directoryHandle.entries()) {
    const relativePath = basePath ? `${basePath}/${name}` : name

    if (handle.kind === 'directory') {
      if (IMPORT_SKIP_DIRECTORIES.has(name)) {
        skipped.directories += 1
        continue
      }
      const nested = await readAllFilesFromDirectory(handle, relativePath)
      files.push(...nested.files)
      skipped.directories += nested.skipped.directories
      skipped.oversizedFiles += nested.skipped.oversizedFiles
    } else {
      const file = await handle.getFile()
      if (file.size > MAX_IMPORT_FILE_BYTES) {
        skipped.oversizedFiles += 1
        continue
      }
      files.push({ relativePath, content: await file.text() })
    }
  }

  return { files, skipped }
}

/** Creates (or opens) a nested folder path under `directoryHandle`. */
export async function createNewFolder(directoryHandle, segments) {
  let directory = directoryHandle
  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment, { create: true })
  }
  return directory
}

/** Creates (or opens) a file handle inside `directoryHandle`. */
export async function createNewFile(directoryHandle, fileName) {
  return directoryHandle.getFileHandle(fileName, { create: true })
}

/** Writes text content to a file handle. */
export async function writeFileContent(fileHandle, content) {
  const writable = await fileHandle.createWritable()
  try {
    await writable.write(content ?? '')
  } finally {
    await writable.close()
  }
}

/**
 * Writes a flat list of { relativePath, content } records into a directory,
 * creating the nested structure. `onProgress(done)` fires after each file.
 */
export async function writeFilesToDirectory(directoryHandle, files, { onProgress } = {}) {
  await requirePermission(directoryHandle)

  let done = 0
  for (const file of files) {
    const segments = String(file.relativePath ?? '')
      .split('/')
      .filter(Boolean)
    const fileName = segments.pop()
    if (!fileName) continue

    const directory = await createNewFolder(directoryHandle, segments)
    const fileHandle = await createNewFile(directory, fileName)
    await writeFileContent(fileHandle, file.content)

    done += 1
    onProgress?.(done)
  }
}

/**
 * Server-tree walker for "Export to Folder": returns the file paths worth
 * writing and how many excluded folders were skipped. Exclusions are matched by
 * folder NAME at any depth (same list as import), and excluded folders are
 * never descended into.
 *
 * @returns {{ files: string[], skippedFolders: number }}
 */
export function collectExportablePaths(serverNode) {
  const files = []
  let skippedFolders = 0

  function walk(node) {
    if (!node) return
    if (node.type === 'file') {
      files.push(node.path)
      return
    }
    for (const child of node.children ?? []) {
      if (child.type === 'folder' && EXPORT_SKIP_DIRECTORIES.has(child.name)) {
        skippedFolders += 1
        continue
      }
      walk(child)
    }
  }

  walk(serverNode)
  return { files, skippedFolders }
}
