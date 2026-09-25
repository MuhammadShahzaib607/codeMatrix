import { useEffect, useLayoutEffect, useRef } from 'react'

/**
 * VS Code style context menu for an Explorer row.
 *
 * `items` is a list of either
 *   { id, label, icon: Component, onSelect, disabled?, danger? }  -> a row, or
 *   { separator: true }                                          -> a divider
 * `null` entries are skipped (handy for conditional items).
 *
 * Closes on: item click, a mousedown anywhere outside, or Escape.
 * Rendered with position: fixed so it escapes the sidebar's overflow clipping,
 * and clamped so it never spills outside the viewport.
 */
export default function TreeContextMenu({ x, y, items, onClose }) {
  const menuRef = useRef(null)
  const positionRef = useRef({ x, y })

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    const maxX = Math.max(0, window.innerWidth - rect.width - 8)
    const maxY = Math.max(0, window.innerHeight - rect.height - 8)
    positionRef.current = { x: Math.min(x, maxX), y: Math.min(y, maxY) }
    menu.style.left = `${positionRef.current.x}px`
    menu.style.top = `${positionRef.current.y}px`
  }, [x, y, items])

  useEffect(() => {
    function handlePointerDown(event) {
      if (!menuRef.current?.contains(event.target)) onClose()
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const visibleItems = items.filter(Boolean)

  return (
    <div
      ref={menuRef}
      className="tree-context-menu"
      role="menu"
      style={{ left: x, top: y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {visibleItems.map((item, index) =>
        item.separator ? (
          // eslint-disable-next-line react/no-array-index-key
          <div key={`sep-${index}`} className="tree-context-separator" role="separator" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`tree-context-item ${item.danger ? 'is-danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return
              item.onSelect()
              onClose()
            }}
          >
            <item.icon size={14} className="tree-context-icon" />
            <span>{item.label}</span>
          </button>
        ),
      )}
    </div>
  )
}
