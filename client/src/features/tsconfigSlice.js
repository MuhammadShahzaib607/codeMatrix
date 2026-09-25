import { createSlice } from '@reduxjs/toolkit'

/**
 * The active project's TypeScript/JavaScript path-mapping config, read from its
 * tsconfig.json (or jsconfig.json) at the workspace root. `compilerOptions` is
 * the small, serializable subset that Monaco needs (baseUrl, paths, jsx,
 * target, module, moduleResolution) — see utils/monacoTsconfig.js.
 *
 * It is empty for a project without a tsconfig; EditorArea then falls back to
 * the modern React/Next defaults so JSX still type-checks.
 */
const initialState = {
  fileName: null,
  compilerOptions: null,
}

const tsconfigSlice = createSlice({
  name: 'tsconfig',
  initialState,
  reducers: {
    setTsConfig(state, action) {
      const { fileName = null, compilerOptions = null } = action.payload ?? {}
      state.fileName = fileName
      state.compilerOptions = compilerOptions
    },

    clearTsConfig(state) {
      state.fileName = null
      state.compilerOptions = null
    },
  },
})

export const { setTsConfig, clearTsConfig } = tsconfigSlice.actions

export default tsconfigSlice.reducer
