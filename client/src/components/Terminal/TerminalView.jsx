import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef } from 'react'
import { getSocket } from '../../services/socket'

// Matches the editor's dark theme (#1e1e1e) per the design.
const THEME = {
  background: '#1e1e1e',
  foreground: '#cccccc',
  cursor: '#ffffff',
  cursorAccent: '#1e1e1e',
  selectionBackground: 'rgba(139, 92, 246, 0.35)',
  black: '#1e1e1e',
  brightBlack: '#767676',
}

const FONT_FAMILY =
  "'SF Mono', 'Cascadia Code', Menlo, Consolas, 'Courier New', monospace"

/**
 * One real terminal: an xterm.js instance wired to a single server-side pty.
 * The instance stays mounted while the tab exists (even when hidden), so its
 * shell process is never torn down just because the user switched tabs.
 */
export default function TerminalView({ terminalId, projectId, isActive }) {
  const containerRef = useRef(null)
  const termRef = useRef(null)
  const fitRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    const term = new Terminal({
      theme: THEME,
      fontFamily: FONT_FAMILY,
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 2000,
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)

    const socket = getSocket()
    let created = false

    const handleOutput = (payload) => {
      if (payload?.terminalId === terminalId) term.write(payload.data)
    }
    const handleReady = (payload) => {
      if (payload?.terminalId === terminalId) {
        term.write(`\r\n\x1b[90m${payload.shell} · ${payload.cwd}\x1b[0m\r\n`)
      }
    }
    const handleExit = (payload) => {
      if (payload?.terminalId !== terminalId) return
      const detail =
        payload.exitCode === undefined ? '' : ` with code ${payload.exitCode}`
      term.write(`\r\n\x1b[90m[process exited${detail}]\x1b[0m\r\n`)
    }
    const handleError = (payload) => {
      if (payload?.terminalId === terminalId) {
        term.write(`\r\n\x1b[31m[terminal error] ${payload.message}\x1b[0m\r\n`)
      }
    }

    socket.on('terminal:output', handleOutput)
    socket.on('terminal:ready', handleReady)
    socket.on('terminal:exit', handleExit)
    socket.on('terminal:error', handleError)

    const dataSubscription = term.onData((data) => {
      socket.emit('terminal:input', { terminalId, data })
    })

    // Fit + create on the next frame so the container has a real size. The rAF
    // is cancelled on unmount, so React StrictMode's mount/unmount/remount cycle
    // cannot spawn a stray pty.
    const raf = requestAnimationFrame(() => {
      try {
        fitAddon.fit()
      } catch {
        // Container not laid out yet — the ResizeObserver below will retry.
      }
      socket.emit('terminal:create', {
        terminalId,
        projectId,
        cols: term.cols,
        rows: term.rows,
      })
      created = true
      term.focus()
    })

    // Keep the pty size in step with the panel/window.
    const observer = new ResizeObserver(() => {
      if (container.clientWidth < 20 || container.clientHeight < 20) return
      try {
        fitAddon.fit()
        if (created) {
          socket.emit('terminal:resize', { terminalId, cols: term.cols, rows: term.rows })
        }
      } catch {
        // Ignore transient sizing failures while the panel animates.
      }
    })
    observer.observe(container)

    termRef.current = term
    fitRef.current = fitAddon

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      dataSubscription.dispose()
      socket.off('terminal:output', handleOutput)
      socket.off('terminal:ready', handleReady)
      socket.off('terminal:exit', handleExit)
      socket.off('terminal:error', handleError)
      // Only close a pty we actually told the server to create.
      if (created) socket.emit('terminal:close', { terminalId })
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [terminalId, projectId])

  // Re-fit and focus whenever this tab becomes active.
  useEffect(() => {
    if (!isActive) return undefined
    const raf = requestAnimationFrame(() => {
      const fit = fitRef.current
      const term = termRef.current
      if (!fit || !term) return
      try {
        fit.fit()
      } catch {
        // Ignore.
      }
      getSocket().emit('terminal:resize', { terminalId, cols: term.cols, rows: term.rows })
      term.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [isActive, terminalId])

  return <div className="terminal-view" ref={containerRef} />
}
