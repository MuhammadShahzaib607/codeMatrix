import { Folder, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import './UploadFolderDialog.css'

export default function UploadFolderDialog({ folders, onPick, onCancel }) {
  const [query, setQuery] = useState('')

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onCancel?.()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  const needle = query.trim().toLowerCase()
  const matches = folders
    .filter((folder) => !needle || String(folder.path).toLowerCase().includes(needle))
    .slice(0, 80)

  return (
    <div className="upload-folder-overlay" onMouseDown={onCancel}>
      <div
        className="upload-folder-card"
        role="dialog"
        aria-modal="true"
        aria-label="Choose a folder to upload into"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="upload-folder-head">
          <span className="upload-folder-title">Upload to which folder?</span>
          <button
            type="button"
            className="upload-folder-close"
            aria-label="Cancel upload"
            onClick={onCancel}
          >
            <X size={15} />
          </button>
        </div>

        <div className="upload-folder-search">
          <Search size={13} className="upload-folder-search-icon" />
          <input
            autoFocus
            className="upload-folder-input"
            value={query}
            placeholder="Filter folders..."
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="upload-folder-list">
          {matches.length === 0 && (
            <div className="upload-folder-empty">No folder matches that name.</div>
          )}
          {matches.map((folder) => (
            <button
              key={folder.path}
              type="button"
              className="upload-folder-item"
              style={{ paddingLeft: `${12 + Math.min(folder.depth, 6) * 14}px` }}
              onClick={() => onPick(folder)}
            >
              <Folder size={14} className="upload-folder-item-icon" />
              <span className="upload-folder-item-name">{folder.name}</span>
              <span className="upload-folder-item-path">{folder.path}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
