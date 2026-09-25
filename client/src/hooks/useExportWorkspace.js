import { useCallback } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { showToast } from '../features/uiSlice'
import { workspaceApi } from '../services/api'

/**
 * Streams the workspace as a .zip and hands it to the browser as a download.
 * The only durable way to keep work safe on the free tier, where the server's
 * disk is wiped on restart.
 */
export default function useExportWorkspace() {
  const dispatch = useDispatch()
  const workspace = useSelector((state) => state.fileSystem.workspace)

  return useCallback(async () => {
    if (workspace.source !== 'cloud' || !workspace.projectId) {
      dispatch(showToast({ message: 'Import a folder before exporting.', type: 'info' }))
      return
    }

    try {
      const { blob, filename } = await workspaceApi.exportProject(workspace.projectId)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      dispatch(showToast({ message: `Exported ${filename}`, type: 'success' }))
    } catch (error) {
      dispatch(showToast({ message: `Export failed: ${error.message}`, type: 'error' }))
    }
  }, [workspace, dispatch])
}
