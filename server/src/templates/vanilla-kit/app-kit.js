import { fontsHref, getThemePreset, DEFAULT_THEME_ID } from './themes.js'
import { initialMark } from './scaffold.js'
import { ICONS_SCRIPT } from './icons.js'

export const APP_CSS = `
/* ==========================================================================
   CodeMatrix Starter Kit — app layer
   Structure for a single-purpose utility app: an app bar and one screen.
   There is deliberately NO nav, hero, testimonial, pricing or footer markup —
   an app is not a marketing page. Tokens above come from the shared kit, so
   colours and fonts come from css/theme.css and a palette swap re-skins it.
   Append your own component rules at the END of this file.
   ========================================================================== */

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  -webkit-text-size-adjust: 100%;
}

body,
body.app {
  margin: 0;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: var(--font-body);
  font-size: var(--step-0);
  line-height: 1.65;
  color: var(--text);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}

h1,
h2,
h3,
h4 {
  font-family: var(--font-heading);
  margin: 0 0 var(--space-4);
  line-height: 1.18;
  color: var(--text);
}

p {
  margin: 0 0 var(--space-4);
}

a {
  color: var(--primary-600);
  text-decoration: none;
}

a:hover {
  color: var(--primary-hover);
  text-decoration: underline;
  text-underline-offset: 3px;
}

img,
svg,
video,
canvas {
  max-width: 100%;
  display: block;
}

:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 3px;
  border-radius: var(--radius-sm);
}

/* --- app bar: sticky by default. A sticky bar holds its own space, so nothing
   can ever slide underneath it. Only an out-of-flow (fixed/absolute) bar needs
   the body padding js/app.js measures into --header-offset. --- */
.app-bar {
  position: sticky;
  top: 0;
  z-index: 50;
  background: color-mix(in srgb, var(--bg) 86%, transparent);
  backdrop-filter: blur(14px) saturate(160%);
  border-bottom: 1px solid var(--border);
}

.app-bar__inner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  max-width: var(--app-width);
  margin-inline: auto;
  padding-inline: var(--space-5);
  min-height: var(--header-h);
}

.app-bar__mark {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--primary), var(--accent));
  color: var(--on-primary);
  font-size: var(--step--1);
  font-weight: 800;
  letter-spacing: 0.02em;
}

.app-bar__title {
  margin: 0;
  font-size: var(--step-1);
  letter-spacing: -0.01em;
}

.app-bar__meta {
  margin: 0 0 0 auto;
  color: var(--muted);
  font-size: var(--step--1);
}

body.has-fixed-header {
  padding-top: var(--header-offset);
}

/* --- the single screen --- */
.app-shell {
  flex: 1 0 auto;
  width: 100%;
  max-width: var(--app-width);
  margin-inline: auto;
  padding: var(--space-6) var(--space-5) var(--space-9);
}

.app-shell--narrow {
  max-width: 720px;
}

.app-head {
  margin-bottom: var(--space-6);
}

.app-head__lead {
  color: var(--muted);
  max-width: 60ch;
}

.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  padding: var(--space-6);
}

.panel--flush {
  padding: 0;
  overflow: hidden;
}

.panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}

.panel__title {
  margin: 0;
  font-size: var(--step-1);
}

.panel__hint {
  margin: var(--space-2) 0 0;
  color: var(--muted);
  font-size: var(--step--1);
}

.app-grid {
  display: grid;
  gap: var(--space-5);
  grid-template-columns: 1fr;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.toolbar__spacer {
  margin-left: auto;
}

/* --- controls. Every hover uses a derived token, never the resting surface,
   so a hover is always visible. --- */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: var(--space-3) var(--space-5);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: background-color var(--transition), border-color var(--transition), color var(--transition);
}

.btn:hover {
  background: var(--surface-2-hover);
}

.btn--primary {
  background: var(--primary);
  color: var(--on-primary);
}

.btn--primary:hover {
  background: var(--primary-hover);
}

.btn--ghost {
  background: transparent;
  border-color: var(--border);
}

.btn--ghost:hover {
  background: var(--hover-overlay);
  border-color: color-mix(in srgb, var(--primary) 40%, var(--border));
}

.btn--block {
  width: 100%;
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.icon-btn {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  transition: background-color var(--transition), border-color var(--transition);
}

.icon-btn:hover {
  background: var(--surface-hover);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.label {
  font-weight: 600;
  font-size: var(--step--1);
}

.input,
.textarea,
.select {
  width: 100%;
  min-height: 44px;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  transition: border-color var(--transition), background-color var(--transition);
}

.input:hover,
.textarea:hover,
.select:hover {
  background: var(--surface-hover);
}

.input:focus-visible,
.textarea:focus-visible,
.select:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}

.textarea {
  min-height: 120px;
  resize: vertical;
}

.hint {
  color: var(--muted);
  font-size: var(--step--1);
}

.error {
  color: var(--danger);
  font-size: var(--step--1);
  font-weight: 600;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.list__item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  transition: background-color var(--transition), border-color var(--transition);
}

.list__item:hover {
  background: var(--surface-hover);
  border-color: color-mix(in srgb, var(--primary) 30%, var(--border));
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--muted);
  font-size: var(--step--1);
  font-weight: 600;
}

.chip:hover {
  background: var(--surface-2-hover);
}

.readout {
  font-family: var(--font-mono);
  font-size: var(--step-4);
  line-height: 1.1;
  word-break: break-all;
  margin: 0 0 var(--space-5);
  text-align: right;
}

.muted {
  color: var(--muted);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.notice {
  margin: var(--space-4) 0 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text);
  font-weight: 600;
}

@media (max-width: 640px) {
  .app-shell {
    padding: var(--space-5) var(--space-4) var(--space-8);
  }

  .panel {
    padding: var(--space-5);
  }

  .readout {
    font-size: var(--step-3);
  }
}

@media (min-width: 900px) {
  .app-grid--2 {
    grid-template-columns: 1fr 1fr;
  }

  .app-grid--sidebar {
    grid-template-columns: 320px 1fr;
    align-items: start;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
`

