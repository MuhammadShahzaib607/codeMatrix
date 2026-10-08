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
  Upload,
} from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { setFolderOpen, toggleFolder } from '../../features/fileSystemSlice'
import { CONTAINER_ID } from '../../services/fileSystemAccess'
import {
  EXPLORER_DRAG_TYPE,
  hasDroppedFolder,
  isCopyModifier,
  isExplorerDrag,
  isFileDrag,
} from '../../utils/dropFiles'
import { isInvalidTransferTarget, transferTargetFolderPath } from '../../utils/explorerTransfer'
import { isBinaryPath } from '../../utils/fileTypes'
import { isHtmlPath } from '../../utils/preview'
import { findNode } from '../../utils/tree'
import Tooltip from '../Common/Tooltip'
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
  dragOverId,
  draggingId,
  onRowDragStart,
  onRowDragEnd,
  onRowDragOver,
  onRowDragLeave,
  onRowDrop,
}) {
  const dispatch = useDispatch()
  const [isRenaming, setIsRenaming] = useState(false)

  const isFolder = node.type === 'folder'
  const isDropTarget = dragOverId === node.id
  const isDragging = draggingId === node.id
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
        draggable
        className={`tree-row ${isSelected ? 'is-selected' : ''} ${isRevealed ? 'is-revealed' : ''} ${
          clipboardPath === node.id ? 'is-cut' : ''
        } ${isDropTarget ? 'is-drop-target' : ''} ${isDragging ? 'is-dragging' : ''}`}
        onClick={handleRowClick}
        onContextMenu={handleContextMenu}
        onDragStart={(event) => onRowDragStart?.(event, node)}
        onDragEnd={() => onRowDragEnd?.()}
        onDragOver={(event) => onRowDragOver?.(event, node)}
        onDragLeave={(event) => onRowDragLeave?.(event, node)}
        onDrop={(event) => onRowDrop?.(event, node)}
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
            <Tooltip label="Rename" side="top">
              <button
                type="button"
                className="tree-action"
                aria-label={`Rename ${node.name}`}
                onClick={startRename}
              >
                <Pencil size={14} />
              </button>
            </Tooltip>
            <Tooltip label="Delete" side="top">
              <button
                type="button"
                className="tree-action"
                aria-label={`Delete ${node.name}`}
                onClick={handleDelete}
              >
                <Trash2 size={14} />
              </button>
            </Tooltip>
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
              dragOverId={dragOverId}
              draggingId={draggingId}
              onRowDragStart={onRowDragStart}
              onRowDragEnd={onRowDragEnd}
              onRowDragOver={onRowDragOver}
              onRowDragLeave={onRowDragLeave}
              onRowDrop={onRowDrop}
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
  onCopyRelativePath,
  onCopyPathRelativeToFile,
  onPreview,
  onRefresh,
  onCollapseAll,
  onOpenFile,
  onUploadFiles,
  onDropFiles,
  onTransfer,
}) {
  const revealedNode = useSelector((state) => state.ui.revealedNode)
  const clipboard = useSelector((state) => state.clipboard)
  const activeFileId = useSelector((state) => state.fileSystem.activeFileId)
  const hasOpenCodeFile = Boolean(activeFileId) && !isBinaryPath(activeFileId)
  const rootRef = useRef(null)
  const [menu, setMenu] = useState(null)
  const [renamingId, setRenamingId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  const [dragSource, setDragSource] = useState(null)
  const [rootOver, setRootOver] = useState(false)
  const expandTimerRef = useRef(null)
  const expandHoverRef = useRef(null)

  const closeMenu = useCallback(() => setMenu(null), [])
  const clearForcedRename = useCallback(() => setRenamingId(null), [])

  const clearExpandTimer = useCallback(() => {
    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current)
      expandTimerRef.current = null
    }
    expandHoverRef.current = null
  }, [])

  const resetDrag = useCallback(() => {
    setDragSource(null)
    setDragOverId(null)
    setRootOver(false)
    clearExpandTimer()
  }, [clearExpandTimer])

  const handleRowDragStart = useCallback((event, node) => {
    event.stopPropagation()
    const payload = node.path ?? node.id
    event.dataTransfer.setData(EXPLORER_DRAG_TYPE, payload)
    event.dataTransfer.setData('text/plain', payload)
    event.dataTransfer.effectAllowed = 'copyMove'
    setDragSource(node)
  }, [])

  const handleRowDragOver = useCallback(
    (event, node) => {
      if (isExplorerDrag(event)) {
        event.preventDefault()
        event.stopPropagation()
        if (rootOver) setRootOver(false)
        const folderPath = transferTargetFolderPath(node)
        const invalid = isInvalidTransferTarget(dragSource, folderPath)
        event.dataTransfer.dropEffect = invalid ? 'none' : isCopyModifier(event) ? 'copy' : 'move'
        setDragOverId(invalid ? null : node.id)

        if (node.type === 'folder' && dragSource?.id !== node.id && !node.isOpen) {
          if (expandHoverRef.current !== node.id) {
            clearExpandTimer()
            expandHoverRef.current = node.id
            expandTimerRef.current = setTimeout(() => {
              dispatch(setFolderOpen({ id: node.id, isOpen: true }))
              expandTimerRef.current = null
            }, 700)
          }
        } else {
          clearExpandTimer()
        }
        return
      }

      if (!isFileDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'copy'
      setDragOverId(node.id)
    },
    [clearExpandTimer, dragSource, rootOver],
  )

  const handleRowDragLeave = useCallback(
    (event, node) => {
      if (event.currentTarget.contains(event.relatedTarget)) return
      setDragOverId((current) => (current === node.id ? null : current))
      if (expandHoverRef.current === node.id) clearExpandTimer()
    },
    [clearExpandTimer],
  )

  const handleRowDrop = useCallback(
    (event, node) => {
      if (isExplorerDrag(event)) {
        event.preventDefault()
        event.stopPropagation()
        const source = dragSource
        const copy = isCopyModifier(event)
        resetDrag()
        if (!source) return
        const folderPath = transferTargetFolderPath(node)
        if (isInvalidTransferTarget(source, folderPath)) return
        onTransfer?.(source, folderPath, { copy })
        return
      }

      if (!isFileDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      setDragOverId(null)
      onDropFiles?.(node, event.dataTransfer.files, { hasDirectory: hasDroppedFolder(event) })
    },
    [dragSource, onDropFiles, onTransfer, resetDrag],
  )

  function handleTreeDragOver(event) {
    if (!isExplorerDrag(event)) return
    event.preventDefault()
    const invalid = isInvalidTransferTarget(dragSource, '')
    event.dataTransfer.dropEffect = invalid ? 'none' : isCopyModifier(event) ? 'copy' : 'move'
    setRootOver(!invalid && Boolean(dragSource))
  }

  function handleTreeDragLeave(event) {
    if (event.currentTarget.contains(event.relatedTarget)) return
    setRootOver(false)
  }

  function handleTreeDrop(event) {
    if (!isExplorerDrag(event)) return
    event.preventDefault()
    const source = dragSource
    const copy = isCopyModifier(event)
    resetDrag()
    if (!source || isInvalidTransferTarget(source, '')) return
    onTransfer?.(source, '', { copy })
  }

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
      isFolder
        ? {
            id: 'upload-files',
            label: 'Upload files...',
            icon: Upload,
            onSelect: () => onUploadFiles?.(node),
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
      {
        id: 'copy-relative-path',
        label: 'Copy relative path',
        icon: Link,
        onSelect: () => onCopyRelativePath?.(node),
      },
      hasOpenCodeFile
        ? {
            id: 'copy-relative-open-file',
            label: 'Copy path relative to open file',
            icon: FileCode,
            onSelect: () => onCopyPathRelativeToFile?.(node),
          }
        : null,
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
      className={`file-tree ${rootOver ? 'is-root-drop-target' : ''}`}
      ref={rootRef}
      tabIndex={-1}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      onDragOver={handleTreeDragOver}
      onDragLeave={handleTreeDragLeave}
      onDrop={handleTreeDrop}
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
          dragOverId={dragOverId}
          draggingId={dragSource?.id ?? null}
          onRowDragStart={handleRowDragStart}
          onRowDragEnd={resetDrag}
          onRowDragOver={handleRowDragOver}
          onRowDragLeave={handleRowDragLeave}
          onRowDrop={handleRowDrop}
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
