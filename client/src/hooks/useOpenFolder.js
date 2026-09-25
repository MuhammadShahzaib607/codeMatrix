import { useCallback, useState } from 'react'
import { useDispatch } from 'react-redux'
import { showToast } from '../features/uiSlice'
import { importWorkspace, reopenWorkspace } from '../features/workspaceThunks'
import { projectApi } from '../services/api'
import {
  isFileSystemAccessSupported,
  openFolder,
  readAllFilesFromDirectory,
} from '../services/fileSystemAccess'
import { saveWorkspaceRef } from '../services/workspaceStorage'
import { UNSUPPORTED_MESSAGE } from '../utils/messages'

export default function useOpenFolder() {
  const dispatch = useDispatch()
  const [isImporting, setIsImporting] = useState(false)

  const importFolder = useCallback(async () => {
    if (!isFileSystemAccessSupported()) {
      dispatch(showToast({ message: UNSUPPORTED_MESSAGE, type: 'error' }))
      return
    }

    setIsImporting(true)
    try {
      const directoryHandle = await openFolder()
      const name = directoryHandle.name
      const { files, skipped } = await readAllFilesFromDirectory(directoryHandle)

      if (files.length === 0) {
        dispatch(
          showToast({
            message: `${name} has no importable files (node_modules, .git and build folders are skipped).`,
            type: 'error',
          }),
        )
        return
      }

      const { project } = await projectApi.create({ name })

      const result = await dispatch(
        importWorkspace({ projectId: project.id, name: project.name, files }),
      ).unwrap()

      await dispatch(
        reopenWorkspace({ projectId: project.id, name: result.name ?? project.name }),
      ).unwrap()

      saveWorkspaceRef({ projectId: project.id, name: project.name })

      const skippedResult = result.failedCount
        ? ` (${result.failedCount} file${result.failedCount === 1 ? '' : 's'} skipped)`
        : ''
      dispatch(
        showToast({
          message: `Imported ${result.fileCount} file${result.fileCount === 1 ? '' : 's'} from ${name}${skippedResult}`,
          type: 'success',
        }),
      )

      // Small follow-up notice when the import deliberately left things out.
      const notices = []
      if (skipped.directories > 0) {
        notices.push(
          'Skipped node_modules and other build folders — run npm install in the terminal to regenerate them',
        )
      }
      if (skipped.oversizedFiles > 0) {
        notices.push(
          `Skipped ${skipped.oversizedFiles} file${skipped.oversizedFiles === 1 ? '' : 's'} larger than 2MB`,
        )
      }
      if (notices.length > 0) {
        dispatch(showToast({ message: notices.join('  •  '), type: 'info' }))
      }
    } catch (error) {
      if (error?.name === 'AbortError') return
      dispatch(showToast({ message: `Could not import folder: ${error.message}`, type: 'error' }))
    } finally {
      setIsImporting(false)
    }
  }, [dispatch])

  return { importFolder, isImporting, isSupported: isFileSystemAccessSupported() }
}
