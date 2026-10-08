import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './Tooltip.css'

const SHOW_DELAY_MS = 400
const GAP = 7
const VIEWPORT_MARGIN = 8
const SIDES = ['top', 'bottom', 'left', 'right']

function offsetFor(side, anchor, bubble) {
  if (side === 'top') {
    return { x: anchor.left + anchor.width / 2 - bubble.width / 2, y: anchor.top - GAP - bubble.height }
  }
  if (side === 'bottom') {
    return { x: anchor.left + anchor.width / 2 - bubble.width / 2, y: anchor.bottom + GAP }
  }
  if (side === 'left') {
    return { x: anchor.left - GAP - bubble.width, y: anchor.top + anchor.height / 2 - bubble.height / 2 }
  }
  return { x: anchor.right + GAP, y: anchor.top + anchor.height / 2 - bubble.height / 2 }
}

function fitsInside(offset, bubble, vw, vh) {
  return (
    offset.x >= VIEWPORT_MARGIN &&
    offset.y >= VIEWPORT_MARGIN &&
    offset.x + bubble.width <= vw - VIEWPORT_MARGIN &&
    offset.y + bubble.height <= vh - VIEWPORT_MARGIN
  )
}

function anchorRect(anchorEl) {
  const target = anchorEl.firstElementChild ?? anchorEl
  const rect = target.getBoundingClientRect()
  if (rect.width > 0 || rect.height > 0) return rect
  return anchorEl.getBoundingClientRect()
}

function computePlacement(anchorEl, bubbleEl, preferredSide) {
  const anchor = anchorRect(anchorEl)
  const bubble = bubbleEl.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight

  let offset = null
  let side = preferredSide
  for (const candidate of [preferredSide, ...SIDES.filter((entry) => entry !== preferredSide)]) {
    const next = offsetFor(candidate, anchor, bubble)
    if (fitsInside(next, bubble, vw, vh)) {
      offset = next
      side = candidate
      break
    }
  }
  if (!offset) offset = offsetFor(preferredSide, anchor, bubble)

  const maxX = Math.max(VIEWPORT_MARGIN, vw - bubble.width - VIEWPORT_MARGIN)
  const maxY = Math.max(VIEWPORT_MARGIN, vh - bubble.height - VIEWPORT_MARGIN)
  return {
    side,
    x: Math.min(Math.max(offset.x, VIEWPORT_MARGIN), maxX),
    y: Math.min(Math.max(offset.y, VIEWPORT_MARGIN), maxY),
  }
}

export default function Tooltip({ label, children, side = 'bottom', disabled = false }) {
  const anchorRef = useRef(null)
  const bubbleRef = useRef(null)
  const timerRef = useRef(null)
  const [isVisible, setIsVisible] = useState(false)
  const [placement, setPlacement] = useState(null)

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setIsVisible(false)
    setPlacement(null)
  }, [])

  const show = useCallback(() => {
    if (disabled || !label) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setIsVisible(true), SHOW_DELAY_MS)
  }, [disabled, label])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (!isVisible) return undefined
    const onScroll = () => hide()
    const onResize = () => hide()
    const onPointerDown = () => hide()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [isVisible, hide])

  useLayoutEffect(() => {
    if (!isVisible) return
    const anchor = anchorRef.current
    const bubble = bubbleRef.current
    if (!anchor || !bubble) return
    setPlacement(computePlacement(anchor, bubble, side))
  }, [isVisible, side, label])

  return (
    <>
      <span
        ref={anchorRef}
        className="tooltip-anchor"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {isVisible && label
        ? createPortal(
            <span
              ref={bubbleRef}
              role="tooltip"
              className={`tooltip-bubble${placement ? ' is-placed' : ''}`}
              style={placement ? { left: `${placement.x}px`, top: `${placement.y}px` } : undefined}
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </>
  )
}
