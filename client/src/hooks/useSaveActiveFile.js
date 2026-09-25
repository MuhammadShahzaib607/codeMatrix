import { useCallback } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { markSaved } from '../features/editorSlice'
import { showToast } from '../features/uiSlice'
import { getHandleById, writeFileContent } from '../services/fileSystemAccess'
import { findNode } from '../utils/tree'

/**
 * Writes the active editor buffer back to the real file on disk.
 * Shared by the Topbar save button and the Ctrl/Cmd+S shortcut.
 */
export default function useSaveActiveFile() {
  const dispatch = useDispatch()
  const activeFileId = useSelector((state) => state.fileSystem.activeFileId)
  const tree = useSelector((state) => state.fileSystem.tree)
  const workspaceSource = useSelector((state) => state.fileSystem.workspace.source)
  const content = useSelector((state) =>
    state.fileSystem.activeFileId
      ? state.editor.contentByFileId[state.fileSystem.activeFileId]
      : undefined,
  )

  return useCallback(async () => {
    if (!activeFileId) {
      dispatch(showToast({ message: 'No file is open.', type: 'info' }))
      return
    }

    const fileName = findNode(tree, activeFileId)?.name ?? 'file'

    if (workspaceSource !== 'local') {
      dispatch(
        showToast({
          message: 'This is the demo workspace — open a local folder to save real files.',
          type: 'info',
        }),
      )
      return
    }

    const handle = getHandleById(activeFileId)
    if (!handle) {
      dispatch(
        showToast({
          message: `Lost access to ${fileName}. Reopen the folder to continue.`,
          type: 'error',
        }),
      )
      return
    }

    try {
      await writeFileContent(handle, content ?? '')
      dispatch(markSaved(activeFileId))
      dispatch(showToast({ message: `Saved ${fileName}`, type: 'success' }))
    } catch (error) {
      dispatch(
        showToast({ message: `Could not save ${fileName}: ${error.message}`, type: 'error' }),
      )
    }
  }, [activeFileId, content, tree, workspaceSource, dispatch])
}
