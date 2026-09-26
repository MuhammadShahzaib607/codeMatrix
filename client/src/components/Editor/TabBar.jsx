import { FileCode2, Loader2, X } from 'lucide-react'
import { useDispatch, useSelector } from 'react-redux'
import { closeTab, setActiveFile } from '../../features/fileSystemSlice'
import { findNode } from '../../utils/tree'

export default function TabBar() {
  const dispatch = useDispatch()
  const { tree, openTabs, activeFileId } = useSelector((state) => state.fileSystem)
  const unsavedFileIds = useSelector((state) => state.editor.unsavedFileIds)
  const savingFileIds = useSelector((state) => state.editor.savingFileIds)

  if (openTabs.length === 0) return null

  return (
    <div className="tab-bar" role="tablist">
      {openTabs.map((fileId) => {
        const node = findNode(tree, fileId)
        if (!node) return null

        const isActive = fileId === activeFileId
        const isDirty = unsavedFileIds.includes(fileId)
        // Auto-save (and manual save) briefly flips this on: the unsaved dot is
        // replaced by a small spinner, then disappears once the write lands.
        const isSaving = savingFileIds.includes(fileId)

        return (
          <div
            key={fileId}
            role="tab"
            aria-selected={isActive}
            className={`tab ${isActive ? 'is-active' : ''}`}
            title={node.name}
            onClick={() => dispatch(setActiveFile(fileId))}
          >
            <FileCode2 size={14} className="tab-icon" />
            <span className="tab-name">{node.name}</span>
            <button
              type="button"
              className={`tab-close ${isDirty ? 'is-dirty' : ''} ${isSaving ? 'is-saving' : ''}`}
              title={isSaving ? 'Saving…' : 'Close'}
              aria-label={isSaving ? `Saving ${node.name}` : `Close ${node.name}`}
              onClick={(event) => {
                event.stopPropagation()
                dispatch(closeTab(fileId))
              }}
            >
              <span className="tab-dirty-dot" />
              <Loader2 size={13} className="tab-saving-spinner spin" />
              <X size={14} className="tab-close-icon" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
