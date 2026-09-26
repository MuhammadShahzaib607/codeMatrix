/**
 * DATA-DRIVEN THEME SYSTEM
 *
 * Every theme is a small spec (id, name, category, dark, a few core colours).
 * buildTheme() expands a spec into a COMPLETE palette of the exact CSS custom
 * properties the app consumes (see index.css for the variable contract), plus
 * the Monaco base theme and a terminal palette. Nothing about applying a theme
 * is theme-specific: App.jsx writes theme.palette onto <html>, monacoThemes.js
 * registers one Monaco theme per entry, and terminalThemes.js derives the xterm
 * theme from the same palette. Add a theme by appending one spec.
 */

// ---------------------------------------------------------------------------
// Colour helpers (all inputs are #rrggbb / #rgb)
// ---------------------------------------------------------------------------
function parseHex(hex) {
  const raw = String(hex).replace('#', '')
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

function toHex([r, g, b]) {
  return `#${[r, g, b]
    .map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0'))
    .join('')}`
}

/** Linear blend: t=0 -> a, t=1 -> b. */
function mix(a, b, t) {
  const A = parseHex(a)
  const B = parseHex(b)
  return toHex(A.map((v, i) => v + (B[i] - v) * t))
}

/** amount > 0 lightens toward white, < 0 darkens toward black. */
function shade(hex, amount) {
  return amount >= 0 ? mix(hex, '#ffffff', amount) : mix(hex, '#000000', -amount)
}

function rgba(hex, alpha) {
  const [r, g, b] = parseHex(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function luminance(hex) {
  const [r, g, b] = parseHex(hex).map((v) => v / 255)
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** Text colour that stays readable on top of `hex`. */
function onColor(hex) {
  return luminance(hex) > 0.55 ? '#101010' : '#ffffff'
}

// ---------------------------------------------------------------------------
// Specs. Only the fields that actually differ between themes are listed; every
// other variable is derived with readable defaults in buildTheme().
// ---------------------------------------------------------------------------
const SPECS = [
  // ---- Dark ---------------------------------------------------------------
  { id: 'default-purple', name: 'Default Purple', cat: 'dark', dark: true, accent: '#8b5cf6', bg: '#1e1e1e', surface: '#252526', topbar: '#333333', text: '#cccccc' },
  { id: 'midnight-black', name: 'Midnight Black', cat: 'dark', dark: true, accent: '#8b5cf6', bg: '#0a0a0a', surface: '#0a0a0a', topbar: '#0f0f0f', text: '#d6d6d6' },
  { id: 'forest-green', name: 'Forest Green', cat: 'dark', dark: true, accent: '#2e7d32', bg: '#0f1712', surface: '#0f1a14', text: '#d2e3d8' },
  { id: 'ocean-blue', name: 'Ocean Blue', cat: 'dark', dark: true, accent: '#0ea5e9', bg: '#0d1b2a', surface: '#0f2233', text: '#cfe3f5' },
  { id: 'dracula', name: 'Dracula', cat: 'dark', dark: true, accent: '#bd93f9', bg: '#282a36', surface: '#2b2d3a', topbar: '#21222c', text: '#f8f8f2' },
  { id: 'nord', name: 'Nord', cat: 'dark', dark: true, accent: '#88c0d0', bg: '#2e3440', surface: '#2b303b', text: '#d8dee9' },
  { id: 'solarized-dark', name: 'Solarized Dark', cat: 'dark', dark: true, accent: '#268bd2', bg: '#002b36', surface: '#073642', text: '#93a1a1' },
  { id: 'monokai', name: 'Monokai', cat: 'dark', dark: true, accent: '#a6e22e', bg: '#272822', surface: '#2c2d26', text: '#f8f8f2' },
  { id: 'github-dark', name: 'GitHub Dark', cat: 'dark', dark: true, accent: '#58a6ff', bg: '#0d1117', surface: '#161b22', topbar: '#010409', text: '#c9d1d9' },
  { id: 'one-dark', name: 'One Dark', cat: 'dark', dark: true, accent: '#61afef', bg: '#282c34', surface: '#21252b', text: '#abb2bf' },
  { id: 'gruvbox', name: 'Gruvbox', cat: 'dark', dark: true, accent: '#d79921', bg: '#282828', surface: '#32302f', topbar: '#1d2021', text: '#ebdbb2' },
  { id: 'material-ocean', name: 'Material Ocean', cat: 'dark', dark: true, accent: '#4dd0e1', bg: '#0f111a', surface: '#141727', text: '#a6accd' },
  { id: 'cobalt-night', name: 'Cobalt Night', cat: 'dark', dark: true, accent: '#2979ff', bg: '#0b1220', surface: '#0f172a', text: '#cbd5e1' },
  { id: 'sunset-orange', name: 'Sunset Orange', cat: 'dark', dark: true, accent: '#f97316', bg: '#1c1412', surface: '#221815', text: '#ecd9d0' },
  { id: 'rose-pink', name: 'Rose Pink', cat: 'colorful', dark: true, accent: '#ec4899', bg: '#1a1218', surface: '#20161d', text: '#f0d9e6' },
  { id: 'crimson-red', name: 'Crimson Red', cat: 'dark', dark: true, accent: '#ef4444', bg: '#180f10', surface: '#1e1314', text: '#f0d5d5' },
  { id: 'teal-dark', name: 'Teal', cat: 'dark', dark: true, accent: '#14b8a6', bg: '#0b1716', surface: '#0f1f1d', text: '#cdeae5' },
  { id: 'cyber-cyan', name: 'Cyber Cyan', cat: 'dark', dark: true, accent: '#22d3ee', bg: '#071418', surface: '#0a1c21', text: '#cdeef5' },
  { id: 'violet-night', name: 'Violet Night', cat: 'dark', dark: true, accent: '#a78bfa', bg: '#16121f', surface: '#1b1626', text: '#e0d8f0' },
  { id: 'emerald-dark', name: 'Emerald', cat: 'dark', dark: true, accent: '#10b981', bg: '#0b1610', surface: '#0f1f16', text: '#cdeadd' },
  { id: 'amber-dark', name: 'Amber', cat: 'dark', dark: true, accent: '#f59e0b', bg: '#1a1408', surface: '#211a0b', text: '#f0e2c0' },
  { id: 'indigo-night', name: 'Indigo Night', cat: 'dark', dark: true, accent: '#6366f1', bg: '#0e1020', surface: '#13162a', text: '#d3d7f0' },
  { id: 'slate-gray', name: 'Slate Gray', cat: 'dark', dark: true, accent: '#94a3b8', bg: '#1a1d21', surface: '#202428', text: '#cbd2d9' },
  { id: 'tokyo-night', name: 'Tokyo Night', cat: 'dark', dark: true, accent: '#7aa2f7', bg: '#1a1b26', surface: '#1f202c', text: '#c0caf5' },
  { id: 'catppuccin', name: 'Catppuccin Mocha', cat: 'dark', dark: true, accent: '#cba6f7', bg: '#1e1e2e', surface: '#232334', text: '#cdd6f4' },
  { id: 'rose-pine', name: 'Rosé Pine', cat: 'colorful', dark: true, accent: '#eb6f92', bg: '#191724', surface: '#1f1d2e', text: '#e0def4' },
  { id: 'everforest', name: 'Everforest', cat: 'dark', dark: true, accent: '#a7c080', bg: '#2b3339', surface: '#323c41', text: '#d3c6aa' },
  { id: 'kanagawa', name: 'Kanagawa', cat: 'dark', dark: true, accent: '#7e9cd8', bg: '#1f1f28', surface: '#2a2a37', text: '#dcd7ba' },
  { id: 'ayu-mirage', name: 'Ayu Mirage', cat: 'dark', dark: true, accent: '#ffcc66', bg: '#1f2430', surface: '#242936', text: '#cbccc6' },
  { id: 'palenight', name: 'Palenight', cat: 'dark', dark: true, accent: '#82aaff', bg: '#292d3e', surface: '#2f3448', text: '#a6accd' },
  { id: 'horizon', name: 'Horizon', cat: 'dark', dark: true, accent: '#e95678', bg: '#1c1e26', surface: '#232530', text: '#d5d8da' },
  { id: 'synthwave', name: 'Synthwave', cat: 'colorful', dark: true, accent: '#ff2d95', bg: '#1a1030', surface: '#20163a', text: '#f0d9ff' },
  { id: 'vaporwave', name: 'Vaporwave', cat: 'colorful', dark: true, accent: '#ff71ce', bg: '#1a1e2e', surface: '#212738', text: '#d9e0f5' },
  { id: 'retro-terminal', name: 'Retro Terminal', cat: 'colorful', dark: true, accent: '#33ff33', bg: '#0b0f0b', surface: '#0f140f', text: '#b8f0b8', folder: '#7cff7c', file: '#a6ffa6' },
  { id: 'amber-crt', name: 'Amber CRT', cat: 'colorful', dark: true, accent: '#ffb000', bg: '#120d05', surface: '#181206', text: '#ffcf7a', folder: '#ffd24a', file: '#ffcf7a' },
  { id: 'blue-steel', name: 'Blue Steel', cat: 'dark', dark: true, accent: '#4f9cf9', bg: '#1b2027', surface: '#212832', text: '#c3ccd8' },
  { id: 'deep-space', name: 'Deep Space', cat: 'dark', dark: true, accent: '#5b8def', bg: '#0a0e17', surface: '#0e1420', text: '#c8d6ea' },
  { id: 'espresso', name: 'Espresso', cat: 'colorful', dark: true, accent: '#c08457', bg: '#241b16', surface: '#2c211b', text: '#e8dcd0' },
  { id: 'golden-arches', name: 'Golden Arches', cat: 'colorful', dark: true, accent: '#da291c', bg: '#1c1512', surface: '#17100d', topbar: '#1b1310', elevated: '#241812', border: '#3d2a22', text: '#e8ddd6', strong: '#ffffff', dim: '#a89488', muted: '#867065', folder: '#ffc72c', file: '#ffd166', warning: '#ffc72c' },

  // ---- Light --------------------------------------------------------------
  { id: 'light', name: 'Light', cat: 'light', dark: false, accent: '#7c3aed', bg: '#ffffff', surface: '#f3f3f3', topbar: '#e8e8e8', text: '#1a1a1a' },
  { id: 'light-blue', name: 'Light Blue', cat: 'light', dark: false, accent: '#2563eb', bg: '#ffffff', surface: '#f1f5f9', topbar: '#e2e8f0', text: '#0f172a' },
  { id: 'light-green', name: 'Light Green', cat: 'light', dark: false, accent: '#15803d', bg: '#ffffff', surface: '#f0fdf4', topbar: '#dcfce7', text: '#052e16' },
  { id: 'light-rose', name: 'Light Rose', cat: 'light', dark: false, accent: '#e11d48', bg: '#ffffff', surface: '#fff1f2', topbar: '#ffe4e6', text: '#4c0519' },
  { id: 'solarized-light', name: 'Solarized Light', cat: 'light', dark: false, accent: '#268bd2', bg: '#fdf6e3', surface: '#eee8d5', text: '#586e75', strong: '#002b36' },
  { id: 'github-light', name: 'GitHub Light', cat: 'light', dark: false, accent: '#0969da', bg: '#ffffff', surface: '#f6f8fa', text: '#1f2328' },
  { id: 'paper', name: 'Paper', cat: 'light', dark: false, accent: '#b45309', bg: '#faf8f4', surface: '#f1ece2', topbar: '#eae3d6', text: '#3b3a36' },

  // ---- High contrast ------------------------------------------------------
  { id: 'high-contrast-dark', name: 'High Contrast Dark', cat: 'high-contrast', dark: true, accent: '#ffff00', bg: '#000000', surface: '#000000', topbar: '#000000', elevated: '#0a0a0a', border: '#ffffff', text: '#ffffff', strong: '#ffffff', dim: '#d0d0d0', muted: '#b0b0b0', folder: '#ffff00', file: '#00ffff', success: '#00ff00', warning: '#ffaa00', info: '#00ffff', danger: '#ff5555' },
  { id: 'high-contrast-light', name: 'High Contrast Light', cat: 'high-contrast', dark: false, accent: '#0000ee', bg: '#ffffff', surface: '#ffffff', topbar: '#ffffff', elevated: '#ffffff', border: '#000000', text: '#000000', strong: '#000000', dim: '#1a1a1a', muted: '#333333', folder: '#8a6d00', file: '#0000ee' },
]

const CATEGORY_LABELS = {
  dark: 'Dark',
  light: 'Light',
  colorful: 'Colorful',
  'high-contrast': 'High Contrast',
}

/** Expands a compact spec into a full CSS-variable palette. */
function buildTheme(spec) {
  const isDark = spec.dark !== false
  const bg = spec.bg
  const surface = spec.surface ?? bg
  const text = spec.text ?? (isDark ? '#cccccc' : '#1a1a1a')
  const strong = spec.strong ?? (isDark ? '#ffffff' : '#000000')
  const dim = spec.dim ?? mix(text, bg, 0.45)
  const muted = spec.muted ?? mix(text, bg, 0.62)
  const topbar = spec.topbar ?? (isDark ? shade(surface, -0.04) : shade(surface, -0.03))
  const elevated = spec.elevated ?? (isDark ? shade(surface, 0.05) : '#ffffff')
  const border = spec.border ?? mix(bg, strong, isDark ? 0.22 : 0.16)

  const accent = spec.accent
  const accentHover = spec.accentHover ?? shade(accent, isDark ? 0.12 : -0.14)
  const accentOn = spec.accentOn ?? onColor(accent)
  const accentText = spec.accentText ?? (isDark ? mix(accent, '#ffffff', 0.32) : shade(accent, -0.18))

  const danger = spec.danger ?? (isDark ? '#f48771' : '#c62828')
  const success = spec.success ?? (isDark ? '#4ec9b0' : '#1a7f5a')
  const warning = spec.warning ?? (isDark ? '#e2a03f' : '#b26a00')
  const info = spec.info ?? (isDark ? '#75beff' : '#0b62c4')
  const folder = spec.folder ?? (isDark ? '#dcb67a' : '#b8862b')
  const file = spec.file ?? (isDark ? '#75beff' : '#0b62c4')

  const palette = {
    '--bg-topbar': topbar,
    '--bg-sidebar': surface,
    '--bg-editor': bg,
    '--bg-tab-bar': topbar,
    '--bg-elevated': elevated,
    '--bg-input': isDark ? shade(bg, 0.03) : '#ffffff',
    '--bg-hover': isDark ? mix(surface, '#ffffff', 0.08) : mix(surface, '#000000', 0.06),
    '--bg-active': isDark ? mix(surface, '#ffffff', 0.15) : mix(surface, '#000000', 0.12),
    '--border': border,

    '--text': text,
    '--text-strong': strong,
    '--text-dim': dim,
    '--text-muted': muted,

    '--accent': accent,
    '--accent-hover': accentHover,
    '--accent-soft': rgba(accent, isDark ? 0.18 : 0.12),
    '--accent-on': accentOn,
    '--accent-text': accentText,

    '--danger': danger,
    '--danger-strong': shade(danger, -0.22),
    '--danger-strong-hover': shade(danger, -0.34),
    '--danger-soft': rgba(danger, isDark ? 0.16 : 0.1),
    '--success': success,
    '--warning': warning,
    '--warning-bg': isDark ? mix(bg, warning, 0.16) : mix('#ffffff', warning, 0.16),
    '--warning-border': mix(bg, warning, 0.42),
    '--warning-text': isDark ? mix(warning, '#ffffff', 0.28) : shade(warning, -0.2),
    '--info': info,
    '--folder': folder,
    '--file': file,

    '--overlay': rgba('#000000', isDark ? 0.62 : 0.35),
    '--shadow': rgba('#000000', isDark ? 0.5 : 0.2),
    '--hover-tint': rgba(isDark ? '#ffffff' : '#000000', isDark ? 0.08 : 0.06),
    '--scrollbar': rgba(isDark ? '#ffffff' : '#000000', isDark ? 0.22 : 0.25),
    '--mark-bg': rgba(accent, isDark ? 0.32 : 0.5),
    '--reveal-bg': rgba(accent, isDark ? 0.45 : 0.5),
    '--app-gradient': rgba(accent, isDark ? 0.09 : 0.06),
  }

  // Monaco's theme API only accepts hex colours, so expose a small hex-only
  // subset separately from the CSS palette (which uses rgba freely).
  const monacoColors = {
    background: bg,
    foreground: text,
    lineHighlight: isDark ? mix(surface, '#ffffff', 0.045) : mix(surface, '#000000', 0.05),
    selection: mix(bg, accent, isDark ? 0.38 : 0.24),
    cursor: accent,
    lineNumber: muted,
    lineNumberActive: text,
    indentGuide: border,
    widgetBackground: elevated,
    widgetBorder: border,
    scrollbar: isDark ? mix(surface, '#ffffff', 0.16) : mix(surface, '#000000', 0.18),
  }

  return {
    id: spec.id,
    name: spec.name,
    category: spec.cat,
    categoryLabel: CATEGORY_LABELS[spec.cat] ?? spec.cat,
    dark: isDark,
    monacoBase: isDark ? 'vs-dark' : 'vs',
    monacoAccent: accent,
    isLight: !isDark,
    swatches: [topbar, surface, bg, accent, folder],
    palette,
    monacoColors,
  }
}

export const THEMES = SPECS.map(buildTheme)
export const THEME_IDS = THEMES.map((theme) => theme.id)
export const DEFAULT_THEME_ID = 'default-purple'

export function getTheme(themeId) {
  return THEMES.find((theme) => theme.id === themeId) ?? THEMES[0]
}

export function isLightTheme(themeId) {
  return getTheme(themeId).dark === false
}
