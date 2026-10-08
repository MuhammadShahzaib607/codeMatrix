import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { TOPBAR_SEARCH_INPUT_ID } from '../components/Topbar/TopbarSearch'
import {
  redoLastExplorerAction,
  undoLastExplorerAction,
} from '../features/explorerHistoryThunks'
import { showToast, toggleAIPanel, toggleSidebar } from '../features/uiSlice'
import useSaveActiveFile from './useSaveActiveFile'

/**
 * True when the keystroke belongs to a text field — the Monaco editor (its
 * hidden textarea), an input, or a contenteditable. Explorer undo/redo must not
 * run there: Monaco has its own per-file text undo.
 */
function isTextEntryFocused() {
  if (typeof document === 'undefined') return false
  const element = document.activeElement
  if (!element) return false
  const tag = element.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || element.isContentEditable) return true
  return Boolean(element.closest?.('.monaco-editor'))
}

/**
 * True when an xterm terminal has the keyboard focus. Editor shortcuts must not
 * fire then: Ctrl+B, Ctrl+P and Ctrl+S belong to the running program (readline
 * backward-char, history, XOFF), not to the editor.
 */
function isTerminalFocused() {
  if (typeof document === 'undefined') return false
  return Boolean(document.activeElement?.closest?.('.terminal-view'))
}

export default function useGlobalShortcuts() {
  const dispatch = useDispatch()
  const saveActiveFile = useSaveActiveFile()
  const activeFileId = useSelector((state) => state.fileSystem.activeFileId)

  useEffect(() => {
    // Undo/redo is a backend round-trip; surface a failure instead of failing
    // silently. A stack with nothing on it resolves to null and stays quiet.
    function runHistoryAction(thunk, label) {
      dispatch(thunk())
        .unwrap()
        .catch((error) => {
          dispatch(showToast({ message: `Could not ${label}: ${error.message}`, type: 'error' }))
        })
    }

    function handleKeyDown(event) {
      if (!event.ctrlKey && !event.metaKey) return
      // While a terminal is focused every Ctrl/Cmd chord goes to the program.
      if (isTerminalFocused()) return

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
        // Explorer undo/redo. Ctrl+Shift+Z and Ctrl+Y both redo.
        case 'z':
          if (isTextEntryFocused()) break
          event.preventDefault()
          if (event.shiftKey) runHistoryAction(redoLastExplorerAction, 'redo')
          else runHistoryAction(undoLastExplorerAction, 'undo')
          break
        case 'y':
          if (isTextEntryFocused()) break
          event.preventDefault()
          runHistoryAction(redoLastExplorerAction, 'redo')
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dispatch, activeFileId, saveActiveFile])
}
