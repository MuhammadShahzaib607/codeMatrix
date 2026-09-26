import Editor from '@monaco-editor/react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { setContent, updateContent } from '../../features/editorSlice'
import { readWorkspaceFile } from '../../features/workspaceThunks'
import useAutoSave from '../../hooks/useAutoSave'
import { getLanguageFromFilename } from '../../utils/language'
import { defineAppMonacoThemes, monacoThemeFor } from '../../utils/monacoThemes'
import { applyMonacoTsConfig } from '../../utils/monacoTsconfig'
import { findNode } from '../../utils/tree'
import { hasActiveWorkspace } from '../../utils/workspace'
import EmptyState from './EmptyState'
import TabBar from './TabBar'
import './Editor.css'

// The monospace stack used when the font setting is "System Default".
const DEFAULT_MONO_FONT =
  "'SF Mono', 'Cascadia Code', Menlo, Consolas, 'Courier New', monospace"

export default function EditorArea() {
  // Auto-save runs as a component-level hook so it stays active for every open
  // file, not just the one Monaco currently renders.
  const dispatch = useDispatch()
  const { tree, activeFileId, workspace } = useSelector((state) => state.fileSystem)
  const contentByFileId = useSelector((state) => state.editor.contentByFileId)
  const revealLine = useSelector((state) => state.ui.revealLine)
  const monacoTsConfig = useSelector((state) => state.tsconfig.compilerOptions)
  const editorSettings = useSelector((state) => state.settings.editor)
  const appTheme = useSelector((state) => state.settings.theme)
  const [failure, setFailure] = useState(null)

  const editorRef = useRef(null)
  const monacoRef = useRef(null)
  const revealRef = useRef(revealLine)
  const activeFileIdRef = useRef(activeFileId)
  const tsConfigRef = useRef(monacoTsConfig)
  const themeRef = useRef(appTheme)

  useAutoSave()

  useEffect(() => {
    revealRef.current = revealLine
  }, [revealLine])

  // Editor preferences are applied to the LIVE Monaco instance here. They are
  // also on `options={...}` for the first mount, but that prop only takes effect
  // on mount — without this effect, toggling word wrap (or changing the font,
  // size, tab size or minimap) while a file is open did nothing visible.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.updateOptions({
      fontSize: editorSettings.fontSize,
      fontFamily: editorSettings.fontFamily || DEFAULT_MONO_FONT,
      minimap: { enabled: editorSettings.minimap, renderCharacters: false },
      wordWrap: editorSettings.wordWrap ? 'on' : 'off',
      tabSize: editorSettings.tabSize,
    })
  }, [editorSettings])

  // Keep the language service in step with the project's tsconfig: apply it as
  // soon as Monaco is ready and re-apply whenever the workspace config changes.
  useEffect(() => {
    tsConfigRef.current = monacoTsConfig
    if (monacoRef.current) applyMonacoTsConfig(monacoRef.current, monacoTsConfig)
  }, [monacoTsConfig])

  useEffect(() => {
    activeFileIdRef.current = activeFileId
  }, [activeFileId])

  // Keep Monaco's theme in step with the app theme. Custom (dark) themes are
  // registered on mount; the Light theme uses Monaco's built-in "vs".
  useEffect(() => {
    themeRef.current = appTheme
    const monaco = monacoRef.current
    if (monaco) defineAppMonacoThemes(monaco)
  }, [appTheme])

  const applyReveal = useCallback(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    const target = revealRef.current
    if (!editor || !monaco || !target) return
    if (target.fileId !== activeFileIdRef.current) return

    const maxLine = editor.getModel()?.getLineCount?.() ?? target.line
    const line = Math.max(1, Math.min(target.line, maxLine))
    editor.revealLineInCenter(line)
    editor.setPosition({ lineNumber: line, column: 1 })

    const decoration = {
      range: new monaco.Range(line, 1, line, 1),
      options: { isWholeLine: true, className: 'editor-line-highlight' },
    }

    if (typeof editor.createDecorationsCollection === 'function') {
      const collection = editor.createDecorationsCollection([decoration])
      window.setTimeout(() => {
        try {
          collection.clear()
        } catch {}
      }, 2000)
      return
    }

    const decorationIds = editor.deltaDecorations([], [decoration])
    window.setTimeout(() => {
      try {
        editor.deltaDecorations(decorationIds, [])
      } catch {}
    }, 2000)
  }, [])

  const activeNode = activeFileId ? findNode(tree, activeFileId) : null
  const isLoaded = activeFileId ? Object.hasOwn(contentByFileId, activeFileId) : false
  const content = isLoaded ? contentByFileId[activeFileId] : ''
  const loadError = failure?.fileId === activeFileId ? failure.message : null

  useEffect(() => {
    if (!activeNode || activeNode.type !== 'file' || isLoaded) return undefined

    // Both an imported project and the scratch workspace have real files on
    // the server; only a missing workspace falls back to an empty buffer.
    if (!hasActiveWorkspace(workspace)) {
      dispatch(setContent({ fileId: activeNode.id, content: '' }))
      return undefined
    }

    let cancelled = false
    dispatch(
      readWorkspaceFile({
        projectId: workspace.projectId,
        path: activeNode.id,
        fileId: activeNode.id,
      }),
    )
      .unwrap()
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
  }, [activeNode, isLoaded, workspace, dispatch])

  useEffect(() => {
    applyReveal()
  }, [applyReveal, revealLine, activeFileId, isLoaded])

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
          // The model URI keeps the REAL file name (…/CustomSelect.tsx) on
          // purpose: Monaco's TypeScript worker derives the script kind (TSX vs
          // TS) from the URI's extension, so a URI without ".tsx" is what makes
          // valid JSX report as syntax errors. `language` must be 'typescript'
          // for .tsx too (see utils/language.js).
          <Editor
            path={`file:///${activeNode.id}`}
            keepCurrentModel
            value={content}
            language={getLanguageFromFilename(activeNode.name)}
            theme={monacoThemeFor(appTheme)}
            onMount={(editor, monaco) => {
              editorRef.current = editor
              monacoRef.current = monaco
              // Register the custom themes BEFORE applying one, so a saved theme
              // is not silently replaced by Monaco's fallback at startup.
              defineAppMonacoThemes(monaco)
              monaco.editor.setTheme(monacoThemeFor(themeRef.current))
              // Monaco's TS worker only resolves path aliases against real file
              // URIs, so models use file:/// and the project's compilerOptions
              // (baseUrl/paths/jsx/…) are pushed in here.
              applyMonacoTsConfig(monaco, tsConfigRef.current)
              applyReveal()
            }}
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
              fontSize: editorSettings.fontSize,
              fontFamily: editorSettings.fontFamily || DEFAULT_MONO_FONT,
              fontLigatures: true,
              minimap: { enabled: editorSettings.minimap, renderCharacters: false },
              wordWrap: editorSettings.wordWrap ? 'on' : 'off',
              padding: { top: 12 },
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              renderLineHighlight: 'all',
              tabSize: editorSettings.tabSize,
              roundedSelection: false,
            }}
          />
        )}
      </div>
    </section>
  )
}
