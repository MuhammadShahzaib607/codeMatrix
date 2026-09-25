import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { toggleAIPanel, toggleSidebar } from '../features/uiSlice'
import useSaveActiveFile from './useSaveActiveFile'

// Keeps the shortcuts listed on the welcome screen actually working.
export default function useGlobalShortcuts() {
  const dispatch = useDispatch()
  const saveActiveFile = useSaveActiveFile()
  const activeFileId = useSelector((state) => state.fileSystem.activeFileId)

  useEffect(() => {
    function handleKeyDown(event) {
      if (!event.ctrlKey && !event.metaKey) return

      switch (event.key.toLowerCase()) {
        case 'b':
          event.preventDefault()
          dispatch(toggleSidebar())
          break
        case 's':
          event.preventDefault()
          // Ctrl+S writes to the real file when a local folder is open.
          if (activeFileId) saveActiveFile()
          break
        case 'j':
          event.preventDefault()
          dispatch(toggleAIPanel())
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dispatch, activeFileId, saveActiveFile])
}
