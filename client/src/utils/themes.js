/**
 * Theme metadata used by the Settings modal's swatch grid. The actual colour
 * values live in index.css as `[data-theme="<id>"]` blocks; `swatches` here is
 * only a small preview so the grid does not need to sample computed styles.
 */
export const THEMES = [
  {
    id: 'default-purple',
    name: 'Default Purple',
    swatches: ['#333333', '#252526', '#1e1e1e', '#8b5cf6'],
    isLight: false,
  },
  {
    id: 'midnight-black',
    name: 'Midnight Black',
    swatches: ['#0f0f0f', '#0a0a0a', '#121212', '#8b5cf6'],
    isLight: false,
  },
  {
    id: 'light',
    name: 'Light',
    swatches: ['#e8e8e8', '#f3f3f3', '#ffffff', '#7c3aed'],
    isLight: true,
  },
  {
    id: 'golden-arches',
    name: 'Golden Arches',
    swatches: ['#1b1310', '#17100d', '#1c1512', '#da291c', '#ffc72c'],
    isLight: false,
  },
  {
    id: 'forest-green',
    name: 'Forest Green',
    swatches: ['#14201a', '#0f1a14', '#0f1712', '#2e7d32'],
    isLight: false,
  },
]

export const DEFAULT_THEME_ID = 'default-purple'

export function isLightTheme(themeId) {
  return THEMES.find((theme) => theme.id === themeId)?.isLight === true
}