export const APP_JS = `;(function () {
  'use strict'

  function ready(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true })
    } else {
      callback()
    }
  }

  function one(selector, scope) {
    return (scope || document).querySelector(selector)
  }

  function all(selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector))
  }

  function on(target, type, handler, options) {
    if (!target || typeof target.addEventListener !== 'function') return function () {}
    target.addEventListener(type, handler, options)
    return function () {
      target.removeEventListener(type, handler, options)
    }
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max)
  }

  function formatNumber(value, digits) {
    var fixed = typeof digits === 'number' ? Number(value).toFixed(digits) : String(value)
    var parts = fixed.split('.')
    parts[0] = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',')
    return parts.join('.')
  }

  function save(key, value) {
    try {
      window.localStorage.setItem('cm-app:' + key, JSON.stringify(value))
    } catch (error) {
      return false
    }
    return true
  }

  function load(key, fallback) {
    try {
      var raw = window.localStorage.getItem('cm-app:' + key)
      return raw === null ? fallback : JSON.parse(raw)
    } catch (error) {
      return fallback
    }
  }

  function syncHeaderOffset() {
    var bar = document.querySelector('.app-bar, header')
    if (!bar || !document.body) return
    var box = bar.getBoundingClientRect()
    var height = Math.round(box.height)
    if (height > 0) document.documentElement.style.setProperty('--header-offset', height + 'px')
    var position = window.getComputedStyle(bar).position
    var outOfFlow = (position === 'fixed' || position === 'absolute') && box.top <= 1
    document.body.classList.toggle('has-fixed-header', outOfFlow)
  }

  ready(syncHeaderOffset)
  on(window, 'resize', syncHeaderOffset)
  ready(function () {
    if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
      document.fonts.ready.then(syncHeaderOffset)
    }
  })

  window.CMApp = {
    ready: ready,
    one: one,
    all: all,
    on: on,
    clamp: clamp,
    formatNumber: formatNumber,
    save: save,
    load: load,
    syncHeaderOffset: syncHeaderOffset,
  }
})()
`

function appMark(brand, title) {
  return initialMark(brand || title || 'App')
}

export function normalizeAppInput(input) {
  const theme = getThemePreset(input?.palette ?? DEFAULT_THEME_ID)
  const brand = String(input?.brand ?? '').trim()
  const title = String(input?.title ?? '').trim() || brand || 'App'
  const description =
    String(input?.description ?? '').trim() || `${title} — a fast, focused tool that works offline in the browser.`
  return { brand, title, description, theme, pages: [{ file: 'index.html', title, sections: ['app'] }] }
}

export function buildAppShell({ title, description, theme, brand }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="${fontsHref(theme.fonts)}">
  <link rel="stylesheet" href="css/theme.css">
  <link rel="stylesheet" href="css/app.css">
</head>
<body class="app">
  <header class="app-bar">
    <div class="app-bar__inner">
      <span class="app-bar__mark" aria-hidden="true">${appMark(brand, title)}</span>
      <h1 class="app-bar__title">${title}</h1>
    </div>
  </header>
  <main class="app-shell" id="app">
    <!-- SLOT:app -->
  </main>
  <script src="js/icons.js" defer></script>
  <script src="js/app.js" defer></script>
</body>
</html>
`
}

export function buildAppFiles(input) {
  const { brand, title, description, theme, pages } = normalizeAppInput(input)
  const files = [
    { path: 'css/theme.css', content: theme.css, kind: 'theme' },
    { path: 'css/app.css', content: null, kind: 'app-css' },
    { path: 'js/app.js', content: APP_JS, kind: 'app-js' },
    { path: 'js/icons.js', content: ICONS_SCRIPT, kind: 'icons' },
    {
      path: 'index.html',
      content: buildAppShell({ title, description, theme, brand }),
      kind: 'page',
    },
  ]
  return { brand, title, description, theme, pages, files }
}

export function extractKitTokens(baseCss) {
  const match = /\/\* kit-tokens:start[\s\S]*?\*\/([\s\S]*?)\/\* kit-tokens:end \*\//.exec(String(baseCss ?? ''))
  return match ? match[1].trim() : ''
}

export function appStylesheet(tokens) {
  const header = `/* ==========================================================================
   CodeMatrix Starter Kit — app tokens (shared with css/base.css)
   ========================================================================== */

`
  return `${header}${tokens}\n${APP_CSS}`
}
