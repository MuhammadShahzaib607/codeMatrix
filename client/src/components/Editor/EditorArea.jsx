import Editor from '@monaco-editor/react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { setContent, updateContent } from '../../features/editorSlice'
import { getHandleById, readFileContent } from '../../services/fileSystemAccess'
import { getLanguageFromFilename } from '../../utils/language'
import { findNode } from '../../utils/tree'
import EmptyState from './EmptyState'
import TabBar from './TabBar'
import './Editor.css'

export default function EditorArea() {
  const dispatch = useDispatch()
  const { tree, activeFileId } = useSelector((state) => state.fileSystem)
  const contentByFileId = useSelector((state) => state.editor.contentByFileId)
  // Kept per file id so switching tabs does not need a state reset in an effect.
  const [failure, setFailure] = useState(null) // { fileId, message }

  const activeNode = activeFileId ? findNode(tree, activeFileId) : null
  // A file already present in the buffer map has been loaded (from disk or from
  // the demo tree) and does not need reading again.
  const isLoaded = activeFileId ? Object.hasOwn(contentByFileId, activeFileId) : false
  const content = isLoaded ? contentByFileId[activeFileId] : ''
  const loadError = failure?.fileId === activeFileId ? failure.message : null

  useEffect(() => {
    if (!activeNode || activeNode.type !== 'file' || isLoaded) return undefined

    const handle = getHandleById(activeNode.id)
    if (!handle) {
      // Demo tree or a stale handle — there is nothing to read from disk.
      dispatch(setContent({ fileId: activeNode.id, content: '' }))
      return undefined
    }

    let cancelled = false
    readFileContent(handle)
      .then((text) => {
        if (!cancelled) dispatch(setContent({ fileId: activeNode.id, content: text }))
      })
      .catch((error) => {
        if (!cancelled) {
          setFailure({
            fileId: activeNode.id,
            message: error.message || 'Could not read this file.',
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeNode, isLoaded, dispatch])

  return (
    <section className="editor-area">
      <TabBar />

      <div className="editor-body">
        {!activeNode && <EmptyState />}

        {activeNode && loadError && (
          <div className="editor-status is-error">
            <AlertTriangle size={18} />
            <p>
              Could not open {activeNode.name}
              <br />
              <span>{loadError}</span>
            </p>
          </div>
        )}

        {activeNode && !loadError && !isLoaded && (
          <div className="editor-status">
            <Loader2 size={18} className="spin" />
            <p>Opening {activeNode.name}…</p>
          </div>
        )}

        {activeNode && !loadError && isLoaded && (
          <Editor
            // `path` gives every file its own model, so undo history and the
            // scroll position survive tab switches.
            path={activeNode.id}
            keepCurrentModel
            value={content}
            language={getLanguageFromFilename(activeNode.name)}
            theme="vs-dark"
            onChange={(value) =>
              dispatch(updateContent({ fileId: activeNode.id, content: value ?? '' }))
            }
            loading={
              <div className="editor-status">
                <Loader2 size={18} className="spin" />
                <p>Loading editor…</p>
              </div>
            }
            options={{
              automaticLayout: true,
              fontSize: 14,
              fontFamily: "'SF Mono', 'Cascadia Code', Menlo, Consolas, 'Courier New', monospace",
              fontLigatures: true,
              minimap: { enabled: true, renderCharacters: false },
              padding: { top: 12 },
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              renderLineHighlight: 'all',
              tabSize: 2,
              roundedSelection: false,
            }}
          />
        )}
      </div>
    </section>
  )
}
