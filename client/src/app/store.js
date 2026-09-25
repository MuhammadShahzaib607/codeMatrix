import { configureStore } from '@reduxjs/toolkit'
import authReducer from '../features/authSlice'
import editorReducer from '../features/editorSlice'
import fileSystemReducer from '../features/fileSystemSlice'
import terminalReducer from '../features/terminalSlice'
import uiReducer from '../features/uiSlice'

export const store = configureStore({
  reducer: {
    auth: authReducer,
    fileSystem: fileSystemReducer,
    editor: editorReducer,
    ui: uiReducer,
    terminal: terminalReducer,
  },
})
