import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef } from 'react'
import { getSocket } from '../../services/socket'

const THEME = {
  background: '#1e1e1e',
  foreground: '#cccccc',
  cursor: '#ffffff',
  cursorAccent: '#1e1e1e',
  selectionBackground: 'rgba(139, 92, 246, 0.35)',
  black: '#1e1e1e',
  brightBlack: '#767676',
}

const FONT_FAMILY = "'SF Mono', 'Cascadia Code', Menlo, Consolas, 'Courier New', monospace"

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
      const detail = payload.exitCode === undefined ? '' : ` with code ${payload.exitCode}`
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

    const raf = requestAnimationFrame(() => {
      try {
        fitAddon.fit()
      } catch {}
      socket.emit('terminal:create', {
        terminalId,
        projectId,
        cols: term.cols,
        rows: term.rows,
      })
      created = true
      term.focus()
    })

    const observer = new ResizeObserver(() => {
      if (container.clientWidth < 20 || container.clientHeight < 20) return
      try {
        fitAddon.fit()
        if (created) {
          socket.emit('terminal:resize', { terminalId, cols: term.cols, rows: term.rows })
        }
      } catch {}
    })
    observer.observe(container)

    termRef.current = term
    fitRef.current = fitAddon

    // Debug/automation hook: exposes live xterm instances so the console (or
    // an automated browser test) can read the scrollback buffer.
    if (typeof window !== 'undefined') {
      window.__TERMINAL_VIEWS__ = window.__TERMINAL_VIEWS__ ?? new Map()
      window.__TERMINAL_VIEWS__.set(terminalId, term)
    }

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      dataSubscription.dispose()
      socket.off('terminal:output', handleOutput)
      socket.off('terminal:ready', handleReady)
      socket.off('terminal:exit', handleExit)
      socket.off('terminal:error', handleError)
      if (created) socket.emit('terminal:close', { terminalId })
      window.__TERMINAL_VIEWS__?.delete(terminalId)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [terminalId, projectId])

  useEffect(() => {
    if (!isActive) return undefined
    const raf = requestAnimationFrame(() => {
      const fit = fitRef.current
      const term = termRef.current
      if (!fit || !term) return
      try {
        fit.fit()
      } catch {}
      getSocket().emit('terminal:resize', { terminalId, cols: term.cols, rows: term.rows })
      term.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [isActive, terminalId])

  return <div className="terminal-view" ref={containerRef} />
}
