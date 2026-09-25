import { useCallback } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { showToast } from '../features/uiSlice'
import { saveWorkspaceFile } from '../features/workspaceThunks'
import { findNode } from '../utils/tree'

export default function useSaveActiveFile() {
  const dispatch = useDispatch()
  const activeFileId = useSelector((state) => state.fileSystem.activeFileId)
  const tree = useSelector((state) => state.fileSystem.tree)
  const workspace = useSelector((state) => state.fileSystem.workspace)
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

    if (workspace.source !== 'cloud' || !workspace.projectId) {
      dispatch(showToast({ message: 'Import a project to save files.', type: 'info' }))
      return
    }

    try {
      await dispatch(
        saveWorkspaceFile({
          projectId: workspace.projectId,
          path: activeFileId,
          content: content ?? '',
        }),
      ).unwrap()
      dispatch(showToast({ message: `Saved ${fileName}`, type: 'success' }))
    } catch (error) {
      dispatch(
        showToast({ message: `Could not save ${fileName}: ${error.message}`, type: 'error' }),
      )
    }
  }, [activeFileId, content, tree, workspace, dispatch])
}
