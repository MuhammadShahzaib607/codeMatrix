import {
  ChevronDown,
  ChevronRight,
  ChevronsUp,
  Clipboard,
  Copy,
  FileCode,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Link,
  Pencil,
  Play,
  RefreshCw,
  Scissors,
  Trash2,
} from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { toggleFolder } from '../../features/fileSystemSlice'
import { CONTAINER_ID } from '../../services/fileSystemAccess'
import { isHtmlPath } from '../../utils/preview'
import { findNode } from '../../utils/tree'
import TreeContextMenu from './TreeContextMenu'

function IndentGuides({ depth }) {
  return Array.from({ length: depth }, (_, level) => <span key={level} className="indent-guide" />)
}

function NewNodeInput({ depth, type, onSubmit, onCancel }) {
  const [value, setValue] = useState('')
  const settled = useRef(false)

  function commit() {
    if (settled.current) return
    settled.current = true
    onSubmit(value)
  }

  function cancel() {
    if (settled.current) return
    settled.current = true
    onCancel()
  }

  return (
    <div className="tree-row is-creating">
      <IndentGuides depth={depth} />
      <span className="tree-icon">
        {type === 'folder' ? <Folder size={16} /> : <FileCode size={16} />}
      </span>
      <input
        autoFocus
        className="tree-input"
        value={value}
        spellCheck={false}
        placeholder={type === 'folder' ? 'Folder name…' : 'File name…'}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          else if (event.key === 'Escape') cancel()
        }}
        onBlur={() => (value.trim() ? commit() : cancel())}
      />
    </div>
  )
}

/**
 * The rename field. It owns its own draft + "already settled" flag so a mount is
 * always a fresh rename session — that is what lets the context menu start a
 * rename on an existing row without any state-syncing effect.
 */
function RenameInput({ initialValue, isFolder, onCommit, onCancel }) {
  const [value, setValue] = useState(initialValue)
  const settled = useRef(false)

  function commit() {
    if (settled.current) return
    settled.current = true
    onCommit(value)
  }

  function cancel() {
    if (settled.current) return
    settled.current = true
    onCancel()
  }

  return (
    <input
      autoFocus
      className="tree-input"
      value={value}
      spellCheck={false}
      placeholder={isFolder ? 'Folder name…' : 'File name…'}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
        else if (event.key === 'Escape') cancel()
      }}
      onBlur={commit}
    />
  )
}

