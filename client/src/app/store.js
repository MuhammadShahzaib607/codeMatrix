import { configureStore } from '@reduxjs/toolkit'
import editorReducer from '../features/editorSlice'
import fileSystemReducer from '../features/fileSystemSlice'
import terminalReducer from '../features/terminalSlice'
import uiReducer from '../features/uiSlice'

export const store = configureStore({
  reducer: {
    fileSystem: fileSystemReducer,
    editor: editorReducer,
    ui: uiReducer,
    terminal: terminalReducer,
  },
})
