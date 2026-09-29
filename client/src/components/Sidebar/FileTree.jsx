import {
  ChevronDown,
  ChevronRight,
  ChevronsUp,
  Clipboard,
  Copy,
  FileCode,
  FilePlus,
  FileText,
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
import { addTab, toggleFolder } from '../../features/fileSystemSlice'
import { CONTAINER_ID, ROOT_ID, containerEntryId } from '../../services/fileSystemAccess'
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
// all. All callbacks passed down are stable (useCallback in the Sidebar / this
// component), so the shallow prop comparison actually holds.
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
  canDeleteProject = false,
  onDeleteProject,
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

  /**
   * ROOT-row only: deletes the WHOLE PROJECT (not the row's own path). It opens
   * the same type-the-project-name confirmation modal as the right-click menu's
   * "Delete Project" — this button just makes that action discoverable.
   */
  function handleDeleteProject(event) {
    event.stopPropagation()
    onDeleteProject?.(node)
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

        {isLocked ? (
          canDeleteProject ? (
            // The locked ROOT row: its only destructive action is deleting the
            // entire project, so it gets ONE clearly-labelled danger button
            // instead of the per-row rename/delete pair (which would delete a
            // single child path — the workspace root itself is never deletable).
            <span className="tree-actions">
              <button
                type="button"
                className="tree-action is-delete-project"
                title={`Delete project “${node.name}” (removes every file)`}
                aria-label={`Delete project ${node.name}`}
                onClick={handleDeleteProject}
              >
                <Trash2 size={14} />
              </button>
            </span>
          ) : null
        ) : (
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
              canDeleteProject={canDeleteProject}
              onDeleteProject={onDeleteProject}
            />
          ))}
        </div>
      )}
    </div>
  )
})

/**
 * One entry of the user's CONTAINER (the Explorer's top level): a sibling
 * project folder, or a plain file that lives beside the projects. Clicking a
 * project folder opens it as the active workspace; a container file is not part
 * of any project, so it explains itself instead of pretending to open.
 */
/**
 * One file (or nested folder) of a SIBLING project, rendered inline under its
 * top-level row. Clicking a file makes that file's project the active one and
 * opens the file — one click, no "select project" step in between. Nothing here
 * mutates the file: these rows exist so every project's files are usable
 * directly, exactly like the active project's own tree.
 */
function SiblingNode({ node, depth, onOpenFile }) {
  const [isOpen, setIsOpen] = useState(false)
  const isFolder = node.type === 'folder'

  return (
    <div className="sibling-node">
      <div
        className="tree-row is-sibling"
        style={{ paddingLeft: 10 + depth * 14 }}
        role="button"
        tabIndex={0}
        data-sibling-node={node.path ?? node.id}
        title={isFolder ? node.name : `${node.name} — click to open it in this project`}
        onClick={() => (isFolder ? setIsOpen((value) => !value) : onOpenFile?.(node))}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          if (isFolder) setIsOpen((value) => !value)
          else onOpenFile?.(node)
        }}
      >
        <span className="tree-chevron">
          {isFolder ? (
            isOpen ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )
          ) : null}
        </span>
        <span className={`tree-icon ${isFolder ? 'is-folder' : 'is-file'}`}>
          {isFolder ? <Folder size={16} /> : <FileText size={16} />}
        </span>
        <span className="tree-label">{node.name}</span>
      </div>
      {isFolder &&
        isOpen &&
        (node.children ?? []).map((child) => (
          <SiblingNode
            key={child.id}
            node={child}
            depth={depth + 1}
            onOpenFile={onOpenFile}
          />
        ))}
    </div>
  )
}

/**
 * The inline file list of one SIBLING project, shown under its top-level row.
 * It is expanded by default, so a freshly opened app shows every project's
 * files ready to click without any prior interaction.
 */
function SiblingProject({ entry, tree, onOpenFile }) {
  const nodes = tree?.children ?? []
  if (nodes.length === 0) {
    return (
      <div className="sibling-empty" data-sibling-empty={entry.projectId}>
        Loading {entry.name}…
      </div>
    )
  }
  return (
    <div className="sibling-project" data-sibling-project={entry.projectId}>
      {nodes.map((node) => (
        <SiblingNode key={node.id} node={node} depth={1} onOpenFile={onOpenFile} />
      ))}
    </div>
  )
}

