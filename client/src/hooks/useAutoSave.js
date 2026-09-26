import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { clearSaving, markSaving } from '../features/editorSlice'
import { saveWorkspaceFile } from '../features/workspaceThunks'
import { hasActiveWorkspace } from '../utils/workspace'

// How long the user must stop typing before the auto-save write fires. Long
// enough to coalesce normal typing, short enough to feel immediate.
export const AUTO_SAVE_DELAY_MS = 1200

/**
 * Saves the ACTIVE file automatically a short time after the last keystroke,
 * when Settings > Editor > Auto Save is on. Deliberately silent: it reuses the
 * exact save thunk as Ctrl+S (which suppresses the server's chokidar refresh, so
 * an auto-save never triggers a full Explorer refresh), sets the tab's in-flight
 * flag for a subtle spinner, and never shows a toast. Turning Auto Save off
 * leaves the manual Ctrl+S / Save button behaviour untouched.
 */
export default function useAutoSave() {
  const dispatch = useDispatch()
  const activeFileId = useSelector((state) => state.fileSystem.activeFileId)
  const projectId = useSelector((state) => state.fileSystem.workspace.projectId)
  const source = useSelector((state) => state.fileSystem.workspace.source)
  const autoSave = useSelector((state) => state.settings.editor.autoSave)
  const content = useSelector((state) =>
    state.fileSystem.activeFileId
      ? state.editor.contentByFileId[state.fileSystem.activeFileId]
      : undefined,
  )
  const isDirty = useSelector(
    (state) =>
      !!state.fileSystem.activeFileId &&
      state.editor.unsavedFileIds.includes(state.fileSystem.activeFileId),
  )

  useEffect(() => {
    if (!autoSave || !activeFileId || !isDirty) return undefined
    if (!hasActiveWorkspace({ projectId, source })) return undefined

    const fileId = activeFileId
    // Every keystroke changes `content`, which tears down this effect and clears
    // the pending timer — i.e. the write only happens once typing pauses.
    const timer = window.setTimeout(() => {
      dispatch(markSaving(fileId))
      dispatch(
        saveWorkspaceFile({ projectId, path: fileId, content: content ?? '' }),
      )
        .unwrap()
        .catch(() => dispatch(clearSaving(fileId)))
    }, AUTO_SAVE_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [autoSave, activeFileId, isDirty, content, projectId, source, dispatch])
}
