import { useEffect, useRef, useState } from 'react'
import './Tooltip.css'

const SHOW_DELAY_MS = 450

/**
 * Small reusable hover/focus tooltip. Wrap any single element:
 *
 *   <Tooltip label="Export project as .zip">
 *     <button className="icon-btn">…</button>
 *   </Tooltip>
 *
 * The bubble appears after a short delay (so it does not flash while the cursor
 * sweeps the toolbar) and disappears immediately on leave/blur. `side` can be
 * 'bottom' (default, for the topbar) or 'top' (for bottom-docked toolbars).
 * The wrapped child should keep its own aria-label for accessibility.
 */
export default function Tooltip({ label, children, side = 'bottom', disabled = false }) {
  const [isVisible, setIsVisible] = useState(false)
  const timerRef = useRef(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  function show() {
    if (disabled || !label) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setIsVisible(true), SHOW_DELAY_MS)
  }

  function hide() {
    if (timerRef.current) clearTimeout(timerRef.current)
    setIsVisible(false)
  }

  return (
    <span
      className="tooltip-anchor"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {isVisible && (
        <span className={`tooltip-bubble is-${side}`} role="tooltip">
          {label}
        </span>
      )}
    </span>
  )
}
