import {
  ChevronDown,
  ChevronRight,
  Clipboard,
  Copy,
  FileCode,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Link,
  Pencil,
  Scissors,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { addTab, toggleFolder } from '../../features/fileSystemSlice'
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

function TreeNode({
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
}) {
  const dispatch = useDispatch()
  const [isRenaming, setIsRenaming] = useState(false)

  const isFolder = node.type === 'folder'
  const isSelected = selectedId === node.id
  const isRevealed = revealedId === node.id
  const isLocked = lockedId !== null && node.id === lockedId
  // Rename can be started from the hover pencil (local state) or from the
  // context menu (the tree publishes the target id; each row compares it against
  // its OWN id, so nested rows work too).
  const forceRename = renamingId === node.id
  const showRename = isRenaming || forceRename

  function handleRowClick(event) {
    event.stopPropagation()
    onSelect(node.id)
    if (isFolder) dispatch(toggleFolder(node.id))
    else dispatch(addTab(node.id))
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
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function FileTree({
  nodes,
  selectedId,
  onSelect,
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
      // Right-click also selects the row, like VS Code, so the highlighted row
      // and the menu always refer to the same node.
      onSelect(node.id)
      setMenu({ x: event.clientX, y: event.clientY, node })
    },
    [onSelect],
  )

  function buildMenuItems(node) {
    const isLocked = lockedId !== null && node.id === lockedId
    const isFolder = node.type === 'folder'
    const canPaste = isFolder && Boolean(clipboard.path)

    if (isLocked) {
      // The workspace root can't be cut, renamed or deleted.
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
    ]
  }

  return (
    <div className="file-tree" ref={rootRef}>
      {creating && creating.parentId === null && (
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
