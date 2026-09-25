import { configureStore } from '@reduxjs/toolkit'
import editorReducer from '../features/editorSlice'
import fileSystemReducer from '../features/fileSystemSlice'
import uiReducer from '../features/uiSlice'

export const store = configureStore({
  reducer: {
    fileSystem: fileSystemReducer,
    editor: editorReducer,
    ui: uiReducer,
  },
})
