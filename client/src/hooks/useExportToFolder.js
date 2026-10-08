import { useCallback, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { showToast } from '../features/uiSlice'
import { workspaceApi } from '../services/api'
import {
  collectExportablePaths,
  isFileSystemAccessSupported,
  pickDirectory,
  writeFilesToDirectory,
} from '../services/fileSystemAccess'
import { isBinaryPath } from '../utils/fileTypes'
import { UNSUPPORTED_MESSAGE } from '../utils/messages'

/**
 * "Export to Folder": writes the cloud workspace onto a folder the user picks
 * on their laptop, skipping node_modules / .git / build folders (the same list
 * used at import time). Unlike Sync-to-Laptop it does NOT require the original
 * imported folder handle, so it works from any machine/session.
 */
export default function useExportToFolder() {
  const dispatch = useDispatch()
  const workspace = useSelector((state) => state.fileSystem.workspace)
  const [isExporting, setIsExporting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  const exportToFolder = useCallback(async () => {
    if (!isFileSystemAccessSupported()) {
      dispatch(showToast({ message: UNSUPPORTED_MESSAGE, type: 'error' }))
      return
    }
    if (workspace.source !== 'cloud' || !workspace.projectId) {
      dispatch(showToast({ message: 'Import a project before exporting.', type: 'info' }))
      return
    }

    let directoryHandle
    try {
      directoryHandle = await pickDirectory()
    } catch (error) {
      if (error?.name === 'AbortError') {
        dispatch(showToast({ message: 'Export cancelled.', type: 'info' }))
        return
      }
      dispatch(showToast({ message: `Could not access that folder: ${error.message}`, type: 'error' }))
      return
    }

    setIsExporting(true)
    setProgress({ done: 0, total: 0 })
    try {
      const data = await workspaceApi.getTree(workspace.projectId)
      const { files: paths, skippedFolders } = collectExportablePaths(data.tree)

      if (paths.length === 0) {
        dispatch(showToast({ message: 'Nothing to export — the project has no files.', type: 'info' }))
        return
      }

      setProgress({ done: 0, total: paths.length })
      const records = []
      let fetched = 0
      for (const path of paths) {
        if (isBinaryPath(path)) {
          const raw = await workspaceApi.getProjectFileBytes(workspace.projectId, path)
          records.push({ relativePath: path, content: raw.blob })
        } else {
          const file = await workspaceApi.getFile(workspace.projectId, path)
          records.push({ relativePath: path, content: file.content })
        }
        fetched += 1
        setProgress({ done: fetched, total: paths.length })
      }

      await writeFilesToDirectory(directoryHandle, records, {
        onProgress: (done) => setProgress({ done, total: records.length }),
      })

      const skipNote =
        skippedFolders > 0
          ? ' — node_modules and build folders were skipped, run npm install there to regenerate them'
          : ''
      dispatch(
        showToast({
          message: `Exported ${records.length} file${records.length === 1 ? '' : 's'} to ${directoryHandle.name}${skipNote}`,
          type: 'success',
        }),
      )
    } catch (error) {
      dispatch(showToast({ message: `Export failed: ${error.message}`, type: 'error' }))
    } finally {
      setIsExporting(false)
      setProgress({ done: 0, total: 0 })
    }
  }, [workspace, dispatch])

  return { exportToFolder, isExporting, progress }
}
