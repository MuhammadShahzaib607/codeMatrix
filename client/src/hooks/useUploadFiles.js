import { useCallback, useState } from 'react'
import { useDispatch } from 'react-redux'
import { refreshWorkspaceTree } from '../features/workspaceThunks'
import { showToast } from '../features/uiSlice'
import { workspaceApi } from '../services/api'
import useAuthGuard from './useAuthGuard'
import { isUploadAllowed } from '../utils/fileTypes'

/**
 * Uploads files (images and other binary assets) into a folder of the user's
 * container. Files that are too large or of an unsupported type are rejected
 * with a clear message and never reach the server; the accepted ones are sent
 * as multipart/form-data and appear in the Explorer through the usual
 * refresh + watcher flow.
 */
export default function useUploadFiles() {
  const dispatch = useDispatch()
  const guard = useAuthGuard()
  const [isUploading, setIsUploading] = useState(false)

  const runUpload = useCallback(
    async (targetPath, fileList) => {
      const files = Array.from(fileList ?? [])
      if (files.length === 0) return

      const accepted = []
      const rejected = []
      for (const file of files) {
        const verdict = isUploadAllowed(file)
        if (verdict.ok) accepted.push(file)
        else rejected.push(verdict.reason)
      }

      if (rejected.length > 0) {
        dispatch(
          showToast({
            message: rejected.slice(0, 3).join(' '),
            type: 'error',
          }),
        )
      }
      if (accepted.length === 0) return

      setIsUploading(true)
      try {
        const result = await workspaceApi.uploadFiles(targetPath, accepted)
        dispatch(refreshWorkspaceTree({}))
        const saved = result?.files ?? []
        const first = saved[0]
        dispatch(
          showToast({
            message:
              saved.length === 1
                ? `Uploaded “${first.name}”`
                : `Uploaded ${saved.length} files into “${first?.path ?? targetPath}”`,
            type: 'success',
            action: first
              ? { label: 'Copy path', kind: 'copy-path', value: first.path }
              : null,
          }),
        )
      } catch (error) {
        dispatch(
          showToast({
            message: `Upload failed: ${error.message}`,
            type: 'error',
          }),
        )
      } finally {
        setIsUploading(false)
      }
    },
    [dispatch],
  )

  const uploadFiles = useCallback(
    (targetPath, fileList) => {
      guard(() => runUpload(targetPath, fileList), 'Please sign in to upload files')
    },
    [guard, runUpload],
  )

  return { uploadFiles, isUploading }
}
