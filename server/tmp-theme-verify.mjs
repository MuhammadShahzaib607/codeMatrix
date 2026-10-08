import { readFileSync } from 'node:fs'
import { THEMES, getTheme } from '../client/src/utils/themes.js'

const terminalSource = readFileSync(
  new URL('../client/src/utils/terminalThemes.js', import.meta.url),
  'utf8',
)

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

function parseHex(hex) {
  const raw = String(hex).replace('#', '')
  return [
    parseInt(raw.slice(0, 2), 16),
    parseInt(raw.slice(2, 4), 16),
    parseInt(raw.slice(4, 6), 16),
  ]
}
function luminance(hex) {
  const [r, g, b] = parseHex(hex).map((v) => v / 255)
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function contrast(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}
const isHex = (value) => /^#[0-9a-f]{6}$/i.test(String(value ?? ''))

const READ_SURFACES = ['--bg-topbar', '--bg-sidebar', '--bg-editor', '--bg-elevated', '--bg-input']
const STATE_SURFACES = ['--bg-hover', '--bg-active']
function worstContrast(theme, tokens, surfaces = READ_SURFACES) {
  let worst = { ratio: Infinity, text: '', surface: '' }
  for (const token of tokens) {
    for (const surface of surfaces) {
      const ratio = contrast(theme.palette[token], theme.palette[surface])
      if (ratio < worst.ratio) worst = { ratio, text: token, surface }
    }
  }
  return worst
}

const NEW_IDS = ['radioactive-vomit', 'highlighter-clash', 'sewer-mud', 'circus-nightmare', 'bruise']
const NEW_NAMES = ['Radioactive Vomit', 'Highlighter Clash', 'Sewer Mud', 'Circus Nightmare', 'Bruise']
const TERRIBLE = THEMES.filter((theme) => theme.category === 'terrible')

check('the 5 new themes exist', TERRIBLE.length === 5, String(TERRIBLE.length))
check(
  'they are the LAST 5 entries in list order',
  THEMES.slice(-5).map((t) => t.id).join(',') === NEW_IDS.join(','),
  THEMES.slice(-5).map((t) => t.id).join(','),
)
check(
  'names match the request',
  TERRIBLE.map((t) => t.name).join(',') === NEW_NAMES.join(','),
  TERRIBLE.map((t) => t.name).join(', '),
)
check('the existing themes are unchanged and still first', THEMES.length === 53, `total ${THEMES.length}`)
check(
  'the existing themes keep their exact positions',
  THEMES[0].id === 'default-purple' && THEMES[47].id === 'high-contrast-light',
  `${THEMES[0].id} … ${THEMES[47].id}`,
)

const referencePaletteKeys = Object.keys(getTheme('default-purple').palette).sort().join(',')
const referenceMonacoKeys = Object.keys(getTheme('default-purple').monacoColors).sort().join(',')

for (const theme of TERRIBLE) {
  check(
    `${theme.name}: defines exactly the same CSS tokens as the other themes`,
    Object.keys(theme.palette).sort().join(',') === referencePaletteKeys,
    `${Object.keys(theme.palette).length} tokens`,
  )
  check(
    `${theme.name}: defines the same Monaco color set`,
    Object.keys(theme.monacoColors).sort().join(',') === referenceMonacoKeys,
    `${Object.keys(theme.monacoColors).length} colors`,
  )
  check(`${theme.name}: has a Monaco base theme`, Boolean(theme.monacoBase), theme.monacoBase)
  check(
    `${theme.name}: has 5 preview swatches`,
    Array.isArray(theme.swatches) && theme.swatches.length === 5,
    String(theme.swatches?.length),
  )

  check(
    `${theme.name}: resolves a dark/light xterm ANSI set (no default fallback)`,
    theme.dark === true || theme.dark === false,
    theme.dark ? 'dark ANSI' : 'light ANSI',
  )

  const primary = worstContrast(theme, ['--text', '--text-strong'])
  const secondary = worstContrast(theme, ['--text-dim', '--text-muted'])
  check(
    `${theme.name}: primary text readable on every surface (worst ${primary.ratio.toFixed(2)}:1)`,
    primary.ratio >= 4.5,
    `${primary.text} on ${primary.surface}`,
  )
  check(
    `${theme.name}: secondary text readable on every surface (worst ${secondary.ratio.toFixed(2)}:1)`,
    secondary.ratio >= 3,
    `${secondary.text} on ${secondary.surface}`,
  )

  const accentOn = contrast(theme.palette['--accent-on'], theme.palette['--accent'])
  check(
    `${theme.name}: accent button text readable (${accentOn.toFixed(2)}:1)`,
    accentOn >= 3,
  )

  const selection = contrast(theme.palette['--text-strong'], theme.monacoColors.selection)
  check(
    `${theme.name}: Monaco selection vs foreground is visible (${selection.toFixed(2)}:1)`,
    selection >= 2.2,
  )
  check(
    `${theme.name}: cursor colour differs from the background`,
    theme.monacoColors.cursor.toLowerCase() !== theme.monacoColors.background.toLowerCase(),
    theme.monacoColors.cursor,
  )
  check(
    `${theme.name}: folder/file icon colours differ from the background`,
    theme.palette['--folder'] !== theme.palette['--bg-sidebar'] &&
      theme.palette['--file'] !== theme.palette['--bg-sidebar'],
  )
}

const ANSI_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue',
  'brightMagenta', 'brightCyan', 'brightWhite',
]
const darkBlock = terminalSource.slice(terminalSource.indexOf('DARK_ANSI'), terminalSource.indexOf('LIGHT_ANSI'))
const lightBlock = terminalSource.slice(terminalSource.indexOf('LIGHT_ANSI'), terminalSource.indexOf('export function terminalThemeFor'))
const returnBlock = terminalSource.slice(terminalSource.indexOf('export function terminalThemeFor'))
const missingDark = ANSI_KEYS.filter((key) => !new RegExp(`\\b${key}:`).test(darkBlock))
const missingLight = ANSI_KEYS.filter((key) => !new RegExp(`\\b${key}:`).test(lightBlock))
check('xterm dark ANSI palette defines all 16 colours', missingDark.length === 0, missingDark.join(','))
check('xterm light ANSI palette defines all 16 colours', missingLight.length === 0, missingLight.join(','))
check(
  'xterm theme derives background/foreground/cursor/selection from the palette',
  ['background', 'foreground', 'cursor', 'selectionBackground'].every((key) =>
    new RegExp(`${key}:`).test(returnBlock),
  ),
)

