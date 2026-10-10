import { ClipboardAddon } from '@xterm/addon-clipboard'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { setTerminalShell } from '../../features/terminalSlice'
import { getSocket } from '../../services/socket'
import { copyTextToClipboard } from '../../utils/clipboard'
import { TERMINAL_FONT_FAMILY, terminalThemeFor } from '../../utils/terminalThemes'
import { getTheme } from '../../utils/themes'

const CLIPBOARD_DENIED_MESSAGE = 'Clipboard access denied — check browser permissions'
const COPIED_MESSAGE = 'Copied'
const NOTICE_TIMEOUT_MS = 4000
const MENU_EDGE_MARGIN = 150

export default function TerminalView({ terminalId, projectId, shell, isActive, autoFocus = true }) {
  const dispatch = useDispatch()
  const appTheme = useSelector((state) => state.settings.theme)
  const terminalFontSize = useSelector((state) => state.settings.terminal.fontSize)
  // Captured once for the INITIAL xterm options; later changes are applied by
  // the sync effect below (which reads the live values), so the creation effect
  // does not need them as dependencies and never recreates the terminal.
  const initialAppearanceRef = useRef({ theme: appTheme, fontSize: terminalFontSize })
  const containerRef = useRef(null)
  const termRef = useRef(null)
  const fitRef = useRef(null)
  const actionsRef = useRef(null)
  // Small transient overlay for clipboard errors / confirmations, scoped to
  // THIS terminal instance.
  const [notice, setNotice] = useState(null)
  const noticeTimerRef = useRef(null)
  const [contextMenu, setContextMenu] = useState(null)

  useEffect(
    () => () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    const term = new Terminal({
      theme: terminalThemeFor(initialAppearanceRef.current.theme),
      fontFamily:
        getTheme(initialAppearanceRef.current.theme).fonts.terminal || TERMINAL_FONT_FAMILY,
      fontSize: initialAppearanceRef.current.fontSize,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 10000,
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, '_blank', 'noopener,noreferrer')))
    term.loadAddon(
      new ClipboardAddon(undefined, {
        readText: () => '',
        writeText: (selection, data) => {
          if (selection !== 'c') return Promise.resolve()
          return copyTextToClipboard(data).then((copied) => {
            showNotice(copied ? COPIED_MESSAGE : CLIPBOARD_DENIED_MESSAGE)
          })
        },
      }),
    )
    term.open(container)

    const socket = getSocket()
    let created = false

    function showNotice(message) {
      setNotice(message)
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
      noticeTimerRef.current = setTimeout(() => setNotice(null), NOTICE_TIMEOUT_MS)
    }

    async function copyText(text) {
      if (!text) return false
      const copied = await copyTextToClipboard(text)
      showNotice(copied ? COPIED_MESSAGE : CLIPBOARD_DENIED_MESSAGE)
      return copied
    }

    // Copy the xterm selection to the system clipboard. Used by Ctrl/Cmd+C
    // (when something is selected) and by right-click.
    async function copySelection() {
      const selection = term.getSelection()
      if (!selection) return
      if (await copyText(selection)) term.clearSelection()
    }

    // Paste the system clipboard straight into the pty, as if it were typed.
    async function pasteFromClipboard() {
      try {
        if (!navigator.clipboard?.readText) throw new Error('Clipboard API unavailable')
        const text = await navigator.clipboard.readText()
        if (text) term.paste(text)
      } catch {
        showNotice(CLIPBOARD_DENIED_MESSAGE)
      }
    }

    // Ctrl+C must COPY when there is a selection, but still send SIGINT (\x03)
    // when there is none — so process-killing Ctrl+C keeps working. Ctrl/Cmd+V
    // pastes. Both are scoped to this xterm instance (attachCustomKeyEventHandler
    // only fires for keystrokes that reach the terminal), so the Explorer's own
    // Ctrl+C/X/V shortcuts are completely unaffected.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return true

      const key = event.key.toLowerCase()

      if (key === 'c') {
        const hasSelection = term.hasSelection()
        if (!event.shiftKey && !hasSelection) return true
        event.preventDefault()
        if (hasSelection) void copySelection()
        return false
      }

      if (key === 'v') {
        event.preventDefault()
        void pasteFromClipboard()
        return false
      }

      return true
    })

    // Right-click copies an active selection (common terminal UX), otherwise it
    // falls through to the browser.
    function handleContextMenu(event) {
      event.preventDefault()
      setContextMenu({
        x: Math.max(0, Math.min(event.clientX, window.innerWidth - MENU_EDGE_MARGIN)),
        y: Math.max(0, Math.min(event.clientY, window.innerHeight - 90)),
        text: term.getSelection(),
      })
    }
    container.addEventListener('contextmenu', handleContextMenu)

    const handleOutput = (payload) => {
      if (payload?.terminalId === terminalId) term.write(payload.data)
    }
    const handleReady = (payload) => {
      if (payload?.terminalId !== terminalId) return
      term.write(`\r\n\x1b[90m${payload.shell} · ${payload.cwd}\x1b[0m\r\n`)
      // Trust the server over the request: label the tab with what actually
      // got spawned (it may differ if the requested shell was unavailable).
      dispatch(
        setTerminalShell({
          terminalId,
          shellId: payload.shellId,
          label: payload.shell,
        }),
      )
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

    // A dropped-and-restored socket re-uses the SAME terminalId so the server
    // reattaches the running pty (and its scrollback) instead of replacing it.
    let seenConnected = socket.connected
    function handleReconnect() {
      if (seenConnected) return
      seenConnected = true
      if (!created) return
      socket.emit('terminal:create', {
        terminalId,
        projectId,
        shell,
        cols: term.cols,
        rows: term.rows,
      })
    }
    function handleDisconnect() {
      seenConnected = false
    }
    socket.on('connect', handleReconnect)
    socket.on('disconnect', handleDisconnect)

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
        shell,
        cols: term.cols,
        rows: term.rows,
      })
      created = true
      term.focus()
    })

    // Debounced so an animated panel width (see .panel-slot's width transition)
    // cannot refit the pty at tiny intermediate sizes, which reflows and garbles
    // the shell's output. The fit runs once the size has settled, and an
    // undersized container (collapsed panel) is skipped entirely.
    let fitTimer = null
    function scheduleFit() {
      if (fitTimer) clearTimeout(fitTimer)
      fitTimer = setTimeout(() => {
        fitTimer = null
        if (container.clientWidth < 20 || container.clientHeight < 20) return
        try {
          fitAddon.fit()
          if (created) {
            socket.emit('terminal:resize', { terminalId, cols: term.cols, rows: term.rows })
          }
        } catch {}
      }, 70)
    }

    const observer = new ResizeObserver(scheduleFit)
    observer.observe(container)

    termRef.current = term
    fitRef.current = fitAddon
    actionsRef.current = { copySelection, copyText, pasteFromClipboard }

    // Debug/automation hook: exposes live xterm instances so the console (or
    // an automated browser test) can read the scrollback buffer.
    if (typeof window !== 'undefined') {
      window.__TERMINAL_VIEWS__ = window.__TERMINAL_VIEWS__ ?? new Map()
      window.__TERMINAL_VIEWS__.set(terminalId, term)
    }

    return () => {
      cancelAnimationFrame(raf)
      if (fitTimer) clearTimeout(fitTimer)
      observer.disconnect()
      container.removeEventListener('contextmenu', handleContextMenu)
      dataSubscription.dispose()
      socket.off('terminal:output', handleOutput)
      socket.off('terminal:ready', handleReady)
      socket.off('terminal:exit', handleExit)
      socket.off('terminal:error', handleError)
      socket.off('connect', handleReconnect)
      socket.off('disconnect', handleDisconnect)
      if (created) socket.emit('terminal:close', { terminalId })
      window.__TERMINAL_VIEWS__?.delete(terminalId)
      term.dispose()
      termRef.current = null
      fitRef.current = null
      actionsRef.current = null
      setContextMenu(null)
    }
  }, [terminalId, projectId, shell, dispatch])

  useEffect(() => {
    if (!contextMenu) return undefined
    function dismiss() {
      setContextMenu(null)
    }
    function onKeyDown(event) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setContextMenu(null)
    }
    document.addEventListener('mousedown', dismiss)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', dismiss)
    return () => {
      document.removeEventListener('mousedown', dismiss)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', dismiss)
    }
  }, [contextMenu])

  // Apply theme / font-size changes to the live xterm instance without
  // recreating it (which would kill the shell session).
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = terminalThemeFor(appTheme)
    term.options.fontFamily = getTheme(appTheme).fonts.terminal || TERMINAL_FONT_FAMILY
    term.options.fontSize = terminalFontSize
    try {
      fitRef.current?.fit()
    } catch {}
  }, [appTheme, terminalFontSize])

  useEffect(() => {
    // When this pane is not the visible one, drop keyboard focus so keystrokes
    // cannot keep reaching a hidden terminal while the other view is in use.
    if (!isActive) {
      termRef.current?.blur()
      return undefined
    }
    const raf = requestAnimationFrame(() => {
      const fit = fitRef.current
      const term = termRef.current
      const container = containerRef.current
      if (!fit || !term) return
      // Only fit once the pane has a usable size; a panel that is still
      // animating open is left to the debounced ResizeObserver instead.
      if (container && container.clientWidth >= 20 && container.clientHeight >= 20) {
        try {
          fit.fit()
        } catch {}
        getSocket().emit('terminal:resize', { terminalId, cols: term.cols, rows: term.rows })
      }
      // In a split every visible pane must fit, but only the active pane takes
      // keyboard focus — otherwise the last-rendered pane would steal it.
      if (autoFocus) term.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [isActive, autoFocus, terminalId])

  async function handleCopyFromMenu() {
    const { text } = contextMenu
    setContextMenu(null)
    const actions = actionsRef.current
    if (!actions) return
    if (await actions.copyText(text)) termRef.current?.clearSelection()
    termRef.current?.focus()
  }

  function handlePasteFromMenu() {
    setContextMenu(null)
    void actionsRef.current?.pasteFromClipboard()
    termRef.current?.focus()
  }

  return (
    <>
      <div className="terminal-view" ref={containerRef} />
      {notice && (
        <div className="terminal-notice" role="status">
          {notice}
        </div>
      )}
      {contextMenu && (
        <div
          className="terminal-context-menu"
          role="menu"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="terminal-context-item"
            disabled={!contextMenu.text}
            onClick={handleCopyFromMenu}
          >
            Copy
          </button>
          <button
            type="button"
            role="menuitem"
            className="terminal-context-item"
            onClick={handlePasteFromMenu}
          >
            Paste
          </button>
        </div>
      )}
    </>
  )
}