// memo(): with the structural sharing in toReduxTree, an unchanged subtree keeps
// its previous node object, so rows below an edited branch do not re-render at
// all.
const TreeNode = memo(function TreeNode({
  node,
  depth,
  selectedId,
  onSelect,
  creating,
  onSubmitCreate,
  onCancelCreate,
  onRename,
  onDelete,
  lockedId,
  revealedId,
  revealNonce,
  renamingId,
  onRenameSettled,
  onOpenMenu,
  clipboardPath,
  onOpenFile,
}) {
  const dispatch = useDispatch()
  const [isRenaming, setIsRenaming] = useState(false)

  const isFolder = node.type === 'folder'
  const isSelected = selectedId === node.id
  const isRevealed = revealedId === node.id
  const isLocked = lockedId !== null && node.id === lockedId
  const forceRename = renamingId === node.id
  const showRename = isRenaming || forceRename

  function handleRowClick(event) {
    event.stopPropagation()
    onSelect(node.id)
    if (isFolder) dispatch(toggleFolder(node.id))
    else onOpenFile?.(node)
  }

  function handleContextMenu(event) {
    onOpenMenu(event, node)
  }

  function startRename(event) {
    event.stopPropagation()
    setIsRenaming(true)
  }

  function commitRename(nextValue) {
    setIsRenaming(false)
    onRenameSettled?.()
    const nextName = nextValue.trim()
    if (nextName && nextName !== node.name) onRename(node, nextName)
  }

  function cancelRename() {
    setIsRenaming(false)
    onRenameSettled?.()
  }

  function handleDelete(event) {
    event.stopPropagation()
    onDelete(node)
  }

  return (
    <div className="tree-node">
      <div
        key={isRevealed ? `reveal-${revealNonce}` : undefined}
        data-node-id={node.id}
        className={`tree-row ${isSelected ? 'is-selected' : ''} ${isRevealed ? 'is-revealed' : ''} ${
          clipboardPath === node.id ? 'is-cut' : ''
        }`}
        onClick={handleRowClick}
        onContextMenu={handleContextMenu}
        title={node.name}
      >
        <IndentGuides depth={depth} />

        <span className="tree-chevron">
          {isFolder ? (
            node.isOpen ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )
          ) : null}
        </span>

        <span className={`tree-icon ${isFolder ? 'is-folder' : 'is-file'}`}>
          {isFolder ? (
            node.isOpen ? (
              <FolderOpen size={16} />
            ) : (
              <Folder size={16} />
            )
          ) : (
            <FileCode size={16} />
          )}
        </span>

        {showRename ? (
          <RenameInput
            key={forceRename ? `menu-${node.id}` : `inline-${node.id}`}
            initialValue={node.name}
            isFolder={isFolder}
            onCommit={commitRename}
            onCancel={cancelRename}
          />
        ) : (
          <span className="tree-label">{node.name}</span>
        )}

        {!isLocked && (
          <span className="tree-actions">
            <button
              type="button"
              className="tree-action"
              title="Rename"
              aria-label={`Rename ${node.name}`}
              onClick={startRename}
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              className="tree-action"
              title="Delete"
              aria-label={`Delete ${node.name}`}
              onClick={handleDelete}
            >
              <Trash2 size={14} />
            </button>
          </span>
        )}
      </div>

      {isFolder && node.isOpen && (
        <div className="tree-children">
          {creating && creating.parentId === node.id && (
            <NewNodeInput
              depth={depth + 1}
              type={creating.type}
              onSubmit={onSubmitCreate}
              onCancel={onCancelCreate}
            />
          )}
          {(node.children ?? []).map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              creating={creating}
              onSubmitCreate={onSubmitCreate}
              onCancelCreate={onCancelCreate}
              onRename={onRename}
              onDelete={onDelete}
              lockedId={lockedId}
              revealedId={revealedId}
              revealNonce={revealNonce}
              renamingId={renamingId}
              onRenameSettled={onRenameSettled}
              onOpenMenu={onOpenMenu}
              clipboardPath={clipboardPath}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}
    </div>
  )
})

function FileTree({
  nodes,
  selectedId,
  onSelect,
  onClearSelection,
  creating,
  onSubmitCreate,
  onCancelCreate,
  onRename,
  onDelete,
  lockedId = null,
  onRequestCreate,
  onCut,
  onCopy,
  onPaste,
  onCopyPath,
  onPreview,
  onRefresh,
  onCollapseAll,
  onOpenFile,
}) {
  const revealedNode = useSelector((state) => state.ui.revealedNode)
  const clipboard = useSelector((state) => state.clipboard)
  const rootRef = useRef(null)
  const [menu, setMenu] = useState(null)
  const [renamingId, setRenamingId] = useState(null)

  const closeMenu = useCallback(() => setMenu(null), [])
  const clearForcedRename = useCallback(() => setRenamingId(null), [])

  useEffect(() => {
    if (!revealedNode?.id) return
    const container = rootRef.current
    if (!container) return
    const row = container.querySelector(`[data-node-id="${CSS.escape(revealedNode.id)}"]`)
    row?.scrollIntoView({ block: 'center' })
  }, [revealedNode, nodes])

  const openMenu = useCallback(
    (event, node) => {
      event.preventDefault()
      event.stopPropagation()
      onSelect(node.id)
      setMenu({ x: event.clientX, y: event.clientY, node })
    },
    [onSelect],
  )

  function handleMouseDown(event) {
    const target = event.target
    const tag = target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
    rootRef.current?.focus()
    if (!target?.closest?.('.tree-row')) onClearSelection?.()
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      onClearSelection?.()
      return
    }
    if (event.altKey || !(event.ctrlKey || event.metaKey)) return

    const target = event.target
    const tag = target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return

    const key = event.key.toLowerCase()
    if (key !== 'c' && key !== 'x' && key !== 'v') return

    const node = selectedId ? findNode(nodes, selectedId) : null

    if (key === 'v') {
      event.preventDefault()
      const folder = node && node.type === 'folder' ? node : { id: CONTAINER_ID, type: 'folder' }
      onPaste?.(folder)
      return
    }

    if (!node) return
    event.preventDefault()
    if (key === 'c') onCopy?.(node)
    else onCut?.(node)
  }

  function buildMenuItems(node) {
    if (!node) {
      const canPaste = Boolean(clipboard.path)
      return [
        {
          id: 'new-file',
          label: 'New File',
          icon: FilePlus,
          onSelect: () => onRequestCreate(CONTAINER_ID, 'file'),
        },
        {
          id: 'new-folder',
          label: 'New Folder',
          icon: FolderPlus,
          onSelect: () => onRequestCreate(CONTAINER_ID, 'folder'),
        },
        canPaste ? { separator: true } : null,
        canPaste
          ? {
              id: 'paste',
              label: 'Paste',
              icon: Clipboard,
              onSelect: () => onPaste({ id: CONTAINER_ID, type: 'folder' }),
            }
          : null,
        { separator: true },
        {
          id: 'refresh',
          label: 'Refresh',
          icon: RefreshCw,
          onSelect: () => onRefresh?.(),
        },
        {
          id: 'collapse-all',
          label: 'Collapse All',
          icon: ChevronsUp,
          onSelect: () => onCollapseAll?.(),
        },
      ]
    }

    const isLocked = lockedId !== null && node.id === lockedId
    const isFolder = node.type === 'folder'
    const canPaste = isFolder && Boolean(clipboard.path)
    const canPreview = !isFolder && isHtmlPath(node.path ?? node.id)

    if (isLocked) {
      return [
        {
          id: 'new-file',
          label: 'New File',
          icon: FilePlus,
          onSelect: () => onRequestCreate(node.id, 'file'),
        },
        {
          id: 'new-folder',
          label: 'New Folder',
          icon: FolderPlus,
          onSelect: () => onRequestCreate(node.id, 'folder'),
        },
        canPaste ? { separator: true } : null,
        canPaste
          ? {
              id: 'paste',
              label: 'Paste',
              icon: Clipboard,
              onSelect: () => onPaste(node),
            }
          : null,
        { separator: true },
        {
          id: 'copy-path',
          label: 'Copy Path',
          icon: Link,
          onSelect: () => onCopyPath(node),
        },
      ]
    }

    return [
      isFolder
        ? {
            id: 'new-file',
            label: 'New File',
            icon: FilePlus,
            onSelect: () => onRequestCreate(node.id, 'file'),
          }
        : null,
      isFolder
        ? {
            id: 'new-folder',
            label: 'New Folder',
            icon: FolderPlus,
            onSelect: () => onRequestCreate(node.id, 'folder'),
          }
        : null,
      isFolder ? { separator: true } : null,
      { id: 'cut', label: 'Cut', icon: Scissors, onSelect: () => onCut(node) },
      { id: 'copy', label: 'Copy', icon: Copy, onSelect: () => onCopy(node) },
      canPaste
        ? {
            id: 'paste',
            label: 'Paste',
            icon: Clipboard,
            onSelect: () => onPaste(node),
          }
        : null,
      { separator: true },
      {
        id: 'rename',
        label: 'Rename',
        icon: Pencil,
        onSelect: () => setRenamingId(node.id),
      },
      {
        id: 'delete',
        label: 'Delete',
        icon: Trash2,
        danger: true,
        onSelect: () => onDelete(node),
      },
      { separator: true },
      {
        id: 'copy-path',
        label: 'Copy Path',
        icon: Link,
        onSelect: () => onCopyPath(node),
      },
      canPreview ? { separator: true } : null,
      canPreview
        ? {
            id: 'live-preview',
            label: 'Open with Live Server',
            icon: Play,
            onSelect: () => onPreview?.(node),
          }
        : null,
    ]
  }

  return (
    <div
      className="file-tree"
      ref={rootRef}
      tabIndex={-1}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => {
        if (event.target?.closest?.('[data-node-id]')) return
        event.preventDefault()
        onClearSelection?.()
        setMenu({ x: event.clientX, y: event.clientY, node: null })
      }}
    >
      {/* Top-level inline create row, before the first scratch bootstrap. */}
      {creating && creating.parentId === CONTAINER_ID && (
        <NewNodeInput
          depth={0}
          type={creating.type}
          onSubmit={onSubmitCreate}
          onCancel={onCancelCreate}
        />
      )}

      {nodes.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          depth={0}
          selectedId={selectedId}
          onSelect={onSelect}
          creating={creating}
          onSubmitCreate={onSubmitCreate}
          onCancelCreate={onCancelCreate}
          onRename={onRename}
          onDelete={onDelete}
          lockedId={lockedId}
          revealedId={revealedNode?.id ?? null}
          revealNonce={revealedNode?.nonce}
          renamingId={renamingId}
          onRenameSettled={clearForcedRename}
          onOpenMenu={openMenu}
          clipboardPath={clipboard.mode === 'cut' ? clipboard.path : null}
          onOpenFile={onOpenFile}
        />
      ))}

      {menu && (
        <TreeContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenuItems(menu.node)}
          onClose={closeMenu}
        />
      )}
    </div>
  )
}

// memo(): the Sidebar's tree selectors return a stable reference (structural
// sharing in toReduxTree) and every callback it passes down is stable, so an
// unrelated Sidebar re-render does not re-map the whole Explorer.
export default memo(FileTree)
