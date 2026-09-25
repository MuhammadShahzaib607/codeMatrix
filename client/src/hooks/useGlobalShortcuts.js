import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { TOPBAR_SEARCH_INPUT_ID } from '../components/Topbar/TopbarSearch'
import { toggleAIPanel, toggleSidebar } from '../features/uiSlice'
import useSaveActiveFile from './useSaveActiveFile'

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
        case 'p':
          event.preventDefault()
          document.getElementById(TOPBAR_SEARCH_INPUT_ID)?.focus()
          break
        case 's':
          event.preventDefault()
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