function ContainerRow({
  entry,
  onOpenProject,
  onInspectFile,
  onToggleProject,
  onOpenFile,
  isActive,
  isExpanded,
  tree,
}) {
  const isFolder = entry.type === 'folder'
  const clickable = isFolder && Boolean(entry.projectId)

  return (
    <div className="container-group">
      <div
        data-container-entry={entry.name}
        className={`tree-row is-container ${isActive ? 'is-active-project' : ''}`}
        role="button"
        tabIndex={0}
        aria-expanded={clickable ? Boolean(isExpanded) : undefined}
        title={
          clickable
            ? `Open project “${entry.name}” — its files below are already usable; click one and the terminal, preview, export and agent follow it`
            : `${entry.name} — at the top level, outside every project`
        }
        onClick={() => (clickable ? onOpenProject?.(entry) : onInspectFile?.(entry))}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          if (clickable) onOpenProject?.(entry)
          else onInspectFile?.(entry)
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (clickable) onOpenProject?.(entry)
          else onInspectFile?.(entry)
        }}
      >
        {clickable ? (
          <Tooltip label={isExpanded ? `Hide ${entry.name}'s files` : `Show ${entry.name}'s files`}>
            <button
              type="button"
              className="tree-chevron-btn"
              aria-label={isExpanded ? `Hide files of ${entry.name}` : `Show files of ${entry.name}`}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onToggleProject?.(entry)
              }}
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          </Tooltip>
        ) : (
          <span className="tree-chevron" />
        )}
        <span className={`tree-icon ${isFolder ? 'is-folder' : 'is-file'}`}>
          {isFolder ? <Folder size={16} /> : <FileText size={16} />}
        </span>
        <span className="tree-label">{entry.name}</span>
        <span className="tree-badge">
          {isActive ? 'active project' : isFolder ? 'project' : 'top level'}
        </span>
      </div>
      {clickable && isExpanded && (
        <SiblingProject entry={entry} tree={tree} onOpenFile={onOpenFile} />
      )}
    </div>
  )
}

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
  canDeleteProject = false,
  onDeleteProject,
  containerEntries = [],
  activeProjectId = null,
  showContainer = false,
  onOpenContainerProject,
  onInspectContainerFile,
  projectTrees = {},
  collapsedProjects = [],
  onToggleContainerProject,
  onOpenContainerFile,
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

  /**
   * Clicking anywhere in the tree (except a text field) focuses the tree
   * element, which is the scope the Ctrl+C / Ctrl+X / Ctrl+V shortcuts below
   * listen on — so they can never fire while the editor or a search box is
   * focused.
   */
  function handleMouseDown(event) {
    const target = event.target
    const tag = target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
    rootRef.current?.focus()
    // Clicking the empty area of the tree deselects, like VS Code. The next
    // New File / New Folder then targets the workspace ROOT instead of whatever
    // folder happened to be selected before.
    if (!target?.closest?.('.tree-row')) onClearSelection?.()
  }

  /**
   * Explorer keyboard shortcuts, reusing the exact same clipboard state and
   * handlers as the right-click menu: Ctrl+C copies the selected row, Ctrl+X
   * cuts it, Ctrl+V pastes into the selected folder (or the workspace root when
   * a file — or nothing — is selected).
   */
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
      const folder = node && node.type === 'folder' ? node : { id: ROOT_ID, type: 'folder' }
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
      // Nothing is selected: the target is the TOP LEVEL — a sibling of the
      // project folder inside the user's container. When no workspace exists at
      // all the same call bootstraps one, exactly like the toolbar button.
      const target = showContainer ? CONTAINER_ID : ROOT_ID
      return [
        {
          id: 'new-file',
          label: 'New File',
          icon: FilePlus,
          onSelect: () => onRequestCreate(target, 'file'),
        },
        {
          id: 'new-folder',
          label: 'New Folder',
          icon: FolderPlus,
          onSelect: () => onRequestCreate(target, 'folder'),
        },
        canPaste ? { separator: true } : null,
        canPaste
          ? {
              id: 'paste',
              label: 'Paste',
              icon: Clipboard,
              onSelect: () => onPaste({ id: target, type: 'folder' }),
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
    // "Open with Live Server" is offered for .html files only (mirrors the
    // Topbar Play button; a CSS/JS file has nothing to render on its own).
    const canPreview = !isFolder && isHtmlPath(node.path ?? node.id)

    if (isLocked) {
      // The workspace root can't be cut or renamed, but the whole PROJECT can be
      // deleted from here (with a typed-name confirm — see the Sidebar).
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
        canDeleteProject ? { separator: true } : null,
        canDeleteProject
          ? {
              id: 'delete-project',
              label: 'Delete Project',
              icon: Trash2,
              danger: true,
              onSelect: () => onDeleteProject?.(node),
            }
          : null,
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
        if (event.target?.closest?.('[data-container-entry]')) return
        event.preventDefault()
        // Right-clicking the empty area clears the selection too, so the menu's
        // New File / New Folder / Paste target the top level (rule A).
        onClearSelection?.()
        setMenu({ x: event.clientX, y: event.clientY, node: null })
      }}
    >
      {/* TOP LEVEL: the user's container. The active project's own folder is NOT
          listed here (it is the project tree rendered below, or its children when
          the workspace is still an anonymous scratch); every OTHER entry is a
          sibling — another project, or a plain top-level file. */}
      {showContainer &&
        containerEntries.map((entry) => (
          <ContainerRow
            key={containerEntryId(entry.name)}
            entry={entry}
            isActive={Boolean(activeProjectId) && entry.projectId === activeProjectId}
            isExpanded={
              Boolean(entry.projectId) && !collapsedProjects.includes(entry.projectId)
            }
            tree={entry.projectId ? projectTrees[entry.projectId] : null}
            onOpenProject={onOpenContainerProject}
            onInspectFile={onInspectContainerFile}
            onToggleProject={onToggleContainerProject}
            onOpenFile={onOpenContainerFile}
          />
        ))}

      {creating && creating.parentId === CONTAINER_ID && (
        <NewNodeInput
          depth={0}
          type={creating.type}
          onSubmit={onSubmitCreate}
          onCancel={onCancelCreate}
        />
      )}

      {/* Root-level inline create row. It renders here (top level, NO indentation)
          whenever the target parent has no row of its own yet — which is exactly
          the case before the first scratch workspace is bootstrapped, and for the
          promoted children of an anonymous scratch. */}
      {creating &&
        (creating.parentId === null || creating.parentId === ROOT_ID) &&
        !nodes.some((node) => node.id === creating.parentId) && (
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
          canDeleteProject={canDeleteProject}
          onDeleteProject={onDeleteProject}
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
// sharing in toReduxTree) and every callback it passes down is now stable, so an
// unrelated Sidebar re-render (opening a confirm dialog, etc.) does not re-map
// the whole Explorer.
export default memo(FileTree)
