import { X } from 'lucide-react'
import { Fragment, useRef } from 'react'
import { useDispatch } from 'react-redux'
import {
  TERMINAL_PANE_MIN_SHARE,
  removeTerminal,
  setActivePane,
  setSplitSizes,
} from '../../features/terminalSlice'
import { getSocket } from '../../services/socket'
import TerminalView from './TerminalView'

/**
 * Renders one tab group that holds 2+ terminals side by side, divided by thin
 * draggable vertical bars. Every pane keeps its own terminalId → its own xterm
 * instance → its own server-side pty, and can be closed on its own with the X
 * in its small header. Closing the last-but-one pane makes the parent render a
 * plain full-width TerminalView instead (see TerminalPanel).
 */
export default function SplitTerminalView({ group, projectId, activePaneId, isVisible }) {
  const dispatch = useDispatch()
  const containerRef = useRef(null)
  const sizes =
    group.sizes?.length === group.panes.length ? group.sizes : group.panes.map(() => 1)

  function closePane(event, terminalId) {
    event.stopPropagation()
    getSocket().emit('terminal:close', { terminalId })
    dispatch(removeTerminal(terminalId))
  }

  // index is the divider between panes[index] and panes[index + 1]. Dragging it
  // moves weight between exactly those two panes and leaves the others alone.
  function startDividerDrag(event, index) {
    if (event.button !== 0) return
    event.preventDefault()
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    if (rect.width < 1) return

    const startSizes = [...sizes]
    const total = startSizes.reduce((sum, size) => sum + size, 0) || 1
    const pairTotal = startSizes[index] + startSizes[index + 1]
    const minShare = pairTotal * TERMINAL_PANE_MIN_SHARE
    const startX = event.clientX

    document.body.classList.add('is-resizing-cols')

    function onMove(moveEvent) {
      // Pane width is proportional to its weight, so a pixel delta maps to a
      // weight delta scaled by the group's total weight.
      const nextLeft = startSizes[index] + ((moveEvent.clientX - startX) / rect.width) * total
      const clamped = Math.min(pairTotal - minShare, Math.max(minShare, nextLeft))
      const next = [...startSizes]
      next[index] = clamped
      next[index + 1] = pairTotal - clamped
      dispatch(setSplitSizes({ groupId: group.groupId, sizes: next }))
    }

    function onUp() {
      document.body.classList.remove('is-resizing-cols')
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div className="terminal-split" ref={containerRef}>
      {group.panes.map((pane, index) => (
        <Fragment key={pane.terminalId}>
          {index > 0 && (
            <div
              className="terminal-split-divider"
              role="separator"
              aria-orientation="vertical"
              title="Drag to resize the split"
              onMouseDown={(event) => startDividerDrag(event, index - 1)}
            />
          )}
          <div
            className={`terminal-split-pane ${
              pane.terminalId === activePaneId ? 'is-active' : ''
            }`}
            style={{ flexGrow: sizes[index] ?? 1 }}
            onMouseDown={() => dispatch(setActivePane(pane.terminalId))}
          >
            <div className="terminal-split-header">
              <span className="terminal-split-title" title={pane.title}>
                {pane.title}
              </span>
              <button
                type="button"
                className="terminal-split-close"
                title={`Close ${pane.title}`}
                aria-label={`Close ${pane.title}`}
                onClick={(event) => closePane(event, pane.terminalId)}
              >
                <X size={12} />
              </button>
            </div>
            <div className="terminal-split-body">
              <TerminalView
                terminalId={pane.terminalId}
                projectId={projectId}
                shell={pane.shell}
                isActive={isVisible}
                autoFocus={isVisible && pane.terminalId === activePaneId}
              />
            </div>
          </div>
        </Fragment>
      ))}
    </div>
  )
}
