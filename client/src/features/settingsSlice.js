import { createSlice, nanoid } from '@reduxjs/toolkit'
import {
  DEFAULT_SETTINGS,
  STRICT_RULE_MAX_COUNT,
  STRICT_RULE_MAX_LENGTH,
  readSettings,
  sanitizeSettings,
} from '../services/settingsStorage'

/**
 * User preferences + the Settings modal's own UI state. The persisted part
 * (theme/editor/terminal) lives in localStorage via services/settingsStorage.js;
 * App.jsx writes it back whenever it changes, and applies `theme` to
 * <html data-theme="…">. `isOpen`/`activeSection` are deliberately NOT persisted.
 */
const initialState = {
  ...readSettings(),
  isOpen: false,
  activeSection: 'appearance',
}

function cleanRuleText(value) {
  let out = ''
  for (const char of String(value ?? '')) {
    const code = char.codePointAt(0)
    out += code < 32 || code === 127 ? ' ' : char
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, STRICT_RULE_MAX_LENGTH)
}

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    openSettings(state, action) {
      state.isOpen = true
      if (typeof action.payload === 'string') state.activeSection = action.payload
    },

    closeSettings(state) {
      state.isOpen = false
    },

    setSettingsSection(state, action) {
      state.activeSection = action.payload
    },

    setTheme(state, action) {
      state.theme = action.payload
    },

    updateEditorSetting(state, action) {
      const { key, value } = action.payload ?? {}
      if (key && Object.hasOwn(state.editor, key)) state.editor[key] = value
    },

    updateTerminalSetting(state, action) {
      const { key, value } = action.payload ?? {}
      if (key && Object.hasOwn(state.terminal, key)) state.terminal[key] = value
    },

    /**
     * Agent preferences that are not the strict-rules list (currently the
     * AGENT.md project-history toggle). Only keys that already exist on
     * state.agent are writable, so a stray key can never add state.
     */
    updateAgentSetting(state, action) {
      const { key, value } = action.payload ?? {}
      if (!key || !Object.hasOwn(state.agent, key)) return
      state.agent[key] = value
    },

    addStrictRule(state, action) {
      const text = cleanRuleText(action.payload)
      if (!text) return
      if (state.agent.strictRules.length >= STRICT_RULE_MAX_COUNT) return
      const key = text.toLowerCase()
      if (state.agent.strictRules.some((rule) => rule.text.toLowerCase() === key)) return
      state.agent.strictRules.push({ id: nanoid(), text, enabled: true })
    },

    updateStrictRule(state, action) {
      const { id, text } = action.payload ?? {}
      const rule = state.agent.strictRules.find((entry) => entry.id === id)
      if (!rule) return
      const next = cleanRuleText(text)
      if (!next) return
      const key = next.toLowerCase()
      if (
        state.agent.strictRules.some(
          (entry) => entry.id !== id && entry.text.toLowerCase() === key,
        )
      ) {
        return
      }
      rule.text = next
    },

    toggleStrictRule(state, action) {
      const rule = state.agent.strictRules.find((entry) => entry.id === action.payload)
      if (rule) rule.enabled = !rule.enabled
    },

    removeStrictRule(state, action) {
      state.agent.strictRules = state.agent.strictRules.filter(
        (entry) => entry.id !== action.payload,
      )
    },

    /** Back to factory defaults (theme + editor + terminal). */
    resetSettings(state) {
      const defaults = sanitizeSettings(DEFAULT_SETTINGS)
      state.theme = defaults.theme
      state.editor = defaults.editor
      state.terminal = defaults.terminal
      state.agent.projectHistory = defaults.agent.projectHistory
    },
  },
})

export const {
  openSettings,
  closeSettings,
  setSettingsSection,
  setTheme,
  updateEditorSetting,
  updateTerminalSetting,
  updateAgentSetting,
  addStrictRule,
  updateStrictRule,
  toggleStrictRule,
  removeStrictRule,
  resetSettings,
} = settingsSlice.actions

export default settingsSlice.reducer
