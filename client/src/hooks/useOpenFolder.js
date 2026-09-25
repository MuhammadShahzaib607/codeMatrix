import { useCallback, useState } from 'react'
import { useDispatch } from 'react-redux'
import { loadWorkspace } from '../features/fileSystemSlice'
import { showToast } from '../features/uiSlice'
import {
  isFileSystemAccessSupported,
  openFolder,
  readDirectoryTree,
} from '../services/fileSystemAccess'

export const UNSUPPORTED_MESSAGE =
  "Your browser doesn't support local folder access. Please use Chrome, Edge, or Brave."

/**
 * Picks a folder with the browser's directory picker and replaces the workspace
 * with a tree read from the user's disk.
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
      const rootNode = await readDirectoryTree(directoryHandle)
      dispatch(loadWorkspace({ tree: [rootNode], name: rootNode.name }))
      dispatch(showToast({ message: `Opened ${rootNode.name}`, type: 'success' }))
    } catch (error) {
      // Cancelling the picker is not an error worth reporting.
      if (error?.name === 'AbortError') return
      dispatch(showToast({ message: `Could not open folder: ${error.message}`, type: 'error' }))
    } finally {
      setIsOpening(false)
    }
  }, [dispatch])

  return { openLocalFolder, isOpening, isSupported: isFileSystemAccessSupported() }
}
