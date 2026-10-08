import { THEMES } from '../client/src/utils/themes.js'

const READ = ['--bg-topbar', '--bg-sidebar', '--bg-editor', '--bg-elevated', '--bg-input']

function parseHex(hex) {
  const raw = String(hex).replace('#', '')
  return [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16)]
}
function toHex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`
}
function mix(a, b, t) {
  const A = parseHex(a)
  const B = parseHex(b)
  return toHex(A.map((v, i) => v + (B[i] - v) * t))
}
function luminance(hex) {
  const [r, g, b] = parseHex(hex).map((v) => v / 255)
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function contrast(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
function worst(theme, color, surfaces = READ) {
  let out = { ratio: Infinity, surface: '' }
  for (const surface of surfaces) {
    const ratio = contrast(color, theme.palette[surface])
    if (ratio < out.ratio) out = { ratio, surface }
  }
  return out
}

for (const theme of THEMES.filter((t) => t.category === 'terrible')) {
  const p = theme.palette
  console.log(`\n=== ${theme.name} (${theme.id}) ===`)
  for (const token of ['--text', '--text-strong']) {
    const w = worst(theme, p[token])
    console.log(`  ${token} ${p[token]} worst ${w.ratio.toFixed(2)}:1 on ${w.surface}`)
  }
  for (const surface of READ) {
    const ratio = Math.min(
      contrast(p['--text'], p[surface]),
      contrast(p['--text-strong'], p[surface]),
    )
    console.log(`    read surface ${surface} ${p[surface]} -> ${ratio.toFixed(2)}:1`)
  }
  for (const surface of ['--bg-hover', '--bg-active']) {
    const ratio = Math.min(
      contrast(p['--text'], p[surface]),
      contrast(p['--text-strong'], p[surface]),
    )
    console.log(`    state surface ${surface} ${p[surface]} -> ${ratio.toFixed(2)}:1`)
  }

  let dim = null
  let muted = null
  for (let t = 0.75; t >= 0; t -= 0.01) {
    const candidate = mix(p['--text'], p['--bg-editor'], t)
    const ratio = worst(theme, candidate).ratio
    if (ratio >= 4.2 && !dim) dim = candidate
    if (ratio >= 3.2 && !muted) muted = candidate
  }
  console.log(`  suggest dim   ${dim} (min 4.2:1)`)
  console.log(`  suggest muted ${muted} (min 3.2:1)`)
}
