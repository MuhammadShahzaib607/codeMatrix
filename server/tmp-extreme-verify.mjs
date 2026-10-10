import { THEMES, DEFAULT_THEME_ID } from '../client/src/utils/themes.js'

function parseHex(hex) {
  const raw = String(hex).replace('#', '')
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
}

function luminance(hex) {
  const [r, g, b] = parseHex(hex).map((v) => v / 255)
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

let pass = 0
let fail = 0
function check(label, ok, detail = '') {
  if (ok) {
    pass += 1
  } else {
    fail += 1
    console.log(`FAIL  ${label} ${detail}`)
  }
}

const NEW_IDS = [
  'eye-bleach-reversed',
  'comic-sans-casino',
  'wet-carpet-rave',
  'clown-dentist',
  'windows-95-fever-dream',
]
const NEW_NAMES = [
  'Eye Bleach Reversed',
  'Comic Sans Casino',
  'Wet Carpet Rave',
  'Clown Dentist',
  'Windows 95 Fever Dream',
]

check('THEMES.length === 63', THEMES.length === 63, `got ${THEMES.length}`)
check(
  'last five are the new themes in order',
  JSON.stringify(THEMES.slice(-5).map((t) => t.id)) === JSON.stringify(NEW_IDS),
  JSON.stringify(THEMES.slice(-5).map((t) => t.id)),
)
check(
  'last five names in order',
  JSON.stringify(THEMES.slice(-5).map((t) => t.name)) === JSON.stringify(NEW_NAMES),
)
check('index 47 is high-contrast-light', THEMES[47]?.id === 'high-contrast-light', THEMES[47]?.id)
check('cartoon-overdose at 57', THEMES[57]?.id === 'cartoon-overdose', THEMES[57]?.id)
check('default-purple still first', THEMES[0]?.id === DEFAULT_THEME_ID)

for (const id of NEW_IDS) {
  const theme = THEMES.find((t) => t.id === id)
  const p = theme.palette
  const bg = p['--bg-editor']
  const surface = p['--bg-sidebar']
  const topbar = p['--bg-topbar']
  const elevated = p['--bg-elevated']
  const text = p['--text']
  const strong = p['--text-strong']
  const dim = p['--text-dim']
  const muted = p['--text-muted']

  check(`${id}: extreme flag`, theme.extreme === true)
  check(`${id}: category terrible`, theme.category === 'terrible')
  check(`${id}: 5 swatches`, theme.swatches.length === 5)

  const min = (label, value, floor) =>
    check(`${id}: ${label} >= ${floor}`, value >= floor, `got ${value.toFixed(2)}`)

  min('text/bg', contrast(text, bg), 3)
  min('text/surface', contrast(text, surface), 3)
  min('text/topbar', contrast(text, topbar), 3)
  min('text/elevated', contrast(text, elevated), 3)
  min('strong/bg', contrast(strong, bg), 3)
  min('dim/bg', contrast(dim, bg), 3)
  min('muted/bg', contrast(muted, bg), 3)
  min('accentOn/accent', contrast(p['--accent-on'], p['--accent']), 3)
  min('monaco fg/bg', contrast(theme.monacoColors.foreground, theme.monacoColors.background), 3)
  min('terminal fg/bg', contrast(p['--text'], p['--bg-editor']), 3)

  check(`${id}: cursor != bg`, theme.monacoColors.cursor.toLowerCase() !== bg.toLowerCase())
  check(
    `${id}: selection differs from bg`,
    theme.monacoColors.selection.toLowerCase() !== bg.toLowerCase(),
  )
  check(`${id}: folder differs from sidebar`, p['--folder'].toLowerCase() !== surface.toLowerCase())
  check(`${id}: file differs from sidebar`, p['--file'].toLowerCase() !== surface.toLowerCase())

  for (const rule of theme.monacoRules ?? []) {
    min(
      `monaco token ${rule.token}`,
      contrast(rule.foreground, theme.monacoColors.background),
      3,
    )
  }

  check(`${id}: 16 ANSI colors`, theme.ansi && Object.keys(theme.ansi).length === 16, String(theme.ansi && Object.keys(theme.ansi).length))
  for (const [name, color] of Object.entries(theme.ansi ?? {})) {
    if (name === 'black') continue
    min(`ansi ${name}`, contrast(color, bg), 3)
  }

  check(`${id}: ui font set`, Boolean(theme.fonts && typeof p['--font-ui'] === 'string' && p['--font-ui'].length > 0))
  check(`${id}: editor font set`, Boolean(theme.fonts.editor))
  check(`${id}: terminal font set`, Boolean(theme.fonts.terminal))
  const allFonts = [p['--font-ui'], p['--font-mono'], theme.fonts.editor, theme.fonts.terminal].join(' ')
  check(`${id}: no network fonts`, !/https?:|@import/i.test(allFonts))

  check(`${id}: ui font differs from default`, !p['--font-ui'].startsWith('-apple-system'), p['--font-ui'])
  check(
    `${id}: editor font differs from default`,
    !theme.fonts.editor.includes('Cascadia'),
    theme.fonts.editor,
  )
  check(
    `${id}: terminal font differs from default`,
    !theme.fonts.terminal.includes('Cascadia'),
    theme.fonts.terminal,
  )
}

for (const theme of THEMES.slice(0, -5)) {
  const ok =
    theme.extreme === false &&
    theme.monacoRules === null &&
    theme.ansi === null &&
    theme.fonts.editor === null &&
    theme.fonts.terminal === null &&
    theme.palette['--font-ui'].startsWith('-apple-system') &&
    theme.palette['--font-mono'].includes('Cascadia')
  check(`unchanged normal theme ${theme.id}`, ok)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
