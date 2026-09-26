/**
 * Monaco does not read CSS variables, so every app theme gets a matching Monaco
 * theme built from the SAME data (utils/themes.js). All of them are registered
 * once when the editor mounts; switching is then just the <Editor theme={...}>
 * prop, which makes @monaco-editor/react call monaco.editor.setTheme() — that is
 * the real-time switch. Adding a theme to themes.js is enough; nothing here
 * needs editing.
 *
 * Monaco's theme color map is hex-only, which is why themes.js exposes a
 * separate `monacoColors` object rather than reusing the rgba CSS palette.
 */
import { THEMES, getTheme } from './themes'

export function monacoThemeFor(themeId) {
  return `cm-${getTheme(themeId).id}`
}

/** Registers every app theme with Monaco. Safe to call more than once. */
export function defineAppMonacoThemes(monaco) {
  if (!monaco?.editor?.defineTheme) return

  for (const theme of THEMES) {
    const c = theme.monacoColors
    monaco.editor.defineTheme(`cm-${theme.id}`, {
      base: theme.monacoBase,
      inherit: true,
      rules: [
        { token: 'comment', foreground: c.lineNumber, fontStyle: 'italic' },
        { token: 'keyword', foreground: theme.monacoAccent },
        { token: 'string', foreground: c.foreground },
      ],
      colors: {
        'editor.background': c.background,
        'editor.foreground': c.foreground,
        'editor.lineHighlightBackground': c.lineHighlight,
        'editor.selectionBackground': c.selection,
        'editorCursor.foreground': c.cursor,
        'editorLineNumber.foreground': c.lineNumber,
        'editorLineNumber.activeForeground': c.lineNumberActive,
        'editorIndentGuide.background1': c.indentGuide,
        'editorIndentGuide.activeBackground1': c.lineNumberActive,
        'editorWidget.background': c.widgetBackground,
        'editorWidget.border': c.widgetBorder,
        'scrollbarSlider.background': c.scrollbar,
        'scrollbarSlider.hoverBackground': c.lineNumberActive,
      },
    })
  }
}
