export const EXPLORER_DRAG_TYPE = 'application/x-codematrix-explorer'

export function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

export function isExplorerDrag(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes(EXPLORER_DRAG_TYPE)
}

export function isCopyModifier(event) {
  return Boolean(event?.ctrlKey || event?.metaKey || event?.altKey)
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
