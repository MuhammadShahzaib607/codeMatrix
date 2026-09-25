import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The dev server's root is client/, but the repository also holds the API in
// server/. server/workspaces is the live sandbox where every imported project,
// `npm install`, file write and terminal command lands — it can emit thousands
// of file events a minute. Vite's watcher treated those as project changes and
// reloaded the WHOLE app (a full-page refresh, not HMR) on almost every
// terminal action. Ignoring that tree (and the server's node_modules) means only
// real edits under client/src trigger HMR.
//
// Glob patterns (rather than absolute paths) keep this working on Windows too.
export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      ignored: ['**/server/workspaces/**', '**/server/node_modules/**', '**/.git/**'],
    },
  },
})
