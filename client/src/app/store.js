import { configureStore } from '@reduxjs/toolkit'
import authReducer from '../features/authSlice'
import clipboardReducer from '../features/clipboardSlice'
import editorReducer from '../features/editorSlice'
import explorerHistoryReducer from '../features/explorerHistorySlice'
import fileSystemReducer from '../features/fileSystemSlice'
import settingsReducer from '../features/settingsSlice'
import terminalReducer from '../features/terminalSlice'
import tsconfigReducer from '../features/tsconfigSlice'
import uiReducer from '../features/uiSlice'

export const store = configureStore({
  reducer: {
    auth: authReducer,
    clipboard: clipboardReducer,
    fileSystem: fileSystemReducer,
    editor: editorReducer,
    explorerHistory: explorerHistoryReducer,
    ui: uiReducer,
    terminal: terminalReducer,
    settings: settingsReducer,
    tsconfig: tsconfigReducer,
  },
})
