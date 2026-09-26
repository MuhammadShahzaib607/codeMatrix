import { createSlice } from '@reduxjs/toolkit'
import { DEFAULT_SETTINGS, readSettings, sanitizeSettings } from '../services/settingsStorage'

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

    /** Back to factory defaults (theme + editor + terminal). */
    resetSettings(state) {
      const defaults = sanitizeSettings(DEFAULT_SETTINGS)
      state.theme = defaults.theme
      state.editor = defaults.editor
      state.terminal = defaults.terminal
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
  resetSettings,
} = settingsSlice.actions

export default settingsSlice.reducer
