import { ChevronDown, ChevronRight, FileCode, Folder, FolderOpen, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { addTab, toggleFolder } from '../../features/fileSystemSlice'

// Vertical guide lines that reproduce VS Code's indentation guides.
function IndentGuides({ depth }) {
  return Array.from({ length: depth }, (_, level) => (
    <span key={level} className="indent-guide" />
  ))
}

// Inline input rendered inside the target folder while a node is being created.
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
}) {
  const dispatch = useDispatch()
  const [isRenaming, setIsRenaming] = useState(false)
  const [draftName, setDraftName] = useState(node.name)
  const settled = useRef(false)

  const isFolder = node.type === 'folder'
  const isSelected = selectedId === node.id
  const isRevealed = revealedId === node.id
  // The workspace root cannot be renamed or deleted.
  const isLocked = lockedId !== null && node.id === lockedId

  function handleRowClick(event) {
    event.stopPropagation()
    onSelect(node.id)
    // Folders expand/collapse; files become the active tab.
    if (isFolder) dispatch(toggleFolder(node.id))
    else dispatch(addTab(node.id))
  }

  function startRename(event) {
    event.stopPropagation()
    settled.current = false
    setDraftName(node.name)
    setIsRenaming(true)
  }

  function commitRename() {
    if (settled.current) return
    settled.current = true
    setIsRenaming(false)
    const nextName = draftName.trim()
    if (nextName && nextName !== node.name) onRename(node, nextName)
  }

  function cancelRename() {
    if (settled.current) return
    settled.current = true
    setDraftName(node.name)
    setIsRenaming(false)
  }

  function handleDelete(event) {
    event.stopPropagation()
    onDelete(node)
  }

  return (
    <div className="tree-node">
      {/* Revealed rows get a nonce-based key so the flash animation replays. */}
      <div
        key={isRevealed ? `reveal-${revealNonce}` : undefined}
        data-node-id={node.id}
        className={`tree-row ${isSelected ? 'is-selected' : ''} ${isRevealed ? 'is-revealed' : ''}`}
        onClick={handleRowClick}
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

        {isRenaming ? (
          <input
            autoFocus
            className="tree-input"
            value={draftName}
            spellCheck={false}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename()
              else if (event.key === 'Escape') cancelRename()
            }}
            onBlur={commitRename}
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
}) {
  const revealedNode = useSelector((state) => state.ui.revealedNode)
  const rootRef = useRef(null)

  // Scroll the revealed row into view whenever search/quick-open jumps to a node.
  useEffect(() => {
    if (!revealedNode?.id) return
    const container = rootRef.current
    if (!container) return
    const row = container.querySelector(`[data-node-id="${CSS.escape(revealedNode.id)}"]`)
    row?.scrollIntoView({ block: 'center' })
  }, [revealedNode, nodes])

  return (
    <div className="file-tree" ref={rootRef}>
      {/* No workspace root yet (demo mode): new nodes are appended at the top level. */}
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
        />
      ))}
    </div>
  )
}
