import { useCallback, useState } from 'react'
import { useDispatch } from 'react-redux'
import { showToast } from '../features/uiSlice'
import { importWorkspace } from '../features/workspaceThunks'
import { getRootHandle, isFileSystemAccessSupported, openFolder, readAllFilesFromDirectory } from '../services/fileSystemAccess'
import { saveWorkspaceRef } from '../services/workspaceStorage'

export const UNSUPPORTED_MESSAGE =
  "Your browser doesn't support local folder access. Please use Chrome, Edge, or Brave."

/**
 * Picks a folder on the user's laptop, reads every file, and imports the whole
 * project into a brand new server-side workspace. The original folder handle is
 * kept in memory so it can later be used to sync the project back down.
 */
export default function useOpenFolder() {
  const dispatch = useDispatch()
  const [isOpening, setIsOpening] = useState(false)

  const openLocalFolder = useCallback(async () => {
    if (!isFileSystemAccessSupported()) {
      dispatch(showToast({ message: UNSUPPORTED_MESSAGE, type: 'error' }))
      return
    }

    setIsOpening(true)
    try {
      // Must be the first await so the picker still has user activation.
      const directoryHandle = await openFolder()
      const name = directoryHandle.name
      const files = await readAllFilesFromDirectory(directoryHandle)

      if (files.length === 0) {
        dispatch(
          showToast({
            message: `${name} has no readable files (node_modules and .git are skipped).`,
            type: 'error',
          }),
        )
        return
      }

      // The backend owns the id being valid; generate it here so the UI can
      // address the workspace before the upload finishes.
      const projectId = crypto.randomUUID()

      const result = await dispatch(importWorkspace({ projectId, name, files })).unwrap()
      saveWorkspaceRef({ projectId, name: result.name ?? name })

      const skipped = result.failedCount
        ? ` (${result.failedCount} file${result.failedCount === 1 ? '' : 's'} skipped)`
        : ''
      dispatch(
        showToast({
          message: `Imported ${result.fileCount} file${result.fileCount === 1 ? '' : 's'} from ${name}${skipped}`,
          type: 'success',
        }),
      )
    } catch (error) {
      // Cancelling the picker is not an error worth reporting.
      if (error?.name === 'AbortError') return
      dispatch(showToast({ message: `Could not import folder: ${error.message}`, type: 'error' }))
    } finally {
      setIsOpening(false)
    }
  }, [dispatch])

  return {
    openLocalFolder,
    isOpening,
    isSupported: isFileSystemAccessSupported(),
    // Used by "Sync to Laptop" to know whether the source folder is still known.
    hasLocalFolder: Boolean(getRootHandle()),
  }
}
