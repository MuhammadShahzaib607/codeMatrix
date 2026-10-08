/**
 * xterm.js renders to a canvas/WebGL layer, so it cannot read our CSS variables.
 * The xterm theme is derived from the SAME data-driven theme palettes in
 * utils/themes.js: the surface/foreground/cursor/selection come straight from the
 * palette, and the 16 ANSI colours are the standard dark or light set depending
 * on whether the theme is dark. Add a theme to themes.js and the terminal
 * follows automatically.
 */
import { getTheme } from './themes'

const DARK_ANSI = {
  black: '#1e1e1e',
  red: '#f48771',
  green: '#4ec9b0',
  yellow: '#dcdcaa',
  blue: '#75beff',
  magenta: '#c586c0',
  cyan: '#4fc1ff',
  white: '#cccccc',
  brightBlack: '#767676',
  brightRed: '#ff8f7a',
  brightGreen: '#6ee7cf',
  brightYellow: '#f0e6a8',
  brightBlue: '#9bd1ff',
  brightMagenta: '#d7a3d7',
  brightCyan: '#7fd4ff',
  brightWhite: '#ffffff',
}

const LIGHT_ANSI = {
  black: '#000000',
  red: '#c62828',
  green: '#1a7f5a',
  yellow: '#8a6d00',
  blue: '#0b62c4',
  magenta: '#a21caf',
  cyan: '#0e7490',
  white: '#1a1a1a',
  brightBlack: '#5a5a5a',
  brightRed: '#b3261e',
  brightGreen: '#146b4c',
  brightYellow: '#6f5600',
  brightBlue: '#0a4fa0',
  brightMagenta: '#86198f',
  brightCyan: '#0c5f77',
  brightWhite: '#000000',
}

export function terminalThemeFor(themeId) {
  const theme = getTheme(themeId)
  const p = theme.palette
  return {
    background: p['--bg-editor'],
    foreground: p['--text'],
    cursor: p['--accent'],
    cursorAccent: p['--bg-editor'],
    selectionBackground: p['--accent-soft'],
    ...(theme.ansi ?? (theme.dark ? DARK_ANSI : LIGHT_ANSI)),
  }
}

export const TERMINAL_FONT_FAMILY =
  "'SF Mono', 'Cascadia Code', Menlo, Consolas, 'Courier New', monospace"
