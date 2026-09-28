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
  agent: {
    strictRules: [],
  },
}

export const STRICT_RULE_MAX_COUNT = 20
export const STRICT_RULE_MAX_LENGTH = 300

function clamp(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

function stripControlChars(text) {
  let out = ''
  for (const char of text) {
    const code = char.codePointAt(0)
    out += code < 32 || code === 127 ? ' ' : char
  }
  return out
}

export function sanitizeStrictRules(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const rules = []
  for (const entry of raw) {
    if (rules.length >= STRICT_RULE_MAX_COUNT) break
    const source = entry && typeof entry === 'object' ? entry.text : entry
    const text = stripControlChars(String(source ?? ''))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, STRICT_RULE_MAX_LENGTH)
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    rules.push({
      id:
        entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id
          ? entry.id
          : `rule-${rules.length}-${text.length}`,
      text,
      enabled: entry && typeof entry === 'object' ? entry.enabled !== false : true,
    })
  }
  return rules
}

export function sanitizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const editor = source.editor && typeof source.editor === 'object' ? source.editor : {}
  const terminal =
    source.terminal && typeof source.terminal === 'object' ? source.terminal : {}
  const agent = source.agent && typeof source.agent === 'object' ? source.agent : {}

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
    agent: {
      strictRules: sanitizeStrictRules(agent.strictRules),
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
