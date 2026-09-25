// Static file tree used until a real backend / file API is wired up.
// Shape:
//   file   -> { id, name, type: 'file', content }
//   folder -> { id, name, type: 'folder', isOpen, children: [] }

const appJsx = `import { useState } from 'react'
import Header from './Header'
import './App.css'

export default function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="app">
      <Header title="AI Code Editor" />
      <main className="app-main">
        <p>You clicked {count} times</p>
        <button onClick={() => setCount(count + 1)}>Increment</button>
      </main>
    </div>
  )
}
`

const headerJsx = `import { Sparkles } from 'lucide-react'

export default function Header({ title }) {
  return (
    <header className="header">
      <Sparkles size={18} />
      <h1>{title}</h1>
    </header>
  )
}
`

const indexJs = `import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './components/App'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`

const stylesCss = `:root {
  --bg: #1e1e1e;
  --text: #cccccc;
  --accent: #8b5cf6;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, sans-serif;
}

button {
  background: var(--accent);
  border: none;
  border-radius: 4px;
  color: white;
  padding: 6px 12px;
  cursor: pointer;
}
`

const useAuthJs = `import { useEffect, useState } from 'react'

// Placeholder auth hook — replace with a real API call later.
export function useAuth() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      setUser({ id: 1, name: 'Guest User' })
      setLoading(false)
    }, 300)

    return () => clearTimeout(timer)
  }, [])

  return { user, loading }
}
`

const packageJson = `{
  "name": "ai-code-editor",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@monaco-editor/react": "^4.7.0",
    "@reduxjs/toolkit": "^2.12.0",
    "lucide-react": "^1.48.0",
    "react": "^19.2.8",
    "react-dom": "^19.2.8",
    "react-redux": "^9.3.0"
  }
}
`

const readmeMd = `# AI Code Editor

A browser-based code editor prototype built with React, Redux Toolkit and Monaco.

## Features

- Nested file explorer with create / rename / delete
- Monaco editor tabs with unsaved-change indicators
- Slide-in AI assistant panel

## Getting started

1. Install dependencies
2. Run the dev server with npm run dev
3. Open the printed local URL in your browser

## Notes

The file tree is currently backed by static dummy data. A real file API
will replace it in the next phase.
`

const robotsTxt = `User-agent: *
Allow: /
`

export const dummyFileTree = [
  {
    id: 'folder-src',
    name: 'src',
    type: 'folder',
    isOpen: true,
    children: [
      {
        id: 'folder-components',
        name: 'components',
        type: 'folder',
        isOpen: true,
        children: [
          { id: 'file-app-jsx', name: 'App.jsx', type: 'file', content: appJsx },
          { id: 'file-header-jsx', name: 'Header.jsx', type: 'file', content: headerJsx },
          {
            id: 'folder-ui',
            name: 'ui',
            type: 'folder',
            isOpen: false,
            children: [
              {
                id: 'file-button-jsx',
                name: 'Button.jsx',
                type: 'file',
                content: `export default function Button({ children, ...props }) {
  return (
    <button className="btn" {...props}>
      {children}
    </button>
  )
}
`,
              },
              {
                id: 'file-button-css',
                name: 'Button.css',
                type: 'file',
                content: `.btn {
  border-radius: 4px;
  padding: 6px 12px;
}
`,
              },
            ],
          },
        ],
      },
      {
        id: 'folder-hooks',
        name: 'hooks',
        type: 'folder',
        isOpen: false,
        children: [{ id: 'file-use-auth', name: 'useAuth.js', type: 'file', content: useAuthJs }],
      },
      { id: 'file-index-js', name: 'index.js', type: 'file', content: indexJs },
      { id: 'file-styles-css', name: 'styles.css', type: 'file', content: stylesCss },
    ],
  },
  {
    id: 'folder-public',
    name: 'public',
    type: 'folder',
    isOpen: false,
    children: [{ id: 'file-robots', name: 'robots.txt', type: 'file', content: robotsTxt }],
  },
  { id: 'file-package-json', name: 'package.json', type: 'file', content: packageJson },
  { id: 'file-readme', name: 'README.md', type: 'file', content: readmeMd },
]
