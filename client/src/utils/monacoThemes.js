/**
 * Monaco does not read CSS variables, so each app theme has an explicit Monaco
 * theme here. They are registered once on editor mount and then selected via
 * the <Editor theme={...}> prop, which makes @monaco-editor/react call
 * monaco.editor.setTheme() — that is the real-time switch.
 */
const DARK_THEMES = {
  'default-purple': {
    background: '#1e1e1e',
    accent: '#8b5cf6',
    lineHighlight: '#262626',
  },
  'midnight-black': {
    background: '#0a0a0a',
    accent: '#8b5cf6',
    lineHighlight: '#151515',
  },
  'golden-arches': {
    background: '#1c1512',
    accent: '#da291c',
    lineHighlight: '#2a1d18',
  },
  'forest-green': {
    background: '#0f1712',
    accent: '#2e7d32',
    lineHighlight: '#17261d',
  },
}

export function monacoThemeFor(themeId) {
  if (themeId === 'light') return 'vs'
  return DARK_THEMES[themeId] ? `cm-${themeId}` : 'vs-dark'
}

/** Registers every custom theme. Safe to call more than once. */
export function defineAppMonacoThemes(monaco) {
  if (!monaco?.editor?.defineTheme) return
  for (const [id, palette] of Object.entries(DARK_THEMES)) {
    monaco.editor.defineTheme(`cm-${id}`, {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': palette.background,
        'editor.lineHighlightBackground': palette.lineHighlight,
        'editorCursor.foreground': palette.accent,
        'editorLineNumber.foreground': '#6b6b6b',
        'editorIndentGuide.background1': '#333333',
      },
    })
  }
}