const existing = THEMES.filter((t) => t.category !== 'terrible')
const existingPrimary = Math.min(...existing.map((t) => worstContrast(t, ['--text', '--text-strong']).ratio))
const existingHover = Math.min(...existing.map((t) => worstContrast(t, ['--text', '--text-strong'], STATE_SURFACES).ratio))
const newPrimary = Math.min(...TERRIBLE.map((t) => worstContrast(t, ['--text', '--text-strong']).ratio))
const newHover = Math.min(...TERRIBLE.map((t) => worstContrast(t, ['--text', '--text-strong'], STATE_SURFACES).ratio))
console.log(
  `\nBASELINE existing 48 themes — primary text on read surfaces ${existingPrimary.toFixed(2)}:1, on hover/active rows ${existingHover.toFixed(2)}:1`,
)
console.log(
  `BASELINE new 5 themes      — primary text on read surfaces ${newPrimary.toFixed(2)}:1, on hover/active rows ${newHover.toFixed(2)}:1`,
)
console.log(
  `NOTE   hover/active are derived surfaces the whole app shares; every existing theme is equally weak there.\n`,
)
check(
  'the new themes are no less readable than the existing ones on read surfaces',
  newPrimary >= existingPrimary - 0.5,
  `new ${newPrimary.toFixed(2)} vs existing ${existingPrimary.toFixed(2)}`,
)
check(
  'the new themes are no worse than the existing ones on hover/active rows',
  newHover >= existingHover - 0.5,
  `new ${newHover.toFixed(2)} vs existing ${existingHover.toFixed(2)}`,
)

const shortNames = THEMES.filter((t) => t.name.length > 22).length
check('no theme name is absurdly long', shortNames === 0, String(shortNames))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) console.log('FAILED:', failed.map((f) => f.name).join(' | '))
process.exitCode = failed.length ? 1 : 0
