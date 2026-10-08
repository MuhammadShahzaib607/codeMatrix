export function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

/**
 * True when the dragged payload contains a DIRECTORY. Folders cannot be
 * uploaded as files, so the caller shows the "use Import Folder" hint instead
 * of a confusing "not an allowed file type" rejection.
 */
export function hasDroppedFolder(event) {
  const items = event.dataTransfer?.items
  if (!items) return false
  for (let index = 0; index < items.length; index += 1) {
    const entry = items[index].webkitGetAsEntry?.()
    if (entry && entry.isDirectory) return true
  }
  return false
}
