import { configureStore } from '@reduxjs/toolkit'
import aiReducer from '../features/aiSlice'
import authReducer from '../features/authSlice'
import clipboardReducer from '../features/clipboardSlice'
import editorReducer from '../features/editorSlice'
import explorerHistoryReducer from '../features/explorerHistorySlice'
import fileSystemReducer from '../features/fileSystemSlice'
import projectsReducer from '../features/projectsSlice'
import settingsReducer from '../features/settingsSlice'
import terminalReducer from '../features/terminalSlice'
import tsconfigReducer from '../features/tsconfigSlice'
import uiReducer from '../features/uiSlice'

export const store = configureStore({
  reducer: {
    ai: aiReducer,
    auth: authReducer,
    clipboard: clipboardReducer,
    fileSystem: fileSystemReducer,
    projects: projectsReducer,
    editor: editorReducer,
    explorerHistory: explorerHistoryReducer,
    ui: uiReducer,
    terminal: terminalReducer,
    settings: settingsReducer,
    tsconfig: tsconfigReducer,
  },
})
