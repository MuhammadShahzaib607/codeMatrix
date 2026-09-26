/**
 * xterm.js renders to a canvas/WebGL layer, so it cannot read our CSS
 * variables. Each app theme maps to an explicit xterm theme object here. The
 * Light theme uses a dark-on-light ANSI palette (the default neon-on-black set
 * is unreadable on white).
 */
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

const TERMINAL_THEMES = {
  'default-purple': {
    background: '#1e1e1e',
    foreground: '#cccccc',
    cursor: '#ffffff',
    cursorAccent: '#1e1e1e',
    selectionBackground: 'rgba(139, 92, 246, 0.35)',
    ...DARK_ANSI,
  },
  'midnight-black': {
    background: '#0a0a0a',
    foreground: '#d6d6d6',
    cursor: '#ffffff',
    cursorAccent: '#0a0a0a',
    selectionBackground: 'rgba(139, 92, 246, 0.3)',
    ...DARK_ANSI,
  },
  light: {
    background: '#ffffff',
    foreground: '#1a1a1a',
    cursor: '#000000',
    cursorAccent: '#ffffff',
    selectionBackground: 'rgba(124, 58, 237, 0.25)',
    ...LIGHT_ANSI,
  },
  'golden-arches': {
    background: '#1c1512',
    foreground: '#e8ddd6',
    cursor: '#ffc72c',
    cursorAccent: '#1c1512',
    selectionBackground: 'rgba(218, 41, 28, 0.35)',
    ...DARK_ANSI,
    green: '#7bc86c',
    yellow: '#ffc72c',
    brightYellow: '#ffdd80',
  },
  'forest-green': {
    background: '#0f1712',
    foreground: '#d2e3d8',
    cursor: '#7fd18a',
    cursorAccent: '#0f1712',
    selectionBackground: 'rgba(46, 125, 50, 0.35)',
    ...DARK_ANSI,
    green: '#7fd18a',
    brightGreen: '#a7e6b0',
  },
}

export function terminalThemeFor(themeId) {
  return TERMINAL_THEMES[themeId] ?? TERMINAL_THEMES['default-purple']
}

export const TERMINAL_FONT_FAMILY =
  "'SF Mono', 'Cascadia Code', Menlo, Consolas, 'Courier New', monospace"
