import { FileCode, Folder, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { addTab, focusContainerProject, setFolderOpen } from '../../features/fileSystemSlice'
import { revealTreeNode, setActiveSidebarView } from '../../features/uiSlice'
import { projectIdForPath, projectNameForPath } from '../../utils/containerPaths'
import { collectAncestorFolderIds, flattenTreeNodes } from '../../utils/tree'

export const TOPBAR_SEARCH_INPUT_ID = 'topbar-quick-open-input'
const MAX_RESULTS = 8

export default function TopbarSearch() {
  const dispatch = useDispatch()
  const tree = useSelector((state) => state.fileSystem.tree)

  const containerRef = useRef(null)
  const inputRef = useRef(null)
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return []
    return flattenTreeNodes(tree)
      .filter((node) => node.name.toLowerCase().includes(needle))
      .slice(0, MAX_RESULTS)
  }, [tree, query])

  const openTarget = useCallback(
    (target) => {
      dispatch(setActiveSidebarView('explorer'))
      const ancestors = collectAncestorFolderIds(tree, target.id) ?? []
      for (const id of ancestors) dispatch(setFolderOpen({ id, isOpen: true }))

      if (target.type === 'folder') {
        dispatch(setFolderOpen({ id: target.id, isOpen: true }))
      } else {
        const projectId = projectIdForPath(target.id, tree)
        if (projectId) {
          dispatch(
            focusContainerProject({
              projectId,
              name: projectNameForPath(target.id, tree),
              source: String(projectId).startsWith('scratch-') ? 'scratch' : 'cloud',
            }),
          )
        }
        dispatch(addTab(target.id))
      }
      dispatch(revealTreeNode(target.id))

      setQuery('')
      setIsOpen(false)
      inputRef.current?.blur()
    },
    [dispatch, tree],
  )

  useEffect(() => {
    function handlePointerDown(event) {
      if (!containerRef.current?.contains(event.target)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      setIsOpen(false)
      setQuery('')
      inputRef.current?.blur()
      return
    }
    if (!results.length) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setIsOpen(true)
      setActiveIndex((index) => (index + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setIsOpen(true)
      setActiveIndex((index) => (index - 1 + results.length) % results.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const target = results[activeIndex]
      if (target) openTarget(target)
    }
  }

  const showDropdown = isOpen && query.trim().length > 0

  return (
    <div className="topbar-search" ref={containerRef}>
      <Search size={15} className="topbar-search-icon" />
      <input
        id={TOPBAR_SEARCH_INPUT_ID}
        ref={inputRef}
        className="topbar-search-input"
        value={query}
        placeholder="Search files and folders..."
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => {
          setQuery(event.target.value)
          setActiveIndex(0)
          setIsOpen(true)
        }}
        onFocus={() => {
          if (query.trim()) setIsOpen(true)
        }}
        onKeyDown={handleKeyDown}
      />

      {showDropdown && (
        <div className="topbar-search-results" role="listbox">
          {results.length === 0 && (
            <div className="topbar-search-empty">No matching files or folders</div>
          )}

          {results.map((node, index) => (
            <button
              key={node.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`topbar-search-result ${index === activeIndex ? 'is-active' : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => openTarget(node)}
            >
              {node.type === 'folder' ? (
                <Folder size={14} className="result-icon is-folder" />
              ) : (
                <FileCode size={14} className="result-icon is-file" />
              )}
              <span className="result-name">{node.name}</span>
              <span className="result-path">{node.path}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
