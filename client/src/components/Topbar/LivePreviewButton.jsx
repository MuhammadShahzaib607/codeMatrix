import { Play } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import useAuthGuard from '../../hooks/useAuthGuard'
import { previewTargetForPath } from '../../utils/containerPaths'
import { collectHtmlFiles, isHtmlPath, openPreviewTab } from '../../utils/preview'
import { findNode } from '../../utils/tree'
import { hasActiveWorkspace } from '../../utils/workspace'
import Tooltip from '../Common/Tooltip'

/**
 * The Topbar Play button: opens the project in a real browser tab, Live Server
 * style. Resolution order on click:
 *
 *   1. the file currently open in the editor, when it is .html;
 *   2. index.html at the workspace root;
 *   3. otherwise a small menu listing every .html file in the project.
 *
 * The button is enabled only while the active workspace contains at least one
 * .html file. Each choice opens a NEW tab (window.open) at
 * /preview/:projectId/<path>?token=<jwt>.
 */
export default function LivePreviewButton() {
  const guard = useAuthGuard()
  const workspace = useSelector((state) => state.fileSystem.workspace)
  const tree = useSelector((state) => state.fileSystem.tree)
  const activeFileId = useSelector((state) => state.fileSystem.activeFileId)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const wrapRef = useRef(null)

  const previewTargets = useMemo(
    () =>
      collectHtmlFiles(tree)
        .map((file) => ({ ...file, target: previewTargetForPath(file.path, tree) }))
        .filter((file) => file.target),
    [tree],
  )
  const canPreview = hasActiveWorkspace(workspace) && previewTargets.length > 0

  // Clicking anywhere outside closes the file picker.
  useEffect(() => {
    function handlePointerDown(event) {
      if (!wrapRef.current?.contains(event.target)) setIsMenuOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  const openFile = useCallback((file) => {
    if (!file?.target) return
    openPreviewTab(file.target.projectId, file.target.innerPath)
    setIsMenuOpen(false)
  }, [])

  function handleClick() {
    if (!canPreview) return
    guard(() => {
      // 1. The active editor tab, when it is HTML.
      const activeNode = activeFileId ? findNode(tree, activeFileId) : null
      const activePath = activeNode?.path ?? activeNode?.id
      if (activeNode && activeNode.type !== 'folder' && isHtmlPath(activePath)) {
        const target = previewTargetForPath(activePath, tree)
        if (target) {
          openPreviewTab(target.projectId, target.innerPath)
          setIsMenuOpen(false)
          return
        }
      }

      // 2. index.html at the project root.
      const rootIndex = previewTargets.find(
        (file) =>
          file.target.projectId === workspace.projectId &&
          file.target.innerPath.toLowerCase() === 'index.html',
      )
      if (rootIndex) {
        openFile(rootIndex)
        return
      }

      // 3. Nothing obvious to open: a lone .html file is opened directly, a
      //    project with several shows a menu so the user picks one.
      if (previewTargets.length === 1) {
        openFile(previewTargets[0])
        return
      }
      setIsMenuOpen((open) => !open)
    }, 'Please sign in to open a live preview')
  }

  return (
    <div className="live-preview" ref={wrapRef}>
      <Tooltip label="Open live preview">
        <button
          type="button"
          className={`icon-btn ${isMenuOpen ? 'is-active' : ''}`}
          aria-label="Open live preview"
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          disabled={!canPreview}
          onClick={handleClick}
        >
          <Play size={18} />
        </button>
      </Tooltip>

      {isMenuOpen && previewTargets.length > 0 && (
        <div className="live-preview-menu" role="menu">
          <div className="live-preview-menu-title">Choose a page to preview</div>
          {previewTargets.map((file) => (
            <button
              key={file.id}
              type="button"
              role="menuitem"
              className="live-preview-item"
              title={file.path}
              onClick={() => openFile(file)}
            >
              <Play size={13} className="live-preview-item-icon" />
              <span className="live-preview-item-path">{file.path}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
