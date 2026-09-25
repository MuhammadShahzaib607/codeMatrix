import { ChevronDown, ChevronRight, FileCode, Folder, Loader2, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { addTab, setFolderOpen } from '../../features/fileSystemSlice'
import { revealLineInEditor, revealTreeNode, setActiveSidebarView } from '../../features/uiSlice'
import { getFileContent } from '../../services/fileContentCache'
import { collectAncestorFolderIds, flattenTreeNodes } from '../../utils/tree'
import './SearchInFiles.css'

const DEBOUNCE_MS = 300
// Guards against freezing the tab on a huge project.
const MAX_FILES_TO_SEARCH = 400
const MAX_LINES_PER_FILE = 50

/** Renders `text` with the first occurrence of `query` wrapped in a <mark>. */
function HighlightedText({ text, query }) {
  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index === -1) return text

  return (
    <>
      {text.slice(0, index)}
      <mark className="sif-mark">{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  )
}

export default function SearchInFiles() {
  const dispatch = useDispatch()
  const tree = useSelector((state) => state.fileSystem.tree)
  const workspace = useSelector((state) => state.fileSystem.workspace)
  const contentByFileId = useSelector((state) => state.editor.contentByFileId)

  // Read through a ref so typing in the editor does not re-run the search.
  const contentRef = useRef(contentByFileId)
  useEffect(() => {
    contentRef.current = contentByFileId
  }, [contentByFileId])

  const inputRef = useRef(null)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [groups, setGroups] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [collapsed, setCollapsed] = useState({})

  // Debounce the input so a big project is not re-walked on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    // The empty case is handled by the input handlers, not here, so this effect
    // never sets state just because the query was cleared.
    if (!debounced) return undefined

    let cancelled = false

    async function run() {
      setIsSearching(true)
      const needle = debounced.toLowerCase()
      const nodes = flattenTreeNodes(tree)
      const found = new Map()

      // (a) name matches — files and folders.
      for (const node of nodes) {
        if (node.name.toLowerCase().includes(needle)) {
          found.set(node.id, { ...node, lines: [], nameMatch: true })
        }
      }

      // (b) content matches — files only.
      const files = nodes.filter((node) => node.type === 'file').slice(0, MAX_FILES_TO_SEARCH)
      for (const file of files) {
        if (cancelled) return

        let content = contentRef.current[file.id]
        if (content === undefined && workspace.source === 'cloud' && workspace.projectId) {
          try {
            content = await getFileContent(workspace.projectId, file.id)
          } catch {
            content = undefined
          }
        }
        if (cancelled) return
        if (typeof content !== 'string') continue

        const lines = []
        const allLines = content.split('\n')
        for (let index = 0; index < allLines.length; index += 1) {
          if (allLines[index].toLowerCase().includes(needle)) {
            lines.push({ line: index + 1, text: allLines[index] })
            if (lines.length >= MAX_LINES_PER_FILE) break
          }
        }

        if (lines.length > 0) {
          const existing = found.get(file.id) ?? { ...file, nameMatch: false }
          existing.lines = lines
          found.set(file.id, existing)
        }
      }

      setGroups([...found.values()])
      setIsSearching(false)
    }

    run()
    return () => {
      cancelled = true
    }
  }, [debounced, tree, workspace])

  const summary = useMemo(() => {
    const total = groups.reduce(
      (sum, group) => sum + (group.lines.length || (group.nameMatch ? 1 : 0)),
      0,
    )
    const files = groups.filter((group) => group.type === 'file').length
    return { total, files }
  }, [groups])

  function handleQueryChange(value) {
    setQuery(value)
    if (!value.trim()) {
      setGroups([])
      setIsSearching(false)
    }
  }

  function clearQuery() {
    setQuery('')
    setGroups([])
    setIsSearching(false)
  }

  function revealNode(id) {
    // Search mode shares the sidebar slot, so switch back to the tree first.
    dispatch(setActiveSidebarView('explorer'))
    for (const ancestorId of collectAncestorFolderIds(tree, id) ?? []) {
      dispatch(setFolderOpen({ id: ancestorId, isOpen: true }))
    }
    dispatch(revealTreeNode(id))
  }

  function openLine(group, line) {
    dispatch(addTab(group.id))
    dispatch(revealLineInEditor({ fileId: group.id, line }))
  }

  function openFile(group) {
    dispatch(addTab(group.id))
    dispatch(revealTreeNode(group.id))
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Search</span>
      </div>

      <div className="sif-search">
        <Search size={14} className="sif-search-icon" />
        <input
          ref={inputRef}
          className="sif-input"
          value={query}
          placeholder="Search"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => handleQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              clearQuery()
              inputRef.current?.blur()
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="sif-clear"
            title="Clear"
            aria-label="Clear search"
            onClick={() => {
              clearQuery()
              inputRef.current?.focus()
            }}
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className="sif-body">
        {!debounced && (
          <div className="sif-state">Search across all files in your project</div>
        )}

        {debounced && isSearching && (
          <div className="sif-state">
            <Loader2 size={14} className="spin" /> Searching…
          </div>
        )}

        {debounced && !isSearching && groups.length === 0 && (
          <div className="sif-state">No results found</div>
        )}

        {debounced && !isSearching && groups.length > 0 && (
          <>
            <div className="sif-summary">
              {summary.total} result{summary.total === 1 ? '' : 's'} in {summary.files} file
              {summary.files === 1 ? '' : 's'}
            </div>

            {groups.map((group) => {
              const matchCount = group.lines.length || (group.nameMatch ? 1 : 0)
              const isCollapsed = Boolean(collapsed[group.id])
              const isFolder = group.type === 'folder'

              return (
                <div className="sif-group" key={group.id}>
                  <div
                    className="sif-group-header"
                    onClick={() => {
                      if (isFolder) revealNode(group.id)
                      else if (group.lines.length === 0) openFile(group)
                      else setCollapsed((state) => ({ ...state, [group.id]: !state[group.id] }))
                    }}
                  >
                    {!isFolder && (
                      <span className="sif-chevron">
                        {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                      </span>
                    )}
                    {isFolder ? (
                      <Folder size={14} className="sif-icon is-folder" />
                    ) : (
                      <FileCode size={14} className="sif-icon is-file" />
                    )}
                    <span className="sif-group-name">{group.name}</span>
                    <span className="sif-group-path">{group.path}</span>
                    <span className="sif-count">{matchCount}</span>
                  </div>

                  {!isCollapsed && group.lines.length > 0 && (
                    <div className="sif-lines">
                      {group.lines.map((entry) => (
                        <button
                          type="button"
                          className="sif-line"
                          key={entry.line}
                          title={`Line ${entry.line}`}
                          onClick={() => openLine(group, entry.line)}
                        >
                          <span className="sif-line-number">{entry.line}</span>
                          <span className="sif-line-text">
                            <HighlightedText text={entry.text} query={debounced} />
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>
    </aside>
  )
}
