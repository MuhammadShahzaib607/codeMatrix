import { useCallback, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { showToast } from '../features/uiSlice'
import { workspaceApi } from '../services/api'
import { getRootHandle, writeFilesToDirectory } from '../services/fileSystemAccess'
import { collectFilePaths } from '../utils/cloudTree'
import { isBinaryPath } from '../utils/fileTypes'

export default function useSyncToLaptop() {
  const dispatch = useDispatch()
  const workspace = useSelector((state) => state.fileSystem.workspace)
  const [isSyncing, setIsSyncing] = useState(false)

  const syncToLaptop = useCallback(async () => {
    if (workspace.source !== 'cloud' || !workspace.projectId) {
      dispatch(showToast({ message: 'Import a project before syncing.', type: 'info' }))
      return
    }

    const handle = getRootHandle()
    if (!handle) {
      dispatch(
        showToast({
          message:
            'The original laptop folder is no longer available. Re-import the folder to sync again.',
          type: 'error',
        }),
      )
      return
    }

    setIsSyncing(true)
    try {
      const data = await workspaceApi.getTree(workspace.projectId)
      const paths = collectFilePaths(data.tree)
      const files = []
      for (const path of paths) {
        if (isBinaryPath(path)) {
          const raw = await workspaceApi.getProjectFileBytes(workspace.projectId, path)
          files.push({ relativePath: path, content: raw.blob })
        } else {
          const file = await workspaceApi.getFile(workspace.projectId, path)
          files.push({ relativePath: path, content: file.content })
        }
      }

      await writeFilesToDirectory(handle, files)
      dispatch(
        showToast({
          message: `Synced ${files.length} file${files.length === 1 ? '' : 's'} to ${handle.name}`,
          type: 'success',
        }),
      )
    } catch (error) {
      dispatch(showToast({ message: `Sync failed: ${error.message}`, type: 'error' }))
    } finally {
      setIsSyncing(false)
    }
  }, [workspace, dispatch])

  return { syncToLaptop, isSyncing }
}
