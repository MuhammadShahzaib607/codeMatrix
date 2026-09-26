/**
 * Persistence for user preferences. Kept in one place so the slice stays pure
 * and App.jsx can save on every change. Values are validated/clamped on read so
 * a hand-edited or corrupt localStorage entry can never break the UI.
 */
import { DEFAULT_THEME_ID, THEME_IDS as ALL_THEME_IDS } from '../utils/themes'

export const SETTINGS_KEY = 'code-matrix:settings'

// The single source of truth for theme ids is utils/themes.js — the palette
// data, the Settings grid and this validator all read the same list, so a new
// theme can never be "unknown" here.
export const THEME_IDS = ALL_THEME_IDS

export const DEFAULT_SETTINGS = {
  theme: DEFAULT_THEME_ID,
  editor: {
    fontSize: 14,
    tabSize: 2,
    wordWrap: false,
    minimap: true,
    fontFamily: '',
    autoSave: true,
  },
  terminal: {
    preferredShell: null,
    fontSize: 13,
  },
}

function clamp(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

export function sanitizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const editor = source.editor && typeof source.editor === 'object' ? source.editor : {}
  const terminal =
    source.terminal && typeof source.terminal === 'object' ? source.terminal : {}

  return {
    theme: oneOf(source.theme, THEME_IDS, DEFAULT_SETTINGS.theme),
    editor: {
      fontSize: clamp(editor.fontSize, 12, 24, DEFAULT_SETTINGS.editor.fontSize),
      tabSize: oneOf(editor.tabSize, [2, 4], DEFAULT_SETTINGS.editor.tabSize),
      wordWrap: Boolean(editor.wordWrap),
      minimap: editor.minimap === undefined ? true : Boolean(editor.minimap),
      fontFamily: typeof editor.fontFamily === 'string' ? editor.fontFamily : '',
      // Auto Save defaults to ON for both a fresh profile and an existing one
      // saved before the setting existed.
      autoSave: editor.autoSave === undefined ? true : Boolean(editor.autoSave),
    },
    terminal: {
      preferredShell:
        typeof terminal.preferredShell === 'string' ? terminal.preferredShell : null,
      fontSize: clamp(terminal.fontSize, 10, 22, DEFAULT_SETTINGS.terminal.fontSize),
    },
  }
}

export function readSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return sanitizeSettings(JSON.parse(raw))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function writeSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {}
}

export function clearStoredSettings() {
  try {
    localStorage.removeItem(SETTINGS_KEY)
  } catch {}
}
