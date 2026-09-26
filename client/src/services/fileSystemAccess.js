export const ROOT_ID = 'root'

// IMPORT-TIME EXCLUSION ONLY — this filter applies solely while reading a
// folder from the user's LOCAL LAPTOP for upload (readAllFilesFromDirectory).
// Dependencies, VCS metadata and build output are huge, regenerable, and would
// blow the API body limit. Checked by folder NAME at every depth.
//
// This is deliberately independent of the workspace tree shown in the Explorer:
// the server walks the workspace folder on disk with NO exclusions, so a
// node_modules/.git/dist created by the terminal still appears in the tree.
const IMPORT_SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.cache',
])

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

export async function writeFilesToDirectory(directoryHandle, files) {
  await requirePermission(directoryHandle)

  for (const file of files) {
    const segments = String(file.relativePath ?? '')
      .split('/')
      .filter(Boolean)
    const fileName = segments.pop()
    if (!fileName) continue

    let directory = directoryHandle
    for (const segment of segments) {
      directory = await directory.getDirectoryHandle(segment, { create: true })
    }

    const fileHandle = await directory.getFileHandle(fileName, { create: true })
    const writable = await fileHandle.createWritable()
    try {
      await writable.write(file.content ?? '')
    } finally {
      await writable.close()
    }
  }
}
